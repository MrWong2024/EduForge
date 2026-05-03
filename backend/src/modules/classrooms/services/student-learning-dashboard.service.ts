import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { QueryClassroomDto } from '../dto/query-classroom.dto';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { AiFeedbackJobService } from '../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackStatus } from '../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type ClassroomLean = Classroom & WithId;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type CompletionFeedback = Pick<
  Feedback,
  'submissionId' | 'source' | 'severity'
>;

type CompletionStatusValue =
  | 'NOT_SUBMITTED'
  | 'NO_FEEDBACK'
  | 'QUALIFIED'
  | 'QUALIFIED_WITH_WARNINGS'
  | 'UNQUALIFIED';

type TaskCompletionStatus = {
  status: CompletionStatusValue;
  severity: FeedbackSeverity | null;
  source: FeedbackSource.Teacher | FeedbackSource.AI | null;
  latestSubmissionId: string | null;
  teacherFeedbackCount: number;
  aiFeedbackCount: number;
  teacherWorstSeverity: FeedbackSeverity | null;
  aiWorstSeverity: FeedbackSeverity | null;
};

type ClassroomTaskStudentItem = {
  _id: Types.ObjectId;
  classroomId: Types.ObjectId;
  taskId: Types.ObjectId;
  title: string;
  publishedAt: Date;
  dueAt?: Date;
};

const severityRanks: Record<FeedbackSeverity, number> = {
  [FeedbackSeverity.Info]: 1,
  [FeedbackSeverity.Warn]: 2,
  [FeedbackSeverity.Error]: 3,
};

const severityRank = (severity: FeedbackSeverity): number =>
  severityRanks[severity] ?? 0;

const pickWorstSeverity = (
  severities: FeedbackSeverity[],
): FeedbackSeverity | null => {
  let worst: FeedbackSeverity | null = null;
  for (const severity of severities) {
    if (severityRank(severity) === 0) {
      continue;
    }
    if (!worst || severityRank(severity) > severityRank(worst)) {
      worst = severity;
    }
  }
  return worst;
};

const statusFromSeverity = (
  severity: FeedbackSeverity,
): Exclude<CompletionStatusValue, 'NOT_SUBMITTED' | 'NO_FEEDBACK'> => {
  if (severity === FeedbackSeverity.Error) {
    return 'UNQUALIFIED';
  }
  if (severity === FeedbackSeverity.Warn) {
    return 'QUALIFIED_WITH_WARNINGS';
  }
  return 'QUALIFIED';
};

const buildNotSubmittedCompletionStatus = (): TaskCompletionStatus => ({
  status: 'NOT_SUBMITTED',
  severity: null,
  source: null,
  latestSubmissionId: null,
  teacherFeedbackCount: 0,
  aiFeedbackCount: 0,
  teacherWorstSeverity: null,
  aiWorstSeverity: null,
});

const buildNoFeedbackCompletionStatus = (
  latestSubmissionId: string,
  teacherFeedbackCount = 0,
  aiFeedbackCount = 0,
  teacherWorstSeverity: FeedbackSeverity | null = null,
  aiWorstSeverity: FeedbackSeverity | null = null,
): TaskCompletionStatus => ({
  status: 'NO_FEEDBACK',
  severity: null,
  source: null,
  latestSubmissionId,
  teacherFeedbackCount,
  aiFeedbackCount,
  teacherWorstSeverity,
  aiWorstSeverity,
});

