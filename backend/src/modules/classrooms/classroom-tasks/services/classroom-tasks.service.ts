import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { Course } from '../../../courses/schemas/course.schema';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import { CreateClassroomTaskDto } from '../dto/create-classroom-task.dto';
import { QueryClassroomTaskDto } from '../dto/query-classroom-task.dto';
import { QueryMyTaskDetailDto } from '../dto/query-my-task-detail.dto';
import { QueryClassroomTaskSubmissionsDto } from '../dto/query-classroom-task-submissions.dto';
import { QueryPublishableTaskTemplateDto } from '../dto/query-publishable-task-template.dto';
import { UpdateClassroomTaskDto } from '../dto/update-classroom-task.dto';
import { UpdateClassroomTaskStatusDto } from '../dto/update-classroom-task-status.dto';
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
import {
  PublishableTaskTemplateItemResponseDto,
  PublishableTaskTemplateListResponseDto,
} from '../dto/publishable-task-template-response.dto';
import { CreateSubmissionDto } from '../../../learning-tasks/dto/create-submission.dto';
import { Task, TaskStatus } from '../../../learning-tasks/schemas/task.schema';
import { TASK_COURSE_LABEL_UNCLASSIFIED } from '../../../learning-tasks/task-course-labels.constants';
import {
  TASK_VISIBILITY_PRIVATE,
  TASK_VISIBILITY_SHARED,
} from '../../../learning-tasks/task-template-visibility.constants';
import type { TaskVisibility } from '../../../learning-tasks/task-template-visibility.constants';
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
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
  type ClassroomTaskStatus,
} from '../classroom-task-status.constants';
import {
  CompletionFeedback,
  buildCompletionStatus,
  buildNotSubmittedCompletionStatus,
} from '../../services/student-task-completion-status';

type ClassroomTaskWithMeta = ClassroomTask & WithId & WithTimestamps;
type ClassroomTaskWithTask = ClassroomTaskWithMeta & { task: Task };
type ClassroomWithMeta = Classroom & WithId & WithTimestamps;
type ClassroomWithCourseLean = Pick<Classroom, 'courseId'> & WithId;
type CourseWithLabelLean = Pick<Course, 'courseLabel'> & WithId;
type ClassroomOwnerLean = Pick<Classroom, 'teacherId'> & WithId;
type ClassroomTaskOwnerLean = Pick<ClassroomTask, 'classroomId'> & WithId;
type ClassroomTaskSubmitTemplateLean = Pick<Task, 'status'> & WithId;
type PublisherSummary = { id: string; name?: string };
type PublisherUserLean = Pick<User, 'name'> & WithId;
type TaskWithMeta = Task & WithId & WithTimestamps;
type PublishableTaskTemplateAgg = TaskWithMeta & {
  __courseLabelPriority?: number;
};
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type ClassroomTaskSubmissionLean = Pick<
  Submission,
  | 'taskId'
  | 'classroomTaskId'
  | 'studentId'
  | 'attemptNo'
  | 'submittedAt'
  | 'isLate'
  | 'lateBySeconds'
  | 'status'
> &
  WithId &
  WithTimestamps;
type SubmissionStudentLean = Pick<
  User,
  'email' | 'roles' | 'status' | 'name' | 'studentNo' | 'employeeNo'
> &
  WithId;
