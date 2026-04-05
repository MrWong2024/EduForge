"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  normalizeClassroomTaskStatus,
  type UpdateClassroomTaskRequest,
} from "@/lib/api/types-teacher";

type EditClassroomTaskFormProps = {
  classroomId: string;
  classroomTaskId?: string;
  status?: string;
  dueAt?: string;
  allowLate?: boolean;
  maxAttempts?: number;
};

type EditClassroomTaskFormErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const toDateTimeLocalValue = (iso: string | undefined): string => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const toIsoDateTime = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

const parseMaxAttempts = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

export function EditClassroomTaskForm({
  classroomId,
  classroomTaskId,
  status,
  dueAt,
  allowLate,
  maxAttempts,
}: EditClassroomTaskFormProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<EditClassroomTaskFormErrorState | null>(null);
  const [nextDueAt, setNextDueAt] = useState("");
  const [nextAllowLate, setNextAllowLate] = useState<boolean>(true);
  const [nextMaxAttempts, setNextMaxAttempts] = useState("");

  const statusValue = normalizeClassroomTaskStatus(status) ?? "ACTIVE";
  const canEdit = Boolean(classroomTaskId) && (statusValue === "ACTIVE" || statusValue === "CLOSED");

  useEffect(() => {
    if (!isExpanded) {
      setNextDueAt(toDateTimeLocalValue(dueAt));
      setNextAllowLate(typeof allowLate === "boolean" ? allowLate : true);
      setNextMaxAttempts(typeof maxAttempts === "number" ? String(maxAttempts) : "");
    }
  }, [dueAt, allowLate, maxAttempts, isExpanded]);

  const hasChanges = useMemo(() => {
    const originalDueAt = toDateTimeLocalValue(dueAt);
    const originalAllowLate = typeof allowLate === "boolean" ? allowLate : true;
    const originalMaxAttempts = typeof maxAttempts === "number" ? String(maxAttempts) : "";
    return (
      nextDueAt !== originalDueAt ||
      nextAllowLate !== originalAllowLate ||
      nextMaxAttempts !== originalMaxAttempts
    );
  }, [allowLate, dueAt, maxAttempts, nextAllowLate, nextDueAt, nextMaxAttempts]);

  if (!canEdit) {
    return null;
  }

  const handleCancel = () => {
    setIsExpanded(false);
    setErrorState(null);
    setSuccessMessage(null);
    setNextDueAt(toDateTimeLocalValue(dueAt));
    setNextAllowLate(typeof allowLate === "boolean" ? allowLate : true);
    setNextMaxAttempts(typeof maxAttempts === "number" ? String(maxAttempts) : "");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!classroomTaskId || isSubmitting) {
      return;
    }

    const dueAtIso = toIsoDateTime(nextDueAt);
    if (nextDueAt.trim() && !dueAtIso) {
      setErrorState({
        summary: "截止时间格式不合法，请重新选择。",
      });
      return;
    }

    const parsedMaxAttempts = parseMaxAttempts(nextMaxAttempts);
    if (nextMaxAttempts.trim() && parsedMaxAttempts === undefined) {
      setErrorState({
        summary: "最大尝试次数必须为正整数。",
      });
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);
    setSuccessMessage(null);

    const payload: UpdateClassroomTaskRequest = {
      dueAt: dueAtIso ?? null,
      allowLate: nextAllowLate,
      maxAttempts: parsedMaxAttempts === undefined ? null : parsedMaxAttempts,
    };

    try {
      await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}`,
        {
          method: "PATCH",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      setSuccessMessage("课堂任务设置已更新。");
      setIsExpanded(false);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summaryByStatus: Record<number, string> = {
          400: "参数不合法，或当前状态不允许编辑该任务。",
          401: "登录状态已失效，请重新登录。",
          403: "无权限编辑该课堂任务。",
          404: "课堂任务不存在或已不可用。",
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
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {!isExpanded ? (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
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
              onChange={(event) => setNextDueAt(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={nextAllowLate}
              onChange={(event) => setNextAllowLate(event.target.checked)}
            />
            允许迟交
          </label>

          <label className="block text-xs text-zinc-700">
            <span className="mb-1 block">最大尝试次数（可清空）</span>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={nextMaxAttempts}
              onChange={(event) => setNextMaxAttempts(event.target.value)}
              placeholder="留空表示不限制"
              className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !hasChanges}
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
