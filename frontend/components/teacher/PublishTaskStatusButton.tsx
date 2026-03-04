"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";

type PublishTaskStatusButtonProps = {
  taskId?: string;
  taskStatus?: string;
};

type PublishStatusErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const toStatusUpper = (value?: string): string => (value ?? "").trim().toUpperCase();

const extractRawDetail = (data: unknown): string | undefined => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const message =
    "message" in data && typeof (data as { message?: unknown }).message === "string"
      ? String((data as { message: string }).message)
      : "";
  const code =
    "code" in data && typeof (data as { code?: unknown }).code === "string"
      ? String((data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

export function PublishTaskStatusButton({ taskId, taskStatus }: PublishTaskStatusButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<PublishStatusErrorState | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const normalizedStatus = toStatusUpper(taskStatus);
  const isPublished = normalizedStatus === "PUBLISHED";
  const isMissingTaskId = !taskId;

  const handlePublish = async () => {
    if (isSubmitting || isPublished || isMissingTaskId) {
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);
    setSuccessText(null);

    try {
      await fetchJson<unknown>(`learning-tasks/tasks/${encodeURIComponent(taskId)}/publish`, {
        method: "POST",
        headers: {
          accept: "application/json",
        },
      });
      setSuccessText("已标记为已发布。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理任务。",
          404: "任务不存在或功能未启用/不可用。",
        };
        const summary = summaryByStatus[error.status] ?? "任务状态更新失败，请稍后重试。";
        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "任务状态更新失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isMissingTaskId) {
    return <p className="text-sm text-zinc-500">缺少 taskId，无法更新发布状态。</p>;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handlePublish}
        disabled={isSubmitting || isPublished}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isPublished ? "已发布" : isSubmitting ? "更新中..." : "标记为已发布"}
      </button>

      {successText ? <p className="text-xs text-emerald-700">{successText}</p> : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="任务状态更新失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
