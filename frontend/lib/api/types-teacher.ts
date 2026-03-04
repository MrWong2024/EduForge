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

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const pickFirstNonEmptyRecord = (...candidates: unknown[]): UnknownRecord => {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
};

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

export type ClassroomTask = {
  id?: string;
  classroomId?: string;
  taskId?: string;
  title?: string;
  description?: string;
  dueAt?: string;
  allowLate?: boolean;
  feedbackEnabled?: boolean;
  taskStatus?: string;
  publishedAt?: string;
  raw: UnknownRecord;
};

export type SubmitTaskResponse = ClassroomTask;

export type TaskCreateRequest = {
  title: string;
  description: string;
  dueAt?: string;
  allowLate?: boolean;
  feedbackEnabled?: boolean;
  taskId?: string;
};

export type PublishClassroomTaskRequest = {
  taskId: string;
  dueAt?: string;
  settings?: {
    allowLate?: boolean;
  };
};

export type LearningTaskOption = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  knowledgeModule?: string;
  stage?: number;
  raw: UnknownRecord;
};

export type LearningTaskListResponse = {
  items: LearningTaskOption[];
  page?: number;
  limit?: number;
  total?: number;
  raw: unknown;
};

export type ClassroomTaskSubmission = {
  id?: string;
  taskId?: string;
  classroomTaskId?: string;
  studentId?: string;
  attemptNo?: number;
  status?: string;
  aiFeedbackStatus?: string;
  submittedAt?: string;
  isLate?: boolean;
  lateBySeconds?: number;
  raw: UnknownRecord;
};

export type ClassroomTaskSubmissionsResponse = {
  items: ClassroomTaskSubmission[];
  page?: number;
  limit?: number;
  total?: number;
  raw: unknown;
};

export type LearningTrajectoryResponse = {
  classroomId?: string;
  classroomTaskId?: string;
  window?: string;
  page?: number;
  limit?: number;
  total?: number;
  items: UnknownRecord[];
  raw: UnknownRecord;
};

export type ReviewPackResponse = {
  classroomId?: string;
  classroomTaskId?: string;
  window?: string;
  overview: UnknownRecord;
  actionItems: UnknownRecord[];
  commonIssues: UnknownRecord;
  examples: UnknownRecord[];
  teacherScript: UnknownRecord[];
  raw: UnknownRecord;
};

export type AiMetricsResponse = {
  classroomId?: string;
  classroomTaskId?: string;
  window?: string;
  summary: UnknownRecord;
  statusBreakdown: UnknownRecord;
  tags: UnknownRecord[];
  errors: UnknownRecord[];
  raw: UnknownRecord;
};

export type WeeklyReportResponse = {
  classroomId?: string;
  window?: string;
  summary: UnknownRecord;
  overview: UnknownRecord;
  items: UnknownRecord[];
  raw: UnknownRecord;
};

export type ProcessAssessmentResponse = {
  classroomId?: string;
  window?: string;
  page?: number;
  limit?: number;
  total?: number;
  items: UnknownRecord[];
  raw: UnknownRecord;
};

export type ExportSnapshotResponse = {
  classroomId?: string;
  window?: string;
  meta: UnknownRecord;
  notes: string[];
  summary: UnknownRecord;
  raw: UnknownRecord;
};

export type ClassroomStudent = {
  userId?: string;
  name?: string;
  email?: string;
  studentNo?: string;
  status?: string;
  enrolledAt?: string;
  raw: UnknownRecord;
};

export type ClassroomStudentsResponse = {
  items: ClassroomStudent[];
  raw: unknown;
};

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

export const toClassroomTask = (payload: unknown): ClassroomTask => {
  const record = asRecord(payload);
  const taskRecord = asRecord(safeGet(record, "task", undefined));
  const settingsRecord = asRecord(safeGet(record, "settings", undefined));

  return {
    id: asString(record.id) ?? asString(record.classroomTaskId),
    classroomId: asString(record.classroomId),
    taskId: asString(record.taskId),
    title: asString(taskRecord.title) ?? asString(record.title) ?? asString(record.name),
    description: asString(taskRecord.description) ?? asString(record.description),
    dueAt: asString(record.dueAt),
    allowLate: asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    feedbackEnabled: asBoolean(settingsRecord.feedbackEnabled),
    taskStatus: asString(taskRecord.status) ?? asString(record.status),
    publishedAt: asString(record.publishedAt),
    raw: record,
  };
};

