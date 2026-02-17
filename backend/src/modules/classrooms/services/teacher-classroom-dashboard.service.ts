import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
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

type ClassroomLean = Classroom & WithId;

type ClassroomTaskDashboardItem = {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  title: string;
  stage: number;
  knowledgeModule: string;
  publishedAt: Date;
  dueAt?: Date;
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

  async getDashboard(id: string, userId: string) {
    const classroom = await this.classroomModel
      .findOne({ _id: id, teacherId: new Types.ObjectId(userId) })
      .lean<ClassroomLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomTaskPipeline: PipelineStage[] = [
      { $match: { classroomId: new Types.ObjectId(id) } },
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

    const classroomTaskIds = classroomTasks.map((task) => task._id);
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
        publishedTasksCount: classroomTasks.length,
        lateSubmissionsTotal: classroomTasks.reduce((sum, task) => {
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
      tasks: classroomTasks.map((task) => {
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
}
