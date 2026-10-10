"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { toRequestAiFeedbackResponse } from "@/lib/api/types-student";
import {
  normalizeAiStatus,
  type AiReview,
  type AiStatus,
} from "@/lib/learning-tasks/ai-review";
import { getCommonErrorSummary } from "@/lib/ui/status";

type Props = {
  submissionId: string;
  review?: AiReview;
  requested: boolean;
  refreshAfterRequest: boolean;
  onRequested: (status: AiStatus | undefined) => void;
};
export function RequestAiFeedbackButton({
  submissionId,
  review,
  requested,
  refreshAfterRequest,
  onRequested,
}: Props) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewNeedsRefresh, setReviewNeedsRefresh] = useState<AiReview | null>(
    null,
  );
  const [error, setError] = useState<{
    status?: number;
    message: string;
  } | null>(null);
  const disabled =
    isSubmitting ||
    requested ||
    review?.canRequest !== true ||
    reviewNeedsRefresh === review;
  const handleRequest = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = await fetchJson<unknown>(
        "learning-tasks/submissions/" +
          encodeURIComponent(submissionId) +
          "/ai-feedback/request",
        {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      const result = toRequestAiFeedbackResponse(payload);
      onRequested(
        normalizeAiStatus(result.aiFeedbackStatus) ??
          normalizeAiStatus(result.status),
      );
      if (refreshAfterRequest) router.refresh();
    } catch (error) {
      setReviewNeedsRefresh(review ?? null);
      setError(
        error instanceof BrowserFetchJsonError
          ? {
              status: error.status,
              message:
                error.status >= 500
                  ? "申请结果尚未确认，请先刷新详情核对，避免重复申请。"
                  : getCommonErrorSummary(error.status, "申请 AI 辅助反馈") +
                    "请刷新详情核对当前资格。",
            }
          : {
              message:
                "网络中断或请求超时，申请结果未确认。请先刷新详情核对，避免重复申请。",
            },
      );
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled}
        onClick={handleRequest}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
      >
        {isSubmitting ? "申请中…" : "申请 AI 辅助反馈"}
      </button>
      {error ? (
        <ErrorState
          status={error.status}
          title="AI 申请结果"
          description={error.message}
        />
      ) : null}
    </div>
  );
}
