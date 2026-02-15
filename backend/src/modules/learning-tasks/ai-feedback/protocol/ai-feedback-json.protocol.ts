import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import { getFeedbackTags } from '../lib/feedback-normalizer';

export const AI_FEEDBACK_JSON_PROTOCOL = {
  allowedRootKeys: ['items', 'meta'] as const,
  allowedItemKeys: [
    'type',
    'severity',
    'message',
    'suggestion',
    'tags',
    'scoreHint',
  ] as const,
  allowedTypes: Object.values(FeedbackType),
  allowedSeverities: Object.values(FeedbackSeverity),
  allowedTags: getFeedbackTags(),
  schemaExample: {
    items: [
      {
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Warn,
        message: 'Use clearer variable names.',
        tags: ['readability'],
      },
    ],
    meta: { language: 'typescript' },
  },
} as const;
