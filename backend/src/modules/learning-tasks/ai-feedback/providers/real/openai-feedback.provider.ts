import { Injectable } from '@nestjs/common';
import {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../../interfaces/ai-feedback-provider.interface';
import { Submission } from '../../../schemas/submission.schema';

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
  async analyzeSubmission(_submission: Submission): Promise<AiFeedbackItem[]> {
    await Promise.resolve(_submission);

    throw new Error(
      'AI_FEEDBACK_PROVIDER=openai is not implemented. ' +
        'Install OpenAI SDK manually (human-decided), configure OPENAI_API_KEY before enabling this provider.',
    );
  }
}