export const toSubmitTaskResponse = (payload: unknown): SubmitTaskResponse =>
  toClassroomTask(payload);

const toLearningTaskOption = (value: unknown): LearningTaskOption => {
  const record = asRecord(value);
  return {
    id: asString(record.id) ?? asString(record.taskId),
    title: asString(record.title),
    description: asString(record.description),
    status: asString(record.status),
    knowledgeModule: asString(record.knowledgeModule),
    stage: asNumber(record.stage),
    raw: record,
  };
};

export const toLearningTaskListResponse = (payload: unknown): LearningTaskListResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toLearningTaskOption(item)),
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toLearningTaskOption(item)),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    raw: payload,
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

export const toLearningTrajectoryResponse = (payload: unknown): LearningTrajectoryResponse => {
  const record = asRecord(payload);

  return {
    classroomId: asString(record.classroomId),
    classroomTaskId: asString(record.classroomTaskId),
    window: asString(record.window),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    items: asRecordArray(safeGet(record, "items", undefined)),
    raw: record,
  };
};

export const toReviewPackResponse = (payload: unknown): ReviewPackResponse => {
  const record = asRecord(payload);

  return {
    classroomId: asString(record.classroomId),
    classroomTaskId: asString(record.classroomTaskId),
    window: asString(record.window),
    overview: asRecord(safeGet(record, "overview", undefined)),
    actionItems: asRecordArray(safeGet(record, "actionItems", undefined)),
    commonIssues: asRecord(safeGet(record, "commonIssues", undefined)),
    examples: asRecordArray(safeGet(record, "examples", undefined)),
    teacherScript: asRecordArray(safeGet(record, "teacherScript", undefined)),
    raw: record,
  };
};

export const toAiMetricsResponse = (payload: unknown): AiMetricsResponse => {
  const record = asRecord(payload);
  const summary = asRecord(safeGet(record, "summary", undefined));
  const statusBreakdown =
    asRecord(safeGet(record, "statusBreakdown", undefined)) ||
    asRecord(safeGet(summary, "statusBreakdown", undefined));
  const jobsBreakdown = asRecord(safeGet(summary, "jobs", undefined));

  return {
    classroomId: asString(record.classroomId),
    classroomTaskId: asString(record.classroomTaskId),
    window: asString(record.window),
    summary,
    statusBreakdown:
      Object.keys(statusBreakdown).length > 0 ? statusBreakdown : jobsBreakdown,
    tags:
      asRecordArray(safeGet(record, "tags", undefined)).length > 0
        ? asRecordArray(safeGet(record, "tags", undefined))
        : asRecordArray(safeGet(record, "feedback.topTags", undefined)),
    errors: asRecordArray(safeGet(record, "errors", undefined)),
    raw: record,
  };
};

export const toWeeklyReportResponse = (payload: unknown): WeeklyReportResponse => {
  const record = asRecord(payload);
  const summary = pickFirstNonEmptyRecord(
    safeGet(record, "summary", undefined),
    safeGet(record, "data.summary", undefined)
  );
  const overview = pickFirstNonEmptyRecord(
    safeGet(record, "overview", undefined),
    safeGet(record, "data.overview", undefined)
  );
  const items =
    asRecordArray(safeGet(record, "items", undefined)).length > 0
      ? asRecordArray(safeGet(record, "items", undefined))
      : asRecordArray(safeGet(record, "data.items", undefined));

  return {
    classroomId: asString(record.classroomId),
    window: asString(record.window),
    summary,
    overview,
    items,
    raw: record,
  };
};

