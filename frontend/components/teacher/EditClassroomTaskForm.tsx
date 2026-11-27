"use client";

import { startTransition, useMemo, useOptimistic, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { normalizeClassroomTaskStatus } from "@/lib/api/types-teacher";
import {
  buildClassroomTaskSettingsRequest,
  readSavedClassroomTaskSettings,
  toClassroomTaskSettingsBaseline,
  type ClassroomTaskSettingsDraft,
} from "@/lib/classroom-task-settings";

type EditClassroomTaskFormProps = {
  classroomId: string;
  classroomTaskId?: string;
  status?: string;
  dueAt?: string;
  allowLate?: boolean;
};

type EditClassroomTaskFormErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

export function EditClassroomTaskForm({
  classroomId,
  classroomTaskId,
  status,
  dueAt,
  allowLate,
}: EditClassroomTaskFormProps) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<EditClassroomTaskFormErrorState | null>(null);
  const [nextDueAt, setNextDueAt] = useState("");
  const [nextAllowLate, setNextAllowLate] = useState<boolean>(true);
  const [editingBaseline, setEditingBaseline] = useState<ClassroomTaskSettingsDraft>({
    dueAtLocal: "",
    allowLate: true,
  });
  const [openBaseline, setOpenBaseline] = useOptimistic(
    toClassroomTaskSettingsBaseline({ dueAt, allowLate }),
  );

  const statusValue = normalizeClassroomTaskStatus(status) ?? "ACTIVE";
  const canEdit = Boolean(classroomTaskId) && (statusValue === "ACTIVE" || statusValue === "CLOSED");

  const settingsRequest = useMemo(
    () => buildClassroomTaskSettingsRequest(editingBaseline, {
      dueAtLocal: nextDueAt,
      allowLate: nextAllowLate,
    }),
    [editingBaseline, nextAllowLate, nextDueAt]
  );

  if (!canEdit) {
    return null;
  }

  const handleExpand = () => {
    if (inFlight.current) return;
    setEditingBaseline(openBaseline);
    setNextDueAt(openBaseline.dueAtLocal);
    setNextAllowLate(openBaseline.allowLate);
    setIsExpanded(true);
  };

  const handleCancel = () => {
    if (inFlight.current) return;
    setIsExpanded(false);
    setErrorState(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !classroomTaskId ||
      !canEdit ||
      isSubmitting ||
      inFlight.current ||
      settingsRequest.kind === "unchanged"
    ) {
      return;
    }

    if (settingsRequest.kind === "invalid-date") {
      setErrorState({
        summary: "截止时间格式不合法，请重新选择。",
      });
      return;
    }

    inFlight.current = true;
    setIsSubmitting(true);
    setErrorState(null);
    setSuccessMessage(null);

    try {
      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}`,
        {
          method: "PATCH",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(settingsRequest.payload),
        }
      );
      const saved = readSavedClassroomTaskSettings(
        payload,
        classroomId,
        classroomTaskId,
      );
      setSuccessMessage("课堂任务设置已更新。");
      setIsExpanded(false);
      // Use the receipt until the refresh commits the list, even if its values are unchanged.
      startTransition(() => {
        setOpenBaseline(saved);
        router.refresh();
      });
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summaryByStatus: Record<number, string> = {
          400: "参数不合法，或当前状态不允许编辑该任务。",
          401: "登录状态已失效，请重新登录。",
          403: "无权限编辑该课堂任务。",
          404: "课堂任务不存在或已不可用。",
          409: "课堂任务状态已变化，请刷新后再操作。",
        };
        setErrorState({
          status: error.status,
          summary: summaryByStatus[error.status] ?? "保存设置失败，请稍后重试。",
          detail: extractRawDetail(error.data),
        });
      } else {
        setErrorState({
          summary: "保存设置失败，请稍后重试。",
        });
      }
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {!isExpanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          编辑设置
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <label className="block text-xs text-zinc-700">
            <span className="mb-1 block">截止时间</span>
            <input
              type="datetime-local"
              value={nextDueAt}
              disabled={isSubmitting}
              onChange={(event) => {
                if (!inFlight.current) setNextDueAt(event.target.value);
              }}
              className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={nextAllowLate}
              disabled={isSubmitting}
              onChange={(event) => {
                if (!inFlight.current) setNextAllowLate(event.target.checked);
              }}
            />
            允许迟交
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isSubmitting || settingsRequest.kind !== "changed"}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {isSubmitting ? "保存中..." : "保存设置"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {successMessage ? <p className="text-xs text-emerald-700">{successMessage}</p> : null}
      {errorState ? (
        <ErrorState
          status={errorState.status}
          title="更新课堂任务设置失败"
          description={buildErrorDescription(errorState.summary, errorState.detail)}
        />
      ) : null}
    </div>
  );
}
