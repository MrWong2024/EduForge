export const AI_LEARNING_ANALYTICS_SCOPE =
  'AI_FEEDBACK_INTERVENTION_V1' as const;
export const AI_LEARNING_ANALYTICS_VERSION =
  'AI_FEEDBACK_INTERVENTION_V1_2' as const;
export const AI_LEARNING_ANALYTICS_SAMPLE_UNIT =
  'STUDENT_CLASSROOM_TASK' as const;
export const AI_LEARNING_ANALYTICS_QUALITY_PROXY =
  'ERROR_PLUS_HALF_WARN' as const;
export const AI_LEARNING_ANALYTICS_DISCLAIMER =
  '本分析仅反映 EduForge AI 反馈介入后的作品更新与反馈条目负荷变化，不代表 AI 对学习成绩或能力提升的因果贡献。';

export const AI_LEARNING_ANALYTICS_OUTCOMES = [
  'IMPROVED',
  'STABLE',
  'REGRESSED',
  'NOT_COMPARABLE',
] as const;
export type AiLearningAnalyticsOutcome =
  (typeof AI_LEARNING_ANALYTICS_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES = [
  'IMPROVED',
  'REMAINED_CLEAN',
  'UNCHANGED_WITH_ISSUES',
  'REGRESSED',
  'NOT_COMPARABLE',
] as const;
export type AiLearningAnalyticsDetailedOutcome =
  (typeof AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_GROWTH_TRENDS = [
  'INSUFFICIENT_DATA',
  'IMPROVING',
  'STABLE',
  'DECLINING',
] as const;
export type AiLearningAnalyticsGrowthTrend =
  (typeof AI_LEARNING_ANALYTICS_GROWTH_TRENDS)[number];

export const AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES = [
  'INSUFFICIENT_DATA',
  'IMPROVED_OVERALL',
  'NO_NET_CHANGE',
  'REGRESSED_OVERALL',
] as const;
export type AiLearningAnalyticsOverallOutcome =
  (typeof AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES = [
  'NO_SUBMISSION',
  'SUBMITTED_WITHOUT_AI_REQUEST',
  'AI_REQUESTED_WITHOUT_DELIVERY',
  'AI_DELIVERED_WITHOUT_REVISION',
  'REVISED_WITHOUT_COMPARABLE',
  'QUALITY_COMPARABLE',
] as const;
export type AiLearningAnalyticsEngagementStatus =
  (typeof AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES)[number];

export const AI_LEARNING_ANALYTICS_COMPARISON_WARNINGS = [
  'EMPTY_FEEDBACK',
  'SIMULATED_REVIEW_EXCLUDED',
  'SOURCE_UNKNOWN',
  'MODEL_UNKNOWN',
  'MODEL_CHANGED',
  'TIME_UNKNOWN',
] as const;
export type AiLearningAnalyticsComparisonWarning =
  (typeof AI_LEARNING_ANALYTICS_COMPARISON_WARNINGS)[number];

export type AiLearningAnalyticsReview = {
  submissionId: string;
  attemptNo: number | null;
  contentRevision: number | null;
  submittedAt: string | null;
  lastEditedAt: string | null;
  contentVersionAt: string | null;
  feedbackCompletedAt: string | null;
  provider: 'bailian' | 'stub' | null;
  model: string | null;
};

export type AiLearningAnalyticsEvidenceSummary = {
  sourceUncertainComparableCount: number;
  modelChangedComparableCount: number;
  simulatedExcludedSampleCount: number;
};
