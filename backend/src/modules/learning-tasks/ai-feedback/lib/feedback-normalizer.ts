import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import { AiFeedbackItem } from '../interfaces/ai-feedback-provider.interface';

export type RawFeedbackItem = {
  type: FeedbackType;
  severity: FeedbackSeverity;
  message: string;
  suggestion?: string;
  tags?: string[];
  scoreHint?: number;
};

const FEEDBACK_TAGS_LIST = [
  'readability',
  'naming',
  'style',
  'formatting',
  'complexity',
  'duplication',
  'edge-cases',
  'null-safety',
  'exception-safety',
  'performance',
  'memory',
  'security',
  'correctness',
  'bug-risk',
  'maintainability',
  'testability',
  'api-design',
  'abstraction',
  'encapsulation',
  'coupling',
  'cohesion',
  'concurrency',
  'io',
  'algorithm',
  'data-structure',
  'documentation',
  'logging',
  'error-handling',
  'validation',
  'input-sanitization',
  'resource-management',
  'time-complexity',
  'space-complexity',
  'readability-comments',
  'modularity',
  'dead-code',
  'unused',
  'other',
];

const FEEDBACK_TAGS = new Set<string>(FEEDBACK_TAGS_LIST);

const cleanTag = (tag: string) => {
  const trimmed = tag.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/[ _]+/g, '-').replace(/-+/g, '-');
};

const normalizeTags = (tags?: string[]) => {
  if (!tags || tags.length === 0) {
    return undefined;
  }

  const normalized = new Set<string>();
  for (const tag of tags) {
    const cleaned = cleanTag(tag);
    if (!cleaned) {
      continue;
    }
    if (FEEDBACK_TAGS.has(cleaned)) {
      normalized.add(cleaned);
    } else {
      normalized.add('other');
    }
  }

  return normalized.size > 0 ? Array.from(normalized) : undefined;
};

export const normalizeFeedbackItems = (
  items: ReadonlyArray<RawFeedbackItem>,
): AiFeedbackItem[] =>
  items.map((item) => ({
    type: item.type,
    severity: item.severity,
    message: item.message,
    suggestion: item.suggestion,
    tags: normalizeTags(item.tags),
    scoreHint: item.scoreHint,
  }));

export const getFeedbackTags = () => [...FEEDBACK_TAGS_LIST];
