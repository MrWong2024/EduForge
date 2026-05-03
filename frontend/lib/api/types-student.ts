import { safeGet } from "@/lib/ui/format";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

const asNullableString = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  return asString(value);
};

const asNullableNumber = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  return asNumber(value);
};

const asNullableBoolean = (value: unknown): boolean | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
};

const pickFirstNonEmptyRecord = (...candidates: unknown[]): UnknownRecord => {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }
  return {};
};

export type JoinClassroomResponse = {
  id?: string;
  name?: string;
  joinCode?: string;
  status?: string;
  raw: UnknownRecord;
};

export type StudentTaskCompletionStatusValue =
  | "NOT_SUBMITTED"
  | "NO_FEEDBACK"
  | "QUALIFIED"
  | "QUALIFIED_WITH_WARNINGS"
  | "UNQUALIFIED";

export type StudentTaskCompletionSeverity = "INFO" | "WARN" | "ERROR";

export type StudentTaskCompletionSource = "TEACHER" | "AI";

export type StudentTaskCompletionStatus = {
  status: StudentTaskCompletionStatusValue;
  severity: StudentTaskCompletionSeverity | null;
  source: StudentTaskCompletionSource | null;
  latestSubmissionId: string | null;
  teacherFeedbackCount: number;
  aiFeedbackCount: number;
  teacherWorstSeverity: StudentTaskCompletionSeverity | null;
  aiWorstSeverity: StudentTaskCompletionSeverity | null;
};

export type StudentDashboardLatestSubmission = {
  submissionId?: string;
  attemptNo?: number;
  createdAt?: string;
  aiFeedbackStatus?: string;
  raw: UnknownRecord;
};

export type StudentDashboardTaskItem = {
  classroomTaskId?: string;
  taskId?: string;
  title?: string;
  publishedAt?: string;
  dueAt?: string;
  myLatestSubmission?: StudentDashboardLatestSubmission | null;
  mySubmissionsCount?: number;
  aiFeedbackStatus?: string;
  completionStatus?: StudentTaskCompletionStatus;
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

export type SubmissionDetailResponse = {
  id?: string;
  taskId?: string;
  classroomTaskId?: string | null;
  studentId?: string;
  studentName?: string | null;
  taskTitle?: string | null;
  language?: string | null;
  content: {
    language?: string | null;
    codeText?: string | null;
  };
  submittedAt?: string | null;
  attemptNo?: number | null;
  isLate?: boolean;
  lateBySeconds?: number;
  aiFeedbackStatus?: string;
  raw: UnknownRecord;
};

export type FeedbackItem = {
  id?: string;
  submissionId?: string;
  createdBy?: string;
  source?: string;
  type?: string;
  severity?: string;
  message?: string;
  suggestion?: string;
  tags: string[];
  scoreHint?: number;
  createdAt?: string;
  updatedAt?: string;
  raw: UnknownRecord;
};

export type ListFeedbackResponse = {
  items: FeedbackItem[];
  raw: UnknownRecord | UnknownRecord[];
};

export type RequestAiFeedbackResponse = {
  submissionId?: string;
  jobId?: string;
  status?: string;
  aiFeedbackStatus?: string;
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

const toStudentDashboardTaskItem = (
  value: unknown,
): StudentDashboardTaskItem => {
  const record = asRecord(value);
  const latestSubmission = toStudentDashboardLatestSubmission(
    safeGet(record, "myLatestSubmission", undefined),
  );

  return {
    classroomTaskId: asString(record.classroomTaskId) ?? asString(record.id),
    taskId: asString(record.taskId),
    title: asString(record.title) ?? asString(record.name),
    publishedAt: asString(record.publishedAt),
    dueAt: asString(record.dueAt),
    myLatestSubmission: latestSubmission,
    mySubmissionsCount: asNumber(record.mySubmissionsCount),
    aiFeedbackStatus:
      latestSubmission?.aiFeedbackStatus ?? asString(record.aiFeedbackStatus),
    completionStatus: toStudentTaskCompletionStatus(record.completionStatus),
    raw: record,
  };
};

const isCompletionStatusValue = (
  value: string | undefined,
): value is StudentTaskCompletionStatusValue =>
  value === "NOT_SUBMITTED" ||
  value === "NO_FEEDBACK" ||
  value === "QUALIFIED" ||
  value === "QUALIFIED_WITH_WARNINGS" ||
  value === "UNQUALIFIED";

const isCompletionSeverity = (
  value: string | undefined,
): value is StudentTaskCompletionSeverity =>
  value === "INFO" || value === "WARN" || value === "ERROR";

const isCompletionSource = (
  value: string | undefined,
): value is StudentTaskCompletionSource =>
  value === "TEACHER" || value === "AI";

const toStudentDashboardLatestSubmission = (
  value: unknown,
): StudentDashboardLatestSubmission | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }

  return {
    submissionId: asString(record.submissionId) ?? asString(record.id),
    attemptNo: asNumber(record.attemptNo),
    createdAt: asString(record.createdAt),
    aiFeedbackStatus: asString(record.aiFeedbackStatus),
    raw: record,
  };
};

