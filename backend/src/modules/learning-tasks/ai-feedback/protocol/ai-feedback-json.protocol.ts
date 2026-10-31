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
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message:
          '源码为空列表设置了独立返回分支，符合空列表返回空列表的任务要求。',
        tags: ['correctness'],
      },
    ],
    meta: { language: 'typescript' },
  },
} as const;
