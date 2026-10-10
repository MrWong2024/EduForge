import type { AiRequestRecord } from '../schemas/ai-feedback-job.schema';
import { AiFeedbackJobStatus } from '../schemas/ai-feedback-job.schema';
export const AI_REVIEW_FAILURE_MESSAGES = {
  INPUT_BUDGET_EXCEEDED:
    '作业已保存，完整内容超过 AI 输入限额，本次未生成 AI 反馈。',
  OUTPUT_LIMIT_REACHED: 'AI 输出达到上限，反馈不完整，本次未保存 AI 反馈。',
  PROVIDER_CONFIGURATION: 'AI 服务配置暂不可用，请联系教师或管理员。',
  RATE_LIMITED: 'AI 服务请求过于频繁，请稍后查看处理状态。',
  UPSTREAM_UNAVAILABLE: 'AI 服务暂不可用或响应超时，请稍后查看处理状态。',
  INVALID_RESPONSE: 'AI 返回的反馈格式无效，本次未保存 AI 反馈。',
  TASK_INELIGIBLE: '当前课堂任务不满足 AI 评阅条件。',
  LEGACY_JOB_UNSUPPORTED: '历史 AI 任务不支持当前评阅预算，请联系教师。',
  INTERNAL_ERROR: 'AI 评阅处理发生内部错误，请联系教师或管理员。',
} as const;
export type AiReviewFailureCode = keyof typeof AI_REVIEW_FAILURE_MESSAGES;
export type AiReviewJob = {
  status: AiFeedbackJobStatus;
  budgetVersion?: number;
  provider?: 'bailian' | 'stub';
  failureCode?: AiReviewFailureCode;
  attempts: number;
  maxAttempts: number;
  notBefore?: Date | null;
  requests?: AiRequestRecord[];
};
export type AiReviewSummary = {
  provider: 'bailian' | 'stub' | null;
  canRequest: boolean;
  requestBlockReason: string | null;
  failure: { code: AiReviewFailureCode; message: string } | null;
  retryScheduled: boolean;
  nextRetryAt: string | null;
  inputCoverage: 'FULL' | 'NOT_SENT' | 'UNKNOWN';
  usage: {
    reservedRequests: number | null;
    reportedRequests: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
};
export function buildAiReviewSummary(
  job: AiReviewJob | null,
  eligibilityReason: string | null,
  workerEnabled: boolean,
): AiReviewSummary {
  const current = job?.budgetVersion === 1;
  const records = current ? (job.requests ?? []) : [];
  const known = !job || current;
  const reported = records.filter(
    (record) => record.usage !== null && record.usage !== undefined,
  );
  const complete = known && reported.length === records.length;
  const sum = (field: 'promptTokens' | 'completionTokens' | 'totalTokens') =>
    complete
      ? reported.reduce(
          (total, record) => total + (record.usage?.[field] ?? 0),
          0,
        )
      : null;
  const retryDate =
    current &&
    job.status === AiFeedbackJobStatus.Failed &&
    job.attempts < job.maxAttempts &&
    workerEnabled
      ? (job.notBefore ?? null)
      : null;
  const retryScheduled = retryDate !== null;
  const failureCode = job?.failureCode;
  const safeCode =
    failureCode && Object.hasOwn(AI_REVIEW_FAILURE_MESSAGES, failureCode)
      ? failureCode
      : null;
  return {
    provider: current ? (job.provider ?? null) : null,
    canRequest: !job && eligibilityReason === null,
    requestBlockReason:
      eligibilityReason ??
      (job ? '该提交已有 AI 评阅任务，不能重复创建。' : null),
    failure: safeCode
      ? { code: safeCode, message: AI_REVIEW_FAILURE_MESSAGES[safeCode] }
      : null,
    retryScheduled,
    nextRetryAt: retryDate?.toISOString() ?? null,
    inputCoverage:
      !job || (current && records.length === 0)
        ? 'NOT_SENT'
        : current &&
            job.provider === 'bailian' &&
            job.status === AiFeedbackJobStatus.Succeeded
          ? 'FULL'
          : 'UNKNOWN',
    usage: {
      reservedRequests: known ? records.length : null,
      reportedRequests: known ? reported.length : null,
      promptTokens: sum('promptTokens'),
      completionTokens: sum('completionTokens'),
      totalTokens: sum('totalTokens'),
    },
  };
}
