"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/blocks/ConfirmDialog";
import { ErrorState } from "@/components/blocks/ErrorState";
import { FloatingMoreMenu } from "@/components/blocks/FloatingMoreMenu";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { type CourseStatus, type UpdateCourseRequest } from "@/lib/api/types-teacher";
import { useTeacherLifecycleList } from "./TeacherLifecycleList";

type CourseLifecycleActionsProps = {
  courseId: string;
  displayName: string;
  status?: CourseStatus;
  hasStatusFilter: boolean;
};

type CourseLifecycleAction = "archive" | "restore" | "delete";

type CourseLifecycleErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const COURSE_NOT_EMPTY_CODE = "COURSE_NOT_EMPTY";
const COURSE_NOT_EMPTY_MESSAGE = "该课程下已有班级记录，不能删除，只能归档";

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
    return action === "archive" ? "归档参数不合法，或当前课程状态不允许归档。" : "恢复参数不合法，或当前课程状态不允许恢复。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限操作该课程。";
  }
  if (status === 404) {
    return "课程不存在或功能未启用/不可用。";
  }
  return getCommonErrorSummary(status, action === "archive" ? "归档课程" : "恢复课程");
};

const getDeleteSummary = (status: number, code?: string): string => {
  if (status === 409 && code === COURSE_NOT_EMPTY_CODE) {
    return COURSE_NOT_EMPTY_MESSAGE;
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限删除该课程。";
  }
  if (status === 404) {
    return "课程不存在或已删除。";
  }
  return getCommonErrorSummary(status, "删除课程");
};

const ACTION_DETAILS = {
  archive: {
    label: "归档课程",
    description: "归档后，该课程默认不再显示在进行中列表，历史数据会保留。",
    success: "已归档",
  },
  restore: {
    label: "恢复课程",
    description: "恢复后，该课程将重新出现在进行中列表。",
    success: "已恢复为进行中",
  },
  delete: {
    label: "删除课程",
    description: "仅空课程允许删除。删除后不可恢复。",
    success: "已删除",
  },
} satisfies Record<CourseLifecycleAction, { label: string; description: string; success: string }>;

export function CourseLifecycleActions({
  courseId,
  displayName,
  status,
  hasStatusFilter,
}: CourseLifecycleActionsProps) {
  const router = useRouter();
  const { clearFeedback, showSuccess } = useTeacherLifecycleList();
  const [confirmation, setConfirmation] = useState<CourseLifecycleAction | null>(null);
  const [runningAction, setRunningAction] = useState<CourseLifecycleAction | null>(null);
  const [errorState, setErrorState] = useState<CourseLifecycleErrorState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isRequestInFlight = useRef(false);

  const isBusy = runningAction !== null || isRefreshing;
  const statusAction = status === "ARCHIVED" ? "restore" : "archive";

  const openConfirmation = (action: CourseLifecycleAction) => {
    if (isBusy || confirmation || isRequestInFlight.current) return;

    // The selected menu item will unmount. Let the dialog restore focus to More.
    triggerRef.current?.focus({ preventScroll: true });
    setIsMenuOpen(false);
    setConfirmation(action);
  };

  const handleConfirm = async () => {
    if (!confirmation || isRequestInFlight.current) return;

    const action = confirmation;
    const path = `courses/${encodeURIComponent(courseId)}`;
    isRequestInFlight.current = true;
    setConfirmation(null);
    setRunningAction(action);
    clearFeedback();
    setErrorState(null);

    try {
      if (action === "delete") {
        await fetchJson<unknown>(path, {
          method: "DELETE",
          headers: { accept: "application/json" },
        });
      } else {
        const payload: UpdateCourseRequest = {
          status: action === "archive" ? "ARCHIVED" : "ACTIVE",
        };
        await fetchJson<unknown>(path, {
          method: "PATCH",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }

      const departingRow = action === "delete" || hasStatusFilter
        ? triggerRef.current?.closest("tr")
        : null;
      showSuccess(`课程「${displayName}」${ACTION_DETAILS[action].success}。`, departingRow);
      startRefresh(() => router.refresh());
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summary = action === "delete"
          ? getDeleteSummary(error.status, extractErrorCode(error.data))
          : getStatusActionSummary(error.status, action);
        setErrorState({
          status: error.status,
          summary,
          detail: summary === COURSE_NOT_EMPTY_MESSAGE ? undefined : extractRawDetail(error.data),
        });
      } else {
        setErrorState({
          summary: `${ACTION_DETAILS[action].label}失败，请稍后重试。`,
        });
      }
    } finally {
      isRequestInFlight.current = false;
      setRunningAction(null);
    }
  };

  return (
    <div className="space-y-2">
      <FloatingMoreMenu
        isOpen={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        triggerRef={triggerRef}
        disabled={isBusy}
        label={isBusy ? "处理中..." : "更多"}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="dialog"
          onClick={() => openConfirmation(statusAction)}
          disabled={isBusy}
          className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          {statusAction === "archive" ? "归档" : "恢复"}
        </button>

        <div className="my-1 border-t border-zinc-100" />

        <button
          type="button"
          role="menuitem"
          aria-haspopup="dialog"
          onClick={() => openConfirmation("delete")}
          disabled={isBusy}
          className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          删除
        </button>
      </FloatingMoreMenu>

      {confirmation ? (
        <ConfirmDialog
          title={`${ACTION_DETAILS[confirmation].label}：${displayName}`}
          description={ACTION_DETAILS[confirmation].description}
          confirmLabel={ACTION_DETAILS[confirmation].label}
          destructive={confirmation === "delete"}
          onCancel={() => setConfirmation(null)}
          onConfirm={handleConfirm}
        />
      ) : null}

      {runningAction ? (
        <p className="text-xs text-zinc-500">正在{ACTION_DETAILS[runningAction].label}...</p>
      ) : null}

      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="课程操作失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
