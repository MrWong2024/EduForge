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
};
export type AiRequestReservation = {
  provider: 'bailian';
  model: string;
  inputBytes: number;
  maxOutputTokens: number;
  reservedAt: Date;
};
// Persistence failures must never become reasons to replay an upstream request.
export type AiFeedbackExecution = {
  reserveRequest: (request: AiRequestReservation) => Promise<void>;
  reportUsage: (usage: AiTokenUsage | null) => Promise<void>;
};
