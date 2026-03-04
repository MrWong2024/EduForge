"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";

type RemoveStudentButtonProps = {
  classroomId: string;
  studentUserId: string;
  disabled?: boolean;
};

type RemoveErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

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

export function RemoveStudentButton({
  classroomId,
  studentUserId,
  disabled = false,
}: RemoveStudentButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<RemoveErrorState | null>(null);

  const handleRemove = async () => {
    if (disabled || isSubmitting) {
      return;
    }

    const confirmed = window.confirm("确认将该学生移出班级？此操作不会删除历史记录。");
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);
    setSuccessMessage(null);

    try {
      await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(studentUserId)}/remove`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
          },
        }
      );
      setSuccessMessage("已移除（不删除历史记录）。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理该班级成员。",
          404: "成员不存在、班级不存在或功能未启用/不可用。",
        };
        const summary = summaryByStatus[error.status] ?? "移除成员失败，请稍后重试。";
        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "移除成员失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleRemove}
        disabled={disabled || isSubmitting}
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isSubmitting ? "移除中..." : "移除"}
      </button>

      {successMessage ? <p className="text-xs text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="移除成员失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
