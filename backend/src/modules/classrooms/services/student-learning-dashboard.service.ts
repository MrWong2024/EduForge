import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
import { QueryClassroomDto } from '../dto/query-classroom.dto';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { CLASSROOM_TASK_STATUS_ACTIVE } from '../classroom-tasks/classroom-task-status.constants';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { AiFeedbackJobService } from '../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackStatus } from '../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { User } from '../../users/schemas/user.schema';
import { Course } from '../../courses/schemas/course.schema';
import {
  CompletionFeedback,
  buildCompletionStatus,
  buildNotSubmittedCompletionStatus,
  groupCompletionFeedbacksBySubmissionId,
  toLatestSubmissionObjectIds,
} from './student-task-completion-status';

type ClassroomLean = Classroom & WithId;
type SubmissionWithMeta = Submission & WithId & WithTimestamps;
type TeacherLean = Pick<User, 'name' | 'employeeNo'> & WithId;
type CourseLean = Pick<Course, 'name' | 'term' | 'code'> & WithId;
type StudentTaskVisibilityStatus =
  | 'CURRENT'
  | 'RECENTLY_EXPIRED'
  | 'HISTORICAL';

type ClassroomTaskStudentAggregateItem = {
  _id: Types.ObjectId;
  classroomId: Types.ObjectId;
  taskId: Types.ObjectId;
  title: string;
  publishedAt?: Date | string | null;
  dueAt?: Date | string | null;
};

