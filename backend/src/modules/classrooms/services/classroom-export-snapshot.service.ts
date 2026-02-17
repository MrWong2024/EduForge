import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { Course } from '../../courses/schemas/course.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  CLASSROOM_EXPORT_SNAPSHOT_WINDOWS,
  ClassroomExportSnapshotWindow,
  QueryClassroomExportSnapshotDto,
} from '../dto/query-classroom-export-snapshot.dto';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { TeacherClassroomWeeklyReportService } from './teacher-classroom-weekly-report.service';
import { AiFeedbackMetricsAggregator } from '../classroom-tasks/services/ai-feedback-metrics-aggregator.service';
import {
  ClassReviewPackService,
  ReviewPackCommonIssues,
} from '../classroom-tasks/services/class-review-pack.service';
import { ProcessAssessmentService } from './process-assessment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type ClassroomWithMeta = Classroom & WithId & WithTimestamps;
type CourseWithMeta = Course & WithId & WithTimestamps;
type ClassroomTaskSnapshotLean = Pick<
  ClassroomTask,
  'taskId' | 'publishedAt' | 'dueAt' | 'settings'
> &
  WithId &
  WithTimestamps;
type SubmissionStatsByTaskAgg = {
  _id: Types.ObjectId;
  total: number;
  lateTotal: number;
  studentIds: Types.ObjectId[];
  submissionIds: Types.ObjectId[];
};
type ProcessAssessmentSnapshotItem = {
  studentId: string;
  submittedTasksCount: number;
  submissionsCount: number;
  lateSubmissionsCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  topTags: Array<{ tag: string; count: number }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
};

@Injectable()
export class ClassroomExportSnapshotService {
  private static readonly DEFAULT_WINDOW: ClassroomExportSnapshotWindow =
    'term';
  private static readonly DEFAULT_LIMIT_STUDENTS = 200;
  private static readonly DEFAULT_LIMIT_ASSESSMENT = 200;
  private static readonly TOP_K = 10;
  private static readonly WINDOW_MS_MAP: Record<'7d' | '30d', number> = {
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
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    private readonly enrollmentService: EnrollmentService,
    private readonly weeklyReportService: TeacherClassroomWeeklyReportService,
    private readonly aiFeedbackMetricsAggregator: AiFeedbackMetricsAggregator,
    private readonly classReviewPackService: ClassReviewPackService,
    private readonly processAssessmentService: ProcessAssessmentService,
  ) {}

  async getSnapshot(
    classroomId: string,
    query: QueryClassroomExportSnapshotDto,
    teacherId: string,
  ) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const window = CLASSROOM_EXPORT_SNAPSHOT_WINDOWS.includes(
      query.window as ClassroomExportSnapshotWindow,
    )
      ? (query.window as ClassroomExportSnapshotWindow)
      : ClassroomExportSnapshotService.DEFAULT_WINDOW;
    const effectiveWindow: '7d' | '30d' = window === '7d' ? '7d' : '30d';
    const includePerTask = this.parseBooleanQuery(query.includePerTask, true);
    const limitStudents = this.toBoundedLimit(
      query.limitStudents,
      ClassroomExportSnapshotService.DEFAULT_LIMIT_STUDENTS,
    );
    const limitAssessment = this.toBoundedLimit(
      query.limitAssessment,
      ClassroomExportSnapshotService.DEFAULT_LIMIT_ASSESSMENT,
    );
    const lowerBound = new Date(
      Date.now() -
        ClassroomExportSnapshotService.WINDOW_MS_MAP[effectiveWindow],
    );
    const notes: string[] = [];
    if (window === 'term') {
      notes.push(
        'term currently maps to 30d because semester boundary source is not connected yet.',
      );
    }

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id name courseId status')
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const course = await this.courseModel
      .findById(classroom.courseId)
      .select('_id code name term status')
      .lean<CourseWithMeta>()
      .exec();
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Snapshot task scope aligns with AA/AB createdAt window semantics for stable cross-endpoint comparison.
    const classroomTasks = await this.classroomTaskModel
      .find({
        classroomId: classroomObjectId,
        createdAt: { $gte: lowerBound },
      })
      .select('_id taskId publishedAt dueAt settings')
      .sort({ createdAt: 1, _id: 1 })
      .lean<ClassroomTaskSnapshotLean[]>()
      .exec();
    const classroomTaskIds = classroomTasks.map((task) => task._id);

