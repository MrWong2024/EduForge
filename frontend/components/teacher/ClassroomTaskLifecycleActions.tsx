"use client";

import { type ReactNode, useState } from "react";
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
  submissionWindowBadge?: ReactNode;
};

type StatusActionErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

type StatusActionTarget = "ACTIVE" | "CLOSED";

const STATUS_META: Record<
  ClassroomTaskStatus,
  {
    label: string;
    badgeClassName: string;
  }
> = {
  ACTIVE: {
    label: "开放中",
    badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  CLOSED: {
    label: "已关闭",
    badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
  RECALLED: {
    label: "已撤回",
    badgeClassName: "border-amber-300 bg-amber-50 text-amber-700",
  },
};

const UNKNOWN_STATUS_META = {
  label: "未知状态",
  badgeClassName: "border-zinc-300 bg-zinc-50 text-zinc-600",
};

export function ClassroomTaskLifecycleActions({
  classroomId,
  classroomTaskId,
  status,
  submissionWindowBadge,
}: ClassroomTaskLifecycleActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingTargetStatus, setPendingTargetStatus] = useState<StatusActionTarget | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<StatusActionErrorState | null>(null);

  const statusValue = normalizeClassroomTaskStatus(status);
  const statusMeta = statusValue ? STATUS_META[statusValue] : UNKNOWN_STATUS_META;
  const canClose = Boolean(classroomTaskId) && statusValue === "ACTIVE";
  const canReopen = Boolean(classroomTaskId) && statusValue === "CLOSED";

  const handleStatusTransition = async (targetStatus: StatusActionTarget) => {
    const canTransition = targetStatus === "CLOSED" ? canClose : canReopen;
    if (!classroomTaskId || !canTransition || isSubmitting) {
      return;
    }

    const confirmMessage =
      targetStatus === "CLOSED"
        ? "确认关闭该课堂任务？关闭后将停止继续提交，已有记录会保留。"
        : "确认恢复该课堂任务的提交？恢复后学生可继续提交；截止时间、迟交与最大尝试次数不会自动修改。";

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setPendingTargetStatus(targetStatus);
    setSuccessMessage(null);
    setErrorState(null);

    const payload: UpdateClassroomTaskStatusRequest = { status: targetStatus };

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
      setSuccessMessage(targetStatus === "CLOSED" ? "已关闭任务。" : "已恢复提交。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = targetStatus === "CLOSED" ? {
          400: "当前任务状态不允许关闭，可能已不是开放中状态。",
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理该课堂任务。",
          404: "课堂任务不存在或已不可用。",
        } : {
          400: "当前任务状态不允许恢复提交，可能已不是已关闭状态。",
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理该课堂任务。",
          404: "课堂任务不存在或已不可用。",
        };
        setErrorState({
          status: error.status,
          summary: summaryByStatus[error.status] ?? (targetStatus === "CLOSED"
            ? "关闭任务失败，请稍后重试。"
            : "恢复提交失败，请稍后重试。"),
          detail,
        });
      } else {
        setErrorState({
          summary: targetStatus === "CLOSED"
            ? "关闭任务失败，请稍后重试。"
            : "恢复提交失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
      setPendingTargetStatus(null);
    }
  };

  return (
    <div className="space-y-2">
      <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusMeta.badgeClassName}`}>
        {statusMeta.label}
      </span>
      {submissionWindowBadge ? <div>{submissionWindowBadge}</div> : null}

      {!classroomTaskId ? (
        <p className="text-xs text-zinc-500">缺少课堂任务标识，无法更新状态。</p>
      ) : canClose ? (
        <button
          type="button"
          onClick={() => handleStatusTransition("CLOSED")}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {isSubmitting && pendingTargetStatus === "CLOSED" ? "关闭中..." : "关闭任务"}
        </button>
      ) : canReopen ? (
        <button
          type="button"
          onClick={() => handleStatusTransition("ACTIVE")}
          disabled={isSubmitting}
          className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {isSubmitting && pendingTargetStatus === "ACTIVE" ? "恢复中..." : "恢复提交"}
        </button>
      ) : null}

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
