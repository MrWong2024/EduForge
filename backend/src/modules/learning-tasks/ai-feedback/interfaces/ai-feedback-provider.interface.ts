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
  analyzeSubmission(
    context: AiSubmissionAnalysisContext,
  ): Promise<AiFeedbackItem[]>;
}
