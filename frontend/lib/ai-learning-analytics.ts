import type {
  AiLearningAnalyticsDetailedOutcome,
  AiLearningAnalyticsComparisonWarning,
  AiLearningAnalyticsEvidenceSummary,
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsMethodologyVersion,
  AiLearningAnalyticsOverallOutcome,
  AiLearningAnalyticsTaskTrend,
  AiLearningAnalyticsTaskPoint,
  AiLearningAnalyticsWindow,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES,
} from "@/lib/api/types-teacher";
import {
  buildQueryString,
  getSingleSearchParam,
  parsePositiveInt,
} from "@/lib/ui/format";
import { paths } from "@/lib/routes/paths";

export const getAiLearningAnalyticsUncomparedRevisionMessage = (
  hasNewerUncomparedRevision: AiLearningAnalyticsTaskPoint["hasNewerUncomparedRevision"],
  hasComparisonReference: boolean,
): string => {
  if (hasNewerUncomparedRevision === true) {
    return "存在较新版本未纳入当前比较。";
  }
  if (hasNewerUncomparedRevision === false) {
    return "未发现可确认的较新未纳入版本。";
  }
  return hasComparisonReference
    ? "时间信息不足，无法确认是否存在较新未纳入版本。"
    : "尚无比较基线，暂无法判断较新未纳入版本。";
};

export const AI_LEARNING_ANALYTICS_WARNING_LABELS: Record<
  AiLearningAnalyticsComparisonWarning,
  string
> = {
  EMPTY_FEEDBACK: "成功处理但无实际反馈条目，未作为评价端点",
  SIMULATED_REVIEW_EXCLUDED: "模拟评阅已排除",
  SOURCE_UNKNOWN: "评阅来源不确定，仅作已有记录对照",
  MODEL_UNKNOWN: "历史模型未知，无法确认模型一致",
  MODEL_CHANGED: "比较端点使用了不同模型",
  TIME_UNKNOWN: "时间信息不足，无法确认完整更新时序",
};

export const buildAiLearningAnalyticsSubmissionHref = (
  submissionId: string,
  classroomId: string,
  classroomTaskId: string,
): string =>
  `${paths.teacher.submissionDetail(submissionId)}?${buildQueryString({ classroomId, classroomTaskId })}`;

export const getAiLearningAnalyticsEvidenceNotes = (
  evidence: AiLearningAnalyticsEvidenceSummary,
): string[] => {
  const notes: string[] = [];
  if (evidence.sourceUncertainComparableCount > 0)
    notes.push(
      `来源或模型信息不完整的可对照样本 ${evidence.sourceUncertainComparableCount}`,
    );
  if (evidence.modelChangedComparableCount > 0)
    notes.push(
      `已知模型不同的可对照样本 ${evidence.modelChangedComparableCount}`,
    );
  if (evidence.simulatedExcludedSampleCount > 0)
    notes.push(
      `存在已排除模拟评阅的样本 ${evidence.simulatedExcludedSampleCount}`,
    );
  return notes;
};

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

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS: Record<
  AiLearningAnalyticsDetailedOutcome,
  string
> = {
  IMPROVED: "负荷下降",
  REMAINED_CLEAN: "前后均无错误或警告",
  UNCHANGED_WITH_ISSUES: "非零负荷持平",
  REGRESSED: "负荷上升",
  NOT_COMPARABLE: "不可对照",
};

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_COMPACT_LABELS: Record<
  AiLearningAnalyticsDetailedOutcome,
  string
> = {
  ...AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  REMAINED_CLEAN: "均无错误或警告",
};

export const AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS: Record<
  AiLearningAnalyticsOverallOutcome,
  string
> = {
  INSUFFICIENT_DATA: "可比数据不足",
  IMPROVED_OVERALL: "可比任务负荷净下降",
  NO_NET_CHANGE: "净变化为零",
  REGRESSED_OVERALL: "可比任务负荷净上升",
};

export const AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS: Record<
  AiLearningAnalyticsEngagementStatus,
  string
