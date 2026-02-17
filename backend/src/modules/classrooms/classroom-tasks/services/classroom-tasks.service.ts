import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import { CreateClassroomTaskDto } from '../dto/create-classroom-task.dto';
import { QueryClassroomTaskDto } from '../dto/query-classroom-task.dto';
import { QueryMyTaskDetailDto } from '../dto/query-my-task-detail.dto';
import {
  LEARNING_TRAJECTORY_SORT_FIELDS,
  LEARNING_TRAJECTORY_SORT_ORDERS,
  LEARNING_TRAJECTORY_WINDOWS,
  LearningTrajectorySortField,
  LearningTrajectorySortOrder,
  LearningTrajectoryWindow,
  QueryLearningTrajectoryDto,
} from '../dto/query-learning-trajectory.dto';
import { ClassroomTaskResponseDto } from '../dto/classroom-task-response.dto';
import { CreateSubmissionDto } from '../../../learning-tasks/dto/create-submission.dto';
import { Task, TaskStatus } from '../../../learning-tasks/schemas/task.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../../learning-tasks/schemas/feedback.schema';
import { Submission } from '../../../learning-tasks/schemas/submission.schema';
import { User } from '../../../users/schemas/user.schema';
import { ClassroomStatus } from '../../schemas/classroom.schema';
import { LearningTasksService } from '../../../learning-tasks/services/learning-tasks.service';
import { AiFeedbackJobService } from '../../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackStatus } from '../../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  hasAnyRole,
} from '../../../users/schemas/user-roles.constants';
import { WithId } from '../../../../common/types/with-id.type';
import { WithTimestamps } from '../../../../common/types/with-timestamps.type';

type ClassroomTaskWithMeta = ClassroomTask & WithId & WithTimestamps;
type ClassroomTaskWithTask = ClassroomTaskWithMeta & { task: Task };
type ClassroomWithMeta = Classroom & WithId & WithTimestamps;
type TaskWithMeta = Task & WithId & WithTimestamps;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type FeedbackSummarySeverityAgg = {
  _id: { submissionId: Types.ObjectId; severity: FeedbackSeverity };
  count: number;
};
type FeedbackSummaryTagAgg = {
  _id: { submissionId: Types.ObjectId; tag: string };
  count: number;
};
type FeedbackItemAgg = {
  _id: Types.ObjectId;
  items: Array<{
    source: FeedbackSource;
    type: string;
    severity: FeedbackSeverity;
    message: string;
    suggestion?: string;
    tags?: string[];
  }>;
};
type SubmissionFeedbackSummary = {
  totalItems: number;
  topTags: Array<{ tag: string; count: number }>;
  severityBreakdown: { INFO: number; WARN: number; ERROR: number };
};
type SubmissionDetailItem = {
  id: string;
  attemptNo: number;
  createdAt: Date;
  aiFeedbackStatus: AiFeedbackStatus;
  feedbackSummary: SubmissionFeedbackSummary;
  feedbackItems?: Array<{
    source: FeedbackSource;
    type: string;
    severity: FeedbackSeverity;
    message: string;
    suggestion?: string;
    tags?: string[];
  }>;
};
type LearningTrajectorySubmissionRow = Pick<
  Submission,
  'studentId' | 'attemptNo' | 'isLate' | 'lateBySeconds'
> &
  WithId &
  WithTimestamps;
type LearningTrajectoryClassroomTaskLean = Pick<
  ClassroomTask,
  'classroomId' | 'dueAt'
> &
  WithId;
type LearningTrajectoryTrend = {
  errorCountFirst: number;
  errorCountLatest: number;
  errorDelta: number;
  topTagsFirst: Array<{ tag: string; count: number }>;
  topTagsLatest: Array<{ tag: string; count: number }>;
};
type LearningTrajectoryAttempt = {
  submissionId: string;
  attemptNo: number;
  createdAt: string;
  isLate: boolean;
  lateBySeconds: number;
  aiFeedbackStatus: AiFeedbackStatus;
  feedbackSummary: SubmissionFeedbackSummary;
};
type LearningTrajectoryItem = {
  studentId: string;
  attemptsCount: number;
  latestAttemptAt: string | null;
  latestAiFeedbackStatus: AiFeedbackStatus | null;
  trend: LearningTrajectoryTrend;
  attempts: LearningTrajectoryAttempt[];
};

