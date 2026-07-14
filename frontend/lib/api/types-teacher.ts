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
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

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

const asNullableNumber = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  return asNumber(value);
};

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const pickFirstNonEmptyRecord = (...candidates: unknown[]): UnknownRecord => {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
};

const toPublisherSummary = (value: unknown): PublisherSummary | null => {
  const record = asRecord(value);
  const id = asString(record.id);
  if (!id) {
    return null;
  }

  const name = asString(record.name);
  return name ? { id, name } : { id };
};

export type ClassroomSummary = {
  id?: string;
  name?: string;
  joinCode?: string;
  status?: ClassroomStatus;
  courseId?: string;
  course?: ClassroomCourseSummary;
};

export type ClassroomCourseSummary = {
  id?: string;
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: string;
  status?: string;
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
  status?: CourseStatus;
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
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: TaskCourseLabel | "";
  status?: CourseStatus;
};

export const COURSE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export type CourseCreateResponse = {
  id?: string;
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: TaskCourseLabel;
  status?: CourseStatus;
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
  overallSubmissionCoverage?: number;
  submissionRate?: number;
  lateSubmissionsCount?: number;
  lateStudentsCount?: number;
  aiJobsTotal?: number;
  aiPendingJobs?: number;
  aiFailedJobs?: number;
  aiSuccessRate?: number | null;
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

export const CLASSROOM_TASK_STATUSES = [
  "ACTIVE",
  "CLOSED",
  "RECALLED",
] as const;
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
  taskPublisher?: PublisherSummary | null;
  publishedAt?: string;
};

export type CreateClassroomRequest = {
  courseId: string;
  name: string;
};

export const CLASSROOM_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ClassroomStatus = (typeof CLASSROOM_STATUSES)[number];

export type UpdateClassroomRequest = {
  name?: string;
  status?: ClassroomStatus;
};

export type ClassroomCreateResponse = {
  id?: string;
  courseId?: string;
  course?: ClassroomCourseSummary;
  name?: string;
  joinCode?: string;
  status?: ClassroomStatus;
  raw: unknown;
};

export type ClassroomDetailResponse = ClassroomSummary;
export type ClassroomUpdateResponse = ClassroomSummary;

export type ClassroomTasksResponse = {
  items: ClassroomTaskSummary[];
  page?: number;
  limit?: number;
  total?: number;
};

export type TeacherDashboardTaskItem = UnknownRecord & {
  classroomTaskId?: string;
  id?: string;
  title?: string;
  name?: string;
  dueAt?: string | null;
  classroomTaskStatus?: string;
  taskTemplateStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | null;
  taskPublisher?: PublisherSummary | null;
};

export const TEACHER_CLASSROOM_ARCHIVE_SUGGESTION_REASONS = [
  "NO_ACTIVE_TASKS",
  "NO_RECENT_SUBMISSIONS",
  "NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS",
] as const;

export type TeacherClassroomArchiveSuggestionReason =
  (typeof TEACHER_CLASSROOM_ARCHIVE_SUGGESTION_REASONS)[number];

export type TeacherClassroomArchiveSuggestion = {
  suggested: boolean;
  reason: TeacherClassroomArchiveSuggestionReason | null;
  message: string | null;
  lastSubmissionAt: string | null;
  latestActiveTaskDueAt: string | null;
  inactiveDays: number | null;
};

export type DashboardResponse = UnknownRecord & {
  tasks?: TeacherDashboardTaskItem[];
  items?: TeacherDashboardTaskItem[];
  archiveSuggestion?: TeacherClassroomArchiveSuggestion;
};

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
  taskPublisher?: PublisherSummary | null;
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

export const LEARNING_TASK_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;
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
  publisher?: PublisherSummary | null;
  createdAt?: string;
  updatedAt?: string;
  stage?: number;
  rubric?: Record<string, unknown>;
  raw: UnknownRecord;
};