export const toProcessAssessmentResponse = (payload: unknown): ProcessAssessmentResponse => {
  const record = asRecord(payload);
  const itemsCandidates = [
    safeGet<unknown>(record, "items", undefined),
    safeGet<unknown>(record, "rows", undefined),
    safeGet<unknown>(record, "data.items", undefined),
    safeGet<unknown>(record, "data.rows", undefined),
    safeGet<unknown>(record, "data", undefined),
  ];

  let items: UnknownRecord[] = [];
  for (const candidate of itemsCandidates) {
    const list = asRecordArray(candidate);
    if (list.length > 0) {
      items = list;
      break;
    }
  }

  return {
    classroomId: asString(record.classroomId),
    window: asString(record.window),
    page: asNumber(record.page) ?? asNumber(safeGet(record, "pagination.page", undefined)),
    limit: asNumber(record.limit) ?? asNumber(safeGet(record, "pagination.limit", undefined)),
    total: asNumber(record.total) ?? asNumber(safeGet(record, "pagination.total", undefined)),
    items,
    raw: record,
  };
};

export const toExportSnapshotResponse = (payload: unknown): ExportSnapshotResponse => {
  const record = asRecord(payload);
  const meta = pickFirstNonEmptyRecord(
    safeGet(record, "meta", undefined),
    safeGet(record, "data.meta", undefined)
  );
  const notesRaw = safeGet<unknown>(meta, "notes", undefined);
  const notes = asStringArray(notesRaw);
  const summary = pickFirstNonEmptyRecord(
    safeGet(record, "summary", undefined),
    safeGet(record, "data.summary", undefined)
  );
  const singleNote = asString(notesRaw);

  return {
    classroomId: asString(record.classroomId),
    window: asString(record.window),
    meta,
    notes:
      notes.length > 0
        ? notes
        : singleNote
          ? [singleNote]
          : [],
    summary,
    raw: record,
  };
};

const normalizeStudentStatus = (value: unknown): string | undefined => {
  const status = asString(value);
  return status ? status.toUpperCase() : undefined;
};

const toClassroomStudent = (value: unknown): ClassroomStudent => {
  const record = asRecord(value);
  const userRecord = asRecord(safeGet(record, "user", undefined));
  const profileRecord = asRecord(safeGet(record, "profile", undefined));

  return {
    userId:
      asString(record.userId) ??
      asString(record.studentId) ??
      asString(record.id) ??
      asString(userRecord.id),
    name:
      asString(record.name) ??
      asString(record.studentName) ??
      asString(userRecord.name),
    email: asString(record.email) ?? asString(userRecord.email),
    studentNo:
      asString(record.studentNo) ??
      asString(profileRecord.studentNo) ??
      asString(safeGet(record, "student.number", undefined)),
    status:
      normalizeStudentStatus(record.status) ??
      normalizeStudentStatus(record.enrollmentStatus) ??
      "ACTIVE",
    enrolledAt:
      asString(record.enrolledAt) ??
      asString(record.joinedAt) ??
      asString(record.createdAt),
    raw: record,
  };
};

export const toClassroomStudentsResponse = (payload: unknown): ClassroomStudentsResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomStudent(item)),
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomStudent(item)),
    raw: payload,
  };
};

const toClassroomTaskSubmission = (value: unknown): ClassroomTaskSubmission => {
  const record = asRecord(value);

  return {
    id: asString(record.id),
    taskId: asString(record.taskId),
    classroomTaskId: asString(record.classroomTaskId),
    studentId: asString(record.studentId),
    attemptNo: asNumber(record.attemptNo),
    status: asString(record.status),
    aiFeedbackStatus: asString(record.aiFeedbackStatus),
    submittedAt: asString(record.submittedAt) ?? asString(record.createdAt),
    isLate: asBoolean(record.isLate),
    lateBySeconds: asNumber(record.lateBySeconds),
    raw: record,
  };
};

export const toClassroomTaskSubmissionsResponse = (
  payload: unknown
): ClassroomTaskSubmissionsResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomTaskSubmission(item)),
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomTaskSubmission(item)),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    raw: payload,
  };
};

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
