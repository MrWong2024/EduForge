import { safeGet } from "@/lib/ui/format";
import {
  normalizeTaskCourseLabel,
  type TaskCourseLabel,
} from "@/lib/learning-tasks/course-labels";
import {
  normalizeTaskTemplateVisibility,
  type TaskTemplateScope,
  type TaskTemplateVisibility,
} from "@/lib/learning-tasks/template-visibility-scope";
import {
  toListFeedbackResponse,
  toSubmissionDetailResponse as toStudentSubmissionDetailResponse,
  type FeedbackItem,
  type ListFeedbackResponse,
  type SubmissionDetailResponse as StudentSubmissionDetailResponse,
} from "@/lib/api/types-student";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNullableString = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  return asString(value);
};

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

export type CourseSummary = {
  id?: string;
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: TaskCourseLabel;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  raw: UnknownRecord;
};

export type CourseListResponse = {
  items: CourseSummary[];
  page?: number;
  limit?: number;
  total?: number;
  raw: unknown;
};

export type CreateCourseRequest = {
  code: string;
  name: string;
  term: string;
  courseLabel?: TaskCourseLabel;
};

export type UpdateCourseRequest = {
  code: string;
  name: string;
  term: string;
  courseLabel?: TaskCourseLabel | "";
};

export type CourseCreateResponse = {
  id?: string;
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: TaskCourseLabel;
  status?: string;
  raw: unknown;
};

export type CourseDetailResponse = CourseSummary;
export type CourseUpdateResponse = CourseSummary;

export type CourseOverviewErrorItem = {
  code?: string;
  count?: number;
};

export type CourseOverviewItem = {
  classroomId?: string;
  name?: string;
  studentsCount?: number;
  publishedClassroomTasks?: number;
  distinctStudentsSubmitted?: number;
  submissionRate?: number;
  lateSubmissionsCount?: number;
  lateStudentsCount?: number;
  aiJobsTotal?: number;
  aiPendingJobs?: number;
  aiFailedJobs?: number;
  aiSuccessRate?: number;
  topErrors: CourseOverviewErrorItem[];
  raw: UnknownRecord;
};

export type CourseOverviewResponse = {
  course?: CourseSummary;
  window?: string;
  generatedAt?: string;
  page?: number;
  limit?: number;
  total?: number;
  items: CourseOverviewItem[];
  raw: UnknownRecord;
};

export const CLASSROOM_TASK_STATUSES = ["ACTIVE", "CLOSED", "RECALLED"] as const;
export type ClassroomTaskStatus = (typeof CLASSROOM_TASK_STATUSES)[number];

export type ClassroomTaskSummary = {
  classroomTaskId?: string;
  taskId?: string;
  title?: string;
  description?: string;
  status?: ClassroomTaskStatus;
  taskStatus?: string;
  knowledgeModule?: string;
  stage?: number;
  dueAt?: string;
  allowLate?: boolean;
  maxAttempts?: number;
  aiStatus?: string;
};

export type CreateClassroomRequest = {
  courseId: string;
  name: string;
};

export type ClassroomCreateResponse = {
  id?: string;
  courseId?: string;
  name?: string;
  joinCode?: string;
  status?: string;
  raw: unknown;
};

export type ClassroomTasksResponse = {
  items: ClassroomTaskSummary[];
};

export type DashboardResponse = UnknownRecord;

export type ClassroomTask = {
  id?: string;
  classroomId?: string;
  taskId?: string;
  status?: ClassroomTaskStatus;
  title?: string;
  description?: string;
  dueAt?: string;
  allowLate?: boolean;
  maxAttempts?: number;
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
    maxAttempts?: number;
  };
};

export type UpdateClassroomTaskStatusRequest = {
  status: ClassroomTaskStatus;
};

export type UpdateClassroomTaskRequest = {
  dueAt?: string | null;
  allowLate?: boolean;
  maxAttempts?: number | null;
};

export const LEARNING_TASK_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type LearningTaskStatus = (typeof LEARNING_TASK_STATUSES)[number];