export type PublisherSummary = {
  id: string;
  name?: string;
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

export type CreateTeacherFeedbackRequest = {
  source: "TEACHER";
  type: string;
  severity: string;
  message: string;
  suggestion?: string;
  tags?: string[];
};

export type UpdateTeacherFeedbackRequest = {
  type?: string;
  severity?: string;
  message?: string;
  suggestion?: string;
  tags?: string[];
};

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

export type ProcessAssessmentItem = UnknownRecord & {
  studentId?: string;
  studentName?: string;
  studentNo?: string | null;
  submittedTasksCount?: number;
  publishedTasksCount?: number;
  submittedTasksRate?: number;
  submissionsCount?: number;
  iteratedTasksCount?: number;
  lateSubmissionsCount?: number;
  lateTasksCount?: number;
  aiRequestedCount?: number;
  aiSucceededCount?: number;
  aiRequestedTasksCount?: number;
  aiSucceededTasksCount?: number;
  avgFeedbackItems?: number;
  avgWarnItems?: number;
  avgErrorItems?: number;
  riskLevel?: string;
  score?: number;
  topTags?: UnknownRecord[];
};

export type ProcessAssessmentResponse = {
  classroomId?: string;
  window?: string;
  page?: number;
  limit?: number;
  total?: number;
  items: ProcessAssessmentItem[];
  raw: UnknownRecord;
};

export const AI_LEARNING_ANALYTICS_WINDOWS = ["all", "7d", "30d"] as const;
export type AiLearningAnalyticsWindow =
  (typeof AI_LEARNING_ANALYTICS_WINDOWS)[number];

export const AI_LEARNING_ANALYTICS_METHODOLOGY_VERSIONS = [
  "AI_FEEDBACK_INTERVENTION_V1_1",
] as const;
export type AiLearningAnalyticsMethodologyVersion =
  | (typeof AI_LEARNING_ANALYTICS_METHODOLOGY_VERSIONS)[number]
  | "UNKNOWN";

export const AI_LEARNING_ANALYTICS_GROWTH_TRENDS = [
  "IMPROVING",
  "STABLE",
  "DECLINING",
  "INSUFFICIENT_DATA",
] as const;
export type AiLearningAnalyticsGrowthTrend =
  (typeof AI_LEARNING_ANALYTICS_GROWTH_TRENDS)[number];

export const AI_LEARNING_ANALYTICS_OUTCOMES = [
  "IMPROVED",
  "STABLE",
  "REGRESSED",
  "NOT_COMPARABLE",
] as const;
export type AiLearningAnalyticsOutcome =
  (typeof AI_LEARNING_ANALYTICS_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES = [
  "IMPROVED",
  "REMAINED_CLEAN",
  "UNCHANGED_WITH_ISSUES",
  "REGRESSED",
  "NOT_COMPARABLE",
] as const;
export type AiLearningAnalyticsDetailedOutcome =
  (typeof AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES = [
  "INSUFFICIENT_DATA",
  "IMPROVED_OVERALL",
  "NO_NET_CHANGE",
  "REGRESSED_OVERALL",
] as const;
export type AiLearningAnalyticsOverallOutcome =
  (typeof AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES)[number];

export const AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES = [
  "NO_SUBMISSION",
  "SUBMITTED_WITHOUT_AI_REQUEST",
  "AI_REQUESTED_WITHOUT_DELIVERY",
  "AI_DELIVERED_WITHOUT_RESUBMISSION",
  "RESUBMITTED_WITHOUT_COMPARABLE",
  "QUALITY_COMPARABLE",
] as const;
export type AiLearningAnalyticsEngagementStatus =
  (typeof AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES)[number];

export type AiLearningAnalyticsContext = {
  classroomId: string;
  classroomName: string;
  courseId: string;
  courseName: string | null;
  courseCode: string | null;
  courseTerm: string | null;
  generatedAt: string;
  window: AiLearningAnalyticsWindow;
  effectiveTaskCount: number;
  excludedTaskIds: string[];
};

export type AiLearningAnalyticsMethodology = {
  scope: string;
  version: AiLearningAnalyticsMethodologyVersion;
  sampleUnit: string;
  qualityProxy: string;
  disclaimer: string;
};

export type AiLearningAnalyticsSummary = {
  activeStudentsCount: number;
  submittedStudentTaskCount: number;
  aiRequestedStudentTaskCount: number;
  aiDeliveredStudentTaskCount: number;
  postFeedbackResubmittedStudentTaskCount: number;
  postFeedbackCodeChangedStudentTaskCount: number;
  qualityComparableStudentTaskCount: number;
  improvedStudentTaskCount: number;
  remainedCleanStudentTaskCount: number;
  unchangedWithIssuesStudentTaskCount: number;
  stableStudentTaskCount: number;
  regressedStudentTaskCount: number;
  aiStudentCoverageRate: number;
  aiTaskCoverageRate: number;
  aiDeliveryRate: number;
  postFeedbackResubmissionRate: number;
  postFeedbackCodeChangeRate: number;
  qualityComparableRate: number;
  improvedRate: number;
  remainedCleanRate: number;
  unchangedWithIssuesRate: number;
  regressedRate: number;
  averageIssueLoadBefore: number;
  averageIssueLoadAfter: number;
  averageIssueLoadDelta: number;
};

export type AiLearningAnalyticsTaskTrend = {
  classroomTaskId: string;
  taskId: string;
  taskTitle: string;
  publishedAt: string | null;
  submittedStudentCount: number;
  aiRequestedStudentCount: number;
  aiDeliveredStudentCount: number;
  postFeedbackResubmittedStudentCount: number;
  postFeedbackCodeChangedStudentCount: number;
  qualityComparableStudentCount: number;
  improvedStudentCount: number;
  remainedCleanStudentCount: number;
  unchangedWithIssuesStudentCount: number;
  stableStudentCount: number;
  regressedStudentCount: number;
  aiTaskCoverageRate: number;
  postFeedbackResubmissionRate: number;
  postFeedbackCodeChangeRate: number;
  qualityComparableRate: number;
  improvedRate: number;
  remainedCleanRate: number;
  unchangedWithIssuesRate: number;
  regressedRate: number;
  averageIssueLoadBefore: number;
  averageIssueLoadAfter: number;
  averageIssueLoadDelta: number;
};

export type AiLearningAnalyticsOverviewResponse = {
  context: AiLearningAnalyticsContext;
  methodology: AiLearningAnalyticsMethodology;
  summary: AiLearningAnalyticsSummary;
  taskTrends: AiLearningAnalyticsTaskTrend[];
  raw: UnknownRecord;
};

export type AiLearningAnalyticsStudentMetrics = {
  submittedTasksCount: number;
  aiRequestedTasksCount: number;
  aiDeliveredTasksCount: number;
  postFeedbackResubmittedTasksCount: number;
  postFeedbackCodeChangedTasksCount: number;
  qualityComparableTasksCount: number;
  improvedTasksCount: number;
  remainedCleanTasksCount: number;
  unchangedWithIssuesTasksCount: number;
  stableTasksCount: number;
  regressedTasksCount: number;
  averageIssueLoadBefore: number;
  averageIssueLoadAfter: number;
  averageIssueLoadDelta: number;
  overallOutcome: AiLearningAnalyticsOverallOutcome;
  engagementStatus: AiLearningAnalyticsEngagementStatus;
  growthTrend: AiLearningAnalyticsGrowthTrend;
};

export type AiLearningAnalyticsStudentItem =
  AiLearningAnalyticsStudentMetrics & {
    studentId: string;
    studentName: string;
    studentNo: string | null;
  };

export type AiLearningAnalyticsStudentsResponse = {
  context: AiLearningAnalyticsContext;
  page: number;
  limit: number;
  total: number;
  activeStudentsTotal: number;
  filters: {
    q: string | null;
    overallOutcome: AiLearningAnalyticsOverallOutcome | null;
    engagementStatus: AiLearningAnalyticsEngagementStatus | null;
  };
  items: AiLearningAnalyticsStudentItem[];
  raw: UnknownRecord;
};

export type AiLearningAnalyticsTaskPoint = {
  classroomTaskId: string;
  taskId: string;
  taskTitle: string;
  publishedAt: string | null;
  attemptsCount: number;
  aiRequested: boolean;
  aiDelivered: boolean;
  postFeedbackResubmitted: boolean;
  postFeedbackCodeChanged: boolean;
  qualityComparable: boolean;
  issueLoadBefore: number | null;
  issueLoadAfter: number | null;
  issueLoadDelta: number | null;
  detailedOutcome: AiLearningAnalyticsDetailedOutcome;
  outcome: AiLearningAnalyticsOutcome;
};

export type AiLearningAnalyticsStudentDetailResponse = {
  context: AiLearningAnalyticsContext;
  methodology: AiLearningAnalyticsMethodology;
  student: {
    studentId: string;
    studentName: string;
    studentNo: string | null;
  };
  summary: AiLearningAnalyticsStudentMetrics;
  taskPoints: AiLearningAnalyticsTaskPoint[];
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
    status: normalizeClassroomStatus(record.status),
    courseId: asString(record.courseId),
    course: toClassroomCourseSummary(record.course),
  };
};

const toClassroomCourseSummary = (
  value: unknown,
): ClassroomCourseSummary | undefined => {
  const record = asRecord(value);
  const course = {
    id: asString(record.id) ?? asString(record.courseId),
    code: asString(record.code),
    name: asString(record.name),
    term: asString(record.term),
    courseLabel: asString(record.courseLabel),
    status: asString(record.status),
  };
  const hasReadableCourse =
    Boolean(course.id) ||
    Boolean(course.code) ||
    Boolean(course.name) ||
    Boolean(course.term) ||
    Boolean(course.courseLabel) ||
    Boolean(course.status);
  return hasReadableCourse ? course : undefined;
};

export const toClassroomCreateResponse = (
  payload: unknown,
): ClassroomCreateResponse => {
  const record = asRecord(payload);
  return {
    id: asString(record.id) ?? asString(record.classroomId),
    courseId: asString(record.courseId),
    course: toClassroomCourseSummary(record.course),
    name: asString(record.name),
    joinCode: asString(record.joinCode),
    status: normalizeClassroomStatus(record.status),
    raw: payload,
  };
};

export const toClassroomDetailResponse = (
  payload: unknown,
): ClassroomDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toClassroomSummary(source);
};

export const toClassroomUpdateResponse = (
  payload: unknown,
): ClassroomUpdateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toClassroomSummary(source);
};

