import { safeGet } from "@/lib/ui/format";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

export type ClassroomSummary = {
  id?: string;
  name?: string;
  joinCode?: string;
  status?: string;
  courseId?: string;
};

export type ClassroomListResponse = {
  items: ClassroomSummary[];
  page?: number;
  limit?: number;
  total?: number;
};

export type ClassroomTaskSummary = {
  classroomTaskId?: string;
  title?: string;
  dueAt?: string;
  allowLate?: boolean;
  aiStatus?: string;
};

export type ClassroomTasksResponse = {
  items: ClassroomTaskSummary[];
};

export type DashboardResponse = UnknownRecord;

export const toClassroomSummary = (value: unknown): ClassroomSummary => {
  const record = asRecord(value);
  return {
    id: asString(record.id) ?? asString(record.classroomId),
    name: asString(record.name),
    joinCode: asString(record.joinCode),
    status: asString(record.status),
    courseId: asString(record.courseId),
  };
};

export const toClassroomListResponse = (payload: unknown): ClassroomListResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomSummary(item)),
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomSummary(item)),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
  };
};

export const toClassroomTaskSummary = (value: unknown): ClassroomTaskSummary => {
  const record = asRecord(value);
  const taskRecord = asRecord(safeGet(record, "task", undefined));
  const settingsRecord = asRecord(safeGet(record, "settings", undefined));

  return {
    classroomTaskId: asString(record.classroomTaskId) ?? asString(record.id),
    title: asString(taskRecord.title) ?? asString(record.title) ?? asString(record.name),
    dueAt: asString(record.dueAt),
    allowLate: asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    aiStatus: asString(record.aiStatus) ?? asString(record.aiFeedbackStatus),
  };
};

export const toClassroomTasksResponse = (payload: unknown): ClassroomTasksResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomTaskSummary(item)),
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomTaskSummary(item)),
  };
};

export const toDashboardResponse = (payload: unknown): DashboardResponse => asRecord(payload);

export const getDashboardItems = (dashboard: DashboardResponse): UnknownRecord[] => {
  const candidates = [
    safeGet<unknown>(dashboard, "items", undefined),
    safeGet<unknown>(dashboard, "tasks", undefined),
    safeGet<unknown>(dashboard, "data.items", undefined),
    safeGet<unknown>(dashboard, "data.tasks", undefined),
  ];

  for (const candidate of candidates) {
    const list = asRecordArray(candidate);
    if (list.length > 0) {
      return list;
    }
  }

  return [];
};

export const getDashboardAiBreakdown = (dashboard: DashboardResponse): UnknownRecord => {
  const candidates = [
    safeGet<unknown>(dashboard, "aiStatusBreakdown", undefined),
    safeGet<unknown>(dashboard, "ai.breakdown", undefined),
    safeGet<unknown>(dashboard, "summary.aiStatusBreakdown", undefined),
    safeGet<unknown>(dashboard, "data.aiStatusBreakdown", undefined),
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
};
