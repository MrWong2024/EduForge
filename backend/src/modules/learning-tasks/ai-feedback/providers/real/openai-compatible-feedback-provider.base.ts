import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeedbackSeverity,
  FeedbackType,
} from '../../../schemas/feedback.schema';
import {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../../interfaces/ai-feedback-provider.interface';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';
import { AiFeedbackProviderError } from '../../interfaces/ai-feedback-provider.error';
import {
  AI_FEEDBACK_ERROR_CODES,
  AiFeedbackProviderErrorCode,
} from '../../interfaces/ai-feedback-provider.error-codes';
import {
  normalizeFeedbackItems,
  RawFeedbackItem,
} from '../../lib/feedback-normalizer';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '../../prompts/ai-feedback.prompt';
import { AI_FEEDBACK_JSON_PROTOCOL } from '../../protocol/ai-feedback-json.protocol';

type OpenAiCompatibleChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type OpenAiCompatibleProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  maxCodeChars: number;
  maxItems: number;
};

type OpenAiCompatibleProviderOptions = {
  providerName: string;
  logName: string;
  errorMessagePrefix: string;
};

type ProviderErrorCode = AiFeedbackProviderErrorCode;

const DEFAULT_SEVERITY = FeedbackSeverity.Warn;
const PROMPT_PROTOCOL_MAX_ITEMS = 2;
const ALLOWED_ROOT_KEYS = new Set<string>(
  AI_FEEDBACK_JSON_PROTOCOL.allowedRootKeys as readonly string[],
);
const ALLOWED_ITEM_KEYS = new Set<string>(
  AI_FEEDBACK_JSON_PROTOCOL.allowedItemKeys as readonly string[],
);
const ALLOWED_TYPES = new Set<string>(
  AI_FEEDBACK_JSON_PROTOCOL.allowedTypes as readonly string[],
);
const ALLOWED_SEVERITIES = new Set<string>(
  AI_FEEDBACK_JSON_PROTOCOL.allowedSeverities as readonly string[],
);

class OpenAiCompatibleProviderError extends AiFeedbackProviderError {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    messagePrefix: string,
    cause?: unknown,
  ) {
    super(code, retryable, `${messagePrefix}: ${code}`, cause);
  }
}

export abstract class OpenAiCompatibleFeedbackProviderBase implements AiFeedbackProvider {
  protected constructor(
    protected readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly options: OpenAiCompatibleProviderOptions,
  ) {}

