import { Injectable } from '@nestjs/common';
import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../interfaces/ai-feedback-provider.interface';
import { AiSubmissionAnalysisContext } from '../interfaces/ai-submission-analysis-context.interface';
import {
  normalizeFeedbackItems,
  RawFeedbackItem,
} from '../lib/feedback-normalizer';

@Injectable()
export class DefaultStubAiFeedbackProvider implements AiFeedbackProvider {
  async analyzeSubmission(
    context: AiSubmissionAnalysisContext,
  ): Promise<AiFeedbackItem[]> {
    await Promise.resolve();
    const codeText = context.codeText ?? '';
    const items: RawFeedbackItem[] = [];

    if (codeText.trim().length === 0) {
      items.push({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: 'Code is empty.',
        tags: ['validation'],
      });
      return normalizeFeedbackItems(items);
    }

    if (codeText.length < 20) {
      items.push({
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Warn,
        message: 'Code is very short; consider adding more detail.',
        tags: ['readability'],
      });
    }

    if (codeText.includes('TODO')) {
      items.push({
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: 'Found TODO markers; remember to resolve them.',
        tags: ['maintainability'],
      });
    }

    if (items.length === 0) {
      items.push({
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: 'AI stub: no obvious issues detected.',
        tags: ['other'],
      });
    }

    return normalizeFeedbackItems(items);
  }
}
