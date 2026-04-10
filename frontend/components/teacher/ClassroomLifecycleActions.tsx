"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { FloatingMoreMenu } from "@/components/blocks/FloatingMoreMenu";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { type ClassroomStatus, type UpdateClassroomRequest } from "@/lib/api/types-teacher";

type ClassroomLifecycleActionsProps = {
  classroomId: string;
  status?: ClassroomStatus;
};

type ClassroomLifecycleAction = "archive" | "restore" | "delete";

type ClassroomLifecycleErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const CLASSROOM_NOT_EMPTY_CODE = "CLASSROOM_NOT_EMPTY";
const CLASSROOM_NOT_EMPTY_MESSAGE = "该班级已有成员或任务记录，不能删除，只能归档";

const extractErrorCode = (source: unknown): string | undefined => {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const sourceRecord = source as Record<string, unknown>;
  if (typeof sourceRecord.code === "string" && sourceRecord.code.trim()) {
    return sourceRecord.code.trim();
  }

  const data = sourceRecord.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const dataRecord = data as Record<string, unknown>;
  if (typeof dataRecord.code === "string" && dataRecord.code.trim()) {
    return dataRecord.code.trim();
  }

  return undefined;
};

const getStatusActionSummary = (status: number, action: "archive" | "restore"): string => {
  if (status === 400) {
    return action === "archive" ? "归档参数不合法，或当前班级状态不允许归档。" : "恢复参数不合法，或当前班级状态不允许恢复。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限操作该班级。";
  }
  if (status === 404) {
    return "班级不存在或功能未启用/不可用。";
  }
  return getCommonErrorSummary(status, action === "archive" ? "归档班级" : "恢复班级");
};

const getDeleteSummary = (status: number, code?: string): string => {
  if (status === 409 && code === CLASSROOM_NOT_EMPTY_CODE) {
    return CLASSROOM_NOT_EMPTY_MESSAGE;
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限删除该班级。";
  }
  if (status === 404) {
    return "班级不存在或已删除。";
  }
  return getCommonErrorSummary(status, "删除班级");
};

export function ClassroomLifecycleActions({ classroomId, status }: ClassroomLifecycleActionsProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ClassroomLifecycleAction | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<ClassroomLifecycleErrorState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isSubmitting = pendingAction !== null;
  const isArchived = status === "ARCHIVED";

  const handleStatusUpdate = async (targetStatus: ClassroomStatus) => {
    const action: "archive" | "restore" = targetStatus === "ARCHIVED" ? "archive" : "restore";
    if (isSubmitting) {
      return;
    }
    setIsMenuOpen(false);

    const confirmed = window.confirm(
      action === "archive"
        ? "归档班级\n归档后该班级默认不再显示在进行中列表，但历史数据会保留。"
        : "恢复班级\n恢复后该班级将重新出现在进行中列表。"
    );
    if (!confirmed) {
      return;
    }

    setPendingAction(action);
    setSuccessMessage(null);
    setErrorState(null);

    const payload: UpdateClassroomRequest = {
      status: targetStatus,
    };

    try {
      await fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      setSuccessMessage(action === "archive" ? "班级已归档。" : "班级已恢复为进行中。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        setErrorState({
          status: error.status,
          summary: getStatusActionSummary(error.status, action),
          detail,
        });
      } else {
        setErrorState({
          summary: action === "archive" ? "归档班级失败，请稍后重试。" : "恢复班级失败，请稍后重试。",
        });
      }
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    if (isSubmitting) {
      return;
    }
    setIsMenuOpen(false);

    const confirmed = window.confirm("删除班级\n仅空班级允许删除。删除后不可恢复。");
    if (!confirmed) {
      return;
    }

    setPendingAction("delete");
    setSuccessMessage(null);
    setErrorState(null);

    try {
      await fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        method: "DELETE",
        headers: {
          accept: "application/json",
        },
      });
      setSuccessMessage("班级已删除。");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const code = extractErrorCode(error.data);
        const detail = extractRawDetail(error.data);
        const summary = getDeleteSummary(error.status, code);
        setErrorState({
          status: error.status,
          summary,
          detail: summary === CLASSROOM_NOT_EMPTY_MESSAGE ? undefined : detail,
        });
      } else {
        setErrorState({
          summary: "删除班级失败，请稍后重试。",
        });
      }
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-2">
      <FloatingMoreMenu
        isOpen={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        disabled={isSubmitting}
        label={isSubmitting ? "处理中..." : "更多"}
      >
        {isArchived ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => handleStatusUpdate("ACTIVE")}
            disabled={isSubmitting}
            className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            恢复
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            onClick={() => handleStatusUpdate("ARCHIVED")}
            disabled={isSubmitting}
            className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            归档
          </button>
        )}

        <div className="my-1 border-t border-zinc-100" />

        <button
          type="button"
          role="menuitem"
          onClick={handleDelete}
          disabled={isSubmitting}
          className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          删除
        </button>
      </FloatingMoreMenu>

      {isArchived ? (
        pendingAction === "restore" ? (
          <p className="text-xs text-zinc-500">正在恢复班级...</p>
        ) : null
      ) : (
        pendingAction === "archive" ? (
          <p className="text-xs text-zinc-500">正在归档班级...</p>
        ) : null
      )}

      {pendingAction === "delete" ? (
        <p className="text-xs text-zinc-500">正在删除班级...</p>
      ) : null}

      {successMessage ? <p className="text-xs text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="班级操作失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