const buildCompletionStatus = (
  latestSubmissionId: string,
  feedbacks: CompletionFeedback[],
): TaskCompletionStatus => {
  const teacherFeedbacks = feedbacks.filter(
    (feedback) => feedback.source === FeedbackSource.Teacher,
  );
  const aiFeedbacks = feedbacks.filter(
    (feedback) => feedback.source === FeedbackSource.AI,
  );
  const teacherWorstSeverity = pickWorstSeverity(
    teacherFeedbacks.map((feedback) => feedback.severity),
  );
  const aiWorstSeverity = pickWorstSeverity(
    aiFeedbacks.map((feedback) => feedback.severity),
  );

  if (teacherFeedbacks.length > 0 && teacherWorstSeverity) {
    return {
      status: statusFromSeverity(teacherWorstSeverity),
      severity: teacherWorstSeverity,
      source: FeedbackSource.Teacher,
      latestSubmissionId,
      teacherFeedbackCount: teacherFeedbacks.length,
      aiFeedbackCount: aiFeedbacks.length,
      teacherWorstSeverity,
      aiWorstSeverity,
    };
  }

  if (aiFeedbacks.length > 0 && aiWorstSeverity) {
    return {
      status: statusFromSeverity(aiWorstSeverity),
      severity: aiWorstSeverity,
      source: FeedbackSource.AI,
      latestSubmissionId,
      teacherFeedbackCount: teacherFeedbacks.length,
      aiFeedbackCount: aiFeedbacks.length,
      teacherWorstSeverity,
      aiWorstSeverity,
    };
  }

  return buildNoFeedbackCompletionStatus(
    latestSubmissionId,
    teacherFeedbacks.length,
    aiFeedbacks.length,
    teacherWorstSeverity,
    aiWorstSeverity,
  );
};

