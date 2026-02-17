import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { QueryClassroomDto } from '../dto/query-classroom.dto';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import { AiFeedbackJobService } from '../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackStatus } from '../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type ClassroomLean = Classroom & WithId;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;

type ClassroomTaskStudentItem = {
  _id: Types.ObjectId;
  classroomId: Types.ObjectId;
  taskId: Types.ObjectId;
  title: string;
  publishedAt: Date;
  dueAt?: Date;
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