const toStudentTaskCompletionStatus = (
  value: unknown,
): StudentTaskCompletionStatus | undefined => {
  const record = asRecord(value);
  const status = asString(record.status);
  if (!isCompletionStatusValue(status)) {
    return undefined;
  }
  const severity = asString(record.severity);
  const source = asString(record.source);
  const teacherWorstSeverity = asString(record.teacherWorstSeverity);
  const aiWorstSeverity = asString(record.aiWorstSeverity);

  return {
    status,
    severity: isCompletionSeverity(severity) ? severity : null,
    source: isCompletionSource(source) ? source : null,
    latestSubmissionId: asNullableString(record.latestSubmissionId) ?? null,
    teacherFeedbackCount: asNumber(record.teacherFeedbackCount) ?? 0,
    aiFeedbackCount: asNumber(record.aiFeedbackCount) ?? 0,
    teacherWorstSeverity: isCompletionSeverity(teacherWorstSeverity)
      ? teacherWorstSeverity
      : null,
    aiWorstSeverity: isCompletionSeverity(aiWorstSeverity)
      ? aiWorstSeverity
      : null,
  };
};

const toStudentDashboardClassroomItem = (
  value: unknown,
): StudentDashboardClassroomItem => {
  const record = asRecord(value);
  const classroomRecord = asRecord(safeGet(record, "classroom", undefined));

  return {
    classroomId:
      asString(classroomRecord.id) ??
      asString(record.classroomId) ??
      asString(record.id),
    classroomName:
      asString(classroomRecord.name) ?? asString(record.classroomName),
    courseId: asString(classroomRecord.courseId) ?? asString(record.courseId),
    status: asString(classroomRecord.status) ?? asString(record.status),
    tasks: asRecordArray(safeGet(record, "tasks", undefined)).map((item) =>
      toStudentDashboardTaskItem(item),
    ),
    raw: record,
  };
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const toFeedbackItem = (value: unknown): FeedbackItem => {
  const record = asRecord(value);

  return {
    id: asString(record.id),
    submissionId: asString(record.submissionId),
    createdBy: asString(record.createdBy),
    source: asString(record.source),
    type: asString(record.type),
    severity: asString(record.severity),
    message: asString(record.message),
    suggestion: asString(record.suggestion),
    tags: toStringArray(record.tags),
    scoreHint: asNumber(record.scoreHint),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    raw: record,
  };
};

export const toJoinClassroomResponse = (
  payload: unknown,
): JoinClassroomResponse => {
  const record = asRecord(payload);

  return {
    id: asString(record.id),
    name: asString(record.name),
    joinCode: asString(record.joinCode),
    status: asString(record.status),
    raw: record,
  };
};

export const toStudentDashboardResponse = (
  payload: unknown,
): StudentDashboardResponse => {
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
    items: asRecordArray(candidateItems).map((item) =>
      toStudentDashboardClassroomItem(item),
    ),
    total: asNumber(record.total),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    raw: record,
  };
};

export const toMyTaskDetailResponse = (
  payload: unknown,
): MyTaskDetailResponse => {
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

export const toSubmissionDetailResponse = (
  payload: unknown,
): SubmissionDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = pickFirstNonEmptyRecord(
    safeGet(record, "data", undefined),
    safeGet(record, "submission", undefined),
  );
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  const contentRecord = asRecord(safeGet(source, "content", undefined));
  const language =
    asNullableString(source.language) ??
    asNullableString(contentRecord.language);

  return {
    id: asString(source.id),
    taskId: asString(source.taskId),
    classroomTaskId: asNullableString(source.classroomTaskId),
    studentId: asString(source.studentId),
    studentName: asNullableString(source.studentName),
    taskTitle: asNullableString(source.taskTitle),
    language,
    content: {
      language,
      codeText: asNullableString(contentRecord.codeText),
    },
    submittedAt:
      asNullableString(source.submittedAt) ??
      asNullableString(source.createdAt),
    attemptNo: asNullableNumber(source.attemptNo),
    isLate: asNullableBoolean(source.isLate) ?? false,
    lateBySeconds: asNumber(source.lateBySeconds) ?? 0,
    aiFeedbackStatus: asString(source.aiFeedbackStatus),
    raw: source,
  };
};

export const toListFeedbackResponse = (
  payload: unknown,
): ListFeedbackResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toFeedbackItem(item)),
      raw: payload.map((item) => asRecord(item)),
    };
  }

  const record = asRecord(payload);
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toFeedbackItem(item)),
    raw: record,
  };
};

export const toRequestAiFeedbackResponse = (
  payload: unknown,
): RequestAiFeedbackResponse => {
  const record = asRecord(payload);

  return {
    submissionId: asString(record.submissionId),
    jobId: asString(record.jobId),
    status: asString(record.status),
    aiFeedbackStatus: asString(record.aiFeedbackStatus),
    raw: record,
  };
};