@Injectable()
export class StudentLearningDashboardService {
  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    private readonly enrollmentService: EnrollmentService,
    private readonly aiFeedbackJobService: AiFeedbackJobService,
  ) {}

  async getMyLearningDashboard(query: QueryClassroomDto, userId: string) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const enrollmentClassroomIds =
      await this.enrollmentService.listActiveClassroomIdsByUser(userId);
    const enrollmentFilter: Record<string, unknown> = {};
    if (query.status) {
      enrollmentFilter.status = query.status;
    }

    let classrooms: ClassroomLean[] = [];
    let total = 0;
    if (enrollmentClassroomIds.length > 0) {
      const filter: Record<string, unknown> = {
        ...enrollmentFilter,
        _id: { $in: enrollmentClassroomIds },
      };
      [classrooms, total] = await Promise.all([
        this.classroomModel
          .find(filter)
          .sort({ createdAt: -1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<ClassroomLean[]>()
          .exec(),
        this.classroomModel.countDocuments(filter),
      ]);
    }

    if (classrooms.length === 0) {
      return {
        items: [],
        total,
        page,
        limit,
      };
    }

    const classroomIds = classrooms.map((classroom) => classroom._id);
    const classroomTaskPipeline: PipelineStage[] = [
      { $match: { classroomId: { $in: classroomIds } } },
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
          classroomId: 1,
          taskId: 1,
          publishedAt: 1,
          dueAt: 1,
          title: '$task.title',
        },
      },
      { $sort: { publishedAt: -1 } },
    ];
    const classroomTasks = await this.classroomTaskModel
      .aggregate<ClassroomTaskStudentItem>(classroomTaskPipeline)
      .exec();

    const tasksByClassroom = new Map<string, ClassroomTaskStudentItem[]>();
    for (const classroom of classrooms) {
      tasksByClassroom.set(classroom._id.toString(), []);
    }
    for (const task of classroomTasks) {
      const key = task.classroomId.toString();
      const bucket = tasksByClassroom.get(key);
      if (bucket) {
        bucket.push(task);
      }
    }

    const classroomTaskIds = classroomTasks.map((task) => task._id);
    const taskIds = classroomTasks.map((task) => task.taskId);
    const classroomTaskIdsByTaskId = new Map<string, string[]>();
    for (const task of classroomTasks) {
      const taskId = task.taskId.toString();
      const current = classroomTaskIdsByTaskId.get(taskId) ?? [];
      current.push(task._id.toString());
      classroomTaskIdsByTaskId.set(taskId, current);
    }
    const submissions =
      classroomTaskIds.length === 0
        ? []
        : await this.submissionModel
            .find({
              $or: [
                { classroomTaskId: { $in: classroomTaskIds } },
                {
                  taskId: { $in: taskIds },
                  $or: [
                    { classroomTaskId: { $exists: false } },
                    { classroomTaskId: null },
                  ],
                },
              ],
              studentId: new Types.ObjectId(userId),
            })
            .sort({ createdAt: -1 })
            .lean<SubmissionWithMeta[]>()
            .exec();

    const submissionIds = submissions.map((submission) => submission._id);
    const statusMap =
      await this.aiFeedbackJobService.getStatusMapBySubmissionIds(
        submissionIds,
      );

    const submissionStatsMap = new Map<
      string,
      { count: number; latest?: SubmissionWithMeta }
    >();
    for (const submission of submissions) {
      let key = submission.classroomTaskId?.toString();
      if (!key) {
        const fallbackTaskKeys = classroomTaskIdsByTaskId.get(
          submission.taskId.toString(),
        );
        if (fallbackTaskKeys && fallbackTaskKeys.length === 1) {
          key = fallbackTaskKeys[0];
        }
      }
      if (!key) {
        continue;
      }
      const entry = submissionStatsMap.get(key) ?? { count: 0 };
      entry.count += 1;
      if (!entry.latest) {
        entry.latest = submission;
      } else {
        const latestAttempt = entry.latest.attemptNo ?? 0;
        const currentAttempt = submission.attemptNo ?? 0;
        const latestCreatedAt = entry.latest.createdAt?.getTime() ?? 0;
        const currentCreatedAt = submission.createdAt?.getTime() ?? 0;
        if (
          currentAttempt > latestAttempt ||
          (currentAttempt === latestAttempt &&
            currentCreatedAt > latestCreatedAt)
        ) {
          entry.latest = submission;
        }
      }
      submissionStatsMap.set(key, entry);
    }

    const latestSubmissionIds = Array.from(submissionStatsMap.values())
      .map((entry) => entry.latest?._id)
      .filter((id): id is Types.ObjectId => Boolean(id));
    const completionFeedbacks =
      latestSubmissionIds.length === 0
        ? []
        : await this.feedbackModel
            .find({
              submissionId: { $in: latestSubmissionIds },
              source: { $in: [FeedbackSource.Teacher, FeedbackSource.AI] },
            })
            .lean<CompletionFeedback[]>()
            .exec();
    const feedbacksBySubmissionId = new Map<string, CompletionFeedback[]>();
    for (const feedback of completionFeedbacks) {
      const key = feedback.submissionId.toString();
      const bucket = feedbacksBySubmissionId.get(key) ?? [];
      bucket.push(feedback);
      feedbacksBySubmissionId.set(key, bucket);
    }

    return {
      items: classrooms.map((classroom) => {
        const key = classroom._id.toString();
        const tasks = tasksByClassroom.get(key) ?? [];
        return {
          classroom: {
            id: key,
            name: classroom.name,
            courseId: classroom.courseId.toString(),
            status: classroom.status,
          },
          tasks: tasks.map((task) => {
            const taskKey = task.taskId.toString();
            const classroomTaskKey = task._id.toString();
            const submissionStats = submissionStatsMap.get(classroomTaskKey);
            const latest = submissionStats?.latest;
            const latestStatus = latest
              ? (statusMap.get(latest._id.toString()) ??
                AiFeedbackStatus.NotRequested)
              : AiFeedbackStatus.NotRequested;
            const completionStatus = latest
              ? buildCompletionStatus(
                  latest._id.toString(),
                  feedbacksBySubmissionId.get(latest._id.toString()) ?? [],
                )
              : buildNotSubmittedCompletionStatus();
            return {
              classroomTaskId: task._id.toString(),
              taskId: taskKey,
              title: task.title,
              publishedAt: task.publishedAt.toISOString(),
              dueAt: task.dueAt ? task.dueAt.toISOString() : null,
              myLatestSubmission: latest
                ? {
                    submissionId: latest._id.toString(),
                    attemptNo: latest.attemptNo,
                    createdAt: (latest.createdAt ?? new Date(0)).toISOString(),
                    aiFeedbackStatus: latestStatus,
                  }
                : null,
              mySubmissionsCount: submissionStats?.count ?? 0,
              completionStatus,
            };
          }),
        };
      }),
      total,
      page,
      limit,
    };
  }
}