type ClassroomTaskStudentItem = ClassroomTaskStudentAggregateItem & {
  studentVisibilityStatus: StudentTaskVisibilityStatus;
  isHistorical: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENTLY_EXPIRED_GRACE_DAYS = 30;
const NO_DUE_DATE_CURRENT_DAYS = 90;

@Injectable()
export class StudentLearningDashboardService {
  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(Course.name)
    private readonly courseModel: Model<Course>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
    private readonly aiFeedbackJobService: AiFeedbackJobService,
  ) {}

  async getMyLearningDashboard(
    query: QueryClassroomDto,
    userId: string,
    includeHistorical = false,
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const enrollmentClassroomIds =
      await this.enrollmentService.listActiveClassroomIdsByUser(userId);

    if (
      enrollmentClassroomIds.length === 0 ||
      (query.status && query.status !== ClassroomStatus.Active)
    ) {
      return {
        items: [],
        total: 0,
        page,
        limit,
      };
    }

    const activeClassrooms = await this.classroomModel
      .find({
        _id: { $in: enrollmentClassroomIds },
        status: ClassroomStatus.Active,
      })
      .sort({ createdAt: -1, _id: 1 })
      .lean<ClassroomLean[]>()
      .exec();

    if (activeClassrooms.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        limit,
      };
    }

    const activeClassroomIds = activeClassrooms.map(
      (classroom) => classroom._id,
    );
    const classroomTaskPipeline: PipelineStage[] = [
      {
        $match: {
          classroomId: { $in: activeClassroomIds },
          status: CLASSROOM_TASK_STATUS_ACTIVE,
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
          classroomId: 1,
          taskId: 1,
          publishedAt: 1,
          dueAt: 1,
          title: '$task.title',
        },
      },
      { $sort: { publishedAt: -1 } },
    ];
    const rawClassroomTasks = await this.classroomTaskModel
      .aggregate<ClassroomTaskStudentAggregateItem>(classroomTaskPipeline)
      .exec();

    const now = new Date();
    const visibleClassroomTasks = rawClassroomTasks
      .map((task): ClassroomTaskStudentItem => {
        const studentVisibilityStatus = this.getStudentTaskVisibilityStatus(
          task,
          now,
        );
        return {
          ...task,
          studentVisibilityStatus,
          isHistorical: studentVisibilityStatus === 'HISTORICAL',
        };
      })
      .filter((task) => includeHistorical || !task.isHistorical)
      .sort((left, right) => this.compareStudentTasks(left, right));

    const tasksByClassroom = new Map<string, ClassroomTaskStudentItem[]>();
    for (const classroom of activeClassrooms) {
      tasksByClassroom.set(classroom._id.toString(), []);
    }
    for (const task of visibleClassroomTasks) {
      const key = task.classroomId.toString();
      const bucket = tasksByClassroom.get(key);
      if (bucket) {
        bucket.push(task);
      }
    }

    const visibleClassrooms = activeClassrooms.filter((classroom) => {
      const tasks = tasksByClassroom.get(classroom._id.toString()) ?? [];
      return tasks.length > 0;
    });
    const total = visibleClassrooms.length;
    const classrooms = visibleClassrooms.slice(
      (page - 1) * limit,
      page * limit,
    );

    if (classrooms.length === 0) {
      return {
        items: [],
        total,
        page,
        limit,
      };
    }

    const teacherObjectIds = Array.from(
      new Set(classrooms.map((classroom) => classroom.teacherId.toString())),
    ).map((teacherId) => new Types.ObjectId(teacherId));
    const courseObjectIds = Array.from(
      new Set(classrooms.map((classroom) => classroom.courseId.toString())),
    ).map((courseId) => new Types.ObjectId(courseId));
    const courses =
      courseObjectIds.length === 0
        ? []
        : await this.courseModel
            .find({ _id: { $in: courseObjectIds } })
            .select('_id name term code')
            .lean<CourseLean[]>()
            .exec();
    const teachers =
      teacherObjectIds.length === 0
        ? []
        : await this.userModel
            .find({ _id: { $in: teacherObjectIds } })
            .select('_id name employeeNo')
            .lean<TeacherLean[]>()
            .exec();
    const courseById = new Map(
      courses.map((course) => [course._id.toString(), course]),
    );
    const teacherById = new Map(
      teachers.map((teacher) => [teacher._id.toString(), teacher]),
    );
    const pageClassroomIds = new Set(
      classrooms.map((classroom) => classroom._id.toString()),
    );
    const classroomTasks = visibleClassroomTasks.filter((task) =>
      pageClassroomIds.has(task.classroomId.toString()),
    );

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

    const latestSubmissionIds = toLatestSubmissionObjectIds(
      Array.from(submissionStatsMap.values()).map((entry) => entry.latest?._id),
    );
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
    const feedbacksBySubmissionId =
      groupCompletionFeedbacksBySubmissionId(completionFeedbacks);

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
            course: this.buildCourseSummary(classroom, courseById),
            teacher: this.buildTeacherSummary(classroom, teacherById),
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
              publishedAt:
                this.toValidDate(task.publishedAt)?.toISOString() ?? null,
              dueAt: this.toValidDate(task.dueAt)?.toISOString() ?? null,
              studentVisibilityStatus: task.studentVisibilityStatus,
              isHistorical: task.isHistorical,
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

  private buildTeacherSummary(
    classroom: ClassroomLean,
    teacherById: Map<string, TeacherLean>,
  ) {
    const teacherId = classroom.teacherId.toString();
    const teacher = teacherById.get(teacherId);
    return {
      id: teacherId,
      name: this.toNullableText(teacher?.name),
      employeeNo: this.toNullableText(teacher?.employeeNo),
    };
  }

  private buildCourseSummary(
    classroom: ClassroomLean,
    courseById: Map<string, CourseLean>,
  ) {
    const courseId = classroom.courseId.toString();
    const course = courseById.get(courseId);
    return {
      id: courseId,
      name: this.toNullableText(course?.name),
      term: this.toNullableText(course?.term),
      code: this.toNullableText(course?.code),
    };
  }

  private getStudentTaskVisibilityStatus(
    task: Pick<ClassroomTaskStudentAggregateItem, 'dueAt' | 'publishedAt'>,
    now: Date,
  ): StudentTaskVisibilityStatus {
    const dueAt = this.toValidDate(task.dueAt);
    const nowTime = now.getTime();

    if (dueAt) {
      const dueTime = dueAt.getTime();
      if (dueTime >= nowTime) {
        return 'CURRENT';
      }
      const expiredCutoff = nowTime - RECENTLY_EXPIRED_GRACE_DAYS * DAY_MS;
      return dueTime >= expiredCutoff ? 'RECENTLY_EXPIRED' : 'HISTORICAL';
    }

    const publishedAt = this.toValidDate(task.publishedAt);
    if (!publishedAt) {
      return 'HISTORICAL';
    }

    const noDueCurrentCutoff = nowTime - NO_DUE_DATE_CURRENT_DAYS * DAY_MS;
    return publishedAt.getTime() >= noDueCurrentCutoff
      ? 'CURRENT'
      : 'HISTORICAL';
  }

  private compareStudentTasks(
    left: ClassroomTaskStudentItem,
    right: ClassroomTaskStudentItem,
  ) {
    const statusRank =
      this.visibilitySortRank(left.studentVisibilityStatus) -
      this.visibilitySortRank(right.studentVisibilityStatus);
    if (statusRank !== 0) {
      return statusRank;
    }
    return this.taskSortTime(right) - this.taskSortTime(left);
  }

  private visibilitySortRank(status: StudentTaskVisibilityStatus) {
    if (status === 'CURRENT') {
      return 0;
    }
    if (status === 'RECENTLY_EXPIRED') {
      return 1;
    }
    return 2;
  }

  private taskSortTime(task: ClassroomTaskStudentAggregateItem) {
    return (
      this.toValidDate(task.dueAt)?.getTime() ??
      this.toValidDate(task.publishedAt)?.getTime() ??
      0
    );
  }

  private toValidDate(value: Date | string | null | undefined) {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toNullableText(value: string | undefined) {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
