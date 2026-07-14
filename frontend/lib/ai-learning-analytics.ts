import type {
  AiLearningAnalyticsDetailedOutcome,
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsGrowthTrend,
  AiLearningAnalyticsMethodologyVersion,
  AiLearningAnalyticsOutcome,
  AiLearningAnalyticsOverallOutcome,
  AiLearningAnalyticsTaskTrend,
  AiLearningAnalyticsWindow,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES,
} from "@/lib/api/types-teacher";
import { getSingleSearchParam, parsePositiveInt } from "@/lib/ui/format";

export const AI_LEARNING_ANALYTICS_STUDENT_SECTION_ID = "student-analysis";

export const withAiLearningAnalyticsStudentSectionHash = (
  href: string,
): string => `${href}#${AI_LEARNING_ANALYTICS_STUDENT_SECTION_ID}`;

export const AI_LEARNING_ANALYTICS_DISPLAY_WINDOWS = [
  "7d",
  "30d",
  "all",
] as const satisfies readonly AiLearningAnalyticsWindow[];

export const AI_LEARNING_ANALYTICS_WINDOW_LABELS: Record<
  AiLearningAnalyticsWindow,
  string
> = {
  "7d": "近 7 天发布的任务",
  "30d": "近 30 天发布的任务",
  all: "全部任务",
};

export const AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS: Record<
  AiLearningAnalyticsGrowthTrend,
  string
> = {
  IMPROVING: "问题负荷改善",
  STABLE: "变化持平",
  DECLINING: "问题负荷恶化",
  INSUFFICIENT_DATA: "可比数据不足",
};

export const AI_LEARNING_ANALYTICS_OUTCOME_LABELS: Record<
  AiLearningAnalyticsOutcome,
  string
> = {
  IMPROVED: "改善",
  STABLE: "持平",
  REGRESSED: "恶化",
  NOT_COMPARABLE: "不可比较",
};

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS: Record<
  AiLearningAnalyticsDetailedOutcome,
  string
> = {
  IMPROVED: "改善",
  REMAINED_CLEAN: "前后均无 ERROR/WARN",
  UNCHANGED_WITH_ISSUES: "问题负荷未减少",
  REGRESSED: "恶化",
  NOT_COMPARABLE: "不可比较",
};

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_COMPACT_LABELS: Record<
  AiLearningAnalyticsDetailedOutcome,
  string
> = {
  ...AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  REMAINED_CLEAN: "均无 ERROR/WARN",
};

export const AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS: Record<
  AiLearningAnalyticsOverallOutcome,
  string
> = {
  INSUFFICIENT_DATA: "可比数据不足",
  IMPROVED_OVERALL: "总体改善",
  NO_NET_CHANGE: "净变化为零",
  REGRESSED_OVERALL: "总体恶化",
};

export const AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS: Record<
  AiLearningAnalyticsEngagementStatus,
  string
> = {
  NO_SUBMISSION: "未提交任务",
  SUBMITTED_WITHOUT_AI_REQUEST: "已提交，未请求 AI 反馈",
  AI_REQUESTED_WITHOUT_DELIVERY: "已请求 AI 反馈，暂无成功交付",
  AI_DELIVERED_WITHOUT_RESUBMISSION: "已获 AI 反馈，未再次提交",
  RESUBMITTED_WITHOUT_COMPARABLE: "已再次提交，暂无质量可比结果",
  QUALITY_COMPARABLE: "已形成质量可比结果",
};

export const AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_OPTIONS =
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES.map((value) => ({
    value,
    label: AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS[value],
  }));

export const AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_OPTIONS =
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES.map((value) => ({
    value,
    label: AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS[value],
  }));

export const getAiLearningAnalyticsMethodologyVersionLabel = (
  version: AiLearningAnalyticsMethodologyVersion,
): string =>
  version === "AI_FEEDBACK_INTERVENTION_V1_1" ? "V1.1" : "版本未知";

export type AiLearningAnalyticsSearchParams = {
  window?: string | string[];
  page?: string | string[];
  excludedTaskIds?: string | string[];
  q?: string | string[];
  overallOutcome?: string | string[];
  engagementStatus?: string | string[];
} & Record<string, string | string[] | undefined>;

export type AiLearningAnalyticsQueryState = {
  window: AiLearningAnalyticsWindow;
  page: number;
  excludedTaskIds: string[];
  q: string | undefined;
  overallOutcome: AiLearningAnalyticsOverallOutcome | undefined;
  engagementStatus: AiLearningAnalyticsEngagementStatus | undefined;
};

export const parseAiLearningAnalyticsWindow = (
  value: string | string[] | undefined,
): AiLearningAnalyticsWindow => {
  const window = getSingleSearchParam(value);
  return window === "7d" || window === "30d" || window === "all"
    ? window
    : "all";
};

