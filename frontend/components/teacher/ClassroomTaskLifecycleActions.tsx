"use client";

import { type ReactNode, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/blocks/ConfirmDialog";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  normalizeClassroomTaskStatus,
  type ClassroomTaskStatus,
  type UpdateClassroomTaskStatusRequest,
} from "@/lib/api/types-teacher";
import { getClassroomTaskStatusLabel } from "@/lib/ui/status";
import { useClassroomTaskPublishReceipt } from "./ClassroomTaskListInteractions";

type ClassroomTaskLifecycleActionsProps = {
  classroomId: string;
  classroomTaskId?: string;
  taskTitle: string;
  status?: string;
  submissionWindowBadge?: ReactNode;
  listHeadingId: string;
};

type LifecycleAction = ClassroomTaskStatus | "DELETE";

type PendingAction = {
  action: LifecycleAction;
  classroomTaskId: string;
};

type ActionError = {
  action: LifecycleAction;
  status?: number;
  reason?: "notEmpty" | "unconfirmed";
};

const STATUS_BADGE: Record<ClassroomTaskStatus, string> = {
  ACTIVE: "border-emerald-300 bg-emerald-50 text-emerald-700",
  CLOSED: "border-zinc-300 bg-zinc-100 text-zinc-700",
  RECALLED: "border-amber-300 bg-amber-50 text-amber-700",
};

const UNKNOWN_STATUS_BADGE = "border-zinc-300 bg-zinc-50 text-zinc-600";

const ACTION_DETAILS = {
  CLOSED: {
    label: "关闭任务",
    description: "关闭后停止新提交。已有作品和反馈会保留，任务仍计入过程性评价。之后可恢复提交。",
    success: "已关闭任务。",
    style: "border-zinc-300 text-zinc-700 hover:bg-zinc-100",
  },
  ACTIVE: {
    label: "恢复提交",
    description: "任务恢复开放。原截止时间和迟交设置继续生效，学生能否提交以这些规则为准。",
    success: "已恢复提交。",
    style: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  },
  RECALLED: {
    label: "撤回任务",
    description: "撤回后停止新提交，保留作品和反馈。该任务及其贡献退出过程性评价，撤回后不可恢复。",
    success: "已撤回任务。",
    style: "border-amber-300 text-amber-800 hover:bg-amber-50",
  },
  DELETE: {
    label: "删除任务",
    description: "仅删除当前班级的发布实例，源模板保留。仅无关联作品和 AI 反馈任务的实例可删除。删除后，学生不能提交，此实例不会计入过程性评价，也无法恢复。",
    success: "已删除任务。",
    style: "border-red-300 text-red-700 hover:bg-red-50",
  },
} satisfies Record<LifecycleAction, {
  label: string;
  description: string;
  success: string;
  style: string;
}>;

const ERROR_SUMMARY: Record<number, string> = {
  400: "当前任务状态不允许此操作，请核对任务状态后再操作。",
  401: "登录状态已失效，请重新登录。",
  403: "无权限管理该课堂任务。",
  404: "课堂任务不存在或已不可用。",
  409: "课堂任务状态已变化，请核对最新状态后再操作。",
};

function describeActionError(error: ActionError, canRecall: boolean) {
  const label = ACTION_DETAILS[error.action].label;
  if (error.reason === "notEmpty") {
    return canRecall
      ? "该任务已有作品或 AI 反馈任务，无法删除。若要停止提交并保留记录，可选择撤回任务。"
      : "该任务已有作品或 AI 反馈任务，无法删除。";
  }
  if (error.reason === "unconfirmed") {
    return `无法确认是否已完成“${label}”，请核对任务列表后再操作。`;
  }
  return (error.status ? ERROR_SUMMARY[error.status] : undefined)
    ?? `${label}失败，请稍后再试。`;
}