export const toClassroomListResponse = (
  payload: unknown,
): ClassroomListResponse => {
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
    items: asRecordArray(candidateItems).map((item) =>
      toClassroomSummary(item),
    ),
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
    status: normalizeCourseStatus(record.status),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    raw: record,
  };
};

export const toCourseCreateResponse = (
  payload: unknown,
): CourseCreateResponse => {
  const record = asRecord(payload);
  return {
    id: asString(record.id) ?? asString(record.courseId),
    code: asString(record.code),
    name: asString(record.name),
    term: asString(record.term),
    courseLabel: normalizeTaskCourseLabel(record.courseLabel),
    status: normalizeCourseStatus(record.status),
    raw: payload,
  };
};

export const toCourseDetailResponse = (
  payload: unknown,
): CourseDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toCourseSummary(source);
};

export const toCourseUpdateResponse = (
  payload: unknown,
): CourseUpdateResponse => {
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
    overallSubmissionCoverage: asNumber(record.overallSubmissionCoverage),
    submissionRate: asNumber(record.submissionRate),
    lateSubmissionsCount: asNumber(record.lateSubmissionsCount),
    lateStudentsCount: asNumber(record.lateStudentsCount),
    aiJobsTotal: asNumber(aiRecord.jobsTotal),
    aiPendingJobs: asNumber(aiRecord.pendingJobs),
    aiFailedJobs: asNumber(aiRecord.failedJobs),
    aiSuccessRate: asNullableNumber(aiRecord.aiSuccessRate),
    topErrors: asRecordArray(safeGet(aiRecord, "topErrors", undefined)).map(
      (item) => toCourseOverviewErrorItem(item),
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

export const toCourseOverviewResponse = (
  payload: unknown,
): CourseOverviewResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;

  return {
    course:
      Object.keys(asRecord(safeGet(source, "course", undefined))).length > 0
        ? toCourseSummary(safeGet(source, "course", undefined))
        : undefined,
    window: asString(source.window),
    generatedAt: asString(source.generatedAt),
    page: asNumber(source.page),
    limit: asNumber(source.limit),
    total: asNumber(source.total),
    items: asRecordArray(safeGet(source, "items", undefined)).map((item) =>
      toCourseOverviewItem(item),
    ),
    raw: source,
  };
};

export const toClassroomTaskSummary = (
  value: unknown,
): ClassroomTaskSummary => {
  const record = asRecord(value);
  const taskRecord = asRecord(safeGet(record, "task", undefined));
  const settingsRecord = asRecord(safeGet(record, "settings", undefined));

  return {
    classroomTaskId: asString(record.classroomTaskId) ?? asString(record.id),
    taskId:
      asString(record.taskId) ??
      asString(taskRecord.id) ??
      asString(taskRecord.taskId),
    title:
      asString(taskRecord.title) ??
      asString(record.title) ??
      asString(record.name),
    description:
      asString(taskRecord.description) ?? asString(record.description),
    status: normalizeClassroomTaskStatus(record.status) ?? "ACTIVE",
    taskStatus:
      asString(taskRecord.status) ??
      asString(record.taskStatus) ??
      asString(record.learningTaskStatus),
    knowledgeModule:
      asString(taskRecord.knowledgeModule) ?? asString(record.knowledgeModule),
    stage: asNumber(taskRecord.stage) ?? asNumber(record.stage),
    dueAt: asString(record.dueAt),
    allowLate:
      asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    maxAttempts:
      asNumber(settingsRecord.maxAttempts) ?? asNumber(record.maxAttempts),
    aiStatus: asString(record.aiStatus) ?? asString(record.aiFeedbackStatus),
    taskPublisher: toPublisherSummary(record.taskPublisher),
    publishedAt:
      asString(record.publishedAt) ?? asString(taskRecord.publishedAt),
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
    title:
      asString(taskRecord.title) ??
      asString(record.title) ??
      asString(record.name),
    description:
      asString(taskRecord.description) ?? asString(record.description),
    dueAt: asString(record.dueAt),
    allowLate:
      asBoolean(settingsRecord.allowLate) ?? asBoolean(record.allowLate),
    maxAttempts:
      asNumber(settingsRecord.maxAttempts) ?? asNumber(record.maxAttempts),
    feedbackEnabled: asBoolean(settingsRecord.feedbackEnabled),
    taskPublisher: toPublisherSummary(record.taskPublisher),
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
    publisher: toPublisherSummary(record.publisher),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    stage: asNumber(record.stage),
    rubric: Object.keys(rubricRecord).length > 0 ? rubricRecord : undefined,
    raw: record,
  };
};

export const toLearningTaskListResponse = (
  payload: unknown,
): LearningTaskListResponse => {
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
    items: asRecordArray(candidateItems).map((item) =>
      toLearningTaskOption(item),
    ),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    raw: payload,
  };
};