export type CreateLearningTaskRequest = {
  title: string;
  description: string;
  knowledgeModule: string;
  courseLabel?: string;
  visibility?: TaskTemplateVisibility;
  stage: number;
  status: LearningTaskStatus;
  rubric?: Record<string, unknown>;
};

export type UpdateLearningTaskRequest = {
  title: string;
  description: string;
  knowledgeModule: string;
  courseLabel?: string;
  visibility?: TaskTemplateVisibility;
  stage: number;
  status: LearningTaskStatus;
  rubric?: Record<string, unknown>;
};

export type ListLearningTasksRequest = {
  page?: number;
  limit?: number;
  scope?: TaskTemplateScope;
  status?: LearningTaskStatus;
  knowledgeModule?: string;
  courseLabel?: TaskCourseLabel;
  stage?: number;
};

export type ListPublishableTaskTemplatesRequest = {
  page?: number;
  limit?: number;
  courseLabel?: TaskCourseLabel;
  onlyMine?: boolean;
  knowledgeModule?: string;
  stage?: number;
};

export type LearningTaskOption = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  knowledgeModule?: string;
  courseLabel?: string;
  visibility?: TaskTemplateVisibility;
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
  stage?: number;
  rubric?: Record<string, unknown>;
  raw: UnknownRecord;
};

export type LearningTaskListResponse = {
  items: LearningTaskOption[];
  page?: number;
  limit?: number;
  total?: number;
  raw: unknown;
};

export type PublishableTaskTemplateListResponse = LearningTaskListResponse;

export type LearningTaskDetailResponse = LearningTaskOption;
export type LearningTaskCreateResponse = LearningTaskOption;
export type LearningTaskUpdateResponse = LearningTaskOption;

export type ClassroomTaskSubmissionItem = {
  submissionId?: string;
  classroomTaskId?: string;
  studentId?: string;
  studentName?: string;
  submittedAt?: string;
  aiFeedbackStatus?: string;
  attemptNo?: number;
  feedbackCount?: number;
  raw: UnknownRecord;
};

export type ClassroomTaskSubmissionsResponse = {
  items: ClassroomTaskSubmissionItem[];
  page?: number;
  limit?: number;
  total?: number;
  raw: unknown;
};

export type TeacherFeedbackItem = FeedbackItem;

export type TeacherFeedbackListResponse = ListFeedbackResponse;

export type SubmissionDetailResponse = StudentSubmissionDetailResponse;

export type TeacherSubmissionContext = {
  submissionId: string;
  classroomId?: string;
  classroomTaskId?: string;
  taskTitle?: string;
  studentName?: string;
  language?: string;
  submittedAt?: string;
  attemptNo?: number;
  isLate?: boolean;
  lateBySeconds?: number;
  codeText?: string;
};

export type GroupedTeacherFeedbackItems = {
  teacher: TeacherFeedbackItem[];
  ai: TeacherFeedbackItem[];
  system: TeacherFeedbackItem[];
};

export type LearningTrajectoryResponse = {
  classroomId?: string;
  classroomTaskId?: string;
  window?: string;
  page?: number;
  limit?: number;
  total?: number;
  items: LearningTrajectoryItem[];
  raw: UnknownRecord;
};

export type LearningTrajectoryStudentPublic = {
  id?: string;
  name?: string | null;
  studentNo?: string | null;
  email?: string | null;
  raw: UnknownRecord;
};

export type LearningTrajectoryItem = {
  studentId?: string;
  studentName?: string | null;
  student?: LearningTrajectoryStudentPublic;
  attemptsCount?: number;
  latestAttemptAt?: string | null;
  latestAiFeedbackStatus?: string | null;
  trend: UnknownRecord;
  attempts: UnknownRecord[];
  raw: UnknownRecord;
};

export type ReviewPackResponse = {
  classroomId?: string;
  classroomTaskId?: string;
  window?: string;
  overview: UnknownRecord;
  commonIssues: UnknownRecord;
  examples: ReviewPackExampleItem[];
  studentTiers: ReviewPackStudentTiers;
  raw: UnknownRecord;
};