    const [activeStudentIds, weeklyReport, aiByTask, processAssessment] =
      await Promise.all([
        this.enrollmentService.listActiveStudentIds(classroom._id),
        this.weeklyReportService.getWeeklyReportByLowerBound(
          classroom._id.toString(),
          lowerBound,
          effectiveWindow,
          teacherId,
        ),
        this.aiFeedbackMetricsAggregator.aggregateJobsGroupedByClassroomTaskIds(
          classroomTaskIds,
          lowerBound,
          'createdAt',
          ClassroomExportSnapshotService.TOP_K,
        ),
        this.processAssessmentService.getProcessAssessmentForSnapshot(
          classroom._id.toString(),
          effectiveWindow,
          teacherId,
        ),
      ]);
    const activeStudentObjectIds = activeStudentIds.map(
      (studentId) => new Types.ObjectId(studentId),
    );
    const studentsTotal = activeStudentIds.length;
    const submissionStatsByTask =
      await this.aggregateSubmissionStatsByClassroomTaskIds(
        classroomTaskIds,
        lowerBound,
        activeStudentObjectIds,
      );

    const submissionIds = Array.from(
      new Set(
        submissionStatsByTask.flatMap((row) =>
          row.submissionIds.map((submissionId) => submissionId.toString()),
        ),
      ),
    ).map((submissionId) => new Types.ObjectId(submissionId));

    const [summaryCommonIssues, perTaskCommonIssuesMap] = await Promise.all([
      this.classReviewPackService.aggregateCommonIssuesBySubmissionIds(
        submissionIds,
        ClassroomExportSnapshotService.TOP_K,
      ),
      includePerTask
        ? this.classReviewPackService.aggregateCommonIssuesByClassroomTaskIds(
            classroomTaskIds,
            lowerBound,
            ClassroomExportSnapshotService.TOP_K,
            activeStudentObjectIds,
          )
        : Promise.resolve(new Map<string, ReviewPackCommonIssues>()),
    ]);

    const submissionStatsMap = new Map<string, SubmissionStatsByTaskAgg>();
    for (const row of submissionStatsByTask) {
      submissionStatsMap.set(row._id.toString(), row);
    }

    const statsByClassroomTask = includePerTask
      ? classroomTasks.map((task) => {
          const taskId = task._id.toString();
          const submissions = submissionStatsMap.get(taskId);
          const ai = aiByTask.get(taskId) ?? {
            jobs: {
              total: 0,
              pending: 0,
              running: 0,
              succeeded: 0,
              failed: 0,
              dead: 0,
            },
            avgAttempts: 0,
            errors: [],
          };
          const commonIssues = perTaskCommonIssuesMap.get(taskId) ?? {
            topTags: [],
            topTypes: [],
            topSeverities: [],
          };
          return {
            classroomTaskId: taskId,
            taskId: task.taskId.toString(),
            submissions: {
              total: submissions?.total ?? 0,
              lateTotal: submissions?.lateTotal ?? 0,
              distinctStudents: submissions?.studentIds.length ?? 0,
            },
            ai: {
              jobsTotal: ai.jobs.total,
              succeeded: ai.jobs.succeeded,
              failed: ai.jobs.failed,
              dead: ai.jobs.dead,
              pending: ai.jobs.pending,
              running: ai.jobs.running,
              errorsTop: ai.errors,
            },
            commonIssues,
          };
        })
      : [];

