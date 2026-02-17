import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  CLASSROOM_WEEKLY_REPORT_WINDOWS,
  ClassroomWeeklyReportWindow,
} from '../dto/query-classroom-weekly-report.dto';
import { AI_FEEDBACK_ERROR_CODES } from '../../learning-tasks/ai-feedback/interfaces/ai-feedback-provider.error-codes';
import { AiFeedbackMetricsAggregator } from '../classroom-tasks/services/ai-feedback-metrics-aggregator.service';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type ClassroomWithMeta = Classroom & WithId & WithTimestamps;
type ClassroomTaskWithMeta = ClassroomTask & WithId & WithTimestamps;
type SubmittedStudentsAgg = {
  _id: null;
  studentIds: Types.ObjectId[];
};

@Injectable()
export class TeacherClassroomWeeklyReportService {
  private static readonly DEFAULT_WINDOW: ClassroomWeeklyReportWindow = '7d';
  private static readonly TOP_TAGS_LIMIT = 5;
  private static readonly SAMPLE_RISK_STUDENT_LIMIT = 10;
  private static readonly WINDOW_MS_MAP: Record<
    ClassroomWeeklyReportWindow,
    number
  > = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    private readonly enrollmentService: EnrollmentService,
    private readonly aiFeedbackMetricsAggregator: AiFeedbackMetricsAggregator,
  ) {}

  async getWeeklyReport(
    classroomId: string,
    window: ClassroomWeeklyReportWindow | undefined,
    includeRiskStudentIdsQuery: string | undefined,
    teacherId: string,
  ) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const includeRiskStudentIds = this.parseIncludeRiskStudentIds(
      includeRiskStudentIdsQuery,
    );
    const { window: resolvedWindow, lowerBound } = this.resolveWindow(window);
    const now = new Date();

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id name courseId status studentIds')
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    // Weekly report metric contract (AA):
    // 1) Time-window filtering uses createdAt consistently across tasks/submissions/jobs/feedback.
    //    createdAt is immutable and avoids reclassification when records are later updated.
    // 2) Task scope is strictly classroomId-constrained before any downstream aggregation.
    // 4) atRisk (v1) means students with zero submissions in-window across all in-window classroomTasks.
    // 5) AI error code extraction is delegated to shared aggregator:
    //    prefer `lastError.code`, fallback to known code tokens only (no long-message parsing).
    const classroomTasks = await this.classroomTaskModel
      .find({
        classroomId: classroomObjectId,
        createdAt: { $gte: lowerBound },
      })
      .select('_id dueAt publishedAt createdAt')
      .lean<ClassroomTaskWithMeta[]>()
      .exec();
    const classroomTaskIds = classroomTasks.map((task) => task._id);
    // Migration fallback (temporary) is encapsulated in EnrollmentService:
    // fall back to legacy studentIds only when classroom enrollments are empty.
    const [studentsCount, classroomStudentIdsRaw] = await Promise.all([
      this.enrollmentService.countStudentsWithLegacyFallback(
        classroom._id,
        classroom.studentIds ?? [],
      ),
      this.enrollmentService.listStudentIdsWithLegacyFallback(
        classroom._id,
        classroom.studentIds ?? [],
      ),
    ]);
    const classroomStudentIds = [...classroomStudentIdsRaw].sort(
      (left, right) => left.localeCompare(right),
    );
    const classroomStudentObjectIds = classroomStudentIds.map(
      (studentId) => new Types.ObjectId(studentId),
    );
    const submittedStudentIdSet = await this.getSubmittedStudentIdSet(
      classroomTaskIds,
      classroomStudentObjectIds,
      lowerBound,
    );

    const distinctStudentsSubmitted = submittedStudentIdSet.size;
    // Global rule: when studentsCount is 0, submissionRate is 0.
    const submissionRate =
      studentsCount > 0 ? distinctStudentsSubmitted / studentsCount : 0;
    const riskStudentIds = classroomStudentIds.filter(
      (studentId) => !submittedStudentIdSet.has(studentId),
    );

    const [{ jobs, errors }, topTags] = await Promise.all([
      this.aiFeedbackMetricsAggregator.aggregateJobsByClassroomTaskIds(
        classroomTaskIds,
        lowerBound,
        'createdAt',
      ),
      this.aiFeedbackMetricsAggregator.aggregateTopTagsByClassroomTaskIds(
        classroomTaskIds,
        lowerBound,
        TeacherClassroomWeeklyReportService.TOP_TAGS_LIMIT,
      ),
    ]);

    const rateLimitErrorCount = errors
      .filter(
        (item) =>
          item.code === AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_LOCAL ||
          item.code === AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_UPSTREAM,
      )
      .reduce((sum, item) => sum + item.count, 0);
    const timeoutErrorCount = errors
      .filter((item) => item.code === AI_FEEDBACK_ERROR_CODES.TIMEOUT)
      .reduce((sum, item) => sum + item.count, 0);

    return {
      classroom: {
        id: classroom._id.toString(),
        name: classroom.name,
        courseId: classroom.courseId.toString(),
        status: classroom.status ?? ClassroomStatus.Active,
      },
      window: resolvedWindow,
      generatedAt: now.toISOString(),
      progress: {
        studentsCount,
        publishedClassroomTasks: classroomTasks.length,
        dueClassroomTasks: classroomTasks.filter(
          (task) => !!task.dueAt && task.dueAt <= now,
        ).length,
        distinctStudentsSubmitted,
        submissionRate,
      },
      atRisk: {
        notSubmittedStudentsCount: riskStudentIds.length,
        sampleStudentIds: includeRiskStudentIds
          ? riskStudentIds.slice(
              0,
              TeacherClassroomWeeklyReportService.SAMPLE_RISK_STUDENT_LIMIT,
            )
          : [],
      },
      aiHealth: {
        jobs,
        successRate: jobs.total > 0 ? jobs.succeeded / jobs.total : 0,
        rateLimitRatio: jobs.total > 0 ? rateLimitErrorCount / jobs.total : 0,
        timeoutRatio: jobs.total > 0 ? timeoutErrorCount / jobs.total : 0,
        errors,
      },
      topTags,
    };
  }

  private async getSubmittedStudentIdSet(
    classroomTaskIds: Types.ObjectId[],
    classroomStudentObjectIds: Types.ObjectId[],
    lowerBound: Date,
  ) {
    const result = new Set<string>();
    if (
      classroomTaskIds.length === 0 ||
      classroomStudentObjectIds.length === 0
    ) {
      return result;
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          classroomTaskId: { $in: classroomTaskIds },
          studentId: { $in: classroomStudentObjectIds },
          createdAt: { $gte: lowerBound },
        },
      },
      {
        $group: {
          _id: null,
          studentIds: { $addToSet: '$studentId' },
        },
      },
    ];
    const aggregated = await this.submissionModel
      .aggregate<SubmittedStudentsAgg>(pipeline)
      .exec();
    const studentIds = aggregated[0]?.studentIds ?? [];
    for (const studentId of studentIds) {
      result.add(studentId.toString());
    }
    return result;
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private parseIncludeRiskStudentIds(value: string | undefined) {
    if (value === undefined) {
      return false;
    }
    return value.toLowerCase() === 'true';
  }

  private resolveWindow(window: ClassroomWeeklyReportWindow | undefined) {
    const resolved = CLASSROOM_WEEKLY_REPORT_WINDOWS.includes(
      window as ClassroomWeeklyReportWindow,
    )
      ? (window as ClassroomWeeklyReportWindow)
      : TeacherClassroomWeeklyReportService.DEFAULT_WINDOW;
    const lowerBound = new Date(
      Date.now() - TeacherClassroomWeeklyReportService.WINDOW_MS_MAP[resolved],
    );
    return { window: resolved, lowerBound };
  }
}