@Injectable()
export class ClassroomTasksService {
  private static readonly DEFAULT_TRAJECTORY_WINDOW: LearningTrajectoryWindow =
    '7d';
  private static readonly DEFAULT_TRAJECTORY_PAGE = 1;
  private static readonly DEFAULT_TRAJECTORY_LIMIT = 20;
  private static readonly DEFAULT_TRAJECTORY_SORT: LearningTrajectorySortField =
    'latestAttemptAt';
  private static readonly DEFAULT_TRAJECTORY_ORDER: LearningTrajectorySortOrder =
    'desc';
  private static readonly TRAJECTORY_WINDOW_MS_MAP: Record<
    LearningTrajectoryWindow,
    number
  > = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<Feedback>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
    private readonly aiFeedbackJobService: AiFeedbackJobService,
    private readonly learningTasksService: LearningTasksService,
  ) {}

  async createClassroomTask(
    classroomId: string,
    dto: CreateClassroomTaskDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    const classroom = await this.classroomModel
      .findOne({ _id: classroomId, teacherId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (classroom.status === ClassroomStatus.Archived) {
      throw new BadRequestException('Archived classrooms cannot publish tasks');
    }

    const task = await this.taskModel.findById(dto.taskId).lean().exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status !== TaskStatus.Published) {
      throw new BadRequestException('Task must be published');
    }

    const publishedAt = new Date();
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : undefined;
    const settings = {
      allowLate: dto.settings?.allowLate ?? true,
      ...(dto.settings?.maxAttempts !== undefined
        ? { maxAttempts: dto.settings.maxAttempts }
        : {}),
    };

    try {
      const classroomTask = await this.classroomTaskModel.create({
        classroomId: new Types.ObjectId(classroomId),
        taskId: new Types.ObjectId(dto.taskId),
        publishedAt,
        dueAt,
        settings,
        createdBy: new Types.ObjectId(userId),
      });
      return this.toClassroomTaskResponse(
        classroomTask as ClassroomTaskWithMeta,
        task,
      );
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        throw new BadRequestException('Task already published to classroom');
      }
      throw error;
    }
  }

  async listClassroomTasks(
    classroomId: string,
    query: QueryClassroomTaskDto,
    userId: string,
  ) {
    const classroom = await this.classroomModel
      .findById(classroomId)
      .lean()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    await this.ensureClassroomAccess(classroom, userId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const match = { classroomId: new Types.ObjectId(classroomId) };
    const basePipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'tasks',
          localField: 'taskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
    ];
    const statusPipeline: PipelineStage[] = query.status
      ? [{ $match: { 'task.status': query.status } }]
      : [];
    const itemsPipeline: PipelineStage[] = [
      ...basePipeline,
      ...statusPipeline,
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];
    const totalPipeline: PipelineStage[] = [
      ...basePipeline,
      ...statusPipeline,
      { $count: 'total' },
    ];

    const items = await this.classroomTaskModel
      .aggregate<ClassroomTaskWithTask>(itemsPipeline)
      .exec();
    const totalResult = await this.classroomTaskModel
      .aggregate<{ total: number }>(totalPipeline)
      .exec();
    const total = totalResult[0]?.total ?? 0;

    return {
      items: items.map((item) => this.toClassroomTaskResponse(item, item.task)),
      total,
      page,
      limit,
    };
  }

  async getClassroomTask(
    classroomId: string,
    classroomTaskId: string,
    userId: string,
  ) {
    const classroomTask = await this.classroomTaskModel
      .findOne({
        _id: classroomTaskId,
        classroomId: new Types.ObjectId(classroomId),
      })
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const classroom = await this.classroomModel
      .findById(classroomId)
      .lean()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    await this.ensureClassroomAccess(classroom, userId);

    const task = await this.taskModel
      .findById(classroomTask.taskId)
      .lean()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.toClassroomTaskResponse(classroomTask, task);
  }

  async createClassroomTaskSubmission(
    classroomId: string,
    classroomTaskId: string,
    dto: CreateSubmissionDto,
    userId: string,
  ) {
    await this.ensureStudent(userId);
    const classroom = await this.classroomModel
      .findById(classroomId)
      .lean()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    const isMember = await this.enrollmentService.isStudentActiveInClassroom(
      classroom._id,
      userId,
    );
    if (!isMember) {
      throw new ForbiddenException('Not allowed to submit classroom tasks');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({
        _id: classroomTaskId,
        classroomId: new Types.ObjectId(classroomId),
      })
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    return this.learningTasksService.createSubmissionForClassroomTask(
      classroomTask.taskId.toString(),
      classroomTaskId,
      dto,
      userId,
    );
  }

  async getLearningTrajectory(
    classroomId: string,
    classroomTaskId: string,
    query: QueryLearningTrajectoryDto,
    teacherId: string,
  ) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const page = query.page ?? ClassroomTasksService.DEFAULT_TRAJECTORY_PAGE;
    const limit = Math.min(
      query.limit ?? ClassroomTasksService.DEFAULT_TRAJECTORY_LIMIT,
      50,
    );
    const sort = LEARNING_TRAJECTORY_SORT_FIELDS.includes(
      query.sort as LearningTrajectorySortField,
    )
      ? (query.sort as LearningTrajectorySortField)
      : ClassroomTasksService.DEFAULT_TRAJECTORY_SORT;
    const order = LEARNING_TRAJECTORY_SORT_ORDERS.includes(
      query.order as LearningTrajectorySortOrder,
    )
      ? (query.order as LearningTrajectorySortOrder)
      : ClassroomTasksService.DEFAULT_TRAJECTORY_ORDER;
    const window = LEARNING_TRAJECTORY_WINDOWS.includes(
      query.window as LearningTrajectoryWindow,
    )
      ? (query.window as LearningTrajectoryWindow)
      : ClassroomTasksService.DEFAULT_TRAJECTORY_WINDOW;
    const includeAttempts = this.parseBooleanQuery(query.includeAttempts, true);
    const includeTagDetails = this.parseBooleanQuery(
      query.includeTagDetails,
      true,
    );
    const lowerBound = new Date(
      Date.now() - ClassroomTasksService.TRAJECTORY_WINDOW_MS_MAP[window],
    );

    // Z4 metric contract:
    // 1) submissions are isolated by classroomTaskId and filtered by submissions.createdAt window.
    // 2) Students are sourced from Enrollment ACTIVE only (STUDENT role).
    // 3) sort is applied within the paged enrollment slice (page-local sort), not globally.
    // 4) errorRate(v1) uses latest attempt ERROR count for deterministic sorting.
    const [classroom, classroomTask] = await Promise.all([
      this.classroomModel
        .findOne({
          _id: classroomObjectId,
          teacherId: new Types.ObjectId(teacherId),
        })
        .select('_id')
        .lean<WithId>()
        .exec(),
      this.classroomTaskModel
        .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
        .select('_id classroomId dueAt')
        .lean<LearningTrajectoryClassroomTaskLean>()
        .exec(),
    ]);
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const [total, studentIds] = await Promise.all([
      this.enrollmentService.countStudents(classroomObjectId.toString()),
      this.enrollmentService.listActiveStudentIdsByClassroomPage(
        classroomObjectId,
        page,
        limit,
      ),
    ]);

    if (studentIds.length === 0) {
      return {
        classroomId,
        classroomTaskId,
        window,
        generatedAt: new Date().toISOString(),
        page,
        limit,
        total,
        items: [],
      };
    }

    const studentObjectIds = studentIds.map(
      (studentId) => new Types.ObjectId(studentId),
    );
    const submissions = await this.submissionModel
      .find({
        classroomTaskId: classroomTaskObjectId,
        studentId: { $in: studentObjectIds },
        createdAt: { $gte: lowerBound },
      })
      .select('_id studentId attemptNo createdAt isLate lateBySeconds')
      .sort({ studentId: 1, attemptNo: 1, createdAt: 1 })
      .lean<LearningTrajectorySubmissionRow[]>()
      .exec();

    const submissionIds = submissions.map((submission) => submission._id);
    const [statusMap, feedbackSummaryMap] = await Promise.all([
      this.aiFeedbackJobService.getStatusMapBySubmissionIds(submissionIds),
      this.getFeedbackSummariesBySubmissionIds(
        submissionIds,
        includeTagDetails,
      ),
    ]);

    const submissionsByStudentId = new Map<
      string,
      LearningTrajectorySubmissionRow[]
    >();
    for (const submission of submissions) {
      const studentId = submission.studentId.toString();
      const bucket = submissionsByStudentId.get(studentId) ?? [];
      bucket.push(submission);
      submissionsByStudentId.set(studentId, bucket);
    }

    const items = studentIds.map((studentId) => {
      const studentSubmissions = submissionsByStudentId.get(studentId) ?? [];
      if (studentSubmissions.length === 0) {
        return {
          studentId,
          attemptsCount: 0,
          latestAttemptAt: null,
          latestAiFeedbackStatus: null,
          trend: {
            errorCountFirst: 0,
            errorCountLatest: 0,
            errorDelta: 0,
            topTagsFirst: [],
            topTagsLatest: [],
          },
          attempts: [],
        } as LearningTrajectoryItem;
      }

      const firstSubmission =
        this.findFirstAttemptSubmission(studentSubmissions);
      const latestSubmission =
        this.findLatestAttemptSubmission(studentSubmissions);
      const firstSummary =
        feedbackSummaryMap.get(firstSubmission._id.toString()) ??
        this.getEmptyFeedbackSummary();
      const latestSummary =
        feedbackSummaryMap.get(latestSubmission._id.toString()) ??
        this.getEmptyFeedbackSummary();
      const latestAiFeedbackStatus =
        statusMap.get(latestSubmission._id.toString()) ??
        AiFeedbackStatus.NotRequested;

      const attempts = includeAttempts
        ? studentSubmissions.map((submission) => {
            const feedbackSummary =
              feedbackSummaryMap.get(submission._id.toString()) ??
              this.getEmptyFeedbackSummary();
            const createdAt = submission.createdAt ?? new Date(0);
            return {
              submissionId: submission._id.toString(),
              attemptNo: submission.attemptNo,
              createdAt: createdAt.toISOString(),
              isLate: submission.isLate ?? false,
              lateBySeconds: submission.lateBySeconds ?? 0,
              aiFeedbackStatus:
                statusMap.get(submission._id.toString()) ??
                AiFeedbackStatus.NotRequested,
              feedbackSummary,
            } as LearningTrajectoryAttempt;
          })
        : [];

      return {
        studentId,
        attemptsCount: studentSubmissions.length,
        latestAttemptAt: (
          latestSubmission.createdAt ?? new Date(0)
        ).toISOString(),
        latestAiFeedbackStatus,
        trend: {
          errorCountFirst: firstSummary.severityBreakdown.ERROR,
          errorCountLatest: latestSummary.severityBreakdown.ERROR,
          errorDelta:
            latestSummary.severityBreakdown.ERROR -
            firstSummary.severityBreakdown.ERROR,
          topTagsFirst: firstSummary.topTags,
          topTagsLatest: latestSummary.topTags,
        },
        attempts,
      } as LearningTrajectoryItem;
    });

    items.sort((left, right) =>
      this.compareTrajectoryItems(left, right, sort, order),
    );

    return {
      classroomId,
      classroomTaskId,
      window,
      generatedAt: new Date().toISOString(),
      page,
      limit,
      total,
      items,
    };
  }

  async getMyTaskDetail(
    classroomId: string,
    classroomTaskId: string,
    query: QueryMyTaskDetailDto,
    userId: string,
  ) {
    await this.ensureStudent(userId);
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const studentObjectId = new Types.ObjectId(userId);
    const includeFeedbackItems = this.parseIncludeFeedbackItems(
      query.includeFeedbackItems,
    );
    const feedbackLimit = query.feedbackLimit ?? 5;

    const classroom = await this.classroomModel
      .findById(classroomObjectId)
      .select('_id name courseId')
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    const isMember = await this.enrollmentService.isStudentActiveInClassroom(
      classroom._id,
      studentObjectId,
    );
    if (!isMember) {
      throw new ForbiddenException('Not allowed to view classroom tasks');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const task = await this.taskModel
      .findById(classroomTask.taskId)
      .select(
        'title description knowledgeModule stage difficulty rubric status createdAt updatedAt',
      )
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const submissions = await this.submissionModel
      .find({
        classroomTaskId: classroomTaskObjectId,
        studentId: studentObjectId,
      })
      .sort({ attemptNo: 1, createdAt: 1 })
      .lean<SubmissionWithMeta[]>()
      .exec();

    const submissionIds = submissions.map((submission) => submission._id);
    const [statusMap, feedbackSummaryMap, feedbackItemsMap] = await Promise.all(
      [
        this.aiFeedbackJobService.getStatusMapBySubmissionIds(submissionIds),
        this.getFeedbackSummariesBySubmissionIds(submissionIds),
        includeFeedbackItems
          ? this.getFeedbackItemsPreviewBySubmissionIds(
              submissionIds,
              feedbackLimit,
            )
          : Promise.resolve(
              new Map<string, SubmissionDetailItem['feedbackItems']>(),
            ),
      ],
    );

    const submissionItems = submissions.map((submission) => {
      const submissionId = submission._id.toString();
      const base: SubmissionDetailItem = {
        id: submissionId,
        attemptNo: submission.attemptNo,
        createdAt: submission.createdAt ?? new Date(0),
        aiFeedbackStatus:
          statusMap.get(submissionId) ?? AiFeedbackStatus.NotRequested,
        feedbackSummary:
          feedbackSummaryMap.get(submissionId) ??
          this.getEmptyFeedbackSummary(),
      };
      if (includeFeedbackItems) {
        base.feedbackItems = feedbackItemsMap.get(submissionId) ?? [];
      }
      return base;
    });

    const latestSubmission = submissionItems[submissionItems.length - 1];

    return {
      classroom: {
        id: classroom._id.toString(),
        name: classroom.name,
        courseId: classroom.courseId.toString(),
      },
      classroomTask: {
        id: classroomTask._id.toString(),
        classroomId: classroomTask.classroomId.toString(),
        taskId: classroomTask.taskId.toString(),
        publishedAt: classroomTask.publishedAt,
        dueAt: classroomTask.dueAt,
        settings: classroomTask.settings,
      },
      task: {
        id: task._id.toString(),
        title: task.title,
        description: task.description,
        knowledgeModule: task.knowledgeModule,
        stage: task.stage,
        difficulty: task.difficulty,
        rubric: task.rubric,
        status: task.status,
      },
      me: { studentId: studentObjectId.toString() },
      submissions: submissionItems,
      latest: latestSubmission
        ? {
            submissionId: latestSubmission.id,
            attemptNo: latestSubmission.attemptNo,
            aiFeedbackStatus: latestSubmission.aiFeedbackStatus,
            feedbackSummary: latestSubmission.feedbackSummary,
            ...(includeFeedbackItems
              ? { feedbackItems: latestSubmission.feedbackItems ?? [] }
              : {}),
          }
        : null,
    };
  }

  private async ensureTeacher(userId: string) {
    const roles = await this.getUserRoles(userId);
    if (!hasAnyRole(roles, TEACHER_ROLES)) {
      throw new ForbiddenException('Not allowed to manage classroom tasks');
    }
  }

  private async ensureStudent(userId: string) {
    const roles = await this.getUserRoles(userId);
    if (!hasAnyRole(roles, STUDENT_ROLES)) {
      throw new ForbiddenException('Not allowed to submit classroom tasks');
    }
  }

  private async ensureClassroomAccess(
    classroom: Classroom & { _id: Types.ObjectId },
    userId: string,
  ) {
    const roles = await this.getUserRoles(userId);
    const isTeacher = hasAnyRole(roles, TEACHER_ROLES);
    const isStudent = hasAnyRole(roles, STUDENT_ROLES);
    const isOwner = classroom.teacherId.toString() === userId;
    if (isTeacher && isOwner) {
      return;
    }
    if (isStudent) {
      const isMember = await this.enrollmentService.isStudentActiveInClassroom(
        classroom._id,
        userId,
      );
      if (!isMember) {
        throw new ForbiddenException('Not allowed to view classroom tasks');
      }
      return;
    }
    throw new ForbiddenException('Not allowed to view classroom tasks');
  }

  private async getUserRoles(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('roles')
      .lean()
      .exec();
    if (!user) {
      throw new ForbiddenException('Not allowed');
    }
    return user.roles ?? [];
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private parseIncludeFeedbackItems(includeFeedbackItems?: string) {
    return this.parseBooleanQuery(includeFeedbackItems, false);
  }

  private getEmptyFeedbackSummary(): SubmissionFeedbackSummary {
    return {
      totalItems: 0,
      topTags: [],
      severityBreakdown: { INFO: 0, WARN: 0, ERROR: 0 },
    };
  }

  private async getFeedbackSummariesBySubmissionIds(
    ids: Types.ObjectId[],
    includeTagDetails = true,
  ) {
    const summaryMap = new Map<string, SubmissionFeedbackSummary>();
    if (ids.length === 0) {
      return summaryMap;
    }

    type FeedbackSummaryFacetResult = {
      totals: Array<{ _id: Types.ObjectId; totalItems: number }>;
      severities: FeedbackSummarySeverityAgg[];
      tags?: FeedbackSummaryTagAgg[];
    };

    const facet: Record<string, PipelineStage[]> = {
      totals: [{ $group: { _id: '$submissionId', totalItems: { $sum: 1 } } }],
      severities: [
        {
          $group: {
            _id: {
              submissionId: '$submissionId',
              severity: '$severity',
            },
            count: { $sum: 1 },
          },
        },
      ],
    };
    if (includeTagDetails) {
      facet.tags = [
        { $match: { tags: { $exists: true, $ne: [] } } },
        { $unwind: '$tags' },
        {
          $group: {
            _id: {
              submissionId: '$submissionId',
              tag: '$tags',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.submissionId': 1, count: -1 } },
      ];
    }

    const result = await this.feedbackModel
      .aggregate<FeedbackSummaryFacetResult>([
        {
          $match: {
            submissionId: { $in: ids },
            source: FeedbackSource.AI,
          },
        },
        { $facet: facet },
      ] as PipelineStage[])
      .exec();

    const aggregate = result[0] ?? { totals: [], severities: [], tags: [] };

    for (const total of aggregate.totals) {
      summaryMap.set(total._id.toString(), {
        ...this.getEmptyFeedbackSummary(),
        totalItems: total.totalItems,
      });
    }

    for (const severity of aggregate.severities) {
      const submissionId = severity._id.submissionId.toString();
      const current =
        summaryMap.get(submissionId) ?? this.getEmptyFeedbackSummary();
      if (severity._id.severity === FeedbackSeverity.Info) {
        current.severityBreakdown.INFO = severity.count;
      }
      if (severity._id.severity === FeedbackSeverity.Warn) {
        current.severityBreakdown.WARN = severity.count;
      }
      if (severity._id.severity === FeedbackSeverity.Error) {
        current.severityBreakdown.ERROR = severity.count;
      }
      summaryMap.set(submissionId, current);
    }

    if (includeTagDetails) {
      for (const tag of aggregate.tags ?? []) {
        const submissionId = tag._id.submissionId.toString();
        const current =
          summaryMap.get(submissionId) ?? this.getEmptyFeedbackSummary();
        if (current.topTags.length < 5) {
          current.topTags.push({ tag: tag._id.tag, count: tag.count });
        }
        summaryMap.set(submissionId, current);
      }
    }

    return summaryMap;
  }

  private findFirstAttemptSubmission(
    submissions: LearningTrajectorySubmissionRow[],
  ) {
    let first = submissions[0];
    for (const submission of submissions) {
      if (submission.attemptNo < first.attemptNo) {
        first = submission;
        continue;
      }
      if (submission.attemptNo === first.attemptNo) {
        const submissionTime = submission.createdAt?.getTime() ?? 0;
        const firstTime = first.createdAt?.getTime() ?? 0;
        if (submissionTime < firstTime) {
          first = submission;
        }
      }
    }
    return first;
  }

  private findLatestAttemptSubmission(
    submissions: LearningTrajectorySubmissionRow[],
  ) {
    let latest = submissions[0];
    for (const submission of submissions) {
      const submissionTime = submission.createdAt?.getTime() ?? 0;
      const latestTime = latest.createdAt?.getTime() ?? 0;
      if (submissionTime > latestTime) {
        latest = submission;
        continue;
      }
      if (
        submissionTime === latestTime &&
        submission.attemptNo > latest.attemptNo
      ) {
        latest = submission;
      }
    }
    return latest;
  }

  private compareTrajectoryItems(
    left: LearningTrajectoryItem,
    right: LearningTrajectoryItem,
    sort: LearningTrajectorySortField,
    order: LearningTrajectorySortOrder,
  ) {
    if (sort === 'notSubmitted') {
      const leftNotSubmitted = left.attemptsCount === 0 ? 1 : 0;
      const rightNotSubmitted = right.attemptsCount === 0 ? 1 : 0;
      if (leftNotSubmitted !== rightNotSubmitted) {
        return rightNotSubmitted - leftNotSubmitted;
      }
      return left.studentId.localeCompare(right.studentId);
    }

    if (sort === 'latestAttemptAt') {
      const leftValue = left.latestAttemptAt
        ? new Date(left.latestAttemptAt).getTime()
        : null;
      const rightValue = right.latestAttemptAt
        ? new Date(right.latestAttemptAt).getTime()
        : null;
      if (leftValue === null || rightValue === null) {
        if (leftValue === null && rightValue === null) {
          return left.studentId.localeCompare(right.studentId);
        }
        if (order === 'asc') {
          return leftValue === null ? -1 : 1;
        }
        return leftValue === null ? 1 : -1;
      }
      if (leftValue !== rightValue) {
        const diff = leftValue - rightValue;
        return order === 'asc' ? diff : -diff;
      }
      return left.studentId.localeCompare(right.studentId);
    }

    const leftValue =
      sort === 'attemptsCount'
        ? left.attemptsCount
        : left.trend.errorCountLatest;
    const rightValue =
      sort === 'attemptsCount'
        ? right.attemptsCount
        : right.trend.errorCountLatest;
    if (leftValue !== rightValue) {
      const diff = leftValue - rightValue;
      return order === 'asc' ? diff : -diff;
    }
    return left.studentId.localeCompare(right.studentId);
  }

  private parseBooleanQuery(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  private async getFeedbackItemsPreviewBySubmissionIds(
    ids: Types.ObjectId[],
    feedbackLimit: number,
  ) {
    const itemsMap = new Map<string, SubmissionDetailItem['feedbackItems']>();
    if (ids.length === 0) {
      return itemsMap;
    }

    const rows = await this.feedbackModel
      .aggregate<FeedbackItemAgg>([
        {
          $match: {
            submissionId: { $in: ids },
            source: FeedbackSource.AI,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $project: {
            _id: 0,
            submissionId: 1,
            source: 1,
            type: 1,
            severity: 1,
            message: 1,
            suggestion: 1,
            tags: 1,
          },
        },
        {
          $group: {
            _id: '$submissionId',
            items: {
              $push: {
                source: '$source',
                type: '$type',
                severity: '$severity',
                message: '$message',
                suggestion: '$suggestion',
                tags: '$tags',
              },
            },
          },
        },
        { $project: { items: { $slice: ['$items', feedbackLimit] } } },
      ] as PipelineStage[])
      .exec();

    for (const row of rows) {
      itemsMap.set(row._id.toString(), row.items);
    }
    return itemsMap;
  }

  private toClassroomTaskResponse(
    classroomTask: ClassroomTaskWithMeta,
    task: Task,
  ) {
    return {
      id: classroomTask._id.toString(),
      classroomId: classroomTask.classroomId.toString(),
      taskId: classroomTask.taskId.toString(),
      publishedAt: classroomTask.publishedAt,
      dueAt: classroomTask.dueAt,
      settings: classroomTask.settings,
      createdBy: classroomTask.createdBy.toString(),
      createdAt: classroomTask.createdAt ?? new Date(0),
      updatedAt: classroomTask.updatedAt ?? new Date(0),
      task: {
        title: task.title,
        description: task.description,
        knowledgeModule: task.knowledgeModule,
        stage: task.stage,
        difficulty: task.difficulty,
        status: task.status,
      },
    } as ClassroomTaskResponseDto;
  }
}
