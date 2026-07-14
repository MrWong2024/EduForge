import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { Course } from '../../courses/schemas/course.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import { Task } from '../../learning-tasks/schemas/task.schema';
import { User } from '../../users/schemas/user.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import {
  AI_LEARNING_ANALYTICS_WINDOWS,
  AiLearningAnalyticsWindow,
  QueryAiLearningAnalyticsDto,
  QueryAiLearningAnalyticsStudentsDto,
} from '../dto/query-ai-learning-analytics.dto';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { Classroom } from '../schemas/classroom.schema';
import {
  AI_LEARNING_ANALYTICS_DISCLAIMER,
  AI_LEARNING_ANALYTICS_QUALITY_PROXY,
  AI_LEARNING_ANALYTICS_SAMPLE_UNIT,
  AI_LEARNING_ANALYTICS_SCOPE,
  AI_LEARNING_ANALYTICS_VERSION,
} from '../types/ai-learning-analytics.types';
import type {
  AiLearningAnalyticsDetailedOutcome,
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsGrowthTrend,
  AiLearningAnalyticsOutcome,
  AiLearningAnalyticsOverallOutcome,
} from '../types/ai-learning-analytics.types';

export {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES,
  AI_LEARNING_ANALYTICS_DISCLAIMER,
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES,
  AI_LEARNING_ANALYTICS_GROWTH_TRENDS,
  AI_LEARNING_ANALYTICS_OUTCOMES,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES,
  AI_LEARNING_ANALYTICS_QUALITY_PROXY,
  AI_LEARNING_ANALYTICS_SAMPLE_UNIT,
  AI_LEARNING_ANALYTICS_SCOPE,
  AI_LEARNING_ANALYTICS_VERSION,
} from '../types/ai-learning-analytics.types';
export type {
  AiLearningAnalyticsDetailedOutcome,
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsGrowthTrend,
  AiLearningAnalyticsOutcome,
  AiLearningAnalyticsOverallOutcome,
} from '../types/ai-learning-analytics.types';

type ClassroomContextLean = Pick<Classroom, 'courseId' | 'name'> & WithId;
type CourseContextLean = Pick<Course, 'code' | 'name' | 'term'> & WithId;
type ClassroomTaskAnalyticsLean = Pick<
  ClassroomTask,
  'taskId' | 'publishedAt'
> &
  WithId;
type TaskTitleLean = Pick<Task, 'title'> & WithId;
type StudentPublicLean = Pick<User, 'name' | 'studentNo'> & WithId;
type AnalyticsSubmissionLean = Pick<
  Submission,
  'classroomTaskId' | 'studentId' | 'attemptNo' | 'submittedAt'
> & { content: { codeText: string } } & WithId;
type AnalyticsJobLean = Pick<AiFeedbackJob, 'submissionId' | 'status'> &
  WithId &
  WithTimestamps;
type AnalyticsFeedbackLean = Pick<
  Feedback,
  'submissionId' | 'source' | 'severity'
> &
  WithId;