type ClassroomTaskSubmissionListItem = {
  id: string;
  taskId: string;
  classroomTaskId: string;
  student: {
    id: string;
    email: string;
    roles: string[];
    status: string;
    name: string | null;
    studentNo: string | null;
    employeeNo: string | null;
  };
  attemptNo: number;
  submittedAt: Date;
  isLate: boolean;
  lateBySeconds: number;
  status: Submission['status'];
  aiFeedbackStatus: AiFeedbackStatus;
  feedbackCount: number;
};
type ListClassroomTaskSubmissionsResponse = {
  items: ClassroomTaskSubmissionListItem[];
  total: number;
  page: number;
  limit: number;
};
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
type FeedbackCountAgg = {
  _id: Types.ObjectId;
  count: number;
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
type LearningTrajectoryStudentLean = Pick<
  User,
  'email' | 'name' | 'studentNo'
> &
  WithId;
type LearningTrajectoryStudentPublic = {
  id: string;
  name: string | null;
  studentNo: string | null;
  email: string | null;
};
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
  feedbackCount: number;
  feedbackSummary: SubmissionFeedbackSummary;
};
type LearningTrajectoryItem = {
  studentId: string;
  studentName: string | null;
  student: LearningTrajectoryStudentPublic;
  attemptsCount: number;
  latestAttemptAt: string | null;
  latestAiFeedbackStatus: AiFeedbackStatus | null;
  trend: LearningTrajectoryTrend;
  attempts: LearningTrajectoryAttempt[];
};
type LearningTrajectoryResponse = {
  classroomId: string;
  classroomTaskId: string;
  window: LearningTrajectoryWindow;
  generatedAt: string;
  page: number;
  limit: number;
  total: number;
  items: LearningTrajectoryItem[];
};
type StudentTaskParticipationReason =
  | 'ACTIVE'
  | 'CLASSROOM_NOT_ACTIVE'
  | 'CLASSROOM_TASK_NOT_ACTIVE'
  | 'TASK_NOT_PUBLISHED';
type StudentTaskParticipationStatus = {
  readOnly: boolean;
  canSubmit: boolean;
  canRequestAiFeedback: boolean;
  reason: StudentTaskParticipationReason;
  message: string | null;
};

