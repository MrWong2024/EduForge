import { safeGet } from "@/lib/ui/format";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

export type JoinClassroomResponse = {
  id?: string;
  name?: string;
  joinCode?: string;
  status?: string;
  raw: UnknownRecord;
};

export type StudentDashboardTaskItem = {
  classroomTaskId?: string;
  taskId?: string;
  title?: string;
  publishedAt?: string;
  dueAt?: string;
  mySubmissionsCount?: number;
  aiFeedbackStatus?: string;
  raw: UnknownRecord;
};

export type StudentDashboardClassroomItem = {
  classroomId?: string;
  classroomName?: string;
  courseId?: string;
  status?: string;
  tasks: StudentDashboardTaskItem[];
  raw: UnknownRecord;
};

export type StudentDashboardResponse = {
  items: StudentDashboardClassroomItem[];
  total?: number;
  page?: number;
  limit?: number;
  raw: UnknownRecord;
};

export type MyTaskDetailResponse = {
  classroom: UnknownRecord;
  classroomTask: UnknownRecord;
  task: UnknownRecord;
  me: UnknownRecord;
  submissions: UnknownRecord[];
  latest: UnknownRecord | null;
  raw: UnknownRecord;
};

export type CreateSubmissionRequest = {
  content: {
    codeText: string;
    language: string;
  };
  meta?: {
    aiUsageDeclaration?: string;
  };
};

const toStudentDashboardTaskItem = (value: unknown): StudentDashboardTaskItem => {
  const record = asRecord(value);
  const latestSubmission = asRecord(safeGet(record, "myLatestSubmission", undefined));

  return {
    classroomTaskId: asString(record.classroomTaskId) ?? asString(record.id),
    taskId: asString(record.taskId),
    title: asString(record.title) ?? asString(record.name),
    publishedAt: asString(record.publishedAt),
    dueAt: asString(record.dueAt),
    mySubmissionsCount: asNumber(record.mySubmissionsCount),
    aiFeedbackStatus:
      asString(safeGet(latestSubmission, "aiFeedbackStatus", undefined)) ??
      asString(record.aiFeedbackStatus),
    raw: record,
  };
};

const toStudentDashboardClassroomItem = (value: unknown): StudentDashboardClassroomItem => {
  const record = asRecord(value);
  const classroomRecord = asRecord(safeGet(record, "classroom", undefined));

  return {
    classroomId:
      asString(classroomRecord.id) ?? asString(record.classroomId) ?? asString(record.id),
    classroomName: asString(classroomRecord.name) ?? asString(record.classroomName),
    courseId: asString(classroomRecord.courseId) ?? asString(record.courseId),
    status: asString(classroomRecord.status) ?? asString(record.status),
    tasks: asRecordArray(safeGet(record, "tasks", undefined)).map((item) =>
      toStudentDashboardTaskItem(item)
    ),
    raw: record,
  };
};

export const toJoinClassroomResponse = (payload: unknown): JoinClassroomResponse => {
  const record = asRecord(payload);

  return {
    id: asString(record.id),
    name: asString(record.name),
    joinCode: asString(record.joinCode),
    status: asString(record.status),
    raw: record,
  };
};

export const toStudentDashboardResponse = (payload: unknown): StudentDashboardResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toStudentDashboardClassroomItem(item)),
      raw: {},
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toStudentDashboardClassroomItem(item)),
    total: asNumber(record.total),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    raw: record,
  };
};

export const toMyTaskDetailResponse = (payload: unknown): MyTaskDetailResponse => {
  const record = asRecord(payload);
  const latest = safeGet<unknown>(record, "latest", null);

  return {
    classroom: asRecord(safeGet(record, "classroom", undefined)),
    classroomTask: asRecord(safeGet(record, "classroomTask", undefined)),
    task: asRecord(safeGet(record, "task", undefined)),
    me: asRecord(safeGet(record, "me", undefined)),
    submissions: asRecordArray(safeGet(record, "submissions", undefined)),
    latest: latest && typeof latest === "object" ? asRecord(latest) : null,
    raw: record,
  };
};
