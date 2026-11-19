import type { UpdateClassroomTaskRequest } from "./api/types-teacher";

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
