import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OpenAiCompatibleFeedbackProviderBase,
  OpenAiCompatibleProviderConfig,
} from './openai-compatible-feedback-provider.base';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_MAX_CODE_CHARS = 12000;
const DEFAULT_MAX_ITEMS = 2;

@Injectable()
export class BailianFeedbackProvider extends OpenAiCompatibleFeedbackProviderBase {
  constructor(configService: ConfigService) {
    super(configService, new Logger(BailianFeedbackProvider.name), {
      providerName: 'bailian',
      logName: 'Bailian',
      errorMessagePrefix: 'AI_FEEDBACK_BAILIAN',
    });
  }

  protected getConfig(): OpenAiCompatibleProviderConfig {
    return {
      apiKey: this.configService.get<string>('BAILIAN_API_KEY'),
      baseUrl:
        this.configService.get<string>('BAILIAN_BASE_URL') ?? DEFAULT_BASE_URL,
      model: this.configService.get<string>('BAILIAN_MODEL') ?? DEFAULT_MODEL,
      timeoutMs: this.readInt('BAILIAN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      maxRetries: this.readInt('BAILIAN_MAX_RETRIES', DEFAULT_MAX_RETRIES),
      maxCodeChars: this.readInt(
        'AI_FEEDBACK_MAX_CODE_CHARS',
        DEFAULT_MAX_CODE_CHARS,
      ),
      maxItems: this.readInt('AI_FEEDBACK_MAX_ITEMS', DEFAULT_MAX_ITEMS),
    };
  }
}
