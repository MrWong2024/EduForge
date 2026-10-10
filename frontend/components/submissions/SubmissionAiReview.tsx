"use client";
import { useState } from "react";
import { RefreshButton } from "@/components/blocks/RefreshButton";
import { RequestAiFeedbackButton } from "@/components/student/RequestAiFeedbackButton";
import { SubmissionAutoRefresh } from "@/components/student/SubmissionAutoRefresh";
import {
  displayAiUsage,
  getAutoRefreshPhase,
  normalizeAiStatus,
  type AiReview,
  type AiStatus,
} from "@/lib/learning-tasks/ai-review";
import { getAiStatusHint, getAiStatusLabel } from "@/lib/ui/status";
import { toDisplayDate } from "@/lib/ui/format";

type Props = {
  submissionId: string;
  status?: string;
  review?: AiReview;
  autoRefresh: boolean;
};
export function SubmissionAiReview({
  submissionId,
  status,
  review,
  autoRefresh,
}: Props) {
  const [requestOutcome, setRequestOutcome] = useState<{
    status: AiStatus | undefined;
    reviewAtRequest: AiReview | undefined;
  } | null>(null);
  // A successful POST closes this action for the mounted submission, even if
  // the old server props still say canRequest=true. Fresh detail owns the status.
  const currentStatus =
    requestOutcome && requestOutcome.reviewAtRequest === review
      ? requestOutcome.status
      : normalizeAiStatus(status);
  const polling =
    autoRefresh && getAutoRefreshPhase(currentStatus, review) !== null;
  const requestHint = requestOutcome
    ? "申请接口返回状态：" +
      getAiStatusLabel(requestOutcome.status) +
      "。已有任务会返回原状态，不会重新排队。点击刷新查看最新结果。"
    : null;
  const statusHint =
    currentStatus === "FAILED"
      ? review?.retryScheduled === true
        ? "本次处理失败，已安排自动重试；计划重试不保证已经开始或必然成功。"
        : review?.retryScheduled === false
          ? "本次处理失败，当前未安排自动重试。请刷新核对结果，不能重新创建同一提交的 AI 任务。"
          : "本次处理失败，重试安排信息暂不可用，请刷新核对。"
      : getAiStatusHint(currentStatus);
  const usage = review?.usage;
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-900">AI 辅助反馈</h2>
        <RefreshButton label="刷新详情" />
      </div>
      <p>处理状态：{getAiStatusLabel(currentStatus)}</p>
      <p>{statusHint}</p>
      {review?.failure ? (
        <p
          role="status"
          className="whitespace-pre-wrap break-words rounded-md bg-amber-50 p-3 text-amber-900"
        >
          {review.failure.message}
        </p>
      ) : null}
      {review?.retryScheduled === true && currentStatus === "FAILED" ? (
        <p>
          计划重试时间：
          {review.nextRetryAt ? toDisplayDate(review.nextRetryAt) : "未知"}
        </p>
      ) : null}
      {!review ? (
        <p>AI 摘要信息暂不可用，申请入口已关闭，请刷新详情核对。</p>
      ) : review.canRequest !== true && !requestOutcome ? (
        <p>
          {review.requestBlockReason ?? "当前申请资格暂不可用，请刷新核对。"}
        </p>
      ) : null}
      {currentStatus !== "DEAD" ? (
        <RequestAiFeedbackButton
          submissionId={submissionId}
          review={review}
          requested={requestOutcome !== null}
          refreshAfterRequest={autoRefresh}
          onRequested={(nextStatus) =>
            setRequestOutcome({ status: nextStatus, reviewAtRequest: review })
          }
        />
      ) : null}
      {requestHint ? (
        <p role="status" className="break-words">
          {requestHint}
        </p>
      ) : null}
      <p>
        {polling
          ? "当前提交详情会自动刷新；页面不可见时暂停。"
          : "点击刷新查看最新结果。"}
      </p>
      {autoRefresh ? (
        <SubmissionAutoRefresh status={currentStatus} review={review} />
      ) : null}
      <p className="text-xs text-zinc-600">
        {review?.provider === "stub"
          ? "当前为模拟反馈，未调用真实模型。"
          : review?.provider === "bailian"
            ? "反馈来自平台 AI 服务。"
            : "反馈服务信息未知。"}
      </p>
      <p className="text-xs text-zinc-600">
        {review?.inputCoverage === "FULL"
          ? "本次请求包含完整输入材料。"
          : review?.inputCoverage === "NOT_SENT"
            ? "本次尚未发送真实模型请求。"
            : "完整输入覆盖情况未知。"}{" "}
        平台未运行程序；反馈不表示作品正确、运行通过或学生已经掌握，教师评价仍需独立判断。
      </p>
      <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
        <summary className="cursor-pointer font-medium">
          查看请求预留与实报用量
        </summary>
        <div className="mt-2 grid gap-2 break-words sm:grid-cols-2">
          <p>请求预留数：{displayAiUsage(usage?.reservedRequests)}</p>
          <p>获得实报用量的请求数：{displayAiUsage(usage?.reportedRequests)}</p>
          <p>输入 Token：{displayAiUsage(usage?.promptTokens)}</p>
          <p>输出 Token：{displayAiUsage(usage?.completionTokens)}</p>
          <p>实报总 Token：{displayAiUsage(usage?.totalTokens)}</p>
        </div>
        <p className="mt-2">
          预留不代表供应商必然收到请求；未知用量不会补算为零。本页不估算金额。
        </p>
      </details>
    </section>
  );
}
