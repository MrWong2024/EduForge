import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import { AiSubmissionAnalysisContext } from './ai-submission-analysis-context.interface';

export const AI_FEEDBACK_PROVIDER_TOKEN = 'AI_FEEDBACK_PROVIDER_TOKEN';

export type AiFeedbackItem = {
  type: FeedbackType;
  severity: FeedbackSeverity;
  message: string;
  suggestion?: string;
  tags?: string[];
  scoreHint?: number;
};

export interface AiFeedbackProvider {
  assertInputEligible?(context: AiSubmissionAnalysisContext): void;
  analyzeSubmission(
    context: AiSubmissionAnalysisContext,
    execution: AiFeedbackExecution,
  ): Promise<AiFeedbackItem[]>;
}

export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputTextTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTextTokens?: number | null;
  reasoningTokens?: number | null;
};
export type AiRequestReservation = {
  provider: 'bailian';
  model: string;
  inputBytes: number;
  maxOutputTokens: number;
  reservedAt: Date;
};

export type AiFeedbackResponseDiagnostic = {
  httpStatus: number | null;
  rawResponseBody: string | null;
  validatedItemsBeforeNormalize: AiFeedbackItem[] | null;
  normalizedItemsBeforeCap: AiFeedbackItem[] | null;
  providerItemsAfterCap: AiFeedbackItem[] | null;
  reachedStage:
    | 'request_ready'
    | 'http_response'
    | 'response_body_read'
    | 'response_parsed'
    | 'items_validated'
    | 'items_normalized'
    | 'provider_capped';
  failureCode: string | null;
  captureFailed?: boolean;
};

export type AiFeedbackCompactionDiagnostic = {
  jobId: string;
  claimNo: number;
  compactionReached: boolean;
  compactorInput: AiFeedbackItem[] | null;
  compactorOutput: AiFeedbackItem[] | null;
  reason:
    | 'PROVIDER_NOT_COMPLETED'
    | 'CLAIM_NOT_VALIDATED'
    | 'COMPACTION_NOT_COMPLETED'
    | null;
  captureFailed?: boolean;
};

// Per-call local diagnostics only; never part of a model or database payload.
export type AiFeedbackDiagnosticHandle = {
  readonly traceId: string;
  readonly submissionId: string;
  readonly requestFileName: string;
  readonly createdAt: string;
  requestSaved: boolean;
  saveCompaction: (record: AiFeedbackCompactionDiagnostic) => Promise<void>;
};

// Persistence failures must never become reasons to replay an upstream request.
export type AiFeedbackExecution = {
  reserveRequest: (request: AiRequestReservation) => Promise<void>;
  reportUsage: (usage: AiTokenUsage | null) => Promise<void>;
  onDiagnosticHandle?: (
    handle: AiFeedbackDiagnosticHandle,
  ) => void | Promise<void>;
};