  async analyzeSubmission(
    context: AiSubmissionAnalysisContext,
  ): Promise<AiFeedbackItem[]> {
    const config = this.getConfig();

    if (!config.apiKey?.trim()) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.MISSING_API_KEY,
        false,
      );
    }

    const submissionId = context.submissionId;
    const classroomTaskId = context.classroomTaskId;
    const request = this.buildRequest(context, config);
    const startMs = Date.now();
    let retryCount = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      if (attempt > 0) {
        retryCount = attempt;
        await this.sleep(this.getBackoffMs(attempt));
      }
      try {
        const response = await this.callProvider(request, config.timeoutMs);
        const parsedItems = this.parseResponse(response);
        const protocolMaxItems = Math.min(
          config.maxItems,
          PROMPT_PROTOCOL_MAX_ITEMS,
        );
        const items = parsedItems.slice(0, protocolMaxItems);
        if (parsedItems.length > protocolMaxItems) {
          this.logger.warn(
            `${this.options.logName} feedback items exceeded protocol cap: submissionId=${submissionId}, classroomTaskId=${classroomTaskId ?? 'n/a'}, provider=${this.options.providerName}, model=${config.model}, receivedItems=${parsedItems.length}, cappedTo=${protocolMaxItems}`,
          );
        }
        const durationMs = Date.now() - startMs;
        this.logger.debug(
          `${this.options.logName} feedback success: submissionId=${submissionId}, classroomTaskId=${classroomTaskId ?? 'n/a'}, provider=${this.options.providerName}, model=${config.model}, durationMs=${durationMs}, retried=${retryCount > 0}`,
        );
        return items;
      } catch (error) {
        const providerError = this.toProviderError(error);
        if (providerError.retryable && attempt < config.maxRetries) {
          continue;
        }
        const durationMs = Date.now() - startMs;
        this.logger.warn(
          `${this.options.logName} feedback failed: submissionId=${submissionId}, classroomTaskId=${classroomTaskId ?? 'n/a'}, provider=${this.options.providerName}, model=${config.model}, durationMs=${durationMs}, retried=${retryCount > 0}, error=${providerError.code}`,
        );
        throw providerError;
      }
    }

    throw this.createProviderError(AI_FEEDBACK_ERROR_CODES.UPSTREAM_5XX, true);
  }

  protected abstract getConfig(): OpenAiCompatibleProviderConfig;

  protected buildExtraHeaders(
    config: OpenAiCompatibleProviderConfig,
  ): Record<string, string> {
    void config;
    return {};
  }

  protected buildPayloadExtras(
    config: OpenAiCompatibleProviderConfig,
  ): Record<string, unknown> {
    void config;
    return {};
  }

  protected readInt(key: string, fallback: number) {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private buildRequest(
    context: AiSubmissionAnalysisContext,
    config: OpenAiCompatibleProviderConfig,
  ) {
    const baseUrl = config.baseUrl.replace(/\/+$/g, '');
    const endpoint = `${baseUrl}/chat/completions`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({
      context,
      maxCodeChars: config.maxCodeChars,
    });
    const payload = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      ...this.buildPayloadExtras(config),
    };
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...this.buildExtraHeaders(config),
    };

    return { endpoint, payload, headers, model: config.model };
  }

  private async callProvider(
    request: {
      endpoint: string;
      payload: unknown;
      headers: Record<string, string>;
      model: string;
    },
    timeoutMs: number,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.payload),
        signal: controller.signal,
      });
      if (response.ok) {
        try {
          return (await response.json()) as OpenAiCompatibleChatResponse;
        } catch {
          throw this.createProviderError(
            AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
            false,
          );
        }
      }
      throw this.mapHttpError(response.status);
    } catch (error) {
      throw this.toProviderError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapHttpError(status: number) {
    if (status === 401 || status === 403) {
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.UNAUTHORIZED,
        false,
      );
    }
    if (status === 429) {
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_UPSTREAM,
        true,
      );
    }
    if (status >= 500) {
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.UPSTREAM_5XX,
        true,
      );
    }
    if (status >= 400 && status <= 499) {
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.UPSTREAM_4XX,
        false,
      );
    }
    return this.createProviderError(
      AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
      false,
    );
  }

  private parseResponse(data: OpenAiCompatibleChatResponse): AiFeedbackItem[] {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const raw = content.trim();
    const directResult = this.tryParseJson(raw);
    if (directResult.ok) {
      return this.validateParsedResponse(directResult.value);
    }

    const fenced = this.extractJsonFencedBlock(raw);
    if (fenced) {
      const fencedResult = this.tryParseJson(fenced);
      if (fencedResult.ok) {
        return this.validateParsedResponse(fencedResult.value);
      }
    }

    throw this.createProviderError(AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE, false);
  }

  private validateParsedResponse(parsed: unknown): AiFeedbackItem[] {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const rootKeys = Object.keys(parsed as Record<string, unknown>);
    if (
      rootKeys.length === 0 ||
      rootKeys.some((key) => !ALLOWED_ROOT_KEYS.has(key))
    ) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const meta = (parsed as { meta?: unknown }).meta;
    if (
      meta !== undefined &&
      (meta === null || typeof meta !== 'object' || Array.isArray(meta))
    ) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const normalized: RawFeedbackItem[] = items.map((item) =>
      this.validateItem(item),
    );
    return normalizeFeedbackItems(normalized);
  }

  private validateItem(item: unknown): RawFeedbackItem {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ALLOWED_ITEM_KEYS.has(key)) {
        throw this.createProviderError(
          AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
          false,
        );
      }
    }

    const type = record.type;
    const severity = record.severity;
    const message = record.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const normalizedType =
      typeof type === 'string' && ALLOWED_TYPES.has(type)
        ? (type as FeedbackType)
        : FeedbackType.Other;
    const normalizedSeverity =
      typeof severity === 'string' && ALLOWED_SEVERITIES.has(severity)
        ? (severity as FeedbackSeverity)
        : DEFAULT_SEVERITY;
    const suggestion =
      typeof record.suggestion === 'string' ? record.suggestion : undefined;
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag) => typeof tag === 'string')
      : undefined;
    const scoreHint =
      typeof record.scoreHint === 'number'
        ? record.scoreHint
        : typeof record.scoreHint === 'string' &&
            record.scoreHint.trim().length > 0 &&
            Number.isFinite(Number(record.scoreHint))
          ? Number(record.scoreHint)
          : undefined;

    return {
      type: normalizedType,
      severity: normalizedSeverity,
      message,
      suggestion,
      tags,
      scoreHint,
    };
  }

  private getBackoffMs(attempt: number) {
    const base = 200;
    const factor = 2.5;
    return Math.round(base * Math.pow(factor, Math.max(0, attempt - 1)));
  }

  private async sleep(ms: number) {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isAbortError(error: unknown) {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message.toLowerCase().includes('aborted'))
    );
  }

  private toProviderError(error: unknown) {
    if (error instanceof OpenAiCompatibleProviderError) {
      return error;
    }
    if (error instanceof AiFeedbackProviderError) {
      return this.createProviderError(error.code, error.retryable, error);
    }
    if (error instanceof Error) {
      if (this.isAbortError(error)) {
        return this.createProviderError(
          AI_FEEDBACK_ERROR_CODES.TIMEOUT,
          true,
          error,
        );
      }
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
        error,
      );
    }
    return this.createProviderError(
      AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
      false,
    );
  }

  private createProviderError(
    code: ProviderErrorCode,
    retryable: boolean,
    cause?: unknown,
  ) {
    return new OpenAiCompatibleProviderError(
      code,
      retryable,
      this.options.errorMessagePrefix,
      cause,
    );
  }

  private tryParseJson(
    text: string,
  ): { ok: true; value: unknown } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  }

  private extractJsonFencedBlock(text: string): string | null {
    const lower = text.toLowerCase();
    const startIndex = lower.indexOf('```json');
    if (startIndex < 0) {
      return null;
    }
    const contentStart = startIndex + '```json'.length;
    const endIndex = text.indexOf('```', contentStart);
    if (endIndex < 0) {
      return null;
    }
    const inner = text.slice(contentStart, endIndex).trim();
    return inner ? inner : null;
  }
}