export type ReviewPackExampleItem = {
  feedbackId?: string;
  submissionId?: string;
  attemptNo?: number;
  severity?: string;
  type?: string;
  message?: string;
  suggestion?: string;
  source?: string;
  primaryTag?: string;
  matchedTags: string[];
  tags: string[];
  raw: UnknownRecord;
};

export type ReviewPackTierStudentItem = {
  studentId?: string;
  studentName?: string;
  studentNo?: string | null;
  attemptsCount?: number;
  latestErrorCount?: number;
  latestAiFeedbackStatus?: string | null;
  raw: UnknownRecord;
};

export type ReviewPackStudentTiers = {
  good: ReviewPackTierStudentItem[];
  watch: ReviewPackTierStudentItem[];
  notSubmitted: ReviewPackTierStudentItem[];
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
  total?: number;
  page?: number;
  limit?: number;
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

export const toClassroomCreateResponse = (payload: unknown): ClassroomCreateResponse => {
  const record = asRecord(payload);
  return {
    id: asString(record.id) ?? asString(record.classroomId),
    courseId: asString(record.courseId),
    name: asString(record.name),
    joinCode: asString(record.joinCode),
    status: asString(record.status),
    raw: payload,
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

export const toCourseSummary = (value: unknown): CourseSummary => {
  const record = asRecord(value);
  return {
    id: asString(record.id) ?? asString(record.courseId),
    code: asString(record.code),
    name: asString(record.name),
    term: asString(record.term),
    courseLabel: normalizeTaskCourseLabel(record.courseLabel),
    status: asString(record.status),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    raw: record,
  };
};

export const toCourseCreateResponse = (payload: unknown): CourseCreateResponse => {
  const record = asRecord(payload);
  return {
    id: asString(record.id) ?? asString(record.courseId),
    code: asString(record.code),
    name: asString(record.name),
    term: asString(record.term),
    courseLabel: normalizeTaskCourseLabel(record.courseLabel),
    status: asString(record.status),
    raw: payload,
  };
};

export const toCourseDetailResponse = (payload: unknown): CourseDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toCourseSummary(source);
};

export const toCourseUpdateResponse = (payload: unknown): CourseUpdateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toCourseSummary(source);
};

const toCourseOverviewErrorItem = (value: unknown): CourseOverviewErrorItem => {
  const record = asRecord(value);
  return {
    code: asString(record.code),
    count: asNumber(record.count),
  };
};

const toCourseOverviewItem = (value: unknown): CourseOverviewItem => {
  const record = asRecord(value);
  const aiRecord = asRecord(safeGet(record, "ai", undefined));

  return {
    classroomId: asString(record.classroomId),
    name: asString(record.name),
    studentsCount: asNumber(record.studentsCount),
    publishedClassroomTasks: asNumber(record.publishedClassroomTasks),
    distinctStudentsSubmitted: asNumber(record.distinctStudentsSubmitted),
    submissionRate: asNumber(record.submissionRate),
    lateSubmissionsCount: asNumber(record.lateSubmissionsCount),
    lateStudentsCount: asNumber(record.lateStudentsCount),
    aiJobsTotal: asNumber(aiRecord.jobsTotal),
    aiPendingJobs: asNumber(aiRecord.pendingJobs),
    aiFailedJobs: asNumber(aiRecord.failedJobs),
    aiSuccessRate: asNumber(aiRecord.aiSuccessRate),
    topErrors: asRecordArray(safeGet(aiRecord, "topErrors", undefined)).map((item) =>
      toCourseOverviewErrorItem(item)
    ),
    raw: record,
  };
};

export const toCourseListResponse = (payload: unknown): CourseListResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toCourseSummary(item)),
      total: payload.length,
      page: 1,
      limit: payload.length,
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toCourseSummary(item)),
    total:
      asNumber(record.total) ??
      asNumber(safeGet(record, "pagination.total", undefined)) ??
      asNumber(dataRecord.total),
    page:
      asNumber(record.page) ??
      asNumber(safeGet(record, "pagination.page", undefined)) ??
      asNumber(dataRecord.page),
    limit:
      asNumber(record.limit) ??
      asNumber(safeGet(record, "pagination.limit", undefined)) ??
      asNumber(dataRecord.limit),
    raw: payload,
  };
};

