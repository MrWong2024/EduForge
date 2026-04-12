"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toRequestAiFeedbackResponse } from "@/lib/api/types-student";
import { getAiStatusHint, getCommonErrorSummary } from "@/lib/ui/status";

type RequestAiFeedbackButtonProps = {
  submissionId: string;
  initialStatus?: string;
};

type RequestErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const toNormalizedStatus = (value?: string): string | undefined =>
  value && value.trim() ? value.trim().toUpperCase() : undefined;

const getButtonLabel = (status?: string): string => {
  if (status === "PENDING") {
    return "排队中";
  }
  if (status === "RUNNING") {
    return "处理中";
  }
  if (status === "SUCCEEDED") {
    return "已生成";
  }
  if (status === "FAILED") {
    return "AI 反馈失败";
  }
  if (status === "DEAD") {
    return "不可重试";
  }

  return "请求 AI 反馈";
};

export function RequestAiFeedbackButton({
  submissionId,
  initialStatus,
}: RequestAiFeedbackButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<RequestErrorState | null>(null);
  const [requestResult, setRequestResult] = useState<unknown>(null);
  const [latestStatus, setLatestStatus] = useState<string | undefined>(
    toNormalizedStatus(initialStatus)
  );

  const status = latestStatus;
  const canRequest = status === "NOT_REQUESTED";
  const isDisabled = isSubmitting || !canRequest;

  const statusHint = useMemo(() => {
    if (status === "FAILED") {
      return "AI 反馈失败，当前不可手动重新请求，请稍后刷新查看。";
    }
    if (!status) {
      return "当前 AI 状态未就绪，暂不可手工请求。";
    }
    return getAiStatusHint(status);
  }, [status]);

  const handleRequest = async () => {
    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);

    try {
      const payload = await fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(submissionId)}/ai-feedback/request`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const parsed = toRequestAiFeedbackResponse(payload);
      const nextStatus =
        toNormalizedStatus(parsed.aiFeedbackStatus) ?? toNormalizedStatus(parsed.status);

      setLatestStatus(nextStatus);
      setRequestResult(parsed.raw);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summary =
          error.status === 403
            ? "无权限触发该提交的 AI 反馈请求。"
            : getCommonErrorSummary(error.status, "请求 AI 反馈");

        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "请求 AI 反馈失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isDisabled}
          onClick={handleRequest}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting ? "请求中..." : getButtonLabel(status)}
        </button>
        <p className="text-sm text-zinc-700">{statusHint}</p>
      </div>

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="请求 AI 反馈失败"
            description={buildErrorDescription(errorState.summary, errorState.detail)}
          />
        </div>
      ) : null}

      {requestResult ? (
        <details className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-emerald-900">
            请求已提交，查看返回结果
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-emerald-900">
            {JSON.stringify(requestResult, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
