import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiContextReaderService } from '../ai-context/ai-context-reader.service';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiFeedbackMode,
  MISSING_TASK_SNAPSHOT_MESSAGE,
} from '../../classrooms/classroom-tasks/classroom-task-content';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../../classrooms/enrollments/schemas/enrollment.schema';
import { teacherSubmissionScope } from './teacher-submission-scope';
import { Task, TaskStatus } from '../schemas/task.schema';
import { Submission, SubmissionStatus } from '../schemas/submission.schema';
import { Feedback, FeedbackSource } from '../schemas/feedback.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Classroom,
  ClassroomStatus,
} from '../../classrooms/schemas/classroom.schema';
import { User } from '../../users/schemas/user.schema';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { QueryTaskDto } from '../dto/query-task.dto';
import { CreateSubmissionDto } from '../dto/create-submission.dto';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';
import { UpdateFeedbackDto } from '../dto/update-feedback.dto';
import { RequestAiFeedbackDto } from '../dto/request-ai-feedback.dto';
import { TaskResponseDto } from '../dto/task-response.dto';
import { SubmissionResponseDto } from '../dto/submission-response.dto';
import { FeedbackResponseDto } from '../dto/feedback-response.dto';
import { SubmissionDetailResponseDto } from '../dto/submission-detail-response.dto';
import { TASK_COURSE_LABEL_UNCLASSIFIED } from '../task-course-labels.constants';
import {
  TASK_TEMPLATE_SCOPE_ALL,
  TASK_TEMPLATE_SCOPE_DEFAULT,
  TASK_TEMPLATE_SCOPE_MINE,
  TASK_TEMPLATE_SCOPE_SHARED,
  TASK_VISIBILITY_PRIVATE,
  TASK_VISIBILITY_SHARED,
} from '../task-template-visibility.constants';
import type {
  TaskTemplateScope,
  TaskVisibility,
} from '../task-template-visibility.constants';
import {
  buildAiReviewSummary,
  AiReviewSummary,
} from '../ai-feedback/lib/ai-review-summary';
import { AiFeedbackJobService } from '../ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackJobStatus } from '../ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';
import {
  cleanFeedbackTag,
  getFeedbackTags,
} from '../ai-feedback/lib/feedback-normalizer';
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  hasAnyRole,
} from '../../users/schemas/user-roles.constants';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { CLASSROOM_TASK_STATUS_ACTIVE } from '../../classrooms/classroom-tasks/classroom-task-status.constants';

type TagStat = {
  _id: string;
  count: number;
};
type TaskWithMeta = Task & WithId & WithTimestamps;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type FeedbackWithMeta = Feedback & WithId & WithTimestamps;
type ClassroomTaskWithClassroom = ClassroomTask & WithId;
type ClassroomTaskDeadlineConfig = Pick<
  ClassroomTask,
  'classroomId' | 'taskId' | 'status' | 'dueAt' | 'settings' | 'taskSnapshot'
> &
  WithId;
type SubmissionDetailTaskLean = Pick<Task, 'title' | 'createdBy'> & WithId;
type SubmissionDetailStudentLean = Pick<User, 'name'> & WithId;
type SubmissionDetailClassroomLean = Pick<Classroom, 'teacherId'> & WithId;
type ParticipationClassroomLean = Pick<Classroom, 'status'> & WithId;
type PublisherSummary = { id: string; name?: string };
type PublisherUserLean = Pick<User, 'name'> & WithId;
type IdOnly = WithId;
type SubmissionCooldownSource = Pick<Submission, 'submittedAt'> &
  WithId &
  WithTimestamps;

@Injectable()
export class LearningTasksService {
  private static readonly TOP_TAGS_LIMIT = 5;
  private static readonly CREATE_ARCHIVED_TASK_TEMPLATE_MESSAGE =
    'Task templates cannot be created as archived';
  private static readonly TASK_TEMPLATE_STATUS_ACTION_REQUIRED_MESSAGE =
    'Task template status must be changed through lifecycle actions';
  private static readonly ARCHIVED_TASK_TEMPLATE_PUBLISH_MESSAGE =
    'Archived task templates cannot be published';
  private static readonly ONLY_PUBLISHED_TASK_TEMPLATE_ARCHIVE_MESSAGE =
    'Only published task templates can be archived';
  private static readonly RESTORE_TASK_TEMPLATE_DISABLED_MESSAGE =
    'Archived task templates cannot be restored to draft; clone as draft instead';
  private static readonly LATE_SUBMISSION_NOT_ALLOWED_CODE =
    'LATE_SUBMISSION_NOT_ALLOWED';
  private static readonly INVALID_FEEDBACK_TAGS_MESSAGE =
    'Invalid tag(s), please select from predefined tags';
  private static readonly FEEDBACK_TAGS = new Set<string>(getFeedbackTags());
  private static readonly SUBMISSION_COOLDOWN_ACTIVE_CODE =
    'SUBMISSION_COOLDOWN_ACTIVE';
  private static readonly DEFAULT_SUBMISSION_COOLDOWN_MS = 300000;
  private readonly logger = new Logger(LearningTasksService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<Feedback>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly aiFeedbackJobService: AiFeedbackJobService,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    private readonly aiContextReader: AiContextReaderService,
  ) {}

