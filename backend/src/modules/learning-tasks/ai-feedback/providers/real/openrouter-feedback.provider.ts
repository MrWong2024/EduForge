import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OpenAiCompatibleFeedbackProviderBase,
  OpenAiCompatibleProviderConfig,
} from './openai-compatible-feedback-provider.base';

type OpenRouterConfig = OpenAiCompatibleProviderConfig & {
  httpReferer: string;
  xTitle: string;
};

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = '';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CODE_CHARS = 12000;
const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_REFERER = 'https://eduforge.local';
const DEFAULT_TITLE = 'EduForge';

@Injectable()
export class OpenRouterFeedbackProvider extends OpenAiCompatibleFeedbackProviderBase {
  constructor(configService: ConfigService) {
    super(configService, new Logger(OpenRouterFeedbackProvider.name), {
      providerName: 'openrouter',
      logName: 'OpenRouter',
      errorMessagePrefix: 'AI_FEEDBACK_OPENROUTER',
    });
  }

  protected getConfig(): OpenRouterConfig {
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

  protected buildExtraHeaders(config: OpenAiCompatibleProviderConfig) {
    const openRouterConfig = config as OpenRouterConfig;
    return {
      'HTTP-Referer': openRouterConfig.httpReferer,
      'X-Title': openRouterConfig.xTitle,
    };
  }

  protected buildPayloadExtras(config: OpenAiCompatibleProviderConfig) {
    void config;
    return {
      response_format: { type: 'json_object' },
    };
  }
}