> = {
  NO_SUBMISSION: "未提交任务",
  SUBMITTED_WITHOUT_AI_REQUEST: "已提交，未请求 AI 反馈",
  AI_REQUESTED_WITHOUT_DELIVERY: "已请求 AI 反馈，暂无可用反馈交付",
  AI_DELIVERED_WITHOUT_REVISION: "已获可用反馈，尚无可确认的后续更新",
  REVISED_WITHOUT_COMPARABLE: "已有作品更新，暂无反馈可对照结果",
  QUALITY_COMPARABLE: "已形成反馈可对照结果",
};

export const getAiLearningAnalyticsDetailedOutcomeLabel = (
  outcome: AiLearningAnalyticsDetailedOutcome | undefined,
): string =>
  outcome === undefined
    ? "结果未知"
    : AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS[outcome];

export const getAiLearningAnalyticsOverallOutcomeLabel = (
  outcome: AiLearningAnalyticsOverallOutcome | undefined,
): string =>
  outcome === undefined
    ? "结果未知"
    : AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS[outcome];

export const getAiLearningAnalyticsEngagementStatusLabel = (
  status: AiLearningAnalyticsEngagementStatus | undefined,
): string =>
  status === undefined
    ? "参与阶段未知"
    : AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS[status];

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
  version === "AI_FEEDBACK_INTERVENTION_V1_2" ? "V1.2" : "版本未知";

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
  overallOutcome: parseAiLearningAnalyticsOverallOutcome(query.overallOutcome),
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

export const formatAiLearningAnalyticsPercent = (
  rate: number | null,
): string => {
  if (rate === null || !Number.isFinite(rate)) return "—";
  if (rate !== 0 && Math.abs(rate) < 0.00001) {
    return rate > 0 ? "<0.001%" : ">-0.001%";
  }
  return `${Number((rate * 100).toPrecision(4))}%`;
};

export const formatAiLearningAnalyticsIssueLoad = (
  value: number | null,
): string =>
  value === null || !Number.isFinite(value)
    ? "—"
    : String(Number(value.toPrecision(4)));

export const formatAiLearningAnalyticsDelta = (
  value: number | null,
): string => {
  const formatted = formatAiLearningAnalyticsIssueLoad(value);
  return value !== null && value > 0 ? `+${formatted}` : formatted;
};

export const getAiLearningAnalyticsDeltaMeaning = (
  value: number | null,
): "负荷下降" | "差值为零" | "负荷上升" | "不可对照" =>
  value === null
    ? "不可对照"
    : value > 0
      ? "负荷下降"
      : value < 0
        ? "负荷上升"
        : "差值为零";

export type AiLearningAnalyticsTeachingAttention = {
  lowestRevisionTask: AiLearningAnalyticsTaskTrend | null;
  mostRegressedTask: AiLearningAnalyticsTaskTrend | null;
  highestImprovedRateTask: AiLearningAnalyticsTaskTrend | null;
};

export const selectAiLearningAnalyticsTeachingAttention = (
  taskTrends: AiLearningAnalyticsTaskTrend[],
): AiLearningAnalyticsTeachingAttention => {
  let lowestRevisionTask: AiLearningAnalyticsTaskTrend | null = null;
  let mostRegressedTask: AiLearningAnalyticsTaskTrend | null = null;
  let highestImprovedRateTask: AiLearningAnalyticsTaskTrend | null = null;

  for (const task of taskTrends) {
    if (
      task.aiDeliveredStudentCount > 0 &&
      task.postFeedbackRevisionRate !== null &&
      task.postFeedbackRevisionRate < 1 &&
      (lowestRevisionTask === null ||
        task.postFeedbackRevisionRate <
          (lowestRevisionTask.postFeedbackRevisionRate ?? Infinity))
    ) {
      lowestRevisionTask = task;
    }

    if (
      task.qualityComparableStudentCount > 0 &&
      task.regressedStudentCount > 0 &&
      (mostRegressedTask === null ||
        task.regressedStudentCount > mostRegressedTask.regressedStudentCount)
    ) {
      mostRegressedTask = task;
    }

    if (
      task.qualityComparableStudentCount > 0 &&
      task.improvedStudentCount > 0 &&
      task.improvedRate !== null &&
      (highestImprovedRateTask === null ||
        task.improvedRate > (highestImprovedRateTask.improvedRate ?? -Infinity))
    ) {
      highestImprovedRateTask = task;
    }
  }

  return {
    lowestRevisionTask,
    mostRegressedTask,
    highestImprovedRateTask,
  };
};
