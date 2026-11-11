const TASK_SNAPSHOT_ERROR_MESSAGE =
  "课堂任务内容快照缺失或无效，请联系教师核对。";

export const getTaskSnapshotMessage = (
  available: boolean | undefined,
): string =>
  available === true
    ? "已保存的课堂任务内容"
    : available === false
      ? TASK_SNAPSHOT_ERROR_MESSAGE
      : "课堂任务内容信息暂不可用，请刷新核对后继续。";

export function getTaskSnapshotErrorMessage(
  status: number,
  data: unknown,
): string | undefined {
  return (status === 403 || status === 409) &&
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "message" in data &&
    data.message === TASK_SNAPSHOT_ERROR_MESSAGE
    ? TASK_SNAPSHOT_ERROR_MESSAGE
    : undefined;
}

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
    unreportedRequests: number | null;
    promptTokens: number | null;
    inputTextTokens: number | null;
    cachedInputTokens: number | null;
    uncachedInputTokens: number | null;
    completionTokens: number | null;
    outputTextTokens: number | null;
    reasoningTokens: number | null;
    answerTokens: number | null;
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
      unreportedRequests: countOrNull(usage.unreportedRequests),
      promptTokens: countOrNull(usage.promptTokens),
      inputTextTokens: countOrNull(usage.inputTextTokens),
      cachedInputTokens: countOrNull(usage.cachedInputTokens),
      uncachedInputTokens: countOrNull(usage.uncachedInputTokens),
      completionTokens: countOrNull(usage.completionTokens),
      outputTextTokens: countOrNull(usage.outputTextTokens),
      reasoningTokens: countOrNull(usage.reasoningTokens),
      answerTokens: countOrNull(usage.answerTokens),
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
export const displayAiUsage = (value: number | null | undefined): string => {
  const count = countOrNull(value);
  return count === null ? "未知" : String(count);
};