export const toPublishableTaskTemplateListResponse = (
  payload: unknown,
): PublishableTaskTemplateListResponse => toLearningTaskListResponse(payload);

export const toLearningTaskDetailResponse = (
  payload: unknown,
): LearningTaskDetailResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
};

export const toLearningTaskCreateResponse = (
  payload: unknown,
): LearningTaskCreateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
};

export const toLearningTaskUpdateResponse = (
  payload: unknown,
): LearningTaskUpdateResponse => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  return toLearningTaskOption(source);
};

export const toClassroomTasksResponse = (
  payload: unknown,
): ClassroomTasksResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((item) => toClassroomTaskSummary(item)),
      page: 1,
      limit: payload.length,
      total: payload.length,
    };
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  const candidateItems =
    safeGet<unknown>(source, "items", undefined) ??
    safeGet<unknown>(source, "data", undefined);

  return {
    items: asRecordArray(candidateItems).map((item) =>
      toClassroomTaskSummary(item),
    ),
    page: asNumber(source.page),
    limit: asNumber(source.limit),
    total: asNumber(source.total),
  };
};

const normalizeTeacherClassroomArchiveSuggestionReason = (
  value: unknown,
): TeacherClassroomArchiveSuggestionReason | null => {
  const reason = asString(value);
  if (
    reason === "NO_ACTIVE_TASKS" ||
    reason === "NO_RECENT_SUBMISSIONS" ||
    reason === "NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS"
  ) {
    return reason;
  }
  return null;
};

const toTeacherClassroomArchiveSuggestion = (
  value: unknown,
): TeacherClassroomArchiveSuggestion | undefined => {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  return {
    suggested: asBoolean(record.suggested) === true,
    reason: normalizeTeacherClassroomArchiveSuggestionReason(record.reason),
    message: asNullableString(record.message) ?? null,
    lastSubmissionAt: asNullableString(record.lastSubmissionAt) ?? null,
    latestActiveTaskDueAt:
      asNullableString(record.latestActiveTaskDueAt) ?? null,
    inactiveDays: asNullableNumber(record.inactiveDays) ?? null,
  };
};

export const toDashboardResponse = (payload: unknown): DashboardResponse => {
  const record = asRecord(payload);
  const archiveSuggestion = toTeacherClassroomArchiveSuggestion(
    record.archiveSuggestion,
  );

  return archiveSuggestion
    ? {
        ...record,
        archiveSuggestion,
      }
    : record;
};

