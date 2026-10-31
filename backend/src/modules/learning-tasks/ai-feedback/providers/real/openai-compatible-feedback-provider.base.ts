import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeedbackSeverity,
  FeedbackType,
} from '../../../schemas/feedback.schema';
import {
  AiFeedbackExecution,
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
import { AiFeedbackRequestBodyDumper } from '../../lib/ai-feedback-request-body-dumper';

import {
  checkInputBudget,
  readReportedUsage,
  AiChatMessage,
} from '../../lib/ai-request-budget';
type OpenAiCompatibleChatResponse = {
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
};

export type OpenAiCompatibleProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  maxItems: number;
};

type OpenAiCompatibleProviderOptions = {
  providerName: string;
  logName: string;
  errorMessagePrefix: string;
};

type ProviderErrorCode = AiFeedbackProviderErrorCode;

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
const ALLOWED_TAGS = new Set<string>(AI_FEEDBACK_JSON_PROTOCOL.allowedTags);
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
  private readonly requestBodyDumper: AiFeedbackRequestBodyDumper;

  protected constructor(
    protected readonly configService: ConfigService,
    private readonly logger: Logger,
    private readonly options: OpenAiCompatibleProviderOptions,
  ) {
    this.requestBodyDumper = new AiFeedbackRequestBodyDumper(logger);
  }

  assertInputEligible(context: AiSubmissionAnalysisContext): void {
    const config = this.getConfig();
    checkInputBudget(
      this.buildRequest(context, config).payload.messages,
      config.maxInputBytes,
    );
  }

  async analyzeSubmission(
    context: AiSubmissionAnalysisContext,
    execution: AiFeedbackExecution,
  ): Promise<AiFeedbackItem[]> {
    const config = this.getConfig();
    if (!config.apiKey?.trim()) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.MISSING_API_KEY,
        false,
      );
    }
    const request = this.buildRequest(context, config);
    const inputBytes = checkInputBudget(
      request.payload.messages,
      config.maxInputBytes,
    );
    await execution.reserveRequest({
      provider: 'bailian',
      model: config.model,
      inputBytes,
      maxOutputTokens: config.maxOutputTokens,
      reservedAt: new Date(),
    });
    let response: { status: number; data: unknown };
    try {
      response = await this.callProvider(
        request,
        config.timeoutMs,
        context.submissionId,
      );
    } catch (error) {
      await execution.reportUsage(null);
      throw error;
    }
    // Persist actual usage even for non-2xx, truncated and malformed feedback.
    // Keep this outside the fetch catch: a DB failure must stay non-retryable.
    await execution.reportUsage(readReportedUsage(response.data));
    if (response.status < 200 || response.status >= 300) {
      throw this.mapHttpError(response.status);
    }
    if (!response.data || typeof response.data !== 'object') {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const data = response.data as OpenAiCompatibleChatResponse;
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.OUTPUT_LIMIT_REACHED,
        false,
      );
    }
    if (finishReason !== 'stop') {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    const parsedItems = this.parseResponse(data);
    const cap = Math.min(config.maxItems, PROMPT_PROTOCOL_MAX_ITEMS);
    this.logger.debug(
      this.options.logName +
        ' feedback success: submissionId=' +
        context.submissionId +
        ', provider=' +
        this.options.providerName +
        ', model=' +
        config.model,
    );
    return parsedItems.slice(0, cap);
  }

  protected abstract getConfig(): OpenAiCompatibleProviderConfig;

  protected readInt(
    key: string,
    fallback: number,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  ) {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  }

  private buildRequest(
    context: AiSubmissionAnalysisContext,
    config: OpenAiCompatibleProviderConfig,
  ) {
    const baseUrl = config.baseUrl.replace(/\/+$/g, '');
    const endpoint = `${baseUrl}/chat/completions`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({ context });
    const messages: AiChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const payload = {
      model: config.model,
      messages,
      enable_thinking: false,
      max_tokens: config.maxOutputTokens,
      temperature: 0.2,
    };
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
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
    submissionId: string,
  ) {
    // This exact string is both retained and supplied to fetch. Preparation and
    // reservation have already succeeded; filesystem time is not HTTP time.
    const body = JSON.stringify(request.payload);
    if (
      this.configService.get<string>('NODE_ENV') === 'development' &&
      this.configService.get<boolean>('AI_FEEDBACK_DUMP_REQUEST_BODY') === true
    ) {
      await this.requestBodyDumper.save(submissionId, body);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body,
        signal: controller.signal,
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
      return { status: response.status, data };
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

    const rootKeys = Object.keys(parsed);
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

    if (
      typeof type !== 'string' ||
      !ALLOWED_TYPES.has(type) ||
      typeof severity !== 'string' ||
      !ALLOWED_SEVERITIES.has(severity)
    ) {
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    }
    if (
      (record.suggestion !== undefined &&
        typeof record.suggestion !== 'string') ||
      (record.tags !== undefined &&
        (!Array.isArray(record.tags) ||
          record.tags.some(
            (tag: unknown) => typeof tag !== 'string' || !ALLOWED_TAGS.has(tag),
          ))) ||
      (record.scoreHint !== undefined &&
        (typeof record.scoreHint !== 'number' ||
          !Number.isFinite(record.scoreHint) ||
          record.scoreHint < 0 ||
          record.scoreHint > 100))
    )
      throw this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.BAD_RESPONSE,
        false,
      );
    const normalizedType = type as FeedbackType;
    const normalizedSeverity = severity as FeedbackSeverity;
    const suggestion =
      typeof record.suggestion === 'string' ? record.suggestion : undefined;
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag) => typeof tag === 'string')
      : undefined;
    const scoreHint =
      typeof record.scoreHint === 'number' ? record.scoreHint : undefined;

    return {
      type: normalizedType,
      severity: normalizedSeverity,
      message,
      suggestion,
      tags,
      scoreHint,
    };
  }

  private isAbortError(error: unknown) {
    // Native fetch errors can originate in another realm (e.g. Jest/undici).
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    );
  }

  private toProviderError(error: unknown) {
    if (error instanceof OpenAiCompatibleProviderError) {
      return error;
    }
    if (error instanceof AiFeedbackProviderError) {
      return this.createProviderError(error.code, error.retryable, error);
    }
    if (this.isAbortError(error)) {
      return this.createProviderError(
        AI_FEEDBACK_ERROR_CODES.TIMEOUT,
        true,
        error,
      );
    }
    if (error instanceof Error) {
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