    if (!includePerTask) {
      notes.push('perTask omitted by includePerTask=false');
    }

    const assessmentItems = [
      ...(processAssessment.items as ProcessAssessmentSnapshotItem[]),
    ].sort((left, right) =>
      left.score === right.score
        ? left.studentId.localeCompare(right.studentId)
        : right.score - left.score,
    );

    const statsByStudent = assessmentItems
      .slice(0, limitStudents)
      .map((item) => ({
        studentId: item.studentId,
        submittedTasksCount: item.submittedTasksCount,
        submissionsCount: item.submissionsCount,
        lateSubmissionsCount: item.lateSubmissionsCount,
        aiRequestedCount: item.aiRequestedCount,
        aiSucceededCount: item.aiSucceededCount,
        topTags: item.topTags,
        riskLevel: item.riskLevel,
        score: item.score,
      }));
    const processAssessmentItems = assessmentItems.slice(0, limitAssessment);

    if (assessmentItems.length > statsByStudent.length) {
      notes.push(
        `statsByStudent truncated: original=${assessmentItems.length}, exported=${statsByStudent.length}`,
      );
    }
    if (assessmentItems.length > processAssessmentItems.length) {
      notes.push(
        `processAssessment.items truncated: original=${assessmentItems.length}, exported=${processAssessmentItems.length}`,
      );
    }

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        window,
        effectiveWindow,
        notes,
      },
      course: {
        id: course._id.toString(),
        code: course.code,
        name: course.name,
        term: course.term,
        status: course.status,
      },
      classroom: {
        id: classroom._id.toString(),
        name: classroom.name,
        courseId: classroom.courseId.toString(),
        status: classroom.status,
      },
      students: {
        total: studentsTotal,
        exported: statsByStudent.length,
      },
      classroomTasks: classroomTasks.map((task) => ({
        classroomTaskId: task._id.toString(),
        taskId: task.taskId.toString(),
        publishedAt: task.publishedAt?.toISOString() ?? null,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        allowLate: task.settings?.allowLate !== false,
      })),
      summary: {
        progress: weeklyReport.progress,
        aiHealth: weeklyReport.aiHealth,
        commonIssues: summaryCommonIssues,
        late: {
          lateSubmissionsCount: weeklyReport.progress.lateSubmissionsCount,
          lateStudentsCount: weeklyReport.progress.lateStudentsCount,
        },
      },
      statsByClassroomTask,
      statsByStudent,
      processAssessment: {
        rubric: processAssessment.rubric,
        items: processAssessmentItems,
      },
    };
  }

  private async aggregateSubmissionStatsByClassroomTaskIds(
    classroomTaskIds: Types.ObjectId[],
    lowerBound: Date,
    activeStudentObjectIds: Types.ObjectId[],
  ) {
    if (classroomTaskIds.length === 0 || activeStudentObjectIds.length === 0) {
      return [] as SubmissionStatsByTaskAgg[];
    }

    return this.submissionModel
      .aggregate<SubmissionStatsByTaskAgg>([
        {
          $match: {
            classroomTaskId: { $in: classroomTaskIds },
            studentId: { $in: activeStudentObjectIds },
            createdAt: { $gte: lowerBound },
          },
        },
        {
          $group: {
            _id: '$classroomTaskId',
            total: { $sum: 1 },
            lateTotal: {
              $sum: {
                $cond: [{ $ifNull: ['$isLate', false] }, 1, 0],
              },
            },
            studentIds: { $addToSet: '$studentId' },
            submissionIds: { $addToSet: '$_id' },
          },
        },
      ] as PipelineStage[])
      .exec();
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private parseBooleanQuery(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  private toBoundedLimit(raw: number | undefined, defaultValue: number) {
    const value = raw ?? defaultValue;
    if (value < 1) {
      return 1;
    }
    if (value > 1000) {
      return 1000;
    }
    return value;
  }
}
