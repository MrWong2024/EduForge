import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
} from '../classroom-tasks/classroom-task-status.constants';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Feedback,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { TaskStatus } from '../../learning-tasks/schemas/task.schema';

type ClassroomLean = Classroom & WithId & WithTimestamps;

type SubmissionLean = Submission & WithTimestamps;

type ClassroomTaskDashboardItem = {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  title: string;
  stage: number;
  knowledgeModule: string;
  publishedAt: Date;
  dueAt?: Date;
  classroomTaskStatus: string;
};

type ClassroomTaskArchiveCandidate = {
  _id: Types.ObjectId;
  classroomTaskStatus?: string;
  taskStatus?: string;
  publishedAt?: Date;
  dueAt?: Date;
};

type ArchiveSuggestionReason =
  | 'NO_ACTIVE_TASKS'
  | 'NO_RECENT_SUBMISSIONS'
  | 'NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS';

type ArchiveSuggestion = {
  suggested: boolean;
  reason: ArchiveSuggestionReason | null;
  message: string | null;
  lastSubmissionAt: string | null;
  latestActiveTaskDueAt: string | null;
  inactiveDays: number | null;
};

type SubmissionStats = {
  _id: Types.ObjectId;
  submissionsCount: number;
  distinctStudentsSubmitted: number;
  lateSubmissionsCount: number;
  lateStudentIds: Types.ObjectId[];
};

type AiFeedbackStats = {
  _id: { classroomTaskId: Types.ObjectId; status: AiFeedbackJobStatus };
  count: number;
};

type TagStats = {
  _id: Types.ObjectId;
  tags: { tag: string; count: number }[];
};

