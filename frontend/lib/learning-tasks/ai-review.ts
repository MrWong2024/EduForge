export const AI_FEEDBACK_MODES = [
  "DISABLED",
  "TEACHER_ONLY",
  "MANUAL",
  "FIRST_SUBMISSION_AUTO",
] as const;
export type AiFeedbackMode = (typeof AI_FEEDBACK_MODES)[number];
export const AI_MODE_LABELS: Record<AiFeedbackMode, string> = {
  DISABLED: "不使用平台 AI 反馈",
  TEACHER_ONLY: "仅教师发起",
  MANUAL: "师生手动发起",
  FIRST_SUBMISSION_AUTO: "首次提交自动申请",
};
export const normalizeAiFeedbackMode = (
  value: unknown,
): AiFeedbackMode | undefined =>
  AI_FEEDBACK_MODES.find((mode) => mode === value);
export const getAiModeLabel = (value: unknown): string => {
  const mode = normalizeAiFeedbackMode(value);
  return mode ? AI_MODE_LABELS[mode] : "平台 AI 策略信息暂不可用";
};
export const getTaskSnapshotMessage = (
  available: boolean | undefined,
): string =>
  available === true
    ? "发布时的任务内容"
    : available === false
      ? "未保存发布时任务内容，当前说明为模板现状；请教师重新布置后继续。"
      : "发布内容信息暂不可用，请刷新核对后继续。";
export const canSubmitTextTask = (
  snapshot: boolean | undefined,
  canSubmit: boolean | undefined,
): boolean => snapshot === true && canSubmit === true;

export const AI_STATUSES = [
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];
export const normalizeAiStatus = (value: unknown): AiStatus | undefined =>
  AI_STATUSES.find((status) => status === value);
export type AiReview = {
  provider: "bailian" | "stub" | null;
  canRequest: boolean | null;
  requestBlockReason: string | null;
  failure: { code: string; message: string } | null;
  retryScheduled: boolean | null;
  nextRetryAt: string | null;
  inputCoverage: "FULL" | "NOT_SENT" | "UNKNOWN" | null;
  usage: {
    reservedRequests: number | null;
    reportedRequests: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
};
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const countOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export function toAiReview(value: unknown): AiReview | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;
  const usage = asRecord(record.usage);
  const failure = asRecord(record.failure);
  const code = stringOrNull(failure.code),
    message = stringOrNull(failure.message);
  const nextRetryAt = stringOrNull(record.nextRetryAt);
  return {
    provider:
      record.provider === "bailian" || record.provider === "stub"
        ? record.provider
        : null,
    canRequest:
      typeof record.canRequest === "boolean" ? record.canRequest : null,
    requestBlockReason: stringOrNull(record.requestBlockReason),
    failure: code && message ? { code, message } : null,
    retryScheduled:
      typeof record.retryScheduled === "boolean" ? record.retryScheduled : null,
    nextRetryAt:
      nextRetryAt && Number.isFinite(Date.parse(nextRetryAt))
        ? nextRetryAt
        : null,
    inputCoverage:
      record.inputCoverage === "FULL" ||
      record.inputCoverage === "NOT_SENT" ||
      record.inputCoverage === "UNKNOWN"
        ? record.inputCoverage
        : null,
    usage: {
      reservedRequests: countOrNull(usage.reservedRequests),
      reportedRequests: countOrNull(usage.reportedRequests),
      promptTokens: countOrNull(usage.promptTokens),
      completionTokens: countOrNull(usage.completionTokens),
      totalTokens: countOrNull(usage.totalTokens),
    },
  };
}
export function getAutoRefreshPhase(
  status: unknown,
  review: AiReview | undefined,
): "PENDING" | "RUNNING" | "FAILED" | null {
  if (!review) return null;
  if (status === "PENDING" || status === "RUNNING") return status;
  return status === "FAILED" && review.retryScheduled === true
    ? "FAILED"
    : null;
}
export const displayAiUsage = (value: number | null | undefined): string =>
  value === null || value === undefined ? "未知" : String(value);
