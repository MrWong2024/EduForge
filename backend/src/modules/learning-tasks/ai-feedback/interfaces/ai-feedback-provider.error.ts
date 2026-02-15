import type { AiFeedbackProviderErrorCode } from './ai-feedback-provider.error-codes';

export class AiFeedbackProviderError extends Error {
  constructor(
    readonly code: AiFeedbackProviderErrorCode,
    readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AiFeedbackProviderError';
    if (cause !== undefined && !('cause' in this)) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}
