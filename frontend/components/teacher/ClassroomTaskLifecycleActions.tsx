"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  normalizeClassroomTaskStatus,
  type ClassroomTaskStatus,
  type UpdateClassroomTaskStatusRequest,
} from "@/lib/api/types-teacher";

type ClassroomTaskLifecycleActionsProps = {
  classroomId: string;
  classroomTaskId?: string;
  status?: string;
};

type StatusActionErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const STATUS_META: Record<
  ClassroomTaskStatus,
  {
    label: string;
    hint: string;
    badgeClassName: string;
  }
> = {
  ACTIVE: {
    label: "进行中",
    hint: "当前可继续提交。",
    badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  CLOSED: {
    label: "已关闭",
    hint: "已停止继续提交。",
    badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
  RECALLED: {
    label: "已撤回",
    hint: "已撤回，不再接收提交。",
    badgeClassName: "border-amber-300 bg-amber-50 text-amber-700",
  },
};

export function ClassroomTaskLifecycleActions({
  classroomId,
  classroomTaskId,
  status,
}: ClassroomTaskLifecycleActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<StatusActionErrorState | null>(null);

  const statusValue = normalizeClassroomTaskStatus(status) ?? "ACTIVE";
  const statusMeta = STATUS_META[statusValue];
  const canClose = Boolean(classroomTaskId) && statusValue === "ACTIVE";

  const handleClose = async () => {
    if (!classroomTaskId || !canClose || isSubmitting) {
      return;
    }

    const confirmed = window.confirm("确认关闭该课堂任务？关闭后将停止继续提交，已有记录会保留。");
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const payload: UpdateClassroomTaskStatusRequest = { status: "CLOSED" };

    try {
      await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/status`,
        {
          method: "PATCH",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      setSuccessMessage("已关闭任务。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          400: "当前任务状态不允许关闭，可能已不是进行中状态。",
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理该课堂任务。",
          404: "课堂任务不存在或已不可用。",
        };
        setErrorState({
          status: error.status,
          summary: summaryByStatus[error.status] ?? "关闭任务失败，请稍后重试。",
          detail,
        });
      } else {
        setErrorState({
          summary: "关闭任务失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusMeta.badgeClassName}`}>
        {statusMeta.label}
      </span>
      <p className="text-xs text-zinc-500">{statusMeta.hint}</p>

      {!classroomTaskId ? (
        <p className="text-xs text-zinc-500">缺少课堂任务标识，无法更新状态。</p>
      ) : canClose ? (
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {isSubmitting ? "关闭中..." : "关闭任务"}
        </button>
      ) : (
        <p className="text-xs text-zinc-500">当前状态无需操作</p>
      )}

      {successMessage ? <p className="text-xs text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="更新课堂任务状态失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
