import { Injectable } from '@nestjs/common';
import {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../../interfaces/ai-feedback-provider.interface';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';

export type AiFeedbackRequest = {
  submissionId: string;
  codeText: string;
  language: string;
};

export type AiFeedbackResponse = {
  items: AiFeedbackItem[];
};

@Injectable()
export class OpenAiFeedbackProvider implements AiFeedbackProvider {
  async analyzeSubmission(
    _context: AiSubmissionAnalysisContext,
  ): Promise<AiFeedbackItem[]> {
    await Promise.resolve(_context);

    throw new Error(
      'AI_FEEDBACK_PROVIDER=openai is not implemented. ' +
        'Install OpenAI SDK manually (human-decided), configure OPENAI_API_KEY before enabling this provider.',
    );
  }
}