@Injectable()
export class TeacherClassroomDashboardService {
  private static readonly TOP_TAGS_LIMIT = 5;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly ARCHIVE_SUGGESTION_RECENT_SUBMISSION_DAYS = 30;
  private static readonly ARCHIVE_SUGGESTION_DUE_GRACE_DAYS = 30;
  private static readonly ARCHIVE_SUGGESTION_NO_DUE_PUBLISHED_DAYS = 90;
  private static readonly ARCHIVE_SUGGESTION_NEW_CLASSROOM_GRACE_DAYS = 30;

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<Feedback>,
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  async getDashboard(id: string, userId: string, includeClosedTasks = false) {
    const classroom = await this.classroomModel
      .findOne({ _id: id, teacherId: new Types.ObjectId(userId) })
      .lean<ClassroomLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomObjectId = new Types.ObjectId(id);
    const archiveCandidates =
      await this.getArchiveSuggestionCandidates(classroomObjectId);
    const archiveSuggestion = await this.buildArchiveSuggestion(
      classroom,
      archiveCandidates,
      new Date(),
    );

    const visibleStatuses =
      this.getVisibleClassroomTaskStatuses(includeClosedTasks);
    const classroomTaskPipeline: PipelineStage[] = [
      {
        $match: {
          classroomId: classroomObjectId,
          status: { $in: visibleStatuses },
        },
      },
      {
        $lookup: {
          from: 'tasks',
          localField: 'taskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
      {
        $project: {
          _id: 1,
          taskId: 1,
          classroomTaskStatus: '$status',
          publishedAt: 1,
          dueAt: 1,
          title: '$task.title',
          stage: '$task.stage',
          knowledgeModule: '$task.knowledgeModule',
        },
      },
      { $sort: { publishedAt: -1 } },
    ];
    const classroomTasks = await this.classroomTaskModel
      .aggregate<ClassroomTaskDashboardItem>(classroomTaskPipeline)
      .exec();
    const visibleStatusSet = new Set<string>(visibleStatuses);
    const visibleClassroomTasks = classroomTasks.filter((task) =>
      visibleStatusSet.has(task.classroomTaskStatus),
    );

    const classroomTaskIds = visibleClassroomTasks.map((task) => task._id);
    const studentsCount = await this.enrollmentService.countStudents(
      classroom._id.toString(),
    );
    if (classroomTaskIds.length === 0) {
      return {
        classroom: {
          id: classroom._id.toString(),
          name: classroom.name,
          courseId: classroom.courseId.toString(),
          status: classroom.status,
          joinCode: classroom.joinCode,
        },
        summary: {
          studentsCount,
          publishedTasksCount: 0,
        },
        archiveSuggestion,
        tasks: [],
      };
    }

    const submissionStatsPipeline: PipelineStage[] = [
      { $match: { classroomTaskId: { $in: classroomTaskIds } } },
      {
        $group: {
          _id: '$classroomTaskId',
          submissionsCount: { $sum: 1 },
          studentIds: { $addToSet: '$studentId' },
          lateSubmissionsCount: {
            $sum: {
              $cond: [{ $ifNull: ['$isLate', false] }, 1, 0],
            },
          },
          lateStudentIdsRaw: {
            $addToSet: {
              $cond: [{ $ifNull: ['$isLate', false] }, '$studentId', null],
            },
          },
        },
      },
      {
        $project: {
          submissionsCount: 1,
          distinctStudentsSubmitted: { $size: '$studentIds' },
          lateSubmissionsCount: 1,
          lateStudentIds: {
            $filter: {
              input: '$lateStudentIdsRaw',
              as: 'studentId',
              cond: { $ne: ['$$studentId', null] },
            },
          },
        },
      },
    ];
    const aiFeedbackStatsPipeline: PipelineStage[] = [
      { $match: { classroomTaskId: { $in: classroomTaskIds } } },
      {
        $group: {
          _id: { classroomTaskId: '$classroomTaskId', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ];
    const tagStatsPipeline: PipelineStage[] = [
      {
        $match: {
          source: FeedbackSource.AI,
          tags: { $exists: true, $ne: [] },
        },
      },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission',
        },
      },
      { $unwind: '$submission' },
      { $match: { 'submission.classroomTaskId': { $in: classroomTaskIds } } },
      { $unwind: '$tags' },
      {
        $group: {
          _id: { classroomTaskId: '$submission.classroomTaskId', tag: '$tags' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $group: {
          _id: '$_id.classroomTaskId',
          tags: { $push: { tag: '$_id.tag', count: '$count' } },
        },
      },
      {
        $project: {
          tags: {
            $slice: ['$tags', TeacherClassroomDashboardService.TOP_TAGS_LIMIT],
          },
        },
      },
    ];

    const [submissionStats, aiFeedbackStats, tagStats] = await Promise.all([
      this.submissionModel
        .aggregate<SubmissionStats>(submissionStatsPipeline)
        .exec(),
      this.aiFeedbackJobModel
        .aggregate<AiFeedbackStats>(aiFeedbackStatsPipeline)
        .exec(),
      this.feedbackModel.aggregate<TagStats>(tagStatsPipeline).exec(),
    ]);

    const submissionStatsMap = new Map<string, SubmissionStats>();
    for (const stat of submissionStats) {
      submissionStatsMap.set(stat._id.toString(), stat);
    }

    const aiFeedbackMap = new Map<
      string,
      {
        pending: number;
        running: number;
        succeeded: number;
        failed: number;
        dead: number;
      }
    >();
    for (const stat of aiFeedbackStats) {
      const classroomTaskId = stat._id.classroomTaskId.toString();
      const current = aiFeedbackMap.get(classroomTaskId) ?? {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
      };
      if (stat._id.status === AiFeedbackJobStatus.Pending) {
        current.pending += stat.count;
      } else if (stat._id.status === AiFeedbackJobStatus.Running) {
        current.running += stat.count;
      } else if (stat._id.status === AiFeedbackJobStatus.Succeeded) {
        current.succeeded += stat.count;
      } else if (stat._id.status === AiFeedbackJobStatus.Failed) {
        current.failed += stat.count;
      } else if (stat._id.status === AiFeedbackJobStatus.Dead) {
        current.dead += stat.count;
      }
      aiFeedbackMap.set(classroomTaskId, current);
    }

    const tagStatsMap = new Map<string, TagStats>();
    for (const stat of tagStats) {
      tagStatsMap.set(stat._id.toString(), stat);
    }

    return {
      classroom: {
        id: classroom._id.toString(),
        name: classroom.name,
        courseId: classroom.courseId.toString(),
        status: classroom.status,
        joinCode: classroom.joinCode,
      },
      summary: {
        studentsCount,
        publishedTasksCount: visibleClassroomTasks.length,
        lateSubmissionsTotal: visibleClassroomTasks.reduce((sum, task) => {
          const stat = submissionStatsMap.get(task._id.toString());
          return sum + (stat?.lateSubmissionsCount ?? 0);
        }, 0),
        lateStudentsTotal: (() => {
          const lateStudentSet = new Set<string>();
          for (const stat of submissionStatsMap.values()) {
            for (const studentId of stat.lateStudentIds ?? []) {
              lateStudentSet.add(studentId.toString());
            }
          }
          return lateStudentSet.size;
        })(),
      },
      archiveSuggestion,
      tasks: visibleClassroomTasks.map((task) => {
        const key = task._id.toString();
        const submissions = submissionStatsMap.get(key);
        const submissionsCount = submissions?.submissionsCount ?? 0;
        const lateSubmissionsCount = submissions?.lateSubmissionsCount ?? 0;
        const lateDistinctStudentsCount =
          submissions?.lateStudentIds.length ?? 0;
        const aiFeedbackCounts = aiFeedbackMap.get(key) ?? {
          pending: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          dead: 0,
        };
        const totalRequested =
          aiFeedbackCounts.pending +
          aiFeedbackCounts.running +
          aiFeedbackCounts.succeeded +
          aiFeedbackCounts.failed +
          aiFeedbackCounts.dead;
        const rawNotRequested = submissionsCount - totalRequested;
        const notRequested = rawNotRequested > 0 ? rawNotRequested : 0;
        return {
          classroomTaskId: task._id.toString(),
          classroomTaskStatus: task.classroomTaskStatus,
          taskId: task.taskId.toString(),
          title: task.title,
          stage: task.stage,
          knowledgeModule: task.knowledgeModule,
          publishedAt: task.publishedAt.toISOString(),
          dueAt: task.dueAt ? task.dueAt.toISOString() : null,
          submissionsCount,
          distinctStudentsSubmitted:
            submissions?.distinctStudentsSubmitted ?? 0,
          lateSubmissionsCount,
          lateDistinctStudentsCount,
          aiFeedback: {
            ...aiFeedbackCounts,
            notRequested,
          },
          topTags: tagStatsMap.get(key)?.tags ?? [],
        };
      }),
    };
  }

  private getVisibleClassroomTaskStatuses(includeClosedTasks: boolean) {
    return includeClosedTasks
      ? [CLASSROOM_TASK_STATUS_ACTIVE, CLASSROOM_TASK_STATUS_CLOSED]
      : [CLASSROOM_TASK_STATUS_ACTIVE];
  }

  private async getArchiveSuggestionCandidates(classroomId: Types.ObjectId) {
    const pipeline: PipelineStage[] = [
      { $match: { classroomId } },
      {
        $lookup: {
          from: 'tasks',
          localField: 'taskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: { path: '$task', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          classroomTaskStatus: '$status',
          taskStatus: '$task.status',
          publishedAt: 1,
          dueAt: 1,
        },
      },
    ];
    return this.classroomTaskModel
      .aggregate<ClassroomTaskArchiveCandidate>(pipeline)
      .exec();
  }

  private async buildArchiveSuggestion(
    classroom: ClassroomLean,
    candidates: ClassroomTaskArchiveCandidate[],
    now: Date,
  ): Promise<ArchiveSuggestion> {
    const allClassroomTaskIds = candidates.map((candidate) => candidate._id);
    const lastSubmissionAt =
      await this.findLastSubmissionAt(allClassroomTaskIds);
    const activeTasks = candidates.filter((candidate) =>
      this.isCurrentActiveTask(candidate, now),
    );
    const latestActiveTaskDueAt = this.pickLatestDueAt(activeTasks);
    const inactiveDays = this.calculateInactiveDays(
      now,
      lastSubmissionAt,
      latestActiveTaskDueAt,
    );
    const base = {
      lastSubmissionAt: this.toIsoOrNull(lastSubmissionAt),
      latestActiveTaskDueAt: this.toIsoOrNull(latestActiveTaskDueAt),
      inactiveDays,
    };

    if (classroom.status !== ClassroomStatus.Active) {
      return { suggested: false, reason: null, message: null, ...base };
    }
    if (this.isNewClassroomProtected(classroom, candidates, now)) {
      return { suggested: false, reason: null, message: null, ...base };
    }
    if (activeTasks.length > 0) {
      return { suggested: false, reason: null, message: null, ...base };
    }
    if (this.hasRecentSubmission(lastSubmissionAt, now)) {
      return { suggested: false, reason: null, message: null, ...base };
    }

    return {
      suggested: true,
      reason: 'NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS',
      message: '该班级近期无活跃任务和学生提交，建议归档。',
      ...base,
    };
  }

  private async findLastSubmissionAt(classroomTaskIds: Types.ObjectId[]) {
    if (classroomTaskIds.length === 0) {
      return null;
    }
    const latestSubmission = await this.submissionModel
      .findOne({ classroomTaskId: { $in: classroomTaskIds } })
      .sort({ createdAt: -1 })
      .select({ createdAt: 1 })
      .lean<SubmissionLean>()
      .exec();
    return latestSubmission?.createdAt ?? null;
  }

  private isCurrentActiveTask(
    candidate: ClassroomTaskArchiveCandidate,
    now: Date,
  ) {
    if (
      candidate.classroomTaskStatus !== CLASSROOM_TASK_STATUS_ACTIVE ||
      candidate.taskStatus !== TaskStatus.Published
    ) {
      return false;
    }

    const dueAt = this.toValidDate(candidate.dueAt);
    if (dueAt) {
      return (
        dueAt.getTime() >=
        this.addDays(
          now,
          -TeacherClassroomDashboardService.ARCHIVE_SUGGESTION_DUE_GRACE_DAYS,
        ).getTime()
      );
    }

    const publishedAt = this.toValidDate(candidate.publishedAt);
    if (!publishedAt) {
      return false;
    }
    return (
      publishedAt.getTime() >=
      this.addDays(
        now,
        -TeacherClassroomDashboardService.ARCHIVE_SUGGESTION_NO_DUE_PUBLISHED_DAYS,
      ).getTime()
    );
  }

  private isNewClassroomProtected(
    classroom: ClassroomLean,
    candidates: ClassroomTaskArchiveCandidate[],
    now: Date,
  ) {
    const threshold = this.addDays(
      now,
      -TeacherClassroomDashboardService.ARCHIVE_SUGGESTION_NEW_CLASSROOM_GRACE_DAYS,
    );
    const classroomCreatedAt = this.toValidDate(classroom.createdAt);
    if (classroomCreatedAt) {
      return classroomCreatedAt.getTime() >= threshold.getTime();
    }

    const publishedDates = candidates
      .map((candidate) => this.toValidDate(candidate.publishedAt))
      .filter((date): date is Date => Boolean(date));
    if (publishedDates.length === 0) {
      return false;
    }
    const earliestPublishedAt = publishedDates.reduce((earliest, date) =>
      date.getTime() < earliest.getTime() ? date : earliest,
    );
    return earliestPublishedAt.getTime() >= threshold.getTime();
  }

  private hasRecentSubmission(lastSubmissionAt: Date | null, now: Date) {
    if (!lastSubmissionAt) {
      return false;
    }
    return (
      lastSubmissionAt.getTime() >=
      this.addDays(
        now,
        -TeacherClassroomDashboardService.ARCHIVE_SUGGESTION_RECENT_SUBMISSION_DAYS,
      ).getTime()
    );
  }

  private pickLatestDueAt(candidates: ClassroomTaskArchiveCandidate[]) {
    const dueDates = candidates
      .map((candidate) => this.toValidDate(candidate.dueAt))
      .filter((date): date is Date => Boolean(date));
    if (dueDates.length === 0) {
      return null;
    }
    return dueDates.reduce((latest, date) =>
      date.getTime() > latest.getTime() ? date : latest,
    );
  }

  private calculateInactiveDays(
    now: Date,
    lastSubmissionAt: Date | null,
    latestActiveTaskDueAt: Date | null,
  ) {
    const references = [lastSubmissionAt, latestActiveTaskDueAt].filter(
      (date): date is Date => Boolean(date),
    );
    if (references.length === 0) {
      return null;
    }
    const latestReference = references.reduce((latest, date) =>
      date.getTime() > latest.getTime() ? date : latest,
    );
    const diff = now.getTime() - latestReference.getTime();
    return Math.max(
      0,
      Math.floor(diff / TeacherClassroomDashboardService.DAY_MS),
    );
  }

  private toValidDate(value: Date | undefined | null) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return null;
    }
    return value;
  }

  private toIsoOrNull(value: Date | null) {
    return value ? value.toISOString() : null;
  }

  private addDays(date: Date, days: number) {
    return new Date(
      date.getTime() + days * TeacherClassroomDashboardService.DAY_MS,
    );
  }
}