export const parseAiLearningAnalyticsExcludedTaskIds = (
  value: string | string[] | undefined,
): string[] => {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const taskIds: string[] = [];

  for (const taskId of rawValues
    .flatMap((rawValue) => rawValue.split(","))
    .map((rawValue) => rawValue.trim())
    .filter((rawValue) => rawValue.length > 0)) {
    if (!seen.has(taskId)) {
      seen.add(taskId);
      taskIds.push(taskId);
    }
  }

  return taskIds;
};

export const parseAiLearningAnalyticsSearchQuery = (
  value: string | string[] | undefined,
): string | undefined => {
  const normalized = getSingleSearchParam(value)?.trim();
  return normalized ? normalized : undefined;
};

export const parseAiLearningAnalyticsOverallOutcome = (
  value: string | string[] | undefined,
): AiLearningAnalyticsOverallOutcome | undefined => {
  const normalized = getSingleSearchParam(value);
  return AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES.find(
    (candidate) => candidate === normalized,
  );
};

export const parseAiLearningAnalyticsEngagementStatus = (
  value: string | string[] | undefined,
): AiLearningAnalyticsEngagementStatus | undefined => {
  const normalized = getSingleSearchParam(value);
  return AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES.find(
    (candidate) => candidate === normalized,
  );
};

export const resolveAiLearningAnalyticsQueryState = (
  query: AiLearningAnalyticsSearchParams,
): AiLearningAnalyticsQueryState => ({
  window: parseAiLearningAnalyticsWindow(query.window),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
  excludedTaskIds: parseAiLearningAnalyticsExcludedTaskIds(
    query.excludedTaskIds,
  ),
  q: parseAiLearningAnalyticsSearchQuery(query.q),
  overallOutcome: parseAiLearningAnalyticsOverallOutcome(
    query.overallOutcome,
  ),
  engagementStatus: parseAiLearningAnalyticsEngagementStatus(
    query.engagementStatus,
  ),
});

export const toAiLearningAnalyticsExcludedTaskIdsQueryValue = (
  excludedTaskIds: string[],
): string | undefined =>
  excludedTaskIds.length > 0 ? excludedTaskIds.join(",") : undefined;

export const toAiLearningAnalyticsSearchParamEntries = (
  query: AiLearningAnalyticsSearchParams,
): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) {
      continue;
    }
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      entries.push([key, value]);
    }
  }
  return entries;
};

export const formatAiLearningAnalyticsPercent = (rate: number): string => {
  const percent = Math.round(rate * 1000) / 10;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
};

export const formatAiLearningAnalyticsIssueLoad = (value: number): string => {
  const normalized = Math.abs(value) < 0.0001 ? 0 : value;
  const rounded = Math.round(normalized * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(2)}`;
};

export const formatAiLearningAnalyticsDelta = (value: number): string => {
  const normalized = Math.abs(value) < 0.0001 ? 0 : value;
  const formatted = formatAiLearningAnalyticsIssueLoad(normalized);
  return normalized > 0 ? `+${formatted}` : formatted;
};

export const getAiLearningAnalyticsDeltaMeaning = (
  value: number,
): "改善" | "差值为零" | "恶化" =>
  value > 0 ? "改善" : value < 0 ? "恶化" : "差值为零";

export type AiLearningAnalyticsTeachingAttention = {
  lowestResubmissionTask: AiLearningAnalyticsTaskTrend | null;
  mostRegressedTask: AiLearningAnalyticsTaskTrend | null;
  highestImprovedRateTask: AiLearningAnalyticsTaskTrend | null;
};

export const selectAiLearningAnalyticsTeachingAttention = (
  taskTrends: AiLearningAnalyticsTaskTrend[],
): AiLearningAnalyticsTeachingAttention => {
  let lowestResubmissionTask: AiLearningAnalyticsTaskTrend | null = null;
  let mostRegressedTask: AiLearningAnalyticsTaskTrend | null = null;
  let highestImprovedRateTask: AiLearningAnalyticsTaskTrend | null = null;

  for (const task of taskTrends) {
    if (
      task.aiDeliveredStudentCount > 0 &&
      (lowestResubmissionTask === null ||
        task.postFeedbackResubmissionRate <
          lowestResubmissionTask.postFeedbackResubmissionRate)
    ) {
      lowestResubmissionTask = task;
    }

    if (
      task.qualityComparableStudentCount > 0 &&
      (mostRegressedTask === null ||
        task.regressedStudentCount > mostRegressedTask.regressedStudentCount)
    ) {
      mostRegressedTask = task;
    }

    if (
      task.qualityComparableStudentCount > 0 &&
      (highestImprovedRateTask === null ||
        task.improvedRate > highestImprovedRateTask.improvedRate)
    ) {
      highestImprovedRateTask = task;
    }
  }

  return {
    lowestResubmissionTask,
    mostRegressedTask,
    highestImprovedRateTask,
  };
};
