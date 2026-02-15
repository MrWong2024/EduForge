import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeedbackSeverity,
  FeedbackType,
} from '../../../schemas/feedback.schema';
import type { SubmissionDocument } from '../../../schemas/submission.schema';
import {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../../interfaces/ai-feedback-provider.interface';
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
} from '../../prompts/openrouter-feedback.prompt';
import { AI_FEEDBACK_JSON_PROTOCOL } from '../../protocol/ai-feedback-json.protocol';

type OpenRouterChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type OpenRouterConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  realEnabled: boolean;
  maxCodeChars: number;
  maxItems: number;
  httpReferer: string;
  xTitle: string;
};

type ProviderErrorCode = AiFeedbackProviderErrorCode;

const PROVIDER_NAME = 'openrouter';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CODE_CHARS = 12000;
const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_REFERER = 'https://eduforge.local';
const DEFAULT_TITLE = 'EduForge';
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
const DEFAULT_SEVERITY = FeedbackSeverity.Warn;

class OpenRouterProviderError extends AiFeedbackProviderError {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(code, retryable, `AI_FEEDBACK_OPENROUTER: ${code}`, cause);
  }
}

@Injectable()
export class OpenRouterFeedbackProvider implements AiFeedbackProvider {
  private readonly logger = new Logger(OpenRouterFeedbackProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async analyzeSubmission(
    submission: SubmissionDocument,
  ): Promise<AiFeedbackItem[]> {
    const config = this.getConfig();

    if (!config.realEnabled) {
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.REAL_DISABLED,
        false,
      );
    }
    if (!config.apiKey) {
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.MISSING_API_KEY,
        false,
      );
    }

    const submissionId = submission._id.toString();
    const classroomTaskId = submission.classroomTaskId?.toString?.();
    const request = this.buildRequest(submission, config);
    const startMs = Date.now();
    let retryCount = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      if (attempt > 0) {
        retryCount = attempt;
        await this.sleep(this.getBackoffMs(attempt));
      }
      try {
        const response = await this.callOpenRouter(request, config.timeoutMs);
        const items = this.parseResponse(response).slice(0, config.maxItems);
        const durationMs = Date.now() - startMs;
        this.logger.debug(
          `OpenRouter feedback success: submissionId=${submissionId}, classroomTaskId=${classroomTaskId ?? 'n/a'}, provider=${PROVIDER_NAME}, model=${config.model}, durationMs=${durationMs}, retried=${retryCount > 0}`,
        );
        return items;
      } catch (error) {
        const providerError = this.toProviderError(error);
        if (providerError.retryable && attempt < config.maxRetries) {
          continue;
        }
        const durationMs = Date.now() - startMs;
        this.logger.warn(
          `OpenRouter feedback failed: submissionId=${submissionId}, classroomTaskId=${classroomTaskId ?? 'n/a'}, provider=${PROVIDER_NAME}, model=${config.model}, durationMs=${durationMs}, retried=${retryCount > 0}, error=${providerError.code}`,
        );
        throw providerError;
      }
    }

    throw new OpenRouterProviderError(
      AI_FEEDBACK_ERROR_CODES.UPSTREAM_5XX,
      true,
    );
  }

  private getConfig(): OpenRouterConfig {
    return {
      apiKey: this.configService.get<string>('OPENROUTER_API_KEY'),
      baseUrl:
        this.configService.get<string>('OPENROUTER_BASE_URL') ??
        DEFAULT_BASE_URL,
      model:
        this.configService.get<string>('OPENROUTER_MODEL') ?? DEFAULT_MODEL,
      timeoutMs: this.readInt('OPENROUTER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      maxRetries: this.readInt('OPENROUTER_MAX_RETRIES', DEFAULT_MAX_RETRIES),
      realEnabled:
        this.configService.get<string>('AI_FEEDBACK_REAL_ENABLED') === 'true',
      maxCodeChars: this.readInt(
        'AI_FEEDBACK_MAX_CODE_CHARS',
        DEFAULT_MAX_CODE_CHARS,
      ),
      maxItems: this.readInt('AI_FEEDBACK_MAX_ITEMS', DEFAULT_MAX_ITEMS),
      httpReferer:
        this.configService.get<string>('OPENROUTER_HTTP_REFERER') ??
        DEFAULT_REFERER,
      xTitle:
        this.configService.get<string>('OPENROUTER_X_TITLE') ?? DEFAULT_TITLE,
    };
  }

  private readInt(key: string, fallback: number) {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private buildRequest(
    submission: SubmissionDocument,
    config: OpenRouterConfig,
  ) {
    const baseUrl = config.baseUrl.replace(/\/+$/g, '');
    const endpoint = `${baseUrl}/chat/completions`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({
      submission,
      maxCodeChars: config.maxCodeChars,
    });
    const payload = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.httpReferer,
      'X-Title': config.xTitle,
    };

    return { endpoint, payload, headers, model: config.model };
  }

  private async callOpenRouter(
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
          return (await response.json()) as OpenRouterChatResponse;
        } catch {
          throw new OpenRouterProviderError(
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
      return new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.UNAUTHORIZED,
        false,
      );
    }
    if (status === 429) {
      return new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_UPSTREAM,
        true,
      );
    }
    if (status >= 500) {
      return new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.UPSTREAM_5XX,
        true,
      );
    }
    if (status >= 400 && status <= 499) {
      return new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.UPSTREAM_4XX,
        false,
      );
    }
    return new OpenRouterProviderError(
      AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
      false,
    );
  }

  private parseResponse(data: OpenRouterChatResponse): AiFeedbackItem[] {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new OpenRouterProviderError(
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

    throw new OpenRouterProviderError(
      AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
      false,
    );
  }

  private validateParsedResponse(parsed: unknown): AiFeedbackItem[] {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const rootKeys = Object.keys(parsed as Record<string, unknown>);
    if (
      rootKeys.length === 0 ||
      rootKeys.some((key) => !ALLOWED_ROOT_KEYS.has(key))
    ) {
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }

    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const meta = (parsed as { meta?: unknown }).meta;
    if (
      meta !== undefined &&
      (meta === null || typeof meta !== 'object' || Array.isArray(meta))
    ) {
      throw new OpenRouterProviderError(
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
      throw new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ALLOWED_ITEM_KEYS.has(key)) {
        throw new OpenRouterProviderError(
          AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
          false,
        );
      }
    }

    const type = record.type;
    const severity = record.severity;
    const message = record.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new OpenRouterProviderError(
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
    if (error instanceof OpenRouterProviderError) {
      return error;
    }
    if (error instanceof AiFeedbackProviderError) {
      return new OpenRouterProviderError(error.code, error.retryable, error);
    }
    if (error instanceof Error) {
      if (this.isAbortError(error)) {
        return new OpenRouterProviderError(
          AI_FEEDBACK_ERROR_CODES.TIMEOUT,
          true,
          error,
        );
      }
      return new OpenRouterProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
        error,
      );
    }
    return new OpenRouterProviderError(
      AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
      false,
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
