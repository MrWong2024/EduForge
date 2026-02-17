import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Course } from '../schemas/course.schema';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import { EnrollmentService } from '../../classrooms/enrollments/services/enrollment.service';
import {
  CourseOverviewSortField,
  CourseOverviewSortOrder,
  CourseOverviewWindow,
  COURSE_OVERVIEW_SORT_ORDERS,
  COURSE_OVERVIEW_SORT_FIELDS,
  COURSE_OVERVIEW_WINDOWS,
  QueryCourseOverviewDto,
} from '../dto/query-course-overview.dto';
import {
  AiFeedbackAggregatedJobMetrics,
  AiFeedbackMetricsAggregator,
} from '../../classrooms/classroom-tasks/services/ai-feedback-metrics-aggregator.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type CourseLean = Course & WithId & WithTimestamps;
type ClassroomLean = Classroom & WithId & WithTimestamps;

type ClassroomTasksAgg = {
  _id: Types.ObjectId;
  publishedClassroomTasks: number;
  classroomTaskIds: Types.ObjectId[];
};

type SubmissionDistinctPairAgg = {
  _id: { classroomTaskId: Types.ObjectId; studentId: Types.ObjectId };
};
type CourseOverviewItem = {
  classroomId: string;
  name: string;
  studentsCount: number;
  publishedClassroomTasks: number;
  distinctStudentsSubmitted: number;
  submissionRate: number;
  ai: {
    jobsTotal: number;
    pendingJobs: number;
    failedJobs: number;
    aiSuccessRate: number;
    topErrors: Array<{ code: string; count: number }>;
  };
};

