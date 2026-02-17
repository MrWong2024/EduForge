import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskStatus } from '../schemas/task.schema';
import { Submission, SubmissionStatus } from '../schemas/submission.schema';
import { Feedback } from '../schemas/feedback.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { QueryTaskDto } from '../dto/query-task.dto';
import { CreateSubmissionDto } from '../dto/create-submission.dto';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';
import { RequestAiFeedbackDto } from '../dto/request-ai-feedback.dto';
import { TaskResponseDto } from '../dto/task-response.dto';
import { SubmissionResponseDto } from '../dto/submission-response.dto';
import { FeedbackResponseDto } from '../dto/feedback-response.dto';
import { AiFeedbackJobService } from '../ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackJobStatus } from '../ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  hasAnyRole,
} from '../../users/schemas/user-roles.constants';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type TagStat = {
  _id: string;
  count: number;
};
type TaskWithMeta = Task & WithId & WithTimestamps;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type FeedbackWithMeta = Feedback & WithId & WithTimestamps;
type ClassroomTaskWithClassroom = ClassroomTask & WithId;
type ClassroomTaskDeadlineConfig = Pick<ClassroomTask, 'dueAt' | 'settings'> &
  WithId;
type IdOnly = WithId;

@Injectable()
export class LearningTasksService {
  private static readonly TOP_TAGS_LIMIT = 5;
  private static readonly LATE_SUBMISSION_NOT_ALLOWED_CODE =
    'LATE_SUBMISSION_NOT_ALLOWED';
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
    private readonly aiFeedbackJobService: AiFeedbackJobService,
  ) {}

  async createTask(dto: CreateTaskDto, userId: string) {
    const now = new Date();
    const task = await this.taskModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
      publishedAt: dto.status === TaskStatus.Published ? now : undefined,
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
    Object.assign(task, dto);
    if (dto.status === TaskStatus.Published && !task.publishedAt) {
      task.publishedAt = new Date();
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
      throw new BadRequestException('Archived tasks cannot be published');
    }
    if (task.status !== TaskStatus.Published) {
      task.status = TaskStatus.Published;
      task.publishedAt = new Date();
      await task.save();
    }
    return this.toTaskResponse(task as TaskWithMeta);
  }

  async listTasks(query: QueryTaskDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.knowledgeModule) {
      filter.knowledgeModule = query.knowledgeModule;
    }
    if (query.stage) {
      filter.stage = query.stage;
    }
    if (query.createdBy) {
      filter.createdBy = new Types.ObjectId(query.createdBy);
    }

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

    return {
      items: items.map((task) => this.toTaskResponse(task)),
      total,
      page,
      limit,
    };
  }

  async getTask(id: string) {
    const task = await this.taskModel.findById(id).lean<TaskWithMeta>().exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return this.toTaskResponse(task);
  }

  async createSubmission(
    taskId: string,
    dto: CreateSubmissionDto,
    userId: string,
  ) {
    return this.createSubmissionInternal(taskId, dto, userId);
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
    const filter = { taskId: new Types.ObjectId(taskId) };
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
    const task = await this.taskModel
      .findById(submission.taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to add feedback');
    }

    const feedback = await this.feedbackModel.create({
      submissionId: new Types.ObjectId(submissionId),
      ...dto,
    });
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
    const task = await this.taskModel
      .findById(submission.taskId)
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const isOwner = submission.studentId.toString() === userId;
    const isTeacher = task.createdBy.toString() === userId;
    if (!isOwner && !isTeacher) {
      throw new ForbiddenException('Not allowed to view feedback');
    }

    const feedback = await this.feedbackModel
      .find({ submissionId: new Types.ObjectId(submissionId) })
      .sort({ createdAt: 1 })
      .lean<FeedbackWithMeta[]>()
      .exec();

    return feedback.map((item) => this.toFeedbackResponse(item));
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

    const taskObjectId = new Types.ObjectId(taskId);
    const [submissionsCount, distinctStudents] = await Promise.all([
      this.submissionModel.countDocuments({ taskId: taskObjectId }),
      this.submissionModel.distinct('studentId', { taskId: taskObjectId }),
    ]);

    const submissionIds: IdOnly[] = await this.submissionModel
      .find({ taskId: taskObjectId })
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

  private toTaskResponse(task: TaskWithMeta) {
    return {
      id: task._id.toString(),
      title: task.title,
      description: task.description,
      knowledgeModule: task.knowledgeModule,
      stage: task.stage,
      difficulty: task.difficulty,
      rubric: task.rubric,
      status: task.status,
      createdBy: task.createdBy.toString(),
      createdAt: task.createdAt ?? new Date(0),
      updatedAt: task.updatedAt ?? new Date(0),
      publishedAt: task.publishedAt,
    } as TaskResponseDto;
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
      content: submission.content,
      meta: submission.meta,
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

  private async createSubmissionInternal(
    taskId: string,
    dto: CreateSubmissionDto,
    userId: string,
    classroomTaskId?: string,
  ) {
    const task = await this.taskModel.findById(taskId).lean().exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status !== TaskStatus.Published) {
      throw new BadRequestException('Task is not published');
    }

    const taskObjectId = new Types.ObjectId(taskId);
    const studentObjectId = new Types.ObjectId(userId);
    const classroomTaskObjectId = classroomTaskId
      ? new Types.ObjectId(classroomTaskId)
      : undefined;
    const classroomTask = classroomTaskObjectId
      ? await this.classroomTaskModel
          .findById(classroomTaskObjectId)
          .select('_id dueAt settings')
          .lean<ClassroomTaskDeadlineConfig>()
          .exec()
      : null;
    if (classroomTaskObjectId && !classroomTask) {
      throw new NotFoundException('Classroom task not found');
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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lastSubmission = await this.submissionModel
        .findOne({ taskId: taskObjectId, studentId: studentObjectId })
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

        const shouldEnqueue = this.shouldAutoEnqueue(submission.attemptNo);
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

  private shouldAutoEnqueue(attemptNo: number) {
    const autoOnSubmit =
      this.configService.get<string>('AI_FEEDBACK_AUTO_ON_SUBMIT') !== 'false';
    if (!autoOnSubmit) {
      return false;
    }
    const autoOnFirstAttemptOnly =
      this.configService.get<string>(
        'AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY',
      ) !== 'false';
    if (autoOnFirstAttemptOnly) {
      return attemptNo === 1;
    }
    return true;
  }

  private async ensureCanRequestAiFeedback(
    submission: SubmissionWithMeta,
    user: { id: string; roles?: string[] },
  ) {
    const roles = user.roles ?? [];
    if (hasAnyRole(roles, TEACHER_ROLES)) {
      await this.ensureTeacherCanRequestAiFeedback(submission, user.id);
      return;
    }

    if (
      hasAnyRole(roles, STUDENT_ROLES) &&
      submission.studentId.toString() === user.id
    ) {
      return;
    }

    throw new ForbiddenException('Not allowed to request AI feedback');
  }

  private async ensureTeacherCanRequestAiFeedback(
    submission: SubmissionWithMeta,
    userId: string,
  ) {
    if (submission.classroomTaskId) {
      const classroomTask = await this.classroomTaskModel
        .findById(submission.classroomTaskId)
        .select('_id classroomId')
        .lean<ClassroomTaskWithClassroom>()
        .exec();
      if (!classroomTask) {
        throw new NotFoundException('Classroom task not found');
      }
      const classroom = await this.classroomModel
        .findOne({
          _id: classroomTask.classroomId,
          teacherId: new Types.ObjectId(userId),
        })
        .select('_id')
        .lean()
        .exec();
      if (!classroom) {
        throw new ForbiddenException('Not allowed to request AI feedback');
      }
      return;
    }

    const task = await this.taskModel
      .findById(submission.taskId)
      .select('createdBy')
      .lean<TaskWithMeta>()
      .exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to request AI feedback');
    }
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
}