export const toCourseOverviewResponse = (payload: unknown): CourseOverviewResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;

  return {
    course: Object.keys(asRecord(safeGet(source, "course", undefined))).length > 0
      ? toCourseSummary(safeGet(source, "course", undefined))
      : undefined,
    window: asString(source.window),
    generatedAt: asString(source.generatedAt),
    page: asNumber(source.page),
    limit: asNumber(source.limit),
    total: asNumber(source.total),
    items: asRecordArray(safeGet(source, "items", undefined)).map((item) =>
      toCourseOverviewItem(item)
    ),
    raw: source,
  };
};

export const toClassroomTaskSummary = (value: unknown): ClassroomTaskSummary => {
  const record = asRecord(value);
  const taskRecord = asRecord(safeGet(record, "task", undefined));
  const settingsRecord = asRecord(safeGet(record, "settings", undefined));

  return {
    classroomTaskId: asString(record.classroomTaskId) ?? asString(record.id),
    taskId:
      asString(record.taskId) ??
      asString(taskRecord.id) ??
      asString(taskRecord.taskId),
    title: asString(taskRecord.title) ?? asString(record.title) ?? asString(record.name),
    description: asString(taskRecord.description) ?? asString(record.description),
    status: normalizeClassroomTaskStatus(record.status) ?? "ACTIVE",
    taskStatus:
      asString(taskRecord.status) ??
      asString(record.taskStatus) ??
      asString(record.learningTaskStatus),
    knowledgeModule: asString(taskRecord.knowledgeModule) ?? asString(record.knowledgeModule),
    stage: asNumber(taskRecord.stage) ?? asNumber(record.stage),
    dueAt: asString(record.dueAt),
    allowLate: asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    maxAttempts: asNumber(settingsRecord.maxAttempts) ?? asNumber(record.maxAttempts),
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
    status: normalizeClassroomTaskStatus(record.status) ?? "ACTIVE",
    title: asString(taskRecord.title) ?? asString(record.title) ?? asString(record.name),
    description: asString(taskRecord.description) ?? asString(record.description),
    dueAt: asString(record.dueAt),
    allowLate: asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    maxAttempts: asNumber(settingsRecord.maxAttempts) ?? asNumber(record.maxAttempts),
    feedbackEnabled: asBoolean(settingsRecord.feedbackEnabled),
    taskStatus:
      asString(taskRecord.status) ??
      asString(record.taskStatus) ??
      asString(record.learningTaskStatus),
    publishedAt: asString(record.publishedAt),
    raw: record,
  };
};

export const toSubmitTaskResponse = (payload: unknown): SubmitTaskResponse =>
  toClassroomTask(payload);

export const toLearningTaskOption = (value: unknown): LearningTaskOption => {
  const record = asRecord(value);
  const createdByRecord = asRecord(record.createdBy);
  const rubricRecord = asRecord(record.rubric);
  return {
    id: asString(record.id) ?? asString(record.taskId),
    title: asString(record.title),
    description: asString(record.description),
    status: asString(record.status),
    knowledgeModule: asString(record.knowledgeModule),
    courseLabel: asString(record.courseLabel),
    visibility: normalizeTaskTemplateVisibility(record.visibility),
    createdById:
      asString(record.createdBy) ??
      asString(createdByRecord.id) ??
      asString(createdByRecord._id) ??
      asString(createdByRecord.userId),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    stage: asNumber(record.stage),
    rubric: Object.keys(rubricRecord).length > 0 ? rubricRecord : undefined,
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

export const toPublishableTaskTemplateListResponse = (
  payload: unknown
): PublishableTaskTemplateListResponse => toLearningTaskListResponse(payload);

export const toLearningTaskDetailResponse = (payload: unknown): LearningTaskDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
};

export const toLearningTaskCreateResponse = (payload: unknown): LearningTaskCreateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
};

export const toLearningTaskUpdateResponse = (payload: unknown): LearningTaskUpdateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
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

const toLearningTrajectoryStudentPublic = (value: unknown): LearningTrajectoryStudentPublic | undefined => {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  return {
    id: asString(record.id),
    name: asNullableString(record.name),
    studentNo: asNullableString(record.studentNo),
    email: asNullableString(record.email),
    raw: record,
  };
};