  async createTask(dto: CreateTaskDto, userId: string) {
    const now = new Date();
    const courseLabel = this.toSanitizedCourseLabel(dto.courseLabel);
    const visibility =
      this.toSanitizedTaskVisibility(dto.visibility) ?? TASK_VISIBILITY_PRIVATE;
    const initialStatus = dto.status ?? TaskStatus.Draft;
    if (initialStatus === TaskStatus.Archived) {
      throw new BadRequestException(
        LearningTasksService.CREATE_ARCHIVED_TASK_TEMPLATE_MESSAGE,
      );
    }
    await this.aiContextReader.validateForSave(dto.aiContextRefs);
    const task = await this.taskModel.create({
      ...dto,
      courseLabel,
      visibility,
      status: initialStatus,
      createdBy: new Types.ObjectId(userId),
      publishedAt: initialStatus === TaskStatus.Published ? now : undefined,
    });
    return this.toTaskResponse(task as TaskWithMeta);
  }

  async updateTask(id: string, dto: UpdateTaskDto, userId: string) {
    const task = await this.taskModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(userId),
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === TaskStatus.Archived) {
      throw new BadRequestException('Archived tasks cannot be updated');
    }
    if (dto.status !== undefined && dto.status !== task.status) {
      throw new BadRequestException(
        LearningTasksService.TASK_TEMPLATE_STATUS_ACTION_REQUIRED_MESSAGE,
      );
    }
    await this.aiContextReader.validateForSave(
      dto.aiContextRefs === undefined ? task.aiContextRefs : dto.aiContextRefs,
    );
    if (dto.aiContextRefs !== undefined) {
      task.aiContextRefs = dto.aiContextRefs;
    }
    const hasCourseLabel = 'courseLabel' in dto;
    const nextVisibility = this.toSanitizedTaskVisibility(dto.visibility);
    const hasVisibility = nextVisibility !== undefined;
    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.knowledgeModule !== undefined) {
      task.knowledgeModule = dto.knowledgeModule;
    }
    if (dto.difficulty !== undefined) {
      task.difficulty = dto.difficulty;
    }
    if (dto.rubric !== undefined) {
      task.rubric = dto.rubric;
    }
    if (hasCourseLabel) {
      task.courseLabel = this.toSanitizedCourseLabel(dto.courseLabel);
    }
    if (hasVisibility) {
      task.visibility = nextVisibility;
    }
    await task.save();
    return this.toTaskResponse(task as TaskWithMeta);
  }

  async publishTask(id: string, userId: string) {
    const task = await this.taskModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(userId),
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === TaskStatus.Archived) {
      throw new BadRequestException(
        LearningTasksService.ARCHIVED_TASK_TEMPLATE_PUBLISH_MESSAGE,
      );
    }
    if (task.status === TaskStatus.Published) {
      return this.toTaskResponse(task as TaskWithMeta);
    }
    if (task.status !== TaskStatus.Draft) {
      throw new BadRequestException(
        'Only draft task templates can be published',
      );
    }
    await this.aiContextReader.validateForSave(task.aiContextRefs);
    task.status = TaskStatus.Published;
    task.publishedAt = new Date();
    await task.save();
    return this.toTaskResponse(task as TaskWithMeta);
  }

  async archiveTask(id: string, teacherId: string) {
    const task = await this.taskModel.findById(id).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== teacherId) {
      throw new ForbiddenException('Not allowed to archive task');
    }
    if (task.status !== TaskStatus.Published) {
      throw new BadRequestException(
        LearningTasksService.ONLY_PUBLISHED_TASK_TEMPLATE_ARCHIVE_MESSAGE,
      );
    }
    task.status = TaskStatus.Archived;
    await task.save();
    return this.toTaskResponse(task as TaskWithMeta);
  }

  async restoreTask(id: string, userId: string) {
    const task = await this.taskModel.findById(id).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to restore task');
    }
    throw new BadRequestException(
      LearningTasksService.RESTORE_TASK_TEMPLATE_DISABLED_MESSAGE,
    );
  }

  async listTasks(query: QueryTaskDto, userId: string) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const userObjectId = new Types.ObjectId(userId);
    const scope = this.resolveTaskTemplateScope(query.scope);
    const legacyCreatedBy = query.createdBy?.trim();
    const andFilters: Record<string, unknown>[] = [];
    const baseFilter: Record<string, unknown> = {};
    if (query.status) {
      baseFilter.status = query.status;
    }
    if (query.knowledgeModule) {
      baseFilter.knowledgeModule = query.knowledgeModule;
    }
    if (query.courseLabel) {
      if (query.courseLabel === TASK_COURSE_LABEL_UNCLASSIFIED) {
        andFilters.push({
          $or: [
            { courseLabel: TASK_COURSE_LABEL_UNCLASSIFIED },
            { courseLabel: { $exists: false } },
            { courseLabel: null },
            { courseLabel: '' },
          ],
        });
      } else {
        baseFilter.courseLabel = query.courseLabel;
      }
    }
    if (scope === TASK_TEMPLATE_SCOPE_MINE) {
      if (legacyCreatedBy && legacyCreatedBy !== userId) {
        this.logger.debug(
          `Ignoring createdBy filter outside current teacher scope: requested=${legacyCreatedBy}, current=${userId}`,
        );
      }
      // createdBy remains for legacy query compatibility, but mine scope is always current teacher.
      baseFilter.createdBy = userObjectId;
    } else if (scope === TASK_TEMPLATE_SCOPE_SHARED) {
      andFilters.push({ $or: this.getSharedVisibilityConditions() });
    } else if (scope === TASK_TEMPLATE_SCOPE_ALL) {
      andFilters.push({
        $or: [
          { createdBy: userObjectId },
          ...this.getSharedVisibilityConditions(),
        ],
      });
    }

    if (Object.keys(baseFilter).length > 0) {
      andFilters.unshift(baseFilter);
    }
    const filter =
      andFilters.length === 0
        ? {}
        : andFilters.length === 1
          ? andFilters[0]
          : { $and: andFilters };

    const [items, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<TaskWithMeta[]>()
        .exec(),
      this.taskModel.countDocuments(filter),
    ]);

    const publisherMap = await this.getPublisherSummaryMap(
      items.map((task) => task.createdBy),
    );

    return {
      items: items.map((task) =>
        this.toTaskResponse(
          task,
          this.getPublisherSummaryFromMap(task.createdBy, publisherMap),
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async getTask(id: string, userId: string) {
    const task = await this.taskModel.findById(id).lean<TaskWithMeta>().exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const isOwner = task.createdBy.toString() === userId;
    if (!isOwner && !this.isTaskSharedVisibility(task.visibility)) {
      throw new NotFoundException('Task not found');
    }
    const publisher = await this.getPublisherSummaryById(task.createdBy);
    return this.toTaskResponse(task, publisher);
  }

  createSubmission(taskId: string, dto: CreateSubmissionDto, userId: string) {
    void taskId;
    void dto;
    void userId;
    throw new ConflictException('请从班级任务入口提交。');
  }

  async createSubmissionForClassroomTask(
    taskId: string,
    classroomTaskId: string,
    dto: CreateSubmissionDto,
    userId: string,
  ) {
    return this.createSubmissionInternal(taskId, dto, userId, classroomTaskId);
  }

  async requestAiFeedback(
    submissionId: string,
    user: { id: string; roles?: string[] },
    dto: RequestAiFeedbackDto,
  ) {
    const submission = await this.submissionModel
      .findById(submissionId)
      .lean<SubmissionWithMeta>()
      .exec();
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    await this.ensureCanRequestAiFeedback(submission, user);
    const ensured =
      await this.aiFeedbackJobService.ensureJobForSubmission(submission);

    if (dto.reason) {
      this.logger.debug(
        `Manual AI feedback request accepted: submissionId=${submission._id.toString()}, userId=${user.id}, reason=${dto.reason}`,
      );
    }

    return {
      submissionId: submission._id.toString(),
      jobId: ensured.jobId,
      status: ensured.status,
      aiFeedbackStatus: this.toAiFeedbackStatus(ensured.status),
    };
  }

  async listMySubmissions(taskId: string, userId: string) {
    const task = await this.taskModel.findById(taskId).select('_id').lean();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const submissions = await this.submissionModel
      .find({
        taskId: new Types.ObjectId(taskId),
        studentId: new Types.ObjectId(userId),
      })
      .sort({ attemptNo: 1 })
      .lean<SubmissionWithMeta[]>()
      .exec();
    const statusMap =
      await this.aiFeedbackJobService.getStatusMapBySubmissionIds(
        submissions.map((submission) => submission._id),
      );
    return submissions.map((submission) =>
      this.toSubmissionResponse(
        submission,
        statusMap.get(submission._id.toString()) ??
          AiFeedbackStatus.NotRequested,
      ),
    );
  }

  async listTaskSubmissions(
    taskId: string,
    userId: string,
    page = 1,
    limit = 20,
  ) {
    const task = await this.taskModel
      .findById(taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to view submissions');
    }

    const safeLimit = Math.min(limit, 100);
    const filter = await teacherSubmissionScope(
      taskId,
      userId,
      this.classroomModel,
      this.classroomTaskModel,
    );
    const [items, total] = await Promise.all([
      this.submissionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * safeLimit)
        .limit(safeLimit)
        .lean<SubmissionWithMeta[]>()
        .exec(),
      this.submissionModel.countDocuments(filter),
    ]);
    const statusMap =
      await this.aiFeedbackJobService.getStatusMapBySubmissionIds(
        items.map((submission) => submission._id),
      );

    return {
      items: items.map((submission) =>
        this.toSubmissionResponse(
          submission,
          statusMap.get(submission._id.toString()) ??
            AiFeedbackStatus.NotRequested,
        ),
      ),
      total,
      page,
      limit: safeLimit,
    };
  }

  async createFeedback(
    submissionId: string,
    dto: CreateFeedbackDto,
    userId: string,
  ) {
    const submission = await this.submissionModel
      .findById(submissionId)
      .lean<SubmissionWithMeta>()
      .exec();
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    const { task, classroomTask } =
      await this.loadSubmissionAuthContext(submission);
    await this.ensureTeacherCanManageSubmission(
      submission,
      task,
      classroomTask,
      userId,
      'Not allowed to add feedback',
    );

    if (dto.source !== FeedbackSource.Teacher) {
      throw new BadRequestException('Only TEACHER feedback can be created');
    }
    const normalizedTags = this.normalizeTeacherFeedbackTags(dto.tags);
    const feedback = await this.feedbackModel.create({
      submissionId: new Types.ObjectId(submissionId),
      ...dto,
      createdBy: new Types.ObjectId(userId),
      tags: normalizedTags,
    });
    return this.toFeedbackResponse(feedback as FeedbackWithMeta);
  }

  async updateFeedback(
    submissionId: string,
    feedbackId: string,
    dto: UpdateFeedbackDto,
    userId: string,
  ) {
    if (!this.hasFeedbackUpdateFields(dto)) {
      throw new BadRequestException('At least one feedback field is required');
    }
    if (dto.message !== undefined && dto.message.length === 0) {
      throw new BadRequestException('message should not be empty');
    }

    const submission = await this.submissionModel
      .findById(submissionId)
      .lean<SubmissionWithMeta>()
      .exec();
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const feedback = await this.feedbackModel.findById(feedbackId).exec();
    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }
    if (feedback.submissionId.toString() !== submissionId) {
      throw new NotFoundException('Feedback not found');
    }

    const { task, classroomTask } =
      await this.loadSubmissionAuthContext(submission);
    await this.ensureTeacherCanManageSubmission(
      submission,
      task,
      classroomTask,
      userId,
      'Not allowed to update feedback',
    );

    if (feedback.source !== FeedbackSource.Teacher) {
      throw new ForbiddenException('Only teacher feedback can be updated');
    }
    if (feedback.createdBy && feedback.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to update feedback');
    }

    if (dto.type !== undefined) {
      feedback.type = dto.type;
    }
    if (dto.severity !== undefined) {
      feedback.severity = dto.severity;
    }
    if (dto.message !== undefined) {
      feedback.message = dto.message;
    }
    if (dto.suggestion !== undefined) {
      feedback.suggestion = dto.suggestion;
    }
    if (dto.tags !== undefined) {
      feedback.tags = this.normalizeTeacherFeedbackTags(dto.tags);
    }
    if (dto.scoreHint !== undefined) {
      feedback.scoreHint = dto.scoreHint;
    }
    if (!feedback.createdBy) {
      feedback.createdBy = new Types.ObjectId(userId);
    }

    await feedback.save();
    return this.toFeedbackResponse(feedback as FeedbackWithMeta);
  }

  async listFeedback(submissionId: string, userId: string) {
    const submission = await this.submissionModel
      .findById(submissionId)
      .lean<SubmissionWithMeta>()
      .exec();
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    const { task, classroomTask } =
      await this.loadSubmissionAuthContext(submission);
    const isOwner = submission.studentId.toString() === userId;
    if (!isOwner) {
      await this.ensureTeacherCanManageSubmission(
        submission,
        task,
        classroomTask,
        userId,
        'Not allowed to view feedback',
      );
    }

    const feedback = await this.feedbackModel
      .find({ submissionId: new Types.ObjectId(submissionId) })
      .sort({ createdAt: 1 })
      .lean<FeedbackWithMeta[]>()
      .exec();

    return feedback.map((item) => this.toFeedbackResponse(item));
  }

  async getSubmissionDetail(
    submissionId: string,
    user: { id: string; roles?: string[] },
  ): Promise<SubmissionDetailResponseDto> {
    const submission = await this.submissionModel
      .findById(submissionId)
      .lean<SubmissionWithMeta>()
      .exec();
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const [task, student, classroomTask] = await Promise.all([
      this.taskModel
        .findById(submission.taskId)
        .select('_id title createdBy')
        .lean<SubmissionDetailTaskLean>()
        .exec(),
      this.userModel
        .findById(submission.studentId)
        .select('_id name')
        .lean<SubmissionDetailStudentLean>()
        .exec(),
      submission.classroomTaskId
        ? this.classroomTaskModel
            .findById(submission.classroomTaskId)
            .select('_id classroomId taskId taskSnapshot settings status')
            .lean<ClassroomTaskWithClassroom>()
            .exec()
        : Promise.resolve(null),
    ]);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.ensureCanViewSubmissionDetail(
      submission,
      task,
      classroomTask,
      user,
    );

    const job = await this.aiFeedbackJobService.getReviewJob(submission._id);
    const reason = await this.aiRequestBlockReason(submission, user);
    const worker = this.configService.get<boolean | string>(
      'AI_FEEDBACK_WORKER_ENABLED',
    );
    const review = buildAiReviewSummary(
      job,
      reason,
      worker === true || worker === 'true',
    );
    return this.toSubmissionDetailResponse(
      submission,
      task,
      classroomTask,
      student ?? null,
      job ? this.toAiFeedbackStatus(job.status) : AiFeedbackStatus.NotRequested,
      review,
    );
  }

  async getStats(taskId: string, userId: string) {
    const task = await this.taskModel
      .findById(taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to view stats');
    }

    const filter = await teacherSubmissionScope(
      taskId,
      userId,
      this.classroomModel,
      this.classroomTaskModel,
    );
    const [submissionsCount, distinctStudents] = await Promise.all([
      this.submissionModel.countDocuments(filter),
      this.submissionModel.distinct('studentId', filter),
    ]);

    const submissionIds: IdOnly[] = await this.submissionModel
      .find(filter)
      .select('_id')
      .lean()
      .exec();

    let topTags: string[] = [];
    if (submissionIds.length > 0) {
      const ids = submissionIds.map((item) => item._id);
      const tagStats = await this.feedbackModel.aggregate<TagStat>([
        { $match: { submissionId: { $in: ids } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: LearningTasksService.TOP_TAGS_LIMIT },
      ]);
      topTags = tagStats.map((tag) => tag._id);
    }

    return {
      submissionsCount,
      distinctStudentsCount: distinctStudents.length,
      topTags,
    };
  }

  private toTaskResponse(
    task: TaskWithMeta,
    publisher?: PublisherSummary | null,
  ) {
    return {
      id: task._id.toString(),
      title: task.title,
      description: task.description,
      knowledgeModule: task.knowledgeModule,
      courseLabel: this.toSanitizedCourseLabel(task.courseLabel),
      visibility: this.toTaskVisibilityForRead(task.visibility),
      difficulty: task.difficulty,
      rubric: task.rubric,
      aiContextRefs: task.aiContextRefs?.map((ref) => ({
        archivePath: ref.archivePath,
        entryPaths: [...ref.entryPaths],
      })),
      status: task.status,
      createdBy: task.createdBy.toString(),
      publisher: publisher ?? this.toPublisherSummary(task.createdBy, null),
      createdAt: task.createdAt ?? new Date(0),
      updatedAt: task.updatedAt ?? new Date(0),
      publishedAt: task.publishedAt,
    } as TaskResponseDto;
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

  private resolveTaskTemplateScope(scope: unknown): TaskTemplateScope {
    if (scope === TASK_TEMPLATE_SCOPE_SHARED) {
      return TASK_TEMPLATE_SCOPE_SHARED;
    }
    if (scope === TASK_TEMPLATE_SCOPE_ALL) {
      return TASK_TEMPLATE_SCOPE_ALL;
    }
    return TASK_TEMPLATE_SCOPE_DEFAULT;
  }

  private getSharedVisibilityConditions(): Record<string, unknown>[] {
    return [
      { visibility: TASK_VISIBILITY_SHARED },
      { visibility: { $exists: false } },
      { visibility: null },
      { visibility: '' },
    ];
  }

  private isTaskSharedVisibility(visibility: unknown): boolean {
    return this.toTaskVisibilityForRead(visibility) === TASK_VISIBILITY_SHARED;
  }

  private toTaskVisibilityForRead(visibility: unknown): TaskVisibility {
    const sanitized = this.toSanitizedTaskVisibility(visibility);
    return sanitized ?? TASK_VISIBILITY_SHARED;
  }

  private toSubmissionResponse(
    submission: SubmissionWithMeta,
    aiFeedbackStatus: AiFeedbackStatus = AiFeedbackStatus.NotRequested,
  ) {
    return {
      id: submission._id.toString(),
      taskId: submission.taskId.toString(),
      classroomTaskId: submission.classroomTaskId
        ? submission.classroomTaskId.toString()
        : undefined,
      studentId: submission.studentId.toString(),
      attemptNo: submission.attemptNo,
      content: {
        codeText: submission.content.codeText,
        language: submission.content.language,
        submissionNote: submission.content?.submissionNote ?? '',
      },
      meta: submission.meta
        ? { aiUsageDeclaration: submission.meta.aiUsageDeclaration }
        : undefined,
      status: submission.status,
      aiFeedbackStatus,
      submittedAt:
        submission.submittedAt ?? submission.createdAt ?? new Date(0),
      isLate: submission.isLate ?? false,
      lateBySeconds: submission.lateBySeconds ?? 0,
      createdAt: submission.createdAt ?? new Date(0),
      updatedAt: submission.updatedAt ?? new Date(0),
    } as SubmissionResponseDto;
  }

  private toSubmissionDetailResponse(
    submission: SubmissionWithMeta,
    task: SubmissionDetailTaskLean,
    classroomTask: ClassroomTaskWithClassroom | null,
    student: SubmissionDetailStudentLean | null,
    aiFeedbackStatus: AiFeedbackStatus,
    aiReview: AiReviewSummary,
  ): SubmissionDetailResponseDto {
    const language = submission.content?.language ?? null;
    return {
      id: submission._id.toString(),
      taskId: submission.taskId.toString(),
      classroomTaskId: submission.classroomTaskId
        ? submission.classroomTaskId.toString()
        : null,
      studentId: submission.studentId.toString(),
      studentName: student?.name ?? null,
      taskTitle: classroomTask?.taskSnapshot?.title ?? task.title ?? null,
      taskSnapshotAvailable: Boolean(classroomTask?.taskSnapshot),
      meta: submission.meta
        ? { aiUsageDeclaration: submission.meta.aiUsageDeclaration }
        : undefined,
      language,
      content: {
        language,
        codeText: submission.content?.codeText ?? null,
        submissionNote: submission.content?.submissionNote ?? '',
      },
      submittedAt: submission.submittedAt ?? submission.createdAt ?? null,
      attemptNo: submission.attemptNo ?? null,
      isLate: submission.isLate ?? false,
      lateBySeconds: submission.lateBySeconds ?? 0,
      aiFeedbackStatus,
      aiReview,
    };
  }

  private async createSubmissionInternal(
    taskId: string,
    dto: CreateSubmissionDto,
    userId: string,
    classroomTaskId?: string,
  ) {
    const task = await this.taskModel
      .findById(taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const taskObjectId = new Types.ObjectId(taskId);
    const studentObjectId = new Types.ObjectId(userId);
    const classroomTaskObjectId = classroomTaskId
      ? new Types.ObjectId(classroomTaskId)
      : undefined;
    const classroomTask = classroomTaskObjectId
      ? await this.classroomTaskModel
          .findById(classroomTaskObjectId)
          .select('_id classroomId taskId status dueAt settings taskSnapshot')
          .lean<ClassroomTaskDeadlineConfig>()
          .exec()
      : null;
    if (classroomTaskObjectId && !classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }
    if (classroomTask) {
      if (classroomTask.taskId.toString() !== taskObjectId.toString()) {
        throw new ConflictException('Classroom task does not match task');
      }
      if (!classroomTask.taskSnapshot) {
        throw new ConflictException(MISSING_TASK_SNAPSHOT_MESSAGE);
      }
      await this.ensureStudentParticipationContextIsActive(
        classroomTask,
        'submit',
      );
    } else if (task.status !== TaskStatus.Published) {
      throw new BadRequestException('Task is not published');
    }
    const submittedAt = new Date();
    const dueAt = classroomTask?.dueAt ?? undefined;
    const allowLate = classroomTask?.settings?.allowLate !== false;
    const isLate = !!dueAt && submittedAt.getTime() > dueAt.getTime();
    const lateBySeconds =
      dueAt && isLate
        ? Math.floor((submittedAt.getTime() - dueAt.getTime()) / 1000)
        : 0;
    if (isLate && !allowLate) {
      throw new ForbiddenException({
        statusCode: 403,
        code: LearningTasksService.LATE_SUBMISSION_NOT_ALLOWED_CODE,
        message: 'Late submission is not allowed for this classroom task',
      });
    }

    await this.ensureSubmissionCooldownNotHit(
      studentObjectId,
      classroomTaskObjectId,
      submittedAt,
    );
    const attemptScopeFilter = classroomTaskObjectId
      ? {
          classroomTaskId: classroomTaskObjectId,
          studentId: studentObjectId,
        }
      : {
          taskId: taskObjectId,
          studentId: studentObjectId,
        };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lastSubmission = await this.submissionModel
        .findOne(attemptScopeFilter)
        .sort({ attemptNo: -1 })
        .select('attemptNo')
        .lean()
        .exec();

      const attemptNo = (lastSubmission?.attemptNo ?? 0) + 1;

      try {
        const submission = await this.submissionModel.create({
          taskId: taskObjectId,
          classroomTaskId: classroomTaskObjectId,
          studentId: studentObjectId,
          attemptNo,
          submittedAt,
          isLate,
          lateBySeconds,
          content: dto.content,
          meta: dto.meta,
          status: SubmissionStatus.Submitted,
        });

        const shouldEnqueue = this.shouldAutoEnqueue(
          submission.attemptNo,
          classroomTask?.settings?.aiFeedbackMode,
        );
        if (shouldEnqueue) {
          await this.aiFeedbackJobService.enqueue(submission);
          return this.toSubmissionResponse(
            submission as SubmissionWithMeta,
            AiFeedbackStatus.Pending,
          );
        }

        return this.toSubmissionResponse(
          submission as SubmissionWithMeta,
          AiFeedbackStatus.NotRequested,
        );
      } catch (error) {
        const mongoError = error as { code?: number };
        if (mongoError.code !== 11000 || attempt === 2) {
          throw error;
        }
      }
    }

    throw new BadRequestException('Unable to allocate attempt number');
  }

  private normalizeTeacherFeedbackTags(tags?: string[]) {
    if (!tags || tags.length === 0) {
      return ['other'];
    }

    const normalized = new Set<string>();
    for (const tag of tags) {
      const cleaned = cleanFeedbackTag(tag);
      if (!cleaned) {
        continue;
      }
      if (!LearningTasksService.FEEDBACK_TAGS.has(cleaned)) {
        throw new BadRequestException(
          LearningTasksService.INVALID_FEEDBACK_TAGS_MESSAGE,
        );
      }
      normalized.add(cleaned);
    }

    return normalized.size > 0 ? Array.from(normalized) : ['other'];
  }

  private shouldAutoEnqueue(
    attemptNo: number,
    mode: AiFeedbackMode | undefined,
  ) {
    const autoOnSubmit = this.configService.get<unknown>(
      'AI_FEEDBACK_AUTO_ON_SUBMIT',
    );
    return (
      mode === AiFeedbackMode.FirstSubmissionAuto &&
      attemptNo === 1 &&
      autoOnSubmit !== false &&
      autoOnSubmit !== 'false'
    );
  }

  private getSubmissionCooldownMs() {
    const value = this.configService.get<unknown>(
      'LEARNING_TASK_SUBMISSION_COOLDOWN_MS',
    );
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value < 0) {
        return LearningTasksService.DEFAULT_SUBMISSION_COOLDOWN_MS;
      }
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return LearningTasksService.DEFAULT_SUBMISSION_COOLDOWN_MS;
      }
      return Math.floor(parsed);
    }
    return LearningTasksService.DEFAULT_SUBMISSION_COOLDOWN_MS;
  }

  private async ensureSubmissionCooldownNotHit(
    studentId: Types.ObjectId,
    classroomTaskId: Types.ObjectId | undefined,
    submittedAt: Date,
  ) {
    if (!classroomTaskId) {
      return;
    }

    const cooldownMs = this.getSubmissionCooldownMs();
    if (cooldownMs <= 0) {
      return;
    }

    const latestSubmission = await this.submissionModel
      .findOne({
        studentId,
        classroomTaskId,
      })
      .sort({ submittedAt: -1, _id: -1 })
      .select('_id submittedAt createdAt')
      .lean<SubmissionCooldownSource>()
      .exec();
    if (!latestSubmission) {
      return;
    }

    const latestSubmittedAt =
      latestSubmission.submittedAt ?? latestSubmission.createdAt;
    if (!latestSubmittedAt) {
      return;
    }

    const elapsedMs = submittedAt.getTime() - latestSubmittedAt.getTime();
    if (elapsedMs >= cooldownMs) {
      return;
    }

    const retryAfterMs = Math.max(1, cooldownMs - elapsedMs);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    const cooldownSeconds = Math.ceil(cooldownMs / 1000);
    throw new HttpException(
      {
        statusCode: 429,
        code: LearningTasksService.SUBMISSION_COOLDOWN_ACTIVE_CODE,
        message: `提交过于频繁。当前设置的提交冷却时间为 ${cooldownSeconds} 秒，请约 ${retryAfterSeconds} 秒后再试。`,
        cooldownMs,
        cooldownSeconds,
        retryAfterMs,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async aiRequestBlockReason(
    submission: SubmissionWithMeta,
    user: { id: string; roles?: string[] },
  ): Promise<string | null> {
    try {
      await this.ensureCanRequestAiFeedback(submission, user);
      return null;
    } catch (error) {
      // Only the existing eligibility exceptions are public blocking reasons.
      // Unknown DB/config/programming failures still propagate as server errors.
      if (error instanceof ForbiddenException)
        return '当前用户或课堂 AI 策略不允许申请 AI 反馈。';
      if (error instanceof ConflictException) {
        if (error.message === MISSING_TASK_SNAPSHOT_MESSAGE)
          return MISSING_TASK_SNAPSHOT_MESSAGE;
        if (
          error.message === '班级已归档，不能请求 AI 反馈。' ||
          error.message === '课堂任务已关闭，不能请求 AI 反馈。'
        )
          return error.message;
        return '提交与课堂任务不匹配，不能申请 AI 反馈。';
      }
      if (error instanceof NotFoundException)
        return '关联课堂任务或班级不存在，不能申请 AI 反馈。';
      throw error;
    }
  }

  private async ensureCanRequestAiFeedback(
    submission: SubmissionWithMeta,
    user: { id: string; roles?: string[] },
  ) {
    const teacher = hasAnyRole(user.roles ?? [], TEACHER_ROLES);
    const student = hasAnyRole(user.roles ?? [], STUDENT_ROLES);
    if (!teacher && !(student && submission.studentId.toString() === user.id)) {
      throw new ForbiddenException('Not allowed to request AI feedback');
    }
    if (!submission.classroomTaskId) {
      throw new ConflictException(MISSING_TASK_SNAPSHOT_MESSAGE);
    }
    const classroomTask = await this.classroomTaskModel
      .findById(submission.classroomTaskId)
      .lean<ClassroomTaskDeadlineConfig>()
      .exec();
    if (!classroomTask) throw new NotFoundException('Classroom task not found');
    if (classroomTask.taskId.toString() !== submission.taskId.toString()) {
      throw new ConflictException('Submission does not match classroom task');
    }
    const classroom = await this.classroomModel
      .findById(classroomTask.classroomId)
      .lean()
      .exec();
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (teacher) {
      if (classroom.teacherId.toString() !== user.id)
        throw new ForbiddenException('Not allowed to request AI feedback');
    } else {
      const member = await this.enrollmentModel.exists({
        classroomId: classroomTask.classroomId,
        userId: new Types.ObjectId(user.id),
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      });
      if (!member)
        throw new ForbiddenException('Not allowed to request AI feedback');
      await this.ensureStudentParticipationContextIsActive(
        classroomTask,
        'requestAi',
      );
    }
    if (!classroomTask.taskSnapshot)
      throw new ConflictException(MISSING_TASK_SNAPSHOT_MESSAGE);
    const mode = classroomTask.settings?.aiFeedbackMode;
    if (
      mode === AiFeedbackMode.Disabled ||
      (!teacher &&
        mode !== AiFeedbackMode.Manual &&
        mode !== AiFeedbackMode.FirstSubmissionAuto)
    ) {
      throw new ForbiddenException(
        'Classroom task AI feedback policy forbids this request',
      );
    }
  }

  private async ensureStudentParticipationContextIsActive(
    classroomTask: ClassroomTaskDeadlineConfig,
    operation: 'submit' | 'requestAi',
  ) {
    const classroom = await this.classroomModel
      .findById(classroomTask.classroomId)
      .select('_id status')
      .lean<ParticipationClassroomLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    if (classroom.status !== ClassroomStatus.Active) {
      throw new ConflictException(
        operation === 'submit'
          ? '班级已归档，不能继续提交该任务。'
          : '班级已归档，不能请求 AI 反馈。',
      );
    }
    if (classroomTask.status !== CLASSROOM_TASK_STATUS_ACTIVE) {
      throw new ConflictException(
        operation === 'submit'
          ? '课堂任务已关闭，不能继续提交。'
          : '课堂任务已关闭，不能请求 AI 反馈。',
      );
    }
  }

  private async ensureCanViewSubmissionDetail(
    submission: SubmissionWithMeta,
    task: SubmissionDetailTaskLean,
    classroomTask: ClassroomTaskWithClassroom | null,
    user: { id: string; roles?: string[] },
  ) {
    const roles = user.roles ?? [];
    const isSubmissionOwner = submission.studentId.toString() === user.id;
    if (hasAnyRole(roles, STUDENT_ROLES) && isSubmissionOwner) {
      return;
    }

    if (hasAnyRole(roles, TEACHER_ROLES)) {
      await this.ensureTeacherCanViewSubmissionDetail(
        submission,
        task,
        classroomTask,
        user.id,
      );
      return;
    }

    throw new ForbiddenException('Not allowed to view submission detail');
  }

  private async ensureTeacherCanViewSubmissionDetail(
    submission: SubmissionWithMeta,
    task: SubmissionDetailTaskLean,
    classroomTask: ClassroomTaskWithClassroom | null,
    userId: string,
  ) {
    await this.ensureTeacherCanManageSubmission(
      submission,
      task,
      classroomTask,
      userId,
      'Not allowed to view submission detail',
    );
  }

  private async ensureTeacherCanManageSubmission(
    submission: SubmissionWithMeta,
    task: SubmissionDetailTaskLean,
    classroomTask: ClassroomTaskWithClassroom | null,
    userId: string,
    deniedMessage: string,
  ) {
    if (submission.classroomTaskId) {
      if (!classroomTask) {
        throw new NotFoundException('Classroom task not found');
      }
      const classroom = await this.classroomModel
        .findById(classroomTask.classroomId)
        .select('_id teacherId')
        .lean<SubmissionDetailClassroomLean>()
        .exec();
      if (!classroom) {
        throw new NotFoundException('Classroom not found');
      }
      if (classroom.teacherId.toString() !== userId) {
        throw new ForbiddenException(deniedMessage);
      }
      return;
    }

    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException(deniedMessage);
    }
  }

  private async loadSubmissionAuthContext(submission: SubmissionWithMeta) {
    const [task, classroomTask] = await Promise.all([
      this.taskModel
        .findById(submission.taskId)
        .select('_id title createdBy')
        .lean<SubmissionDetailTaskLean>()
        .exec(),
      submission.classroomTaskId
        ? this.classroomTaskModel
            .findById(submission.classroomTaskId)
            .select('_id classroomId taskId taskSnapshot settings status')
            .lean<ClassroomTaskWithClassroom>()
            .exec()
        : Promise.resolve(null),
    ]);
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return { task, classroomTask };
  }

  private hasFeedbackUpdateFields(dto: UpdateFeedbackDto) {
    return (
      dto.type !== undefined ||
      dto.severity !== undefined ||
      dto.message !== undefined ||
      dto.suggestion !== undefined ||
      dto.tags !== undefined ||
      dto.scoreHint !== undefined
    );
  }

  private toAiFeedbackStatus(status: AiFeedbackJobStatus) {
    const mapped = {
      [AiFeedbackJobStatus.Pending]: AiFeedbackStatus.Pending,
      [AiFeedbackJobStatus.Running]: AiFeedbackStatus.Running,
      [AiFeedbackJobStatus.Succeeded]: AiFeedbackStatus.Succeeded,
      [AiFeedbackJobStatus.Failed]: AiFeedbackStatus.Failed,
      [AiFeedbackJobStatus.Dead]: AiFeedbackStatus.Dead,
    }[status];
    return mapped ?? AiFeedbackStatus.NotRequested;
  }

  private toFeedbackResponse(feedback: FeedbackWithMeta) {
    return {
      id: feedback._id.toString(),
      submissionId: feedback.submissionId.toString(),
      createdBy: feedback.createdBy ? feedback.createdBy.toString() : undefined,
      source: feedback.source,
      type: feedback.type,
      severity: feedback.severity,
      message: feedback.message,
      suggestion: feedback.suggestion,
      tags: feedback.tags,
      scoreHint: feedback.scoreHint,
      createdAt: feedback.createdAt ?? new Date(0),
      updatedAt: feedback.updatedAt ?? new Date(0),
    } as FeedbackResponseDto;
  }

  private toSanitizedCourseLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
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
}