const toLearningTrajectoryStudentPublic = (
  value: unknown,
): LearningTrajectoryStudentPublic | undefined => {
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

export const toLearningTrajectoryResponse = (
  payload: unknown,
): LearningTrajectoryResponse => {
  const record = asRecord(payload);

  return {
    classroomId: asString(record.classroomId),
    classroomTaskId: asString(record.classroomTaskId),
    window: asString(record.window),
    page: asNumber(record.page),
    limit: asNumber(record.limit),
    total: asNumber(record.total),
    items: asRecordArray(safeGet(record, "items", undefined)).map((item) =>
      toLearningTrajectoryItem(item),
    ),
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

const toReviewPackTierStudentItem = (
  value: unknown,
): ReviewPackTierStudentItem => {
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
      toReviewPackTierStudentItem(item),
    ),
    watch: asRecordArray(safeGet(record, "watch", undefined)).map((item) =>
      toReviewPackTierStudentItem(item),
    ),
    notSubmitted: asRecordArray(safeGet(record, "notSubmitted", undefined)).map(
      (item) => toReviewPackTierStudentItem(item),
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
    examples: asRecordArray(safeGet(record, "examples", undefined)).map(
      (item) => toReviewPackExampleItem(item),
    ),
    studentTiers: toReviewPackStudentTiers(
      safeGet(record, "studentTiers", undefined),
    ),
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

export const toWeeklyReportResponse = (
  payload: unknown,
): WeeklyReportResponse => {
  const record = asRecord(payload);
  const summary = pickFirstNonEmptyRecord(
    safeGet(record, "summary", undefined),
    safeGet(record, "data.summary", undefined),
  );
  const overview = pickFirstNonEmptyRecord(
    safeGet(record, "overview", undefined),
    safeGet(record, "data.overview", undefined),
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

export const toProcessAssessmentResponse = (
  payload: unknown,
): ProcessAssessmentResponse => {
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
    page:
      asNumber(record.page) ??
      asNumber(safeGet(record, "pagination.page", undefined)),
    limit:
      asNumber(record.limit) ??
      asNumber(safeGet(record, "pagination.limit", undefined)),
    total:
      asNumber(record.total) ??
      asNumber(safeGet(record, "pagination.total", undefined)),
    items,
    raw: record,
  };
};

const unwrapAiLearningAnalyticsRecord = (payload: unknown): UnknownRecord => {
  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  return Object.keys(dataRecord).length > 0 ? dataRecord : record;
};

const toRequiredString = (value: unknown, fallback = ""): string =>
  asString(value) ?? fallback;

const toRequiredNumber = (value: unknown): number => asNumber(value) ?? 0;

const normalizeAiLearningAnalyticsWindow = (
  value: unknown,
): AiLearningAnalyticsWindow => {
  const window = asString(value);
  return window === "7d" || window === "30d" || window === "all"
    ? window
    : "all";
};

const normalizeAiLearningAnalyticsGrowthTrend = (
  value: unknown,
): AiLearningAnalyticsGrowthTrend => {
  const trend = asString(value);
  if (
    trend === "IMPROVING" ||
    trend === "STABLE" ||
    trend === "DECLINING" ||
    trend === "INSUFFICIENT_DATA"
  ) {
    return trend;
  }
  return "INSUFFICIENT_DATA";
};

const normalizeAiLearningAnalyticsOutcome = (
  value: unknown,
): AiLearningAnalyticsOutcome => {
  const outcome = asString(value);
  if (
    outcome === "IMPROVED" ||
    outcome === "STABLE" ||
    outcome === "REGRESSED" ||
    outcome === "NOT_COMPARABLE"
  ) {
    return outcome;
  }
  return "NOT_COMPARABLE";
};

const normalizeAiLearningAnalyticsMethodologyVersion = (
  value: unknown,
): AiLearningAnalyticsMethodologyVersion =>
  asString(value) === "AI_FEEDBACK_INTERVENTION_V1_1"
    ? "AI_FEEDBACK_INTERVENTION_V1_1"
    : "UNKNOWN";

const normalizeAiLearningAnalyticsDetailedOutcome = (
  value: unknown,
): AiLearningAnalyticsDetailedOutcome => {
  const outcome = asString(value);
  if (
    outcome === "IMPROVED" ||
    outcome === "REMAINED_CLEAN" ||
    outcome === "UNCHANGED_WITH_ISSUES" ||
    outcome === "REGRESSED" ||
    outcome === "NOT_COMPARABLE"
  ) {
    return outcome;
  }
  return "NOT_COMPARABLE";
};

const normalizeAiLearningAnalyticsOverallOutcome = (
  value: unknown,
): AiLearningAnalyticsOverallOutcome => {
  const outcome = asString(value);
  if (
    outcome === "INSUFFICIENT_DATA" ||
    outcome === "IMPROVED_OVERALL" ||
    outcome === "NO_NET_CHANGE" ||
    outcome === "REGRESSED_OVERALL"
  ) {
    return outcome;
  }
  return "INSUFFICIENT_DATA";
};

const normalizeAiLearningAnalyticsEngagementStatus = (
  value: unknown,
): AiLearningAnalyticsEngagementStatus => {
  const status = asString(value);
  if (
    status === "NO_SUBMISSION" ||
    status === "SUBMITTED_WITHOUT_AI_REQUEST" ||
    status === "AI_REQUESTED_WITHOUT_DELIVERY" ||
    status === "AI_DELIVERED_WITHOUT_RESUBMISSION" ||
    status === "RESUBMITTED_WITHOUT_COMPARABLE" ||
    status === "QUALITY_COMPARABLE"
  ) {
    return status;
  }
  return "NO_SUBMISSION";
};

const toAiLearningAnalyticsContext = (
  value: unknown,
): AiLearningAnalyticsContext => {
  const record = asRecord(value);
  return {
    classroomId: toRequiredString(record.classroomId),
    classroomName: toRequiredString(record.classroomName, "未命名班级"),
    courseId: toRequiredString(record.courseId),
    courseName: asNullableString(record.courseName) ?? null,
    courseCode: asNullableString(record.courseCode) ?? null,
    courseTerm: asNullableString(record.courseTerm) ?? null,
    generatedAt: toRequiredString(record.generatedAt),
    window: normalizeAiLearningAnalyticsWindow(record.window),
    effectiveTaskCount: toRequiredNumber(record.effectiveTaskCount),
    excludedTaskIds: asStringArray(record.excludedTaskIds)
      .map((taskId) => taskId.trim())
      .filter((taskId) => taskId.length > 0),
  };
};

const toAiLearningAnalyticsMethodology = (
  value: unknown,
): AiLearningAnalyticsMethodology => {
  const record = asRecord(value);
  return {
    scope: toRequiredString(record.scope, "AI_FEEDBACK_INTERVENTION_V1"),
    version: normalizeAiLearningAnalyticsMethodologyVersion(record.version),
    sampleUnit: toRequiredString(
      record.sampleUnit,
      "STUDENT_CLASSROOM_TASK",
    ),
    qualityProxy: toRequiredString(
      record.qualityProxy,
      "ERROR_PLUS_HALF_WARN",
    ),
    disclaimer: toRequiredString(
      record.disclaimer,
      "本分析仅反映 EduForge AI 反馈介入后的提交行为与代码问题代理变化，不代表 AI 对学习成绩或能力提升的因果贡献。",
    ),
  };
};

const toAiLearningAnalyticsSummary = (
  value: unknown,
): AiLearningAnalyticsSummary => {
  const record = asRecord(value);
  return {
    activeStudentsCount: toRequiredNumber(record.activeStudentsCount),
    submittedStudentTaskCount: toRequiredNumber(
      record.submittedStudentTaskCount,
    ),
    aiRequestedStudentTaskCount: toRequiredNumber(
      record.aiRequestedStudentTaskCount,
    ),
    aiDeliveredStudentTaskCount: toRequiredNumber(
      record.aiDeliveredStudentTaskCount,
    ),
    postFeedbackResubmittedStudentTaskCount: toRequiredNumber(
      record.postFeedbackResubmittedStudentTaskCount,
    ),
    postFeedbackCodeChangedStudentTaskCount: toRequiredNumber(
      record.postFeedbackCodeChangedStudentTaskCount,
    ),
    qualityComparableStudentTaskCount: toRequiredNumber(
      record.qualityComparableStudentTaskCount,
    ),
    improvedStudentTaskCount: toRequiredNumber(
      record.improvedStudentTaskCount,
    ),
    remainedCleanStudentTaskCount: toRequiredNumber(
      record.remainedCleanStudentTaskCount,
    ),
    unchangedWithIssuesStudentTaskCount: toRequiredNumber(
      record.unchangedWithIssuesStudentTaskCount,
    ),
    stableStudentTaskCount: toRequiredNumber(record.stableStudentTaskCount),
    regressedStudentTaskCount: toRequiredNumber(
      record.regressedStudentTaskCount,
    ),
    aiStudentCoverageRate: toRequiredNumber(record.aiStudentCoverageRate),
    aiTaskCoverageRate: toRequiredNumber(record.aiTaskCoverageRate),
    aiDeliveryRate: toRequiredNumber(record.aiDeliveryRate),
    postFeedbackResubmissionRate: toRequiredNumber(
      record.postFeedbackResubmissionRate,
    ),
    postFeedbackCodeChangeRate: toRequiredNumber(
      record.postFeedbackCodeChangeRate,
    ),
    qualityComparableRate: toRequiredNumber(record.qualityComparableRate),
    improvedRate: toRequiredNumber(record.improvedRate),
    remainedCleanRate: toRequiredNumber(record.remainedCleanRate),
    unchangedWithIssuesRate: toRequiredNumber(
      record.unchangedWithIssuesRate,
    ),
    regressedRate: toRequiredNumber(record.regressedRate),
    averageIssueLoadBefore: toRequiredNumber(record.averageIssueLoadBefore),
    averageIssueLoadAfter: toRequiredNumber(record.averageIssueLoadAfter),
    averageIssueLoadDelta: toRequiredNumber(record.averageIssueLoadDelta),
  };
};

const toAiLearningAnalyticsTaskTrend = (
  value: unknown,
): AiLearningAnalyticsTaskTrend => {
  const record = asRecord(value);
  return {
    classroomTaskId: toRequiredString(record.classroomTaskId),
    taskId: toRequiredString(record.taskId),
    taskTitle: toRequiredString(record.taskTitle, "未知任务"),
    publishedAt: asNullableString(record.publishedAt) ?? null,
    submittedStudentCount: toRequiredNumber(record.submittedStudentCount),
    aiRequestedStudentCount: toRequiredNumber(record.aiRequestedStudentCount),
    aiDeliveredStudentCount: toRequiredNumber(record.aiDeliveredStudentCount),
    postFeedbackResubmittedStudentCount: toRequiredNumber(
      record.postFeedbackResubmittedStudentCount,
    ),
    postFeedbackCodeChangedStudentCount: toRequiredNumber(
      record.postFeedbackCodeChangedStudentCount,
    ),
    qualityComparableStudentCount: toRequiredNumber(
      record.qualityComparableStudentCount,
    ),
    improvedStudentCount: toRequiredNumber(record.improvedStudentCount),
    remainedCleanStudentCount: toRequiredNumber(
      record.remainedCleanStudentCount,
    ),
    unchangedWithIssuesStudentCount: toRequiredNumber(
      record.unchangedWithIssuesStudentCount,
    ),
    stableStudentCount: toRequiredNumber(record.stableStudentCount),
    regressedStudentCount: toRequiredNumber(record.regressedStudentCount),
    aiTaskCoverageRate: toRequiredNumber(record.aiTaskCoverageRate),
    postFeedbackResubmissionRate: toRequiredNumber(
      record.postFeedbackResubmissionRate,
    ),
    postFeedbackCodeChangeRate: toRequiredNumber(
      record.postFeedbackCodeChangeRate,
    ),
    qualityComparableRate: toRequiredNumber(record.qualityComparableRate),
    improvedRate: toRequiredNumber(record.improvedRate),
    remainedCleanRate: toRequiredNumber(record.remainedCleanRate),
    unchangedWithIssuesRate: toRequiredNumber(record.unchangedWithIssuesRate),
    regressedRate: toRequiredNumber(record.regressedRate),
    averageIssueLoadBefore: toRequiredNumber(record.averageIssueLoadBefore),
    averageIssueLoadAfter: toRequiredNumber(record.averageIssueLoadAfter),
    averageIssueLoadDelta: toRequiredNumber(record.averageIssueLoadDelta),
  };
};

const toAiLearningAnalyticsStudentMetrics = (
  value: unknown,
): AiLearningAnalyticsStudentMetrics => {
  const record = asRecord(value);
  return {
    submittedTasksCount: toRequiredNumber(record.submittedTasksCount),
    aiRequestedTasksCount: toRequiredNumber(record.aiRequestedTasksCount),
    aiDeliveredTasksCount: toRequiredNumber(record.aiDeliveredTasksCount),
    postFeedbackResubmittedTasksCount: toRequiredNumber(
      record.postFeedbackResubmittedTasksCount,
    ),
    postFeedbackCodeChangedTasksCount: toRequiredNumber(
      record.postFeedbackCodeChangedTasksCount,
    ),
    qualityComparableTasksCount: toRequiredNumber(
      record.qualityComparableTasksCount,
    ),
    improvedTasksCount: toRequiredNumber(record.improvedTasksCount),
    remainedCleanTasksCount: toRequiredNumber(record.remainedCleanTasksCount),
    unchangedWithIssuesTasksCount: toRequiredNumber(
      record.unchangedWithIssuesTasksCount,
    ),
    stableTasksCount: toRequiredNumber(record.stableTasksCount),
    regressedTasksCount: toRequiredNumber(record.regressedTasksCount),
    averageIssueLoadBefore: toRequiredNumber(record.averageIssueLoadBefore),
    averageIssueLoadAfter: toRequiredNumber(record.averageIssueLoadAfter),
    averageIssueLoadDelta: toRequiredNumber(record.averageIssueLoadDelta),
    overallOutcome: normalizeAiLearningAnalyticsOverallOutcome(
      record.overallOutcome,
    ),
    engagementStatus: normalizeAiLearningAnalyticsEngagementStatus(
      record.engagementStatus,
    ),
    growthTrend: normalizeAiLearningAnalyticsGrowthTrend(record.growthTrend),
  };
};

const toAiLearningAnalyticsStudentItem = (
  value: unknown,
): AiLearningAnalyticsStudentItem => {
  const record = asRecord(value);
  return {
    studentId: toRequiredString(record.studentId),
    studentName: toRequiredString(record.studentName, "未知学生"),
    studentNo: asNullableString(record.studentNo) ?? null,
    ...toAiLearningAnalyticsStudentMetrics(record),
  };
};

const toAiLearningAnalyticsTaskPoint = (
  value: unknown,
): AiLearningAnalyticsTaskPoint => {
  const record = asRecord(value);
  return {
    classroomTaskId: toRequiredString(record.classroomTaskId),
    taskId: toRequiredString(record.taskId),
    taskTitle: toRequiredString(record.taskTitle, "未知任务"),
    publishedAt: asNullableString(record.publishedAt) ?? null,
    attemptsCount: toRequiredNumber(record.attemptsCount),
    aiRequested: asBoolean(record.aiRequested) ?? false,
    aiDelivered: asBoolean(record.aiDelivered) ?? false,
    postFeedbackResubmitted:
      asBoolean(record.postFeedbackResubmitted) ?? false,
    postFeedbackCodeChanged:
      asBoolean(record.postFeedbackCodeChanged) ?? false,
    qualityComparable: asBoolean(record.qualityComparable) ?? false,
    issueLoadBefore: asNullableNumber(record.issueLoadBefore) ?? null,
    issueLoadAfter: asNullableNumber(record.issueLoadAfter) ?? null,
    issueLoadDelta: asNullableNumber(record.issueLoadDelta) ?? null,
    detailedOutcome: normalizeAiLearningAnalyticsDetailedOutcome(
      record.detailedOutcome,
    ),
    outcome: normalizeAiLearningAnalyticsOutcome(record.outcome),
  };
};

export const toAiLearningAnalyticsOverviewResponse = (
  payload: unknown,
): AiLearningAnalyticsOverviewResponse => {
  const source = unwrapAiLearningAnalyticsRecord(payload);
  return {
    context: toAiLearningAnalyticsContext(source.context),
    methodology: toAiLearningAnalyticsMethodology(source.methodology),
    summary: toAiLearningAnalyticsSummary(source.summary),
    taskTrends: asRecordArray(source.taskTrends).map((item) =>
      toAiLearningAnalyticsTaskTrend(item),
    ),
    raw: source,
  };
};

export const toAiLearningAnalyticsStudentsResponse = (
  payload: unknown,
): AiLearningAnalyticsStudentsResponse => {
  const source = unwrapAiLearningAnalyticsRecord(payload);
  const filtersRecord = asRecord(source.filters);
  return {
    context: toAiLearningAnalyticsContext(source.context),
    page: Math.max(1, toRequiredNumber(source.page) || 1),
    limit: Math.max(1, toRequiredNumber(source.limit) || 20),
    total: Math.max(0, toRequiredNumber(source.total)),
    activeStudentsTotal: Math.max(
      0,
      toRequiredNumber(source.activeStudentsTotal),
    ),
    filters: {
      q: asNullableString(filtersRecord.q) ?? null,
      overallOutcome:
        filtersRecord.overallOutcome === null ||
        filtersRecord.overallOutcome === undefined
          ? null
          : normalizeAiLearningAnalyticsOverallOutcome(
              filtersRecord.overallOutcome,
            ),
      engagementStatus:
        filtersRecord.engagementStatus === null ||
        filtersRecord.engagementStatus === undefined
          ? null
          : normalizeAiLearningAnalyticsEngagementStatus(
              filtersRecord.engagementStatus,
            ),
    },
    items: asRecordArray(source.items).map((item) =>
      toAiLearningAnalyticsStudentItem(item),
    ),
    raw: source,
  };
};

export const toAiLearningAnalyticsStudentDetailResponse = (
  payload: unknown,
): AiLearningAnalyticsStudentDetailResponse => {
  const source = unwrapAiLearningAnalyticsRecord(payload);
  const studentRecord = asRecord(source.student);
  return {
    context: toAiLearningAnalyticsContext(source.context),
    methodology: toAiLearningAnalyticsMethodology(source.methodology),
    student: {
      studentId: toRequiredString(studentRecord.studentId),
      studentName: toRequiredString(studentRecord.studentName, "未知学生"),
      studentNo: asNullableString(studentRecord.studentNo) ?? null,
    },
    summary: toAiLearningAnalyticsStudentMetrics(source.summary),
    taskPoints: asRecordArray(source.taskPoints).map((item) =>
      toAiLearningAnalyticsTaskPoint(item),
    ),
    raw: source,
  };
};

export const toExportSnapshotResponse = (
  payload: unknown,
): ExportSnapshotResponse => {
  const record = asRecord(payload);
  const meta = pickFirstNonEmptyRecord(
    safeGet(record, "meta", undefined),
    safeGet(record, "data.meta", undefined),
  );
  const notesRaw = safeGet<unknown>(meta, "notes", undefined);
  const notes = asStringArray(notesRaw);
  const summary = pickFirstNonEmptyRecord(
    safeGet(record, "summary", undefined),
    safeGet(record, "data.summary", undefined),
  );
  const singleNote = asString(notesRaw);

  return {
    classroomId: asString(record.classroomId),
    window: asString(record.window),
    meta,
    notes: notes.length > 0 ? notes : singleNote ? [singleNote] : [],
    summary,
    raw: record,
  };
};

export const normalizeClassroomTaskStatus = (
  value: unknown,
): ClassroomTaskStatus | undefined => {
  const status = asString(value);
  if (!status) {
    return undefined;
  }
  const normalized = status.toUpperCase();
  if (
    normalized === "ACTIVE" ||
    normalized === "CLOSED" ||
    normalized === "RECALLED"
  ) {
    return normalized;
  }
  return undefined;
};

export const normalizeClassroomStatus = (
  value: unknown,
): ClassroomStatus | undefined => {
  const status = asString(value);
  if (!status) {
    return undefined;
  }
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE" || normalized === "ARCHIVED") {
    return normalized;
  }
  return undefined;
};

export const normalizeCourseStatus = (
  value: unknown,
): CourseStatus | undefined => {
  const status = asString(value);
  if (!status) {
    return undefined;
  }
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE" || normalized === "ARCHIVED") {
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

export const toClassroomStudentsResponse = (
  payload: unknown,
): ClassroomStudentsResponse => {
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
    items: asRecordArray(candidateItems).map((item) =>
      toClassroomStudent(item),
    ),
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

const toClassroomTaskSubmissionItem = (
  value: unknown,
): ClassroomTaskSubmissionItem => {
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
  payload: unknown,
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
    items: asRecordArray(candidateItems).map((item) =>
      toClassroomTaskSubmissionItem(item),
    ),
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

export const toTeacherFeedbackListResponse = (
  payload: unknown,
): TeacherFeedbackListResponse => toListFeedbackResponse(payload);

export const toSubmissionDetailResponse = (
  payload: unknown,
): SubmissionDetailResponse => toStudentSubmissionDetailResponse(payload);

const toEpochTime = (iso: string | undefined): number => {
  if (!iso) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const sortFeedbackByCreatedAtDesc = (
  items: TeacherFeedbackItem[],
): TeacherFeedbackItem[] =>
  [...items].sort(
    (left, right) => toEpochTime(right.createdAt) - toEpochTime(left.createdAt),
  );

export const groupTeacherFeedbackItems = (
  items: TeacherFeedbackItem[],
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

export const getDashboardItems = (
  dashboard: DashboardResponse,
): TeacherDashboardTaskItem[] => {
  const candidates = [
    safeGet<unknown>(dashboard, "items", undefined),
    safeGet<unknown>(dashboard, "tasks", undefined),
    safeGet<unknown>(dashboard, "data.items", undefined),
    safeGet<unknown>(dashboard, "data.tasks", undefined),
  ];

  for (const candidate of candidates) {
    const list = asRecordArray(candidate);
    if (list.length > 0) {
      return list as TeacherDashboardTaskItem[];
    }
  }

  return [];
};

export const getDashboardAiBreakdown = (
  dashboard: DashboardResponse,
): UnknownRecord => {
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