const toLearningTrajectoryItem = (value: unknown): LearningTrajectoryItem => {
  const record = asRecord(value);
  const studentRecord = asRecord(safeGet(record, "student", undefined));
  const student = toLearningTrajectoryStudentPublic(studentRecord);
  const studentId = asString(record.studentId) ?? student?.id;

  return {
    studentId,
    studentName:
      asNullableString(record.studentName) ??
      asNullableString(student?.name) ??
      asNullableString(record.name),
    student:
      student ??
      (studentId
        ? {
            id: studentId,
            raw: {},
          }
        : undefined),
    attemptsCount: asNumber(record.attemptsCount),
    latestAttemptAt: asNullableString(record.latestAttemptAt),
    latestAiFeedbackStatus: asNullableString(record.latestAiFeedbackStatus),
    trend: asRecord(safeGet(record, "trend", undefined)),
    attempts: asRecordArray(safeGet(record, "attempts", undefined)),
    raw: record,
  };
};

export const toLearningTrajectoryResponse = (payload: unknown): LearningTrajectoryResponse => {
  const record = asRecord(payload);

  return {
    classroomId: asString(record.classroomId),
    classroomTaskId: asString(record.classroomTaskId),
    window: asString(record.window),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    items: asRecordArray(safeGet(record, "items", undefined)).map((item) => toLearningTrajectoryItem(item)),
    raw: record,
  };
};

const toReviewPackExampleItem = (value: unknown): ReviewPackExampleItem => {
  const record = asRecord(value);
  return {
    feedbackId: asString(record.feedbackId),
    submissionId: asString(record.submissionId),
    attemptNo: asNumber(record.attemptNo),
    severity: asString(record.severity),
    type: asString(record.type),
    message: asString(record.message),
    suggestion: asString(record.suggestion),
    source: asString(record.source),
    primaryTag: asString(record.primaryTag),
    matchedTags: asStringArray(safeGet(record, "matchedTags", undefined)),
    tags: asStringArray(safeGet(record, "tags", undefined)),
    raw: record,
  };
};

const toReviewPackTierStudentItem = (value: unknown): ReviewPackTierStudentItem => {
  const record = asRecord(value);
  const studentNameCandidate =
    asString(record.studentName) ??
    asString(record.name) ??
    asString(safeGet(record, "student.name", undefined));
  const studentName =
    studentNameCandidate && studentNameCandidate.trim()
      ? studentNameCandidate.trim()
      : "未知学生";

  return {
    studentId:
      asString(record.studentId) ??
      asString(record.id) ??
      asString(record.userId),
    studentName,
    studentNo: asNullableString(record.studentNo),
    attemptsCount: asNumber(record.attemptsCount),
    latestErrorCount: asNumber(record.latestErrorCount),
    latestAiFeedbackStatus: asNullableString(record.latestAiFeedbackStatus),
    raw: record,
  };
};

const toReviewPackStudentTiers = (value: unknown): ReviewPackStudentTiers => {
  const record = asRecord(value);
  return {
    good: asRecordArray(safeGet(record, "good", undefined)).map((item) =>
      toReviewPackTierStudentItem(item)
    ),
    watch: asRecordArray(safeGet(record, "watch", undefined)).map((item) =>
      toReviewPackTierStudentItem(item)
    ),
    notSubmitted: asRecordArray(safeGet(record, "notSubmitted", undefined)).map((item) =>
      toReviewPackTierStudentItem(item)
    ),
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
    commonIssues: asRecord(safeGet(record, "commonIssues", undefined)),
    examples: asRecordArray(safeGet(record, "examples", undefined)).map((item) =>
      toReviewPackExampleItem(item)
    ),
    studentTiers: toReviewPackStudentTiers(safeGet(record, "studentTiers", undefined)),
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

export const normalizeClassroomTaskStatus = (
  value: unknown
): ClassroomTaskStatus | undefined => {
  const status = asString(value);
  if (!status) {
    return undefined;
  }
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE" || normalized === "CLOSED" || normalized === "RECALLED") {
    return normalized;
  }
  return undefined;
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
      total: payload.length,
      page: 1,
      limit: payload.length,
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomStudent(item)),
    total:
      asNumber(record.total) ??
      asNumber(safeGet(record, "pagination.total", undefined)) ??
      asNumber(dataRecord.total),
    page:
      asNumber(record.page) ??
      asNumber(safeGet(record, "pagination.page", undefined)) ??
      asNumber(dataRecord.page),
    limit:
      asNumber(record.limit) ??
      asNumber(safeGet(record, "pagination.limit", undefined)) ??
      asNumber(dataRecord.limit),
    raw: payload,
  };
};