type AnalyticsTask = {
  classroomTaskId: string;
  taskId: string;
  taskTitle: string;
  publishedAt: Date;
};
type AnalyticsStudent = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
};
type AnalyticsMethodology = {
  scope: typeof AI_LEARNING_ANALYTICS_SCOPE;
  version: typeof AI_LEARNING_ANALYTICS_VERSION;
  sampleUnit: typeof AI_LEARNING_ANALYTICS_SAMPLE_UNIT;
  qualityProxy: typeof AI_LEARNING_ANALYTICS_QUALITY_PROXY;
  disclaimer: string;
};
type AnalyticsContext = {
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

export type AiLearningAnalyticsStandardSample = {
  studentId: string;
  classroomTaskId: string;
  attemptsCount: number;
  aiRequested: boolean;
  aiDelivered: boolean;
  postFeedbackResubmitted: boolean;
  postFeedbackCodeChanged: boolean;
  qualityComparable: boolean;
  issueLoadBeforeHalfUnits: number | null;
  issueLoadAfterHalfUnits: number | null;
  issueLoadDeltaHalfUnits: number | null;
  detailedOutcome: AiLearningAnalyticsDetailedOutcome;
  outcome: AiLearningAnalyticsOutcome;
};

type SampleAggregate = {
  submittedCount: number;
  aiRequestedCount: number;
  aiDeliveredCount: number;
  postFeedbackResubmittedCount: number;
  postFeedbackCodeChangedCount: number;
  qualityComparableCount: number;
  improvedCount: number;
  remainedCleanCount: number;
  unchangedWithIssuesCount: number;
  stableCount: number;
  regressedCount: number;
  averageIssueLoadBefore: number;
  averageIssueLoadAfter: number;
  averageIssueLoadDelta: number;
  issueLoadDeltaHalfUnitsTotal: number;
};

type BaseAnalyticsData = {
  context: AnalyticsContext;
  methodology: AnalyticsMethodology;
  tasks: AnalyticsTask[];
  activeStudentIds: string[];
};

const toValidTimestamp = (value: Date | undefined): number | null => {
  if (!(value instanceof Date)) {
    return null;
  }
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const normalizeAiLearningAnalyticsCode = (codeText: string) =>
  codeText.replace(/\r\n/g, '\n').trim();

const compareAnalyticsSubmissions = (
  left: AnalyticsSubmissionLean,
  right: AnalyticsSubmissionLean,
) => {
  if (left.attemptNo !== right.attemptNo) {
    return left.attemptNo - right.attemptNo;
  }
  const leftSubmittedAt = toValidTimestamp(left.submittedAt) ?? 0;
  const rightSubmittedAt = toValidTimestamp(right.submittedAt) ?? 0;
  if (leftSubmittedAt !== rightSubmittedAt) {
    return leftSubmittedAt - rightSubmittedAt;
  }
  return left._id.toString().localeCompare(right._id.toString());
};

const toIssueLoadHalfUnits = (feedbackItems: AnalyticsFeedbackLean[]) => {
  let halfUnits = 0;
  for (const feedback of feedbackItems) {
    if (feedback.source !== FeedbackSource.AI) {
      continue;
    }
    if (feedback.severity === FeedbackSeverity.Error) {
      halfUnits += 2;
    } else if (feedback.severity === FeedbackSeverity.Warn) {
      halfUnits += 1;
    }
  }
  return halfUnits;
};

const classifyAiLearningAnalyticsOutcome = (
  issueLoadBeforeHalfUnits: number,
  issueLoadAfterHalfUnits: number,
): {
  detailedOutcome: AiLearningAnalyticsDetailedOutcome;
  outcome: AiLearningAnalyticsOutcome;
} => {
  const issueLoadDeltaHalfUnits =
    issueLoadBeforeHalfUnits - issueLoadAfterHalfUnits;
  if (issueLoadDeltaHalfUnits > 0) {
    return { detailedOutcome: 'IMPROVED', outcome: 'IMPROVED' };
  }
  if (issueLoadDeltaHalfUnits < 0) {
    return { detailedOutcome: 'REGRESSED', outcome: 'REGRESSED' };
  }
  return issueLoadBeforeHalfUnits === 0
    ? { detailedOutcome: 'REMAINED_CLEAN', outcome: 'STABLE' }
    : { detailedOutcome: 'UNCHANGED_WITH_ISSUES', outcome: 'STABLE' };
};

export const deriveAiLearningAnalyticsOverallOutcome = (
  qualityComparableTasksCount: number,
  issueLoadDeltaHalfUnitsTotal: number,
): AiLearningAnalyticsOverallOutcome => {
  if (qualityComparableTasksCount === 0) {
    return 'INSUFFICIENT_DATA';
  }
  if (issueLoadDeltaHalfUnitsTotal > 0) {
    return 'IMPROVED_OVERALL';
  }
  return issueLoadDeltaHalfUnitsTotal < 0
    ? 'REGRESSED_OVERALL'
    : 'NO_NET_CHANGE';
};

export const mapAiLearningAnalyticsOverallOutcomeToGrowthTrend = (
  overallOutcome: AiLearningAnalyticsOverallOutcome,
): AiLearningAnalyticsGrowthTrend => {
  const mapping: Record<
    AiLearningAnalyticsOverallOutcome,
    AiLearningAnalyticsGrowthTrend
  > = {
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
    IMPROVED_OVERALL: 'IMPROVING',
    NO_NET_CHANGE: 'STABLE',
    REGRESSED_OVERALL: 'DECLINING',
  };
  return mapping[overallOutcome];
};

export const deriveAiLearningAnalyticsEngagementStatus = (metrics: {
  submittedTasksCount: number;
  aiRequestedTasksCount: number;
  aiDeliveredTasksCount: number;
  postFeedbackResubmittedTasksCount: number;
  qualityComparableTasksCount: number;
}): AiLearningAnalyticsEngagementStatus => {
  if (metrics.submittedTasksCount === 0) {
    return 'NO_SUBMISSION';
  }
  if (metrics.aiRequestedTasksCount === 0) {
    return 'SUBMITTED_WITHOUT_AI_REQUEST';
  }
  if (metrics.aiDeliveredTasksCount === 0) {
    return 'AI_REQUESTED_WITHOUT_DELIVERY';
  }
  if (metrics.postFeedbackResubmittedTasksCount === 0) {
    return 'AI_DELIVERED_WITHOUT_RESUBMISSION';
  }
  return metrics.qualityComparableTasksCount === 0
    ? 'RESUBMITTED_WITHOUT_COMPARABLE'
    : 'QUALITY_COMPARABLE';
};

export const buildAiLearningAnalyticsStandardSamples = (
  submissions: AnalyticsSubmissionLean[],
  jobs: AnalyticsJobLean[],
  feedbackItems: AnalyticsFeedbackLean[],
): AiLearningAnalyticsStandardSample[] => {
  const jobsBySubmissionId = new Map<string, AnalyticsJobLean[]>();
  for (const job of jobs) {
    const submissionId = job.submissionId.toString();
    const bucket = jobsBySubmissionId.get(submissionId) ?? [];
    bucket.push(job);
    jobsBySubmissionId.set(submissionId, bucket);
  }
  for (const bucket of jobsBySubmissionId.values()) {
    bucket.sort((left, right) =>
      left._id.toString().localeCompare(right._id.toString()),
    );
  }

  const feedbackBySubmissionId = new Map<string, AnalyticsFeedbackLean[]>();
  for (const feedback of feedbackItems) {
    if (feedback.source !== FeedbackSource.AI) {
      continue;
    }
    const submissionId = feedback.submissionId.toString();
    const bucket = feedbackBySubmissionId.get(submissionId) ?? [];
    bucket.push(feedback);
    feedbackBySubmissionId.set(submissionId, bucket);
  }

  const submissionsByStudentTask = new Map<string, AnalyticsSubmissionLean[]>();
  for (const submission of submissions) {
    if (!submission.classroomTaskId) {
      continue;
    }
    const key = `${submission.studentId.toString()}:${submission.classroomTaskId.toString()}`;
    const bucket = submissionsByStudentTask.get(key) ?? [];
    bucket.push(submission);
    submissionsByStudentTask.set(key, bucket);
  }

  const samples: AiLearningAnalyticsStandardSample[] = [];
  for (const bucket of submissionsByStudentTask.values()) {
    bucket.sort(compareAnalyticsSubmissions);
    const firstSubmission = bucket[0];
    const studentId = firstSubmission.studentId.toString();
    const classroomTaskId = firstSubmission.classroomTaskId?.toString();
    if (!classroomTaskId) {
      continue;
    }

    const aiRequested = bucket.some(
      (submission) =>
        (jobsBySubmissionId.get(submission._id.toString())?.length ?? 0) > 0,
    );
    const anchorSubmission = bucket.find((submission) =>
      (jobsBySubmissionId.get(submission._id.toString()) ?? []).some(
        (job) => job.status === AiFeedbackJobStatus.Succeeded,
      ),
    );

    if (!anchorSubmission) {
      samples.push({
        studentId,
        classroomTaskId,
        attemptsCount: bucket.length,
        aiRequested,
        aiDelivered: false,
        postFeedbackResubmitted: false,
        postFeedbackCodeChanged: false,
        qualityComparable: false,
        issueLoadBeforeHalfUnits: null,
        issueLoadAfterHalfUnits: null,
        issueLoadDeltaHalfUnits: null,
        detailedOutcome: 'NOT_COMPARABLE',
        outcome: 'NOT_COMPARABLE',
      });
      continue;
    }

    const anchorJob = (
      jobsBySubmissionId.get(anchorSubmission._id.toString()) ?? []
    ).find((job) => job.status === AiFeedbackJobStatus.Succeeded);
    const feedbackCompletedAt = toValidTimestamp(anchorJob?.updatedAt);
    if (feedbackCompletedAt === null) {
      samples.push({
        studentId,
        classroomTaskId,
        attemptsCount: bucket.length,
        aiRequested,
        aiDelivered: true,
        postFeedbackResubmitted: false,
        postFeedbackCodeChanged: false,
        qualityComparable: false,
        issueLoadBeforeHalfUnits: null,
        issueLoadAfterHalfUnits: null,
        issueLoadDeltaHalfUnits: null,
        detailedOutcome: 'NOT_COMPARABLE',
        outcome: 'NOT_COMPARABLE',
      });
      continue;
    }

    const isAfterFeedback = (submission: AnalyticsSubmissionLean) => {
      const submittedAt = toValidTimestamp(submission.submittedAt);
      return (
        submission.attemptNo > anchorSubmission.attemptNo &&
        submittedAt !== null &&
        submittedAt > feedbackCompletedAt
      );
    };
    const postSubmission = bucket.find(isAfterFeedback);
    const comparableAfterSubmission = bucket.find(
      (submission) =>
        isAfterFeedback(submission) &&
        (jobsBySubmissionId.get(submission._id.toString()) ?? []).some(
          (job) => job.status === AiFeedbackJobStatus.Succeeded,
        ),
    );
    const postFeedbackCodeChanged = postSubmission
      ? normalizeAiLearningAnalyticsCode(anchorSubmission.content.codeText) !==
        normalizeAiLearningAnalyticsCode(postSubmission.content.codeText)
      : false;

    if (!comparableAfterSubmission) {
      samples.push({
        studentId,
        classroomTaskId,
        attemptsCount: bucket.length,
        aiRequested,
        aiDelivered: true,
        postFeedbackResubmitted: !!postSubmission,
        postFeedbackCodeChanged,
        qualityComparable: false,
        issueLoadBeforeHalfUnits: null,
        issueLoadAfterHalfUnits: null,
        issueLoadDeltaHalfUnits: null,
        detailedOutcome: 'NOT_COMPARABLE',
        outcome: 'NOT_COMPARABLE',
      });
      continue;
    }

    const issueLoadBeforeHalfUnits = toIssueLoadHalfUnits(
      feedbackBySubmissionId.get(anchorSubmission._id.toString()) ?? [],
    );
    const issueLoadAfterHalfUnits = toIssueLoadHalfUnits(
      feedbackBySubmissionId.get(comparableAfterSubmission._id.toString()) ??
        [],
    );
    const issueLoadDeltaHalfUnits =
      issueLoadBeforeHalfUnits - issueLoadAfterHalfUnits;
    const { detailedOutcome, outcome } = classifyAiLearningAnalyticsOutcome(
      issueLoadBeforeHalfUnits,
      issueLoadAfterHalfUnits,
    );

    samples.push({
      studentId,
      classroomTaskId,
      attemptsCount: bucket.length,
      aiRequested,
      aiDelivered: true,
      postFeedbackResubmitted: !!postSubmission,
      postFeedbackCodeChanged,
      qualityComparable: true,
      issueLoadBeforeHalfUnits,
      issueLoadAfterHalfUnits,
      issueLoadDeltaHalfUnits,
      detailedOutcome,
      outcome,
    });
  }

  samples.sort((left, right) => {
    const studentComparison = left.studentId.localeCompare(right.studentId);
    return studentComparison !== 0
      ? studentComparison
      : left.classroomTaskId.localeCompare(right.classroomTaskId);
  });
  return samples;
};

@Injectable()
export class AiLearningAnalyticsService {
  private static readonly DEFAULT_WINDOW: AiLearningAnalyticsWindow = 'all';
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 20;
  private static readonly MAX_LIMIT = 100;
  private static readonly WINDOW_MS_MAP: Record<
    Exclude<AiLearningAnalyticsWindow, 'all'>,
    number
  > = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(Course.name)
    private readonly courseModel: Model<Course>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Task.name)
    private readonly taskModel: Model<Task>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  async getOverview(
    classroomId: string,
    query: QueryAiLearningAnalyticsDto,
    teacherId: string,
  ) {
    const base = await this.loadBaseAnalyticsData(
      classroomId,
      query,
      teacherId,
    );
    const samples = await this.loadStandardSamples(
      base.tasks.map((task) => task.classroomTaskId),
      base.activeStudentIds,
    );
    const aggregate = this.aggregateSamples(samples);
    const samplesByTaskId = this.groupSamplesBy(
      samples,
      (sample) => sample.classroomTaskId,
    );
    const requestedStudentIds = new Set(
      samples
        .filter((sample) => sample.aiRequested)
        .map((sample) => sample.studentId),
    );

    return {
      context: base.context,
      methodology: base.methodology,
      summary: {
        activeStudentsCount: base.activeStudentIds.length,
        submittedStudentTaskCount: aggregate.submittedCount,
        aiRequestedStudentTaskCount: aggregate.aiRequestedCount,
        aiDeliveredStudentTaskCount: aggregate.aiDeliveredCount,
        postFeedbackResubmittedStudentTaskCount:
          aggregate.postFeedbackResubmittedCount,
        postFeedbackCodeChangedStudentTaskCount:
          aggregate.postFeedbackCodeChangedCount,
        qualityComparableStudentTaskCount: aggregate.qualityComparableCount,
        improvedStudentTaskCount: aggregate.improvedCount,
        remainedCleanStudentTaskCount: aggregate.remainedCleanCount,
        unchangedWithIssuesStudentTaskCount: aggregate.unchangedWithIssuesCount,
        stableStudentTaskCount: aggregate.stableCount,
        regressedStudentTaskCount: aggregate.regressedCount,
        aiStudentCoverageRate: this.toRate(
          requestedStudentIds.size,
          base.activeStudentIds.length,
        ),
        aiTaskCoverageRate: this.toRate(
          aggregate.aiRequestedCount,
          aggregate.submittedCount,
        ),
        aiDeliveryRate: this.toRate(
          aggregate.aiDeliveredCount,
          aggregate.aiRequestedCount,
        ),
        postFeedbackResubmissionRate: this.toRate(
          aggregate.postFeedbackResubmittedCount,
          aggregate.aiDeliveredCount,
        ),
        postFeedbackCodeChangeRate: this.toRate(
          aggregate.postFeedbackCodeChangedCount,
          aggregate.postFeedbackResubmittedCount,
        ),
        qualityComparableRate: this.toRate(
          aggregate.qualityComparableCount,
          aggregate.aiDeliveredCount,
        ),
        improvedRate: this.toRate(
          aggregate.improvedCount,
          aggregate.qualityComparableCount,
        ),
        remainedCleanRate: this.toRate(
          aggregate.remainedCleanCount,
          aggregate.qualityComparableCount,
        ),
        unchangedWithIssuesRate: this.toRate(
          aggregate.unchangedWithIssuesCount,
          aggregate.qualityComparableCount,
        ),
        regressedRate: this.toRate(
          aggregate.regressedCount,
          aggregate.qualityComparableCount,
        ),
        averageIssueLoadBefore: aggregate.averageIssueLoadBefore,
        averageIssueLoadAfter: aggregate.averageIssueLoadAfter,
        averageIssueLoadDelta: aggregate.averageIssueLoadDelta,
      },
      taskTrends: base.tasks.map((task) =>
        this.buildTaskTrend(
          task,
          samplesByTaskId.get(task.classroomTaskId) ?? [],
        ),
      ),
    };
  }

  async getStudents(
    classroomId: string,
    query: QueryAiLearningAnalyticsStudentsDto,
    teacherId: string,
  ) {
    const base = await this.loadBaseAnalyticsData(
      classroomId,
      query,
      teacherId,
    );
    const page = query.page ?? AiLearningAnalyticsService.DEFAULT_PAGE;
    const limit = Math.min(
      query.limit ?? AiLearningAnalyticsService.DEFAULT_LIMIT,
      AiLearningAnalyticsService.MAX_LIMIT,
    );
    const students = await this.loadStudents(base.activeStudentIds);
    students.sort((left, right) => this.compareStudents(left, right));
    const trimmedQuery = query.q?.trim();
    const normalizedQuery = trimmedQuery ? trimmedQuery : undefined;
    const searchedStudents = normalizedQuery
      ? students.filter((student) =>
          this.matchesStudentSearch(student, normalizedQuery),
        )
      : students;
    const hasMetricsFilter = Boolean(
      query.overallOutcome || query.engagementStatus,
    );
    const taskIds = base.tasks.map((task) => task.classroomTaskId);

    let filteredStudents = searchedStudents;
    let metricsByStudentId = new Map<
      string,
      ReturnType<AiLearningAnalyticsService['buildStudentMetrics']>
    >();
    if (hasMetricsFilter && searchedStudents.length > 0) {
      const candidateSamples = await this.loadStandardSamples(
        taskIds,
        searchedStudents.map((student) => student.studentId),
      );
      const samplesByStudentId = this.groupSamplesBy(
        candidateSamples,
        (sample) => sample.studentId,
      );
      metricsByStudentId = new Map(
        searchedStudents.map((student) => [
          student.studentId,
          this.buildStudentMetrics(
            samplesByStudentId.get(student.studentId) ?? [],
          ),
        ]),
      );
      filteredStudents = searchedStudents.filter((student) => {
        const metrics = metricsByStudentId.get(student.studentId);
        return (
          metrics !== undefined &&
          (!query.overallOutcome ||
            metrics.overallOutcome === query.overallOutcome) &&
          (!query.engagementStatus ||
            metrics.engagementStatus === query.engagementStatus)
        );
      });
    }

    const pageStudents = filteredStudents.slice(
      (page - 1) * limit,
      page * limit,
    );
    if (!hasMetricsFilter && pageStudents.length > 0) {
      const pageSamples = await this.loadStandardSamples(
        taskIds,
        pageStudents.map((student) => student.studentId),
      );
      const samplesByStudentId = this.groupSamplesBy(
        pageSamples,
        (sample) => sample.studentId,
      );
      metricsByStudentId = new Map(
        pageStudents.map((student) => [
          student.studentId,
          this.buildStudentMetrics(
            samplesByStudentId.get(student.studentId) ?? [],
          ),
        ]),
      );
    }

    return {
      context: base.context,
      page,
      limit,
      total: filteredStudents.length,
      activeStudentsTotal: students.length,
      filters: {
        q: normalizedQuery ?? null,
        overallOutcome: query.overallOutcome ?? null,
        engagementStatus: query.engagementStatus ?? null,
      },
      items: pageStudents.map((student) => ({
        ...student,
        ...(metricsByStudentId.get(student.studentId) ??
          this.buildStudentMetrics([])),
      })),
    };
  }

  async getStudentDetail(
    classroomId: string,
    studentId: string,
    query: QueryAiLearningAnalyticsDto,
    teacherId: string,
  ) {
    const base = await this.loadBaseAnalyticsData(
      classroomId,
      query,
      teacherId,
    );
    if (
      !this.isCanonicalObjectId(studentId) ||
      !base.activeStudentIds.includes(new Types.ObjectId(studentId).toString())
    ) {
      throw new NotFoundException('Student not found');
    }
    const canonicalStudentId = new Types.ObjectId(studentId).toString();
    const [student] = await this.loadStudents([canonicalStudentId]);
    const resolvedStudent =
      student ?? this.toStudentFallback(canonicalStudentId);
    const samples = await this.loadStandardSamples(
      base.tasks.map((task) => task.classroomTaskId),
      [canonicalStudentId],
    );
    const sampleByTaskId = new Map(
      samples.map((sample) => [sample.classroomTaskId, sample]),
    );

    return {
      context: base.context,
      methodology: base.methodology,
      student: resolvedStudent,
      summary: this.buildStudentMetrics(samples),
      taskPoints: base.tasks.map((task) =>
        this.buildStudentTaskPoint(
          task,
          sampleByTaskId.get(task.classroomTaskId),
        ),
      ),
    };
  }

  private async loadBaseAnalyticsData(
    classroomId: string,
    query: QueryAiLearningAnalyticsDto,
    teacherId: string,
  ): Promise<BaseAnalyticsData> {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const { window, lowerBound } = this.resolveWindow(query.window);
    const excludedTaskIds = this.normalizeExcludedTaskIds(
      query.excludedTaskIds,
    );
    const excludedTaskObjectIds = excludedTaskIds.map(
      (taskId) => new Types.ObjectId(taskId),
    );

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id courseId name')
      .lean<ClassroomContextLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const taskFilter: Record<string, unknown> = {
      classroomId: classroomObjectId,
    };
    if (lowerBound) {
      taskFilter.publishedAt = { $gte: lowerBound };
    }
    if (excludedTaskObjectIds.length > 0) {
      taskFilter._id = { $nin: excludedTaskObjectIds };
    }

    const [classroomTasks, activeStudentIds, course] = await Promise.all([
      this.classroomTaskModel
        .find(taskFilter)
        .select('_id taskId publishedAt')
        .sort({ publishedAt: 1, _id: 1 })
        .lean<ClassroomTaskAnalyticsLean[]>()
        .exec(),
      this.enrollmentService.listActiveStudentIds(classroomObjectId),
      this.courseModel
        .findById(classroom.courseId)
        .select('_id code name term')
        .lean<CourseContextLean>()
        .exec(),
    ]);

    const taskIds = Array.from(
      new Map(
        classroomTasks.map((classroomTask) => [
          classroomTask.taskId.toString(),
          classroomTask.taskId,
        ]),
      ).values(),
    );
    const taskTitles =
      taskIds.length === 0
        ? []
        : await this.taskModel
            .find({ _id: { $in: taskIds } })
            .select('_id title')
            .lean<TaskTitleLean[]>()
            .exec();
    const taskTitleMap = new Map(
      taskTitles.map((task) => [task._id.toString(), task.title]),
    );
    const tasks = classroomTasks.map((classroomTask) => ({
      classroomTaskId: classroomTask._id.toString(),
      taskId: classroomTask.taskId.toString(),
      taskTitle:
        taskTitleMap.get(classroomTask.taskId.toString()) ?? '未知任务',
      publishedAt: classroomTask.publishedAt,
    }));
    const canonicalActiveStudentIds = Array.from(
      new Set(
        activeStudentIds
          .filter((studentId) => this.isCanonicalObjectId(studentId))
          .map((studentId) => new Types.ObjectId(studentId).toString()),
      ),
    );

    return {
      context: {
        classroomId: classroom._id.toString(),
        classroomName: classroom.name,
        courseId: classroom.courseId.toString(),
        courseName: course?.name ?? null,
        courseCode: course?.code ?? null,
        courseTerm: course?.term ?? null,
        generatedAt: new Date().toISOString(),
        window,
        effectiveTaskCount: tasks.length,
        excludedTaskIds,
      },
      methodology: this.buildMethodology(),
      tasks,
      activeStudentIds: canonicalActiveStudentIds,
    };
  }

  private async loadStudents(
    studentIds: string[],
  ): Promise<AnalyticsStudent[]> {
    if (studentIds.length === 0) {
      return [];
    }
    const students = await this.userModel
      .find({
        _id: {
          $in: studentIds.map((studentId) => new Types.ObjectId(studentId)),
        },
      })
      .select('_id name studentNo')
      .lean<StudentPublicLean[]>()
      .exec();
    const studentMap = new Map(
      students.map((student) => [
        student._id.toString(),
        this.toStudentPublic(student),
      ]),
    );
    return studentIds.map(
      (studentId) =>
        studentMap.get(studentId) ?? this.toStudentFallback(studentId),
    );
  }

  private async loadStandardSamples(
    classroomTaskIds: string[],
    studentIds: string[],
  ) {
    if (classroomTaskIds.length === 0 || studentIds.length === 0) {
      return [];
    }
    const submissions = await this.submissionModel
      .find({
        classroomTaskId: {
          $in: classroomTaskIds.map(
            (classroomTaskId) => new Types.ObjectId(classroomTaskId),
          ),
        },
        studentId: {
          $in: studentIds.map((studentId) => new Types.ObjectId(studentId)),
        },
      })
      .select(
        '_id classroomTaskId studentId attemptNo submittedAt content.codeText',
      )
      .sort({
        studentId: 1,
        classroomTaskId: 1,
        attemptNo: 1,
        submittedAt: 1,
        _id: 1,
      })
      .lean<AnalyticsSubmissionLean[]>()
      .exec();
    if (submissions.length === 0) {
      return [];
    }

    const submissionIds = submissions.map((submission) => submission._id);
    const [jobs, feedbackItems] = await Promise.all([
      this.aiFeedbackJobModel
        .find({ submissionId: { $in: submissionIds } })
        .select('_id submissionId status updatedAt')
        .sort({ submissionId: 1, _id: 1 })
        .lean<AnalyticsJobLean[]>()
        .exec(),
      this.feedbackModel
        .find({
          submissionId: { $in: submissionIds },
          source: FeedbackSource.AI,
        })
        .select('_id submissionId source severity')
        .lean<AnalyticsFeedbackLean[]>()
        .exec(),
    ]);

    return buildAiLearningAnalyticsStandardSamples(
      submissions,
      jobs,
      feedbackItems,
    );
  }

  private aggregateSamples(
    samples: AiLearningAnalyticsStandardSample[],
  ): SampleAggregate {
    let aiRequestedCount = 0;
    let aiDeliveredCount = 0;
    let postFeedbackResubmittedCount = 0;
    let postFeedbackCodeChangedCount = 0;
    let qualityComparableCount = 0;
    let improvedCount = 0;
    let remainedCleanCount = 0;
    let unchangedWithIssuesCount = 0;
    let stableCount = 0;
    let regressedCount = 0;
    let issueLoadBeforeHalfUnitsTotal = 0;
    let issueLoadAfterHalfUnitsTotal = 0;
    let issueLoadDeltaHalfUnitsTotal = 0;

    for (const sample of samples) {
      aiRequestedCount += sample.aiRequested ? 1 : 0;
      aiDeliveredCount += sample.aiDelivered ? 1 : 0;
      postFeedbackResubmittedCount += sample.postFeedbackResubmitted ? 1 : 0;
      postFeedbackCodeChangedCount += sample.postFeedbackCodeChanged ? 1 : 0;
      qualityComparableCount += sample.qualityComparable ? 1 : 0;
      improvedCount += sample.detailedOutcome === 'IMPROVED' ? 1 : 0;
      remainedCleanCount += sample.detailedOutcome === 'REMAINED_CLEAN' ? 1 : 0;
      unchangedWithIssuesCount +=
        sample.detailedOutcome === 'UNCHANGED_WITH_ISSUES' ? 1 : 0;
      stableCount +=
        sample.detailedOutcome === 'REMAINED_CLEAN' ||
        sample.detailedOutcome === 'UNCHANGED_WITH_ISSUES'
          ? 1
          : 0;
      regressedCount += sample.detailedOutcome === 'REGRESSED' ? 1 : 0;
      if (sample.qualityComparable) {
        issueLoadBeforeHalfUnitsTotal += sample.issueLoadBeforeHalfUnits ?? 0;
        issueLoadAfterHalfUnitsTotal += sample.issueLoadAfterHalfUnits ?? 0;
        issueLoadDeltaHalfUnitsTotal += sample.issueLoadDeltaHalfUnits ?? 0;
      }
    }

    return {
      submittedCount: samples.length,
      aiRequestedCount,
      aiDeliveredCount,
      postFeedbackResubmittedCount,
      postFeedbackCodeChangedCount,
      qualityComparableCount,
      improvedCount,
      remainedCleanCount,
      unchangedWithIssuesCount,
      stableCount,
      regressedCount,
      averageIssueLoadBefore: this.toIssueLoadAverage(
        issueLoadBeforeHalfUnitsTotal,
        qualityComparableCount,
      ),
      averageIssueLoadAfter: this.toIssueLoadAverage(
        issueLoadAfterHalfUnitsTotal,
        qualityComparableCount,
      ),
      averageIssueLoadDelta: this.toIssueLoadAverage(
        issueLoadDeltaHalfUnitsTotal,
        qualityComparableCount,
      ),
      issueLoadDeltaHalfUnitsTotal,
    };
  }

  private buildTaskTrend(
    task: AnalyticsTask,
    samples: AiLearningAnalyticsStandardSample[],
  ) {
    const aggregate = this.aggregateSamples(samples);
    return {
      classroomTaskId: task.classroomTaskId,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      submittedStudentCount: aggregate.submittedCount,
      aiRequestedStudentCount: aggregate.aiRequestedCount,
      aiDeliveredStudentCount: aggregate.aiDeliveredCount,
      postFeedbackResubmittedStudentCount:
        aggregate.postFeedbackResubmittedCount,
      postFeedbackCodeChangedStudentCount:
        aggregate.postFeedbackCodeChangedCount,
      qualityComparableStudentCount: aggregate.qualityComparableCount,
      improvedStudentCount: aggregate.improvedCount,
      remainedCleanStudentCount: aggregate.remainedCleanCount,
      unchangedWithIssuesStudentCount: aggregate.unchangedWithIssuesCount,
      stableStudentCount: aggregate.stableCount,
      regressedStudentCount: aggregate.regressedCount,
      aiTaskCoverageRate: this.toRate(
        aggregate.aiRequestedCount,
        aggregate.submittedCount,
      ),
      postFeedbackResubmissionRate: this.toRate(
        aggregate.postFeedbackResubmittedCount,
        aggregate.aiDeliveredCount,
      ),
      postFeedbackCodeChangeRate: this.toRate(
        aggregate.postFeedbackCodeChangedCount,
        aggregate.postFeedbackResubmittedCount,
      ),
      qualityComparableRate: this.toRate(
        aggregate.qualityComparableCount,
        aggregate.aiDeliveredCount,
      ),
      improvedRate: this.toRate(
        aggregate.improvedCount,
        aggregate.qualityComparableCount,
      ),
      remainedCleanRate: this.toRate(
        aggregate.remainedCleanCount,
        aggregate.qualityComparableCount,
      ),
      unchangedWithIssuesRate: this.toRate(
        aggregate.unchangedWithIssuesCount,
        aggregate.qualityComparableCount,
      ),
      regressedRate: this.toRate(
        aggregate.regressedCount,
        aggregate.qualityComparableCount,
      ),
      averageIssueLoadBefore: aggregate.averageIssueLoadBefore,
      averageIssueLoadAfter: aggregate.averageIssueLoadAfter,
      averageIssueLoadDelta: aggregate.averageIssueLoadDelta,
    };
  }

  private buildStudentMetrics(samples: AiLearningAnalyticsStandardSample[]) {
    const aggregate = this.aggregateSamples(samples);
    const overallOutcome = deriveAiLearningAnalyticsOverallOutcome(
      aggregate.qualityComparableCount,
      aggregate.issueLoadDeltaHalfUnitsTotal,
    );
    const baseMetrics = {
      submittedTasksCount: aggregate.submittedCount,
      aiRequestedTasksCount: aggregate.aiRequestedCount,
      aiDeliveredTasksCount: aggregate.aiDeliveredCount,
      postFeedbackResubmittedTasksCount: aggregate.postFeedbackResubmittedCount,
      postFeedbackCodeChangedTasksCount: aggregate.postFeedbackCodeChangedCount,
      qualityComparableTasksCount: aggregate.qualityComparableCount,
      improvedTasksCount: aggregate.improvedCount,
      remainedCleanTasksCount: aggregate.remainedCleanCount,
      unchangedWithIssuesTasksCount: aggregate.unchangedWithIssuesCount,
      stableTasksCount: aggregate.stableCount,
      regressedTasksCount: aggregate.regressedCount,
      averageIssueLoadBefore: aggregate.averageIssueLoadBefore,
      averageIssueLoadAfter: aggregate.averageIssueLoadAfter,
      averageIssueLoadDelta: aggregate.averageIssueLoadDelta,
      overallOutcome,
      growthTrend:
        mapAiLearningAnalyticsOverallOutcomeToGrowthTrend(overallOutcome),
    };
    return {
      ...baseMetrics,
      engagementStatus: deriveAiLearningAnalyticsEngagementStatus(baseMetrics),
    };
  }

  private buildStudentTaskPoint(
    task: AnalyticsTask,
    sample: AiLearningAnalyticsStandardSample | undefined,
  ) {
    return {
      classroomTaskId: task.classroomTaskId,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      attemptsCount: sample?.attemptsCount ?? 0,
      aiRequested: sample?.aiRequested ?? false,
      aiDelivered: sample?.aiDelivered ?? false,
      postFeedbackResubmitted: sample?.postFeedbackResubmitted ?? false,
      postFeedbackCodeChanged: sample?.postFeedbackCodeChanged ?? false,
      qualityComparable: sample?.qualityComparable ?? false,
      issueLoadBefore: this.toNullableIssueLoad(
        sample?.issueLoadBeforeHalfUnits,
      ),
      issueLoadAfter: this.toNullableIssueLoad(sample?.issueLoadAfterHalfUnits),
      issueLoadDelta: this.toNullableIssueLoad(sample?.issueLoadDeltaHalfUnits),
      detailedOutcome: sample?.detailedOutcome ?? 'NOT_COMPARABLE',
      outcome: sample?.outcome ?? 'NOT_COMPARABLE',
    };
  }

  private buildMethodology(): AnalyticsMethodology {
    return {
      scope: AI_LEARNING_ANALYTICS_SCOPE,
      version: AI_LEARNING_ANALYTICS_VERSION,
      sampleUnit: AI_LEARNING_ANALYTICS_SAMPLE_UNIT,
      qualityProxy: AI_LEARNING_ANALYTICS_QUALITY_PROXY,
      disclaimer: AI_LEARNING_ANALYTICS_DISCLAIMER,
    };
  }

  private groupSamplesBy(
    samples: AiLearningAnalyticsStandardSample[],
    getKey: (sample: AiLearningAnalyticsStandardSample) => string,
  ) {
    const grouped = new Map<string, AiLearningAnalyticsStandardSample[]>();
    for (const sample of samples) {
      const key = getKey(sample);
      const bucket = grouped.get(key) ?? [];
      bucket.push(sample);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  private resolveWindow(window: AiLearningAnalyticsWindow | undefined) {
    const resolvedWindow = AI_LEARNING_ANALYTICS_WINDOWS.includes(
      window as AiLearningAnalyticsWindow,
    )
      ? (window as AiLearningAnalyticsWindow)
      : AiLearningAnalyticsService.DEFAULT_WINDOW;
    if (resolvedWindow === 'all') {
      return { window: resolvedWindow, lowerBound: null };
    }
    return {
      window: resolvedWindow,
      lowerBound: new Date(
        Date.now() - AiLearningAnalyticsService.WINDOW_MS_MAP[resolvedWindow],
      ),
    };
  }

  private normalizeExcludedTaskIds(excludedTaskIds: string[] | undefined) {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const taskId of excludedTaskIds ?? []) {
      if (!this.isCanonicalObjectId(taskId)) {
        throw new BadRequestException(
          'excludedTaskIds must contain valid ObjectIds',
        );
      }
      const canonicalTaskId = new Types.ObjectId(taskId).toString();
      if (!seen.has(canonicalTaskId)) {
        seen.add(canonicalTaskId);
        normalized.push(canonicalTaskId);
      }
    }
    return normalized;
  }

  private compareStudents(left: AnalyticsStudent, right: AnalyticsStudent) {
    if (left.studentNo !== right.studentNo) {
      if (left.studentNo === null) {
        return 1;
      }
      if (right.studentNo === null) {
        return -1;
      }
      const studentNoComparison = left.studentNo.localeCompare(right.studentNo);
      if (studentNoComparison !== 0) {
        return studentNoComparison;
      }
    }
    const studentNameComparison = left.studentName.localeCompare(
      right.studentName,
    );
    return studentNameComparison !== 0
      ? studentNameComparison
      : left.studentId.localeCompare(right.studentId);
  }

  private matchesStudentSearch(student: AnalyticsStudent, query: string) {
    const normalizedQuery = query.toLowerCase();
    const nameMatches =
      student.studentName !== '未知学生' &&
      student.studentName.toLowerCase().includes(normalizedQuery);
    const studentNoMatches =
      student.studentNo?.toLowerCase().includes(normalizedQuery) ?? false;
    return nameMatches || studentNoMatches;
  }

  private toStudentPublic(student: StudentPublicLean): AnalyticsStudent {
    const studentName = student.name?.trim();
    const studentNo = student.studentNo?.trim();
    return {
      studentId: student._id.toString(),
      studentName:
        studentName && studentName.length > 0 ? studentName : '未知学生',
      studentNo: studentNo && studentNo.length > 0 ? studentNo : null,
    };
  }

  private toStudentFallback(studentId: string): AnalyticsStudent {
    return {
      studentId,
      studentName: '未知学生',
      studentNo: null,
    };
  }

  private toRate(numerator: number, denominator: number) {
    return denominator > 0 ? this.round(numerator / denominator) : 0;
  }

  private toIssueLoadAverage(totalHalfUnits: number, count: number) {
    return count > 0 ? this.round(totalHalfUnits / 2 / count) : 0;
  }

  private toNullableIssueLoad(value: number | null | undefined) {
    return value === null || value === undefined ? null : value / 2;
  }

  private round(value: number) {
    return Number(value.toFixed(4));
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!this.isCanonicalObjectId(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private isCanonicalObjectId(value: string) {
    return /^[0-9a-fA-F]{24}$/.test(value) && Types.ObjectId.isValid(value);
  }
}