export function ClassroomTaskLifecycleActions({
  classroomId,
  classroomTaskId,
  taskTitle,
  status,
  submissionWindowBadge,
  listHeadingId,
}: ClassroomTaskLifecycleActionsProps) {
  const router = useRouter();
  const [, setPublishedTaskId] = useClassroomTaskPublishReceipt();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [runningAction, setRunningAction] = useState<LifecycleAction | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<ActionError | null>(null);
  const confirmingRef = useRef(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const statusValue = normalizeClassroomTaskStatus(status);
  const statusBadge = statusValue ? STATUS_BADGE[statusValue] : UNKNOWN_STATUS_BADGE;
  const canRecall = statusValue === "ACTIVE" || statusValue === "CLOSED";
  const isBusy = runningAction !== null || isRefreshing;
  const primaryAction = statusValue === "ACTIVE" ? "CLOSED" : "ACTIVE";

  const handleConfirm = async () => {
    if (!pendingAction || confirmingRef.current) return;

    const { action, classroomTaskId: targetId } = pendingAction;
    const path = `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(targetId)}`;
    const signal = AbortSignal.timeout(30_000);
    confirmingRef.current = true;
    setPendingAction(null);
    setRunningAction(action);
    setSuccessMessage(null);
    setErrorState(null);

    try {
      if (action === "DELETE") {
        const response = await fetchJson<{ ok?: boolean } | null>(path, { method: "DELETE", signal });
        if (response?.ok !== true) throw new Error("Unexpected classroom task deletion response");

        setPublishedTaskId((publishedId) => publishedId === targetId ? null : publishedId);
        if (actionsRef.current?.contains(document.activeElement)) {
          document.getElementById(listHeadingId)?.focus();
        }
      } else {
        const payload: UpdateClassroomTaskStatusRequest = { status: action };
        await fetchJson<unknown>(`${path}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
        if (action === "RECALLED" && actionsRef.current?.contains(document.activeElement)) {
          deleteButtonRef.current?.focus();
        }
      }
      setSuccessMessage(ACTION_DETAILS[action].success);
      startRefresh(() => router.refresh());
    } catch (error) {
      const httpStatus = error instanceof BrowserFetchJsonError ? error.status : undefined;
      const data = error instanceof BrowserFetchJsonError ? error.data : null;
      const notEmpty = action === "DELETE" && httpStatus === 409
        && data !== null && typeof data === "object" && "code" in data
        && data.code === "CLASSROOM_TASK_NOT_EMPTY";
      const unconfirmed = httpStatus === undefined || httpStatus >= 500;
      setErrorState({
        action,
        status: httpStatus,
        reason: notEmpty ? "notEmpty" : unconfirmed ? "unconfirmed" : undefined,
      });
      if (unconfirmed || httpStatus === 404 || httpStatus === 409) {
        startRefresh(() => router.refresh());
      }
    } finally {
      confirmingRef.current = false;
      setRunningAction(null);
    }
  };

  const renderAction = (action: LifecycleAction, ref?: typeof deleteButtonRef) => {
    const { label, style } = ACTION_DETAILS[action];
    return (
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-disabled={isBusy}
        onClick={(event) => {
          if (!classroomTaskId || isBusy || pendingAction || confirmingRef.current) return;
          event.currentTarget.focus();
          setPendingAction({ action, classroomTaskId });
        }}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-100 aria-disabled:text-zinc-400 ${style}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div ref={actionsRef} className="space-y-2">
      <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadge}`}>
        {getClassroomTaskStatusLabel(status)}
      </span>
      {submissionWindowBadge ? <div>{submissionWindowBadge}</div> : null}

      {!classroomTaskId ? (
        <p className="text-xs text-zinc-500">缺少课堂任务标识，无法管理任务。</p>
      ) : statusValue ? (
        <div className="flex flex-wrap gap-2">
          {canRecall ? renderAction(primaryAction) : null}
          {canRecall ? renderAction("RECALLED") : null}
          {renderAction("DELETE", deleteButtonRef)}
        </div>
      ) : null}

      {pendingAction ? (
        <ConfirmDialog
          title={`${ACTION_DETAILS[pendingAction.action].label}：${taskTitle}`}
          description={ACTION_DETAILS[pendingAction.action].description}
          confirmLabel={ACTION_DETAILS[pendingAction.action].label}
          destructive={pendingAction.action === "DELETE" || pendingAction.action === "RECALLED"}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirm}
        />
      ) : null}

      {runningAction ? (
        <p role="status" className="text-xs text-zinc-600">正在处理…</p>
      ) : successMessage ? (
        <p role="status" className="text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title={`${ACTION_DETAILS[errorState.action].label}失败`}
          description={describeActionError(errorState, canRecall)}
        />
      ) : null}
    </div>
  );
}
