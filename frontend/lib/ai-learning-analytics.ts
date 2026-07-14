import type {
  AiLearningAnalyticsGrowthTrend,
  AiLearningAnalyticsOutcome,
  AiLearningAnalyticsTaskTrend,
  AiLearningAnalyticsWindow,
} from "@/lib/api/types-teacher";
import { getSingleSearchParam, parsePositiveInt } from "@/lib/ui/format";

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

export type AiLearningAnalyticsSearchParams = {
  window?: string | string[];
  page?: string | string[];
  excludedTaskIds?: string | string[];
} & Record<string, string | string[] | undefined>;

export type AiLearningAnalyticsQueryState = {
  window: AiLearningAnalyticsWindow;
  page: number;
  excludedTaskIds: string[];
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

export const resolveAiLearningAnalyticsQueryState = (
  query: AiLearningAnalyticsSearchParams,
): AiLearningAnalyticsQueryState => ({
  window: parseAiLearningAnalyticsWindow(query.window),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
  excludedTaskIds: parseAiLearningAnalyticsExcludedTaskIds(
    query.excludedTaskIds,
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
): "改善" | "持平" | "恶化" =>
  value > 0 ? "改善" : value < 0 ? "恶化" : "持平";

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
