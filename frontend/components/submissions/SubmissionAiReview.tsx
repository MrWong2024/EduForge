"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import {
  toRequestAiFeedbackResponse,
  toSubmissionDetailResponse,
} from "@/lib/api/types-student";
import { SubmissionAiOperations } from "@/lib/learning-tasks/submission-ai-operations";
import { RequestAiFeedbackButton } from "@/components/student/RequestAiFeedbackButton";
import { SubmissionAutoRefresh } from "@/components/student/SubmissionAutoRefresh";
import {
  displayAiUsage,
  getAutoRefreshPhase,
  type AiReview,
} from "@/lib/learning-tasks/ai-review";
import {
  getAiStatusHint,
  getAiStatusLabel,
  getCommonErrorSummary,
} from "@/lib/ui/status";
import { toDisplayDate } from "@/lib/ui/format";
import {
  getSubmissionRevisionError,
  isValidContentRevision,
} from "@/lib/learning-tasks/text-submission";

type Props = {
  submissionId: string;
  status?: string;
  review?: AiReview;
  autoRefresh: boolean;
  contentRevision?: number | null;
};
export function SubmissionAiReview(props: Props) {
  return <SubmissionAiReviewPanel key={props.submissionId} {...props} />;
}
function SubmissionAiReviewPanel({
  submissionId,
  status,
  review: initialReview,
  autoRefresh,
  contentRevision,
}: Props) {
  const router = useRouter();
  const [operations] = useState(
    () =>
      new SubmissionAiOperations(
        submissionId,
        status,
        initialReview,
        contentRevision,
      ),
  );
  const [view, setView] = useState(() => operations.view);
  const [error, setError] = useState<{
    status?: number;
    message: string;
  } | null>(null);
  const [isPageRefreshing, startTransition] = useTransition();
  const activeAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      operations.cancelPending();
      activeAbort.current?.abort();
    },
    [operations],
  );

  const readDetail = useCallback(
    async (explicit: boolean) => {
      if (isPageRefreshing) return;
      const operation = operations.beginRead(explicit);
      if (!operation) return;
      const abort = new AbortController();
      activeAbort.current = abort;
      setView(operations.view);
      setError(null);
      try {
        const payload = await fetchJson<unknown>(
          "learning-tasks/submissions/" + encodeURIComponent(submissionId),
          {
            cache: "no-store",
            signal: AbortSignal.any([
              abort.signal,
              AbortSignal.timeout(30_000),
            ]),
          },
        );
        const accepted = operations.finishRead(
          operation,
          toSubmissionDetailResponse(payload),
        );
        if (accepted === null) return;
        setView(operations.view);
        if (!accepted) {
          setError({
            message:
              "详情返回信息不完整或与已确认申请不一致，申请入口保持关闭。请再次显式刷新核对。",
          });
          return;
        }
        // Only this after-operation read updates the AI block. RSC props arriving
        // from an earlier refresh cannot replace its accepted status/eligibility.
        if (explicit || autoRefresh) startTransition(() => router.refresh());
      } catch (error) {
        if (operations.finishRead(operation) === null) return;
        setView(operations.view);
        setError({
          status:
            error instanceof BrowserFetchJsonError ? error.status : undefined,
          message: "权威详情读取未完成，申请入口保持关闭。请再次显式刷新核对。",
        });
      } finally {
        if (activeAbort.current === abort) activeAbort.current = null;
      }
    },
    [autoRefresh, isPageRefreshing, operations, router, submissionId],
  );
  const autoRead = useCallback(() => readDetail(false), [readDetail]);
  const handleRequest = async () => {
    if (isPageRefreshing || view.displayedRevision !== contentRevision) return;
    const operation = operations.beginRequest();
    if (!operation) return;
    const abort = new AbortController();
    activeAbort.current = abort;
    setView(operations.view);
    setError(null);
    try {
      const payload = await fetchJson<unknown>(
        "learning-tasks/submissions/" +
          encodeURIComponent(submissionId) +
          "/ai-feedback/request",
        {
          method: "POST",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            expectedRevision: operation.expectedRevision,
          }),
        },
      );
      const confirmed = operations.finishRequest(
        operation,
        toRequestAiFeedbackResponse(payload),
      );
      if (confirmed === null) return;
      setView(operations.view);
      if (!confirmed) {
        setError({
          message:
            "申请响应信息不完整，结果尚未确认。请显式刷新详情核对，避免重复申请。",
        });
        return;
      }
      if (autoRefresh) await readDetail(false);
    } catch (error) {
      if (operations.finishRequest(operation) === null) return;
      setView(operations.view);
      setError({
        status:
          error instanceof BrowserFetchJsonError ? error.status : undefined,
        message:
          error instanceof BrowserFetchJsonError && error.status === 409
            ? getSubmissionRevisionError(error.data)
            : error instanceof BrowserFetchJsonError && error.status < 500
              ? getCommonErrorSummary(error.status, "申请 AI 辅助反馈") +
                "请显式刷新详情核对当前资格。"
              : "申请结果尚未确认，请显式刷新详情核对，避免重复申请。",
      });
    } finally {
      if (activeAbort.current === abort) activeAbort.current = null;
    }
  };
  const currentStatus = view.status,
    review = view.review;
  const refreshEnabled =
    view.busy === null && !view.needsConfirmation && !isPageRefreshing;
  const polling =
    autoRefresh &&
    refreshEnabled &&
    getAutoRefreshPhase(currentStatus, review) !== null;
  const requestHint = view.confirmedJob
    ? "申请已确认已有处理任务，不会重新排队。点击刷新查看最新结果。"
    : view.needsConfirmation
      ? "结果需核对：只有此后手动发起并成功完成的详情读取，才能重新判断申请资格。"
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
        <button
          type="button"
          disabled={view.busy !== null || isPageRefreshing}
          onClick={() => void readDetail(true)}
          className="text-sm text-blue-700 underline disabled:cursor-not-allowed disabled:text-zinc-500"
        >
          {view.busy === "read" || isPageRefreshing ? "刷新中…" : "刷新详情"}
        </button>
      </div>
      <p>处理状态：{getAiStatusLabel(currentStatus)}</p>
      <p>{statusHint}</p>
      {!isValidContentRevision(contentRevision) ? (
        <p>作品版本信息暂不可用，请刷新详情核对后再申请。</p>
      ) : view.displayedRevision !== contentRevision ||
        view.contentRevision !== contentRevision ? (
        <div
          className="space-y-2 rounded-md bg-amber-50 p-3 text-amber-900"
          role="status"
        >
          <p>
            作品已有新版。请先刷新查看页面中的当前作品，再明确确认；后台状态刷新不会替你确认已查看新版。
          </p>
          <button
            type="button"
            disabled={
              view.busy !== null ||
              isPageRefreshing ||
              view.contentRevision !== contentRevision
            }
            onClick={() => {
              if (operations.confirmDisplayedRevision(contentRevision))
                setView(operations.view);
            }}
            className="text-blue-700 underline disabled:text-zinc-500"
          >
            已查看页面当前作品，按此作品申请
          </button>
        </div>
      ) : null}
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
      ) : review.canRequest !== true && !view.confirmedJob ? (
        <p>
          {review.requestBlockReason ?? "当前申请资格暂不可用，请刷新核对。"}
        </p>
      ) : null}
      {currentStatus !== "DEAD" ? (
        <RequestAiFeedbackButton
          disabled={
            !view.canRequest ||
            isPageRefreshing ||
            view.displayedRevision !== contentRevision
          }
          isSubmitting={view.busy === "request"}
          onRequest={handleRequest}
        />
      ) : null}
      {error ? (
        <ErrorState
          status={error.status}
          title="AI 操作结果"
          description={error.message}
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
        <SubmissionAutoRefresh
          status={currentStatus}
          review={review}
          enabled={refreshEnabled}
          onRefresh={autoRead}
        />
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