@Injectable()
export class CourseOverviewService {
  private static readonly DEFAULT_WINDOW: CourseOverviewWindow = '7d';
  private static readonly DEFAULT_SORT: CourseOverviewSortField =
    'aiSuccessRate';
  private static readonly DEFAULT_ORDER: CourseOverviewSortOrder = 'desc';
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 20;
  private static readonly MAX_TOP_ERRORS = 5;
  private static readonly WINDOW_MS_MAP: Record<CourseOverviewWindow, number> =
    {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };

  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<Course>,
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    private readonly enrollmentService: EnrollmentService,
    private readonly aiFeedbackMetricsAggregator: AiFeedbackMetricsAggregator,
  ) {}

  async getCourseOverview(
    courseId: string,
    query: QueryCourseOverviewDto,
    teacherId: string,
  ) {
    const courseObjectId = this.parseObjectId(courseId, 'courseId');
    const page = query.page ?? CourseOverviewService.DEFAULT_PAGE;
    const limit = query.limit ?? CourseOverviewService.DEFAULT_LIMIT;
    const sortField = COURSE_OVERVIEW_SORT_FIELDS.includes(
      query.sort as CourseOverviewSortField,
    )
      ? (query.sort as CourseOverviewSortField)
      : CourseOverviewService.DEFAULT_SORT;
    const sortOrder = COURSE_OVERVIEW_SORT_ORDERS.includes(
      query.order as CourseOverviewSortOrder,
    )
      ? (query.order as CourseOverviewSortOrder)
      : CourseOverviewService.DEFAULT_ORDER;
    const window = COURSE_OVERVIEW_WINDOWS.includes(
      query.window as CourseOverviewWindow,
    )
      ? (query.window as CourseOverviewWindow)
      : CourseOverviewService.DEFAULT_WINDOW;
    const lowerBound = new Date(
      Date.now() - CourseOverviewService.WINDOW_MS_MAP[window],
    );

    const course = await this.courseModel
      .findOne({
        _id: courseObjectId,
        createdBy: new Types.ObjectId(teacherId),
      })
      .select('_id code name term status')
      .lean<CourseLean>()
      .exec();
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const classroomFilter = {
      courseId: courseObjectId,
      teacherId: new Types.ObjectId(teacherId),
    };
    const [total, classrooms] = await Promise.all([
      this.classroomModel.countDocuments(classroomFilter),
      this.classroomModel
        .find(classroomFilter)
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('_id name studentIds')
        .lean<ClassroomLean[]>()
        .exec(),
    ]);

    const classroomIds = classrooms.map((classroom) => classroom._id);
    if (classroomIds.length === 0) {
      return {
        course: {
          id: course._id.toString(),
          code: course.code,
          name: course.name,
          term: course.term,
          status: course.status,
        },
        window,
        generatedAt: new Date().toISOString(),
        page,
        limit,
        total,
        items: [],
      };
    }

    const [enrollmentCountMap, enrollmentStatsMap] = await Promise.all([
      this.enrollmentService.countStudentsGroupedByClassroomIds(classroomIds),
      this.enrollmentService.getClassroomEnrollmentStatsByClassroomIds(
        classroomIds,
      ),
    ]);

    // AB metric contract:
    // Use createdAt as the single time-window field for classroomTasks/submissions/jobs.
    // This matches AA weekly-report semantics and keeps cross-endpoint comparisons stable.
    const classroomTaskAgg = await this.classroomTaskModel
      .aggregate<ClassroomTasksAgg>([
        {
          $match: {
            classroomId: { $in: classroomIds },
            createdAt: { $gte: lowerBound },
          },
        },
        {
          $group: {
            _id: '$classroomId',
            publishedClassroomTasks: { $sum: 1 },
            classroomTaskIds: { $addToSet: '$_id' },
          },
        },
      ] as PipelineStage[])
      .exec();

    const publishedTasksMap = new Map<string, number>();
    const classroomIdByTaskId = new Map<string, string>();
    const classroomTaskIds: Types.ObjectId[] = [];

    for (const row of classroomTaskAgg) {
      const classroomId = row._id.toString();
      publishedTasksMap.set(classroomId, row.publishedClassroomTasks);
      for (const taskId of row.classroomTaskIds) {
        classroomTaskIds.push(taskId);
        classroomIdByTaskId.set(taskId.toString(), classroomId);
      }
    }

    const submissionPairs =
      classroomTaskIds.length === 0
        ? []
        : await this.submissionModel
            .aggregate<SubmissionDistinctPairAgg>([
              {
                $match: {
                  classroomTaskId: { $in: classroomTaskIds },
                  createdAt: { $gte: lowerBound },
                },
              },
              {
                $group: {
                  _id: {
                    classroomTaskId: '$classroomTaskId',
                    studentId: '$studentId',
                  },
                },
              },
            ] as PipelineStage[])
            .exec();

    const distinctStudentsMap = new Map<string, Set<string>>();
    for (const pair of submissionPairs) {
      const classroomId = classroomIdByTaskId.get(
        pair._id.classroomTaskId.toString(),
      );
      if (!classroomId) {
        continue;
      }
      const current = distinctStudentsMap.get(classroomId) ?? new Set<string>();
      current.add(pair._id.studentId.toString());
      distinctStudentsMap.set(classroomId, current);
    }

    const aiByClassroomTaskId =
      await this.aiFeedbackMetricsAggregator.aggregateJobsGroupedByClassroomTaskIds(
        classroomTaskIds,
        lowerBound,
        'createdAt',
      );

    const aiByClassroomId = new Map<
      string,
      {
        jobsTotal: number;
        pendingJobs: number;
        failedJobs: number;
        succeededJobs: number;
        errorCountMap: Map<string, number>;
      }
    >();

    for (const [taskId, metrics] of aiByClassroomTaskId.entries()) {
      const classroomId = classroomIdByTaskId.get(taskId);
      if (!classroomId) {
        continue;
      }
      const current = aiByClassroomId.get(classroomId) ?? {
        jobsTotal: 0,
        pendingJobs: 0,
        failedJobs: 0,
        succeededJobs: 0,
        errorCountMap: new Map<string, number>(),
      };
      this.mergeTaskAiMetrics(current, metrics);
      aiByClassroomId.set(classroomId, current);
    }

    const items = classrooms.map((classroom) => {
      const classroomId = classroom._id.toString();
      const enrollmentStats = enrollmentStatsMap.get(classroomId);
      // Migration fallback (temporary):
      // only fall back to legacy studentIds when enrollment records are absent.
      const studentsCount =
        enrollmentStats && enrollmentStats.totalRecords > 0
          ? (enrollmentCountMap.get(classroomId) ?? 0)
          : (classroom.studentIds?.length ?? 0);
      const distinctStudentsSubmitted =
        distinctStudentsMap.get(classroomId)?.size ?? 0;
      const ai = aiByClassroomId.get(classroomId) ?? {
        jobsTotal: 0,
        pendingJobs: 0,
        failedJobs: 0,
        succeededJobs: 0,
        errorCountMap: new Map<string, number>(),
      };
      const aiSuccessRate =
        ai.jobsTotal > 0 ? ai.succeededJobs / ai.jobsTotal : 0;
      const submissionRate =
        studentsCount > 0 ? distinctStudentsSubmitted / studentsCount : 0;

      return {
        classroomId,
        name: classroom.name,
        studentsCount,
        publishedClassroomTasks: publishedTasksMap.get(classroomId) ?? 0,
        distinctStudentsSubmitted,
        submissionRate,
        ai: {
          jobsTotal: ai.jobsTotal,
          pendingJobs: ai.pendingJobs,
          failedJobs: ai.failedJobs,
          aiSuccessRate,
          topErrors: this.toTopErrors(ai.errorCountMap),
        },
      } as CourseOverviewItem;
    });

    items.sort((left, right) =>
      this.compareItems(left, right, sortField, sortOrder),
    );

    return {
      course: {
        id: course._id.toString(),
        code: course.code,
        name: course.name,
        term: course.term,
        status: course.status,
      },
      window,
      generatedAt: new Date().toISOString(),
      page,
      limit,
      total,
      items,
    };
  }

  private mergeTaskAiMetrics(
    classroomRollup: {
      jobsTotal: number;
      pendingJobs: number;
      failedJobs: number;
      succeededJobs: number;
      errorCountMap: Map<string, number>;
    },
    taskMetrics: AiFeedbackAggregatedJobMetrics,
  ) {
    classroomRollup.jobsTotal += taskMetrics.jobs.total;
    classroomRollup.pendingJobs += taskMetrics.jobs.pending;
    classroomRollup.failedJobs += taskMetrics.jobs.failed;
    classroomRollup.succeededJobs += taskMetrics.jobs.succeeded;
    for (const error of taskMetrics.errors) {
      const count = classroomRollup.errorCountMap.get(error.code) ?? 0;
      classroomRollup.errorCountMap.set(error.code, count + error.count);
    }
  }

  private toTopErrors(errorCountMap: Map<string, number>) {
    return Array.from(errorCountMap.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) =>
        left.count === right.count
          ? left.code.localeCompare(right.code)
          : right.count - left.count,
      )
      .slice(0, CourseOverviewService.MAX_TOP_ERRORS);
  }

  private compareItems(
    left: CourseOverviewItem,
    right: CourseOverviewItem,
    sortField: CourseOverviewSortField,
    sortOrder: CourseOverviewSortOrder,
  ) {
    const leftValue = this.toSortableValue(left, sortField);
    const rightValue = this.toSortableValue(right, sortField);
    if (leftValue !== rightValue) {
      const diff = leftValue - rightValue;
      return sortOrder === 'asc' ? diff : -diff;
    }
    return left.classroomId.localeCompare(right.classroomId);
  }

  private toSortableValue(
    item: CourseOverviewItem,
    sortField: CourseOverviewSortField,
  ) {
    if (sortField === 'studentsCount') {
      return item.studentsCount;
    }
    if (sortField === 'submissionRate') {
      return item.submissionRate;
    }
    if (sortField === 'pendingJobs') {
      return item.ai.pendingJobs;
    }
    if (sortField === 'failedJobs') {
      return item.ai.failedJobs;
    }
    return item.ai.aiSuccessRate;
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