@Injectable()
export class ClassroomTasksService {
  private static readonly DEFAULT_TRAJECTORY_WINDOW: LearningTrajectoryWindow =
    'all';
  private static readonly DEFAULT_TRAJECTORY_PAGE = 1;
  private static readonly DEFAULT_TRAJECTORY_LIMIT = 20;
  private static readonly DEFAULT_TRAJECTORY_SORT: LearningTrajectorySortField =
    'latestAttemptAt';
  private static readonly DEFAULT_TRAJECTORY_ORDER: LearningTrajectorySortOrder =
    'desc';
  private static readonly TRAJECTORY_WINDOW_MS_MAP: Record<
    Exclude<LearningTrajectoryWindow, 'all'>,
    number
  > = {
    '24h': 24 * 60 * 60 * 1000,
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

  async updateClassroomTask(
    classroomId: string,
    classroomTaskId: string,
    dto: UpdateClassroomTaskDto,
    teacherId: string,
  ) {
    await this.ensureTeacher(teacherId);

    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const teacherObjectId = new Types.ObjectId(teacherId);

    const classroom = await this.classroomModel
      .findOne({ _id: classroomObjectId, teacherId: teacherObjectId })
      .select('_id')
      .lean<ClassroomOwnerLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const currentStatus = this.toClassroomTaskStatusForRead(
      classroomTask.status,
    );
    if (currentStatus === CLASSROOM_TASK_STATUS_RECALLED) {
      throw new BadRequestException(
        'Recalled classroom tasks cannot be updated',
      );
    }

    const hasDueAt = Object.hasOwn(dto, 'dueAt');
    const hasAllowLate = Object.hasOwn(dto, 'allowLate');
    const hasMaxAttempts = Object.hasOwn(dto, 'maxAttempts');
    if (!hasDueAt && !hasAllowLate && !hasMaxAttempts) {
      throw new BadRequestException('At least one updatable field is required');
    }

    const setPatch: Record<string, unknown> = {};
    const unsetPatch: Record<string, 1> = {};

    if (hasDueAt) {
      if (dto.dueAt === null || dto.dueAt === undefined) {
        unsetPatch.dueAt = 1;
      } else {
        setPatch.dueAt = new Date(dto.dueAt);
      }
    }
    if (hasAllowLate) {
      setPatch['settings.allowLate'] = dto.allowLate;
    }
    if (hasMaxAttempts) {
      if (dto.maxAttempts === null || dto.maxAttempts === undefined) {
        unsetPatch['settings.maxAttempts'] = 1;
      } else {
        setPatch['settings.maxAttempts'] = dto.maxAttempts;
      }
    }

    const updatePatch: {
      $set?: Record<string, unknown>;
      $unset?: Record<string, 1>;
    } = {};
    if (Object.keys(setPatch).length > 0) {
      updatePatch.$set = setPatch;
    }
    if (Object.keys(unsetPatch).length > 0) {
      updatePatch.$unset = unsetPatch;
    }

    const updatedClassroomTask = await this.classroomTaskModel
      .findOneAndUpdate(
        { _id: classroomTaskObjectId, classroomId: classroomObjectId },
        updatePatch,
        { new: true },
      )
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!updatedClassroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const task = await this.taskModel
      .findById(updatedClassroomTask.taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.toClassroomTaskResponse(updatedClassroomTask, task);
  }

  async updateClassroomTaskStatus(
    classroomId: string,
    classroomTaskId: string,
    dto: UpdateClassroomTaskStatusDto,
    teacherId: string,
  ) {
    await this.ensureTeacher(teacherId);

    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const teacherObjectId = new Types.ObjectId(teacherId);

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: teacherObjectId,
      })
      .select('_id')
      .lean<ClassroomOwnerLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const currentStatus = this.toClassroomTaskStatusForRead(
      classroomTask.status,
    );
    const targetStatus = dto.status;

    if (targetStatus === currentStatus) {
      throw new BadRequestException(
        `Classroom task status is already ${currentStatus}`,
      );
    }

    if (currentStatus === CLASSROOM_TASK_STATUS_RECALLED) {
      throw new BadRequestException(
        'Recalled classroom tasks cannot be reopened or closed',
      );
    }

    if (currentStatus === CLASSROOM_TASK_STATUS_ACTIVE) {
      if (targetStatus === CLASSROOM_TASK_STATUS_CLOSED) {
        // ACTIVE -> CLOSED is always allowed.
      } else if (targetStatus === CLASSROOM_TASK_STATUS_RECALLED) {
        const hasSubmissions = await this.submissionModel.exists({
          classroomTaskId: classroomTask._id,
        });
        if (hasSubmissions) {
          throw new BadRequestException(
            'Classroom task already has submissions and cannot be recalled; close it instead',
          );
        }
      } else {
        throw new BadRequestException(
          `Transition from ${currentStatus} to ${targetStatus} is not allowed`,
        );
      }
    } else if (currentStatus === CLASSROOM_TASK_STATUS_CLOSED) {
      if (targetStatus !== CLASSROOM_TASK_STATUS_ACTIVE) {
        throw new BadRequestException(
          `Transition from ${currentStatus} to ${targetStatus} is not allowed`,
        );
      }
    }

    const updatedClassroomTask = await this.classroomTaskModel
      .findOneAndUpdate(
        { _id: classroomTaskObjectId, classroomId: classroomObjectId },
        { $set: { status: targetStatus } },
        { new: true },
      )
      .lean<ClassroomTaskWithMeta>()
      .exec();
    if (!updatedClassroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const task = await this.taskModel
      .findById(updatedClassroomTask.taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.toClassroomTaskResponse(updatedClassroomTask, task);
  }

  async listPublishableTaskTemplates(
    classroomId: string,
    query: QueryPublishableTaskTemplateDto,
    teacherId: string,
  ): Promise<PublishableTaskTemplateListResponseDto> {
    await this.ensureTeacher(teacherId);

    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const teacherObjectId = new Types.ObjectId(teacherId);
    const classroom = await this.classroomModel
      .findOne({ _id: classroomObjectId, teacherId: teacherObjectId })
      .select('_id courseId')
      .lean<ClassroomWithCourseLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const [course, publishedTaskIds] = await Promise.all([
      this.courseModel
        .findById(classroom.courseId)
        .select('_id courseLabel')
        .lean<CourseWithLabelLean>()
        .exec(),
      this.classroomTaskModel
        .distinct('taskId', { classroomId: classroom._id })
        .exec(),
    ]);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const andFilters: Record<string, unknown>[] = [];
    const baseFilter: Record<string, unknown> = {
      status: TaskStatus.Published,
    };
    if (publishedTaskIds.length > 0) {
      baseFilter._id = { $nin: publishedTaskIds };
    }
    if (query.knowledgeModule) {
      baseFilter.knowledgeModule = query.knowledgeModule;
    }
    if (query.stage) {
      baseFilter.stage = query.stage;
    }
    if (query.onlyMine === true) {
      baseFilter.createdBy = teacherObjectId;
    } else {
      andFilters.push({
        $or: [
          { createdBy: teacherObjectId },
          ...this.getSharedVisibilityFilter(),
        ],
      });
    }
    if (query.courseLabel) {
      if (query.courseLabel === TASK_COURSE_LABEL_UNCLASSIFIED) {
        andFilters.push({ $or: this.getUnclassifiedCourseLabelFilter() });
      } else {
        baseFilter.courseLabel = query.courseLabel;
      }
    }
    andFilters.unshift(baseFilter);
    const filter =
      andFilters.length === 1 ? andFilters[0] : { $and: andFilters };

    const requestedCourseLabel = this.toSanitizedCourseLabel(query.courseLabel);
    const classroomCourseLabel = this.toSanitizedCourseLabel(
      course?.courseLabel,
    );
    const shouldPrioritizeCourseLabel =
      !requestedCourseLabel && !!classroomCourseLabel;
    const addFieldsStage: PipelineStage[] = shouldPrioritizeCourseLabel
      ? [
          {
            $addFields: {
              __courseLabelPriority: {
                $cond: [{ $eq: ['$courseLabel', classroomCourseLabel] }, 0, 1],
              },
            },
          },
        ]
      : [];
    const sortStage: PipelineStage.Sort['$sort'] = shouldPrioritizeCourseLabel
      ? { __courseLabelPriority: 1, updatedAt: -1, createdAt: -1, _id: -1 }
      : { updatedAt: -1, createdAt: -1, _id: -1 };
    const itemsPipeline: PipelineStage[] = [
      { $match: filter },
      ...addFieldsStage,
      { $sort: sortStage },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];

    const [items, total] = await Promise.all([
      this.taskModel
        .aggregate<PublishableTaskTemplateAgg>(itemsPipeline)
        .exec(),
      this.taskModel.countDocuments(filter),
    ]);
    const publisherMap = await this.getPublisherSummaryMap(
      items.map((task) => task.createdBy),
    );

    return {
      items: items.map((task) =>
        this.toPublishableTaskTemplateItemResponse(
          task,
          this.getPublisherSummaryFromMap(task.createdBy, publisherMap),
        ),
      ),
      total,
      page,
      limit,
    };
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

    const [items, totalResult] = await Promise.all([
      this.classroomTaskModel
        .aggregate<ClassroomTaskWithTask>(itemsPipeline)
        .exec(),
      this.classroomTaskModel
        .aggregate<{ total: number }>(totalPipeline)
        .exec(),
    ]);
    const total = totalResult[0]?.total ?? 0;
    const publisherMap = await this.getPublisherSummaryMap(
      items.map((item) => item.task.createdBy),
    );

    return {
      items: items.map((item) =>
        this.toClassroomTaskResponse(
          item,
          item.task,
          this.getPublisherSummaryFromMap(item.task.createdBy, publisherMap),
        ),
      ),
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

    const taskPublisher = await this.getPublisherSummaryById(task.createdBy);
    return this.toClassroomTaskResponse(classroomTask, task, taskPublisher);
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
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (classroom.status !== ClassroomStatus.Active) {
      throw new ConflictException('班级已归档，不能继续提交该任务。');
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
    if (
      this.toClassroomTaskStatusForRead(classroomTask.status) !==
      CLASSROOM_TASK_STATUS_ACTIVE
    ) {
      throw new ConflictException('课堂任务已关闭，不能继续提交。');
    }

    const task = await this.taskModel
      .findById(classroomTask.taskId)
      .select('_id status')
      .lean<ClassroomTaskSubmitTemplateLean>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status !== TaskStatus.Published) {
      throw new ConflictException('任务未发布，不能继续提交。');
    }

    return this.learningTasksService.createSubmissionForClassroomTask(
      classroomTask.taskId.toString(),
      classroomTaskId,
      dto,
      userId,
    );
  }

  async listClassroomTaskSubmissions(
    classroomId: string,
    classroomTaskId: string,
    query: QueryClassroomTaskSubmissionsDto,
    teacherId: string,
  ): Promise<ListClassroomTaskSubmissionsResponse> {
    await this.ensureTeacher(teacherId);

    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id teacherId')
      .lean<ClassroomOwnerLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({ _id: classroomTaskObjectId, classroomId: classroom._id })
      .select('_id classroomId')
      .lean<ClassroomTaskOwnerLean>()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const filter = { classroomTaskId: classroomTask._id };
    const [submissions, total] = await Promise.all([
      this.submissionModel
        .find(filter)
        .sort({ submittedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(
          'taskId classroomTaskId studentId attemptNo submittedAt isLate lateBySeconds status createdAt',
        )
        .lean<ClassroomTaskSubmissionLean[]>()
        .exec(),
      this.submissionModel.countDocuments(filter),
    ]);
    if (submissions.length === 0) {
      return { items: [], total, page, limit };
    }
    const submissionIds = submissions.map((submission) => submission._id);
    const [statusMap, feedbackCountMap] = await Promise.all([
      this.aiFeedbackJobService.getStatusMapBySubmissionIds(submissionIds),
      this.getFeedbackCountsBySubmissionIds(submissionIds),
    ]);

    const studentIds = Array.from(
      new Map(
        submissions.map((submission) => [
          submission.studentId.toString(),
          submission.studentId,
        ]),
      ).values(),
    );
    const students = await this.userModel
      .find({ _id: { $in: studentIds } })
      .select('email roles status name studentNo employeeNo')
      .lean<SubmissionStudentLean[]>()
      .exec();
    const studentMap = new Map<string, SubmissionStudentLean>();
    for (const student of students) {
      studentMap.set(student._id.toString(), student);
    }

    const items = submissions.map((submission) =>
      this.toClassroomTaskSubmissionListItem(
        submission,
        studentMap.get(submission.studentId.toString()),
        statusMap.get(submission._id.toString()) ??
          AiFeedbackStatus.NotRequested,
        feedbackCountMap.get(submission._id.toString()) ?? 0,
        classroomTaskObjectId,
      ),
    );

    return { items, total, page, limit };
  }

  async getLearningTrajectory(
    classroomId: string,
    classroomTaskId: string,
    query: QueryLearningTrajectoryDto,
    teacherId: string,
  ): Promise<LearningTrajectoryResponse> {
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
    const lowerBound =
      window === 'all'
        ? null
        : new Date(
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
    const submissionMatch: Record<string, unknown> = {
      classroomTaskId: classroomTaskObjectId,
      studentId: { $in: studentObjectIds },
    };
    if (lowerBound) {
      submissionMatch.createdAt = { $gte: lowerBound };
    }
    const [students, submissions] = await Promise.all([
      this.userModel
        .find({ _id: { $in: studentObjectIds } })
        .select('name studentNo email')
        .lean<LearningTrajectoryStudentLean[]>()
        .exec(),
      this.submissionModel
        .find(submissionMatch)
        .select('_id studentId attemptNo createdAt isLate lateBySeconds')
        .sort({ studentId: 1, attemptNo: 1, createdAt: 1 })
        .lean<LearningTrajectorySubmissionRow[]>()
        .exec(),
    ]);
    const studentPublicMap = new Map<string, LearningTrajectoryStudentLean>();
    for (const student of students) {
      studentPublicMap.set(student._id.toString(), student);
    }

    const submissionIds = submissions.map((submission) => submission._id);
    const [statusMap, feedbackSummaryMap, feedbackCountMap] = await Promise.all(
      [
        this.aiFeedbackJobService.getStatusMapBySubmissionIds(submissionIds),
        this.getFeedbackSummariesBySubmissionIds(
          submissionIds,
          includeTagDetails,
        ),
        includeAttempts
          ? this.getFeedbackCountsBySubmissionIds(submissionIds)
          : Promise.resolve(new Map<string, number>()),
      ],
    );

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
      const studentPublic = this.toLearningTrajectoryStudentPublic(
        studentId,
        studentPublicMap.get(studentId),
      );
      const studentSubmissions = submissionsByStudentId.get(studentId) ?? [];
      if (studentSubmissions.length === 0) {
        return {
          studentId,
          studentName: studentPublic.name,
          student: studentPublic,
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
              feedbackCount:
                feedbackCountMap.get(submission._id.toString()) ?? 0,
              feedbackSummary,
            } as LearningTrajectoryAttempt;
          })
        : [];

      return {
        studentId,
        studentName: studentPublic.name,
        student: studentPublic,
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
      .select('_id name courseId status')
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
    const completionFeedbacks =
      latestSubmission === undefined
        ? []
        : await this.getCompletionFeedbacksBySubmissionId(
            new Types.ObjectId(latestSubmission.id),
          );
    const completionStatus = latestSubmission
      ? buildCompletionStatus(latestSubmission.id, completionFeedbacks)
      : buildNotSubmittedCompletionStatus();
    const classroomTaskStatus = this.toClassroomTaskStatusForRead(
      classroomTask.status,
    );
    const participationStatus = this.buildStudentTaskParticipationStatus(
      classroom.status,
      classroomTaskStatus,
      task.status,
    );

    return {
      classroom: {
        id: classroom._id.toString(),
        name: classroom.name,
        courseId: classroom.courseId.toString(),
        status: classroom.status,
      },
      classroomTask: {
        id: classroomTask._id.toString(),
        classroomId: classroomTask.classroomId.toString(),
        taskId: classroomTask.taskId.toString(),
        status: classroomTaskStatus,
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
      completionStatus,
      participationStatus,
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

  private buildStudentTaskParticipationStatus(
    classroomStatus: ClassroomStatus,
    classroomTaskStatus: ClassroomTaskStatus,
    taskStatus: TaskStatus,
  ): StudentTaskParticipationStatus {
    if (classroomStatus !== ClassroomStatus.Active) {
      return {
        readOnly: true,
        canSubmit: false,
        canRequestAiFeedback: false,
        reason: 'CLASSROOM_NOT_ACTIVE',
        message: '班级已归档或不可参与，仅可查看历史提交与反馈。',
      };
    }
    if (classroomTaskStatus !== CLASSROOM_TASK_STATUS_ACTIVE) {
      return {
        readOnly: true,
        canSubmit: false,
        canRequestAiFeedback: false,
        reason: 'CLASSROOM_TASK_NOT_ACTIVE',
        message: '课堂任务已关闭或不可参与，仅可查看历史提交与反馈。',
      };
    }
    if (taskStatus !== TaskStatus.Published) {
      return {
        readOnly: true,
        canSubmit: false,
        canRequestAiFeedback: false,
        reason: 'TASK_NOT_PUBLISHED',
        message: '任务未发布或不可参与，仅可查看历史提交与反馈。',
      };
    }
    return {
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: true,
      reason: 'ACTIVE',
      message: null,
    };
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

  private getSharedVisibilityFilter(): Record<string, unknown>[] {
    return [
      { visibility: TASK_VISIBILITY_SHARED },
      { visibility: { $exists: false } },
      { visibility: null },
      { visibility: '' },
    ];
  }

  private getUnclassifiedCourseLabelFilter(): Record<string, unknown>[] {
    return [
      { courseLabel: TASK_COURSE_LABEL_UNCLASSIFIED },
      { courseLabel: { $exists: false } },
      { courseLabel: null },
      { courseLabel: '' },
    ];
  }

  private toSanitizedTaskVisibility(
    value: unknown,
  ): TaskVisibility | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed === TASK_VISIBILITY_PRIVATE) {
      return TASK_VISIBILITY_PRIVATE;
    }
    if (trimmed === TASK_VISIBILITY_SHARED) {
      return TASK_VISIBILITY_SHARED;
    }
    return undefined;
  }

  private toTaskVisibilityForRead(value: unknown): TaskVisibility {
    const sanitized = this.toSanitizedTaskVisibility(value);
    return sanitized ?? TASK_VISIBILITY_SHARED;
  }

  private toSanitizedCourseLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private parseBooleanQuery(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  private toLearningTrajectoryStudentPublic(
    studentId: string,
    student: LearningTrajectoryStudentLean | undefined,
  ): LearningTrajectoryStudentPublic {
    const name =
      typeof student?.name === 'string' && student.name.trim()
        ? student.name.trim()
        : null;
    const studentNo =
      typeof student?.studentNo === 'string' && student.studentNo.trim()
        ? student.studentNo.trim()
        : null;
    const email =
      typeof student?.email === 'string' && student.email.trim()
        ? student.email.trim()
        : null;
    return {
      id: studentId,
      name,
      studentNo,
      email,
    };
  }

  private toClassroomTaskSubmissionListItem(
    submission: ClassroomTaskSubmissionLean,
    student: SubmissionStudentLean | undefined,
    aiFeedbackStatus: AiFeedbackStatus,
    feedbackCount: number,
    classroomTaskId: Types.ObjectId,
  ): ClassroomTaskSubmissionListItem {
    return {
      id: submission._id.toString(),
      taskId: submission.taskId.toString(),
      classroomTaskId: (
        submission.classroomTaskId ?? classroomTaskId
      ).toString(),
      student: {
        id: submission.studentId.toString(),
        email: student?.email ?? '',
        roles: student?.roles ?? [],
        status: student?.status ?? '',
        name: student?.name ?? null,
        studentNo: student?.studentNo ?? null,
        employeeNo: student?.employeeNo ?? null,
      },
      attemptNo: submission.attemptNo,
      submittedAt:
        submission.submittedAt ?? submission.createdAt ?? new Date(0),
      isLate: submission.isLate ?? false,
      lateBySeconds: submission.lateBySeconds ?? 0,
      status: submission.status,
      aiFeedbackStatus,
      feedbackCount,
    };
  }

  private async getFeedbackCountsBySubmissionIds(ids: Types.ObjectId[]) {
    const countMap = new Map<string, number>();
    if (ids.length === 0) {
      return countMap;
    }

    const rows = await this.feedbackModel
      .aggregate<FeedbackCountAgg>([
        { $match: { submissionId: { $in: ids } } },
        { $group: { _id: '$submissionId', count: { $sum: 1 } } },
      ])
      .exec();
    for (const row of rows) {
      countMap.set(row._id.toString(), row.count);
    }
    return countMap;
  }

  private async getCompletionFeedbacksBySubmissionId(id: Types.ObjectId) {
    return this.feedbackModel
      .find({
        submissionId: id,
        source: { $in: [FeedbackSource.Teacher, FeedbackSource.AI] },
      })
      .lean<CompletionFeedback[]>()
      .exec();
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

  private toPublishableTaskTemplateItemResponse(
    task: TaskWithMeta,
    publisher?: PublisherSummary | null,
  ) {
    const createdById = task.createdBy.toString();
    return {
      id: task._id.toString(),
      title: task.title,
      description: task.description,
      knowledgeModule: task.knowledgeModule,
      courseLabel: this.toSanitizedCourseLabel(task.courseLabel),
      visibility: this.toTaskVisibilityForRead(task.visibility),
      stage: task.stage,
      difficulty: task.difficulty,
      status: task.status,
      createdBy: createdById,
      createdById,
      publisher: publisher ?? this.toPublisherSummary(task.createdBy, null),
      createdAt: task.createdAt ?? new Date(0),
      updatedAt: task.updatedAt ?? new Date(0),
      publishedAt: task.publishedAt,
    } as PublishableTaskTemplateItemResponseDto;
  }

  private toClassroomTaskStatusForRead(
    status: ClassroomTask['status'] | undefined | null,
  ): ClassroomTaskStatus {
    if (status === CLASSROOM_TASK_STATUS_CLOSED) {
      return CLASSROOM_TASK_STATUS_CLOSED;
    }
    if (status === CLASSROOM_TASK_STATUS_RECALLED) {
      return CLASSROOM_TASK_STATUS_RECALLED;
    }
    return CLASSROOM_TASK_STATUS_ACTIVE;
  }

  private toClassroomTaskResponse(
    classroomTask: ClassroomTaskWithMeta,
    task: Task,
    taskPublisher?: PublisherSummary | null,
  ) {
    return {
      id: classroomTask._id.toString(),
      classroomId: classroomTask.classroomId.toString(),
      taskId: classroomTask.taskId.toString(),
      status: this.toClassroomTaskStatusForRead(classroomTask.status),
      publishedAt: classroomTask.publishedAt,
      dueAt: classroomTask.dueAt,
      settings: classroomTask.settings,
      createdBy: classroomTask.createdBy.toString(),
      createdAt: classroomTask.createdAt ?? new Date(0),
      updatedAt: classroomTask.updatedAt ?? new Date(0),
      taskPublisher:
        taskPublisher ?? this.toPublisherSummary(task.createdBy, null),
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

  private async getPublisherSummaryById(
    userId: Types.ObjectId | string | null | undefined,
  ) {
    const publisherMap = await this.getPublisherSummaryMap([userId]);
    return this.getPublisherSummaryFromMap(userId, publisherMap);
  }

  private async getPublisherSummaryMap(
    userIds: Array<Types.ObjectId | string | null | undefined>,
  ) {
    const idStrings = Array.from(
      new Set(
        userIds
          .map((userId) => this.normalizeObjectId(userId))
          .filter((userId): userId is string => Boolean(userId)),
      ),
    );
    if (idStrings.length === 0) {
      return new Map<string, PublisherSummary>();
    }

    const users = await this.userModel
      .find({ _id: { $in: idStrings.map((id) => new Types.ObjectId(id)) } })
      .select('_id name')
      .lean<PublisherUserLean[]>()
      .exec();
    const publisherMap = new Map<string, PublisherSummary>();
    for (const user of users) {
      const summary = this.toPublisherSummary(user._id, user);
      if (summary) {
        publisherMap.set(summary.id, summary);
      }
    }
    return publisherMap;
  }

  private getPublisherSummaryFromMap(
    userId: Types.ObjectId | string | null | undefined,
    publisherMap: Map<string, PublisherSummary>,
  ) {
    const id = this.normalizeObjectId(userId);
    if (!id) {
      return null;
    }
    return publisherMap.get(id) ?? { id };
  }

  private toPublisherSummary(
    userId: Types.ObjectId | string | null | undefined,
    user: PublisherUserLean | null | undefined,
  ): PublisherSummary | null {
    const id = this.normalizeObjectId(user?._id ?? userId);
    if (!id) {
      return null;
    }
    const name = this.toOptionalName(user?.name);
    return name ? { id, name } : { id };
  }

  private normalizeObjectId(value: unknown) {
    if (value instanceof Types.ObjectId) {
      return value.toString();
    }
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value).toString();
    }
    return null;
  }

  private toOptionalName(value: unknown) {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
