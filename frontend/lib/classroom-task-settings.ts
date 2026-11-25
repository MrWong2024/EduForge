import {
  toClassroomTask,
  type ClassroomTask,
  type UpdateClassroomTaskRequest,
} from "./api/types-teacher";

export const getClassroomTaskSubmissionWindowStatus = (
  classroomArchived: boolean,
  status: string | undefined,
  dueAt: string | null | undefined,
  allowLate: boolean | undefined,
): {
  label: "可提交" | "允许迟交" | "不可提交" | "状态未知";
  title: string;
  badgeClassName: string;
} => {
  if (classroomArchived) {
    return {
      label: "不可提交",
      title: "班级已归档，学生不能新提交。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (status !== "ACTIVE") {
    return {
      label: "不可提交",
      title: "课堂任务未处于开放状态，学生不能继续提交。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (!dueAt) {
    return {
      label: "可提交",
      title: "课堂任务开放且未设置截止时间；能否提交还需符合当前任务要求。",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  const dueTime = new Date(dueAt).getTime();
  if (!Number.isFinite(dueTime)) {
    return {
      label: "状态未知",
      title: "截止时间格式异常，无法判断提交窗口状态。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (dueTime >= Date.now()) {
    return {
      label: "可提交",
      title: "课堂任务开放且尚未截止；能否提交还需符合当前任务要求。",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (allowLate === true) {
    return {
      label: "允许迟交",
      title:
        "课堂任务已截止，但当前设置允许迟交；能否提交还需符合当前任务要求。",
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "不可提交",
    title: "课堂任务已截止且未允许迟交。",
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
  };
};

export type ClassroomTaskSettingsDraft = {
  dueAtLocal: string;
  allowLate: boolean;
};

export type ClassroomTaskSettingsRequestResult =
  | { kind: "unchanged" }
  | { kind: "invalid-date" }
  | { kind: "changed"; payload: UpdateClassroomTaskRequest };

const formatLocalMinute = (date: Date): string => {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export function toClassroomTaskDueAtLocalValue(dueAt?: string): string {
  if (!dueAt) {
    return "";
  }
  const date = new Date(dueAt);
  return Number.isNaN(date.getTime()) ? "" : formatLocalMinute(date);
}

export function toClassroomTaskSettingsBaseline({
  dueAt,
  allowLate,
}: Pick<ClassroomTask, "dueAt" | "allowLate">): ClassroomTaskSettingsDraft {
  return {
    dueAtLocal: toClassroomTaskDueAtLocalValue(dueAt),
    allowLate: allowLate ?? true,
  };
}

export function readSavedClassroomTaskSettings(
  payload: unknown,
  classroomId: string,
  classroomTaskId: string,
): ClassroomTaskSettingsDraft {
  const task = toClassroomTask(payload);
  if (task.classroomId !== classroomId || task.id !== classroomTaskId) {
    throw new Error("Unexpected classroom task settings response");
  }
  return toClassroomTaskSettingsBaseline(task);
}

export function buildClassroomTaskSettingsRequest(
  baseline: Readonly<ClassroomTaskSettingsDraft>,
  draft: Readonly<ClassroomTaskSettingsDraft>,
): ClassroomTaskSettingsRequestResult {
  const dueAtChanged = draft.dueAtLocal !== baseline.dueAtLocal;
  const allowLateChanged = draft.allowLate !== baseline.allowLate;
  if (!dueAtChanged && !allowLateChanged) {
    return { kind: "unchanged" };
  }

  const payload: UpdateClassroomTaskRequest = {};
  if (dueAtChanged) {
    if (draft.dueAtLocal === "") {
      payload.dueAt = null;
    } else {
      const date = new Date(draft.dueAtLocal);
      // Reject invalid local input and calendar rollover instead of clearing it.
      if (
        Number.isNaN(date.getTime()) ||
        formatLocalMinute(date) !== draft.dueAtLocal
      ) {
        return { kind: "invalid-date" };
      }
      payload.dueAt = date.toISOString();
    }
  }
  if (allowLateChanged) {
    payload.allowLate = draft.allowLate;
  }
  return { kind: "changed", payload };
}