const toClassroomTaskSubmissionItem = (value: unknown): ClassroomTaskSubmissionItem => {
  const record = asRecord(value);
  const studentRecord = asRecord(safeGet(record, "student", undefined));

  return {
    submissionId: asString(record.submissionId) ?? asString(record.id),
    classroomTaskId: asString(record.classroomTaskId),
    studentId: asString(record.studentId) ?? asString(studentRecord.id),
    studentName:
      asString(record.studentName) ??
      asString(studentRecord.name) ??
      asString(studentRecord.displayName),
    submittedAt: asString(record.submittedAt) ?? asString(record.createdAt),
    aiFeedbackStatus:
      asString(record.aiFeedbackStatus) ??
      asString(safeGet(record, "ai.feedbackStatus", undefined)),
    attemptNo: asNumber(record.attemptNo),
    feedbackCount:
      asNumber(record.feedbackCount) ??
      asNumber(safeGet(record, "feedback.count", undefined)) ??
      asNumber(safeGet(record, "feedbackItemsCount", undefined)),
    raw: record,
  };
};

export const toClassroomTaskSubmissionsResponse = (
  payload: unknown
): ClassroomTaskSubmissionsResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomTaskSubmissionItem(item)),
      total: payload.length,
      page: 1,
      limit: payload.length,
      raw: payload,
    };
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const candidateItems =
    safeGet<unknown>(record, "items", undefined) ??
    safeGet<unknown>(record, "data.items", undefined) ??
    safeGet<unknown>(record, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) => toClassroomTaskSubmissionItem(item)),
    page:
      asNumber(record.page) ??
      asNumber(safeGet(record, "pagination.page", undefined)) ??
      asNumber(dataRecord.page),
    limit:
      asNumber(record.limit) ??
      asNumber(safeGet(record, "pagination.limit", undefined)) ??
      asNumber(dataRecord.limit),
    total:
      asNumber(record.total) ??
      asNumber(safeGet(record, "pagination.total", undefined)) ??
      asNumber(dataRecord.total),
    raw: payload,
  };
};

export const toTeacherFeedbackListResponse = (payload: unknown): TeacherFeedbackListResponse =>
  toListFeedbackResponse(payload);

export const toSubmissionDetailResponse = (
  payload: unknown
): SubmissionDetailResponse => toStudentSubmissionDetailResponse(payload);

const toEpochTime = (iso: string | undefined): number => {
  if (!iso) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const sortFeedbackByCreatedAtDesc = (items: TeacherFeedbackItem[]): TeacherFeedbackItem[] =>
  [...items].sort((left, right) => toEpochTime(right.createdAt) - toEpochTime(left.createdAt));

export const groupTeacherFeedbackItems = (
  items: TeacherFeedbackItem[]
): GroupedTeacherFeedbackItems => {
  const grouped: GroupedTeacherFeedbackItems = {
    teacher: [],
    ai: [],
    system: [],
  };

  for (const item of items) {
    const source = (item.source ?? "").toUpperCase();
    if (source === "TEACHER") {
      grouped.teacher.push(item);
      continue;
    }
    if (source === "AI") {
      grouped.ai.push(item);
      continue;
    }
    grouped.system.push(item);
  }

  return {
    teacher: sortFeedbackByCreatedAtDesc(grouped.teacher),
    ai: sortFeedbackByCreatedAtDesc(grouped.ai),
    system: sortFeedbackByCreatedAtDesc(grouped.system),
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
