import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import {
  PROCESS_ASSESSMENT_SORT_FIELDS,
  PROCESS_ASSESSMENT_SORT_ORDERS,
  PROCESS_ASSESSMENT_WINDOWS,
  ProcessAssessmentSortField,
  ProcessAssessmentSortOrder,
  ProcessAssessmentWindow,
  QueryProcessAssessmentDto,
} from '../dto/query-process-assessment.dto';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { WithId } from '../../../common/types/with-id.type';

type SubmissionByStudentAgg = {
  _id: Types.ObjectId;
  submissionsCount: number;
  submittedTasksCount: number;
  lateSubmissionsCount: number;
  lateTasksCount: number;
  submissionIds: Types.ObjectId[];
};
type JobsByStudentAgg = {
  _id: Types.ObjectId;
  aiRequestedCount: number;
  aiSucceededCount: number;
};
type FeedbackTotalsByStudentAgg = {
  _id: Types.ObjectId;
  totalFeedbackItems: number;
  totalErrorItems: number;
};
type FeedbackTagsByStudentAgg = {
  _id: Types.ObjectId;
  topTags: Array<{ tag: string; count: number }>;
};
type FeedbackFacetResult = {
  totals: FeedbackTotalsByStudentAgg[];
  tags: FeedbackTagsByStudentAgg[];
};

type ProcessAssessmentRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type ProcessAssessmentItem = {
  studentId: string;
  submittedTasksCount: number;
  publishedTasksCount: number;
  submittedTasksRate: number;
  submissionsCount: number;
  lateSubmissionsCount: number;
  lateTasksCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  avgFeedbackItems: number;
  avgErrorItems: number;
  topTags: Array<{ tag: string; count: number }>;
  riskLevel: ProcessAssessmentRiskLevel;
  score: number;
};
type ProcessAssessmentPayload = {
  classroomId: string;
  window: ProcessAssessmentWindow;
  generatedAt: string;
  page: number;
  limit: number;
  total: number;
  rubric: {
    submittedTasksRate: number;
    submissionsCount: number;
    aiRequestQualityProxy: number;
    codeQualityProxy: number;
  };
  items: ProcessAssessmentItem[];
};

@Injectable()
export class ProcessAssessmentService {
  // v1 rubric constants:
  // score is process-assessment reference only and must not be used as final grade arbitration.
  private static readonly RUBRIC = {
    submittedTasksRate: 0.4,
    submissionsCount: 0.2,
    aiRequestQualityProxy: 0.2,
    codeQualityProxy: 0.2,
  } as const;
  // v1 risk thresholds:
  // HIGH: submittedTasksRate < 0.4 OR avgErrorItems >= 3
  // MEDIUM: submittedTasksRate < 0.7 OR avgErrorItems >= 1
  // LOW: otherwise
  private static readonly RISK_ORDER_MAP: Record<
    ProcessAssessmentRiskLevel,
    number
  > = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  };
  private static readonly DEFAULT_WINDOW: ProcessAssessmentWindow = '30d';
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly DEFAULT_SORT: ProcessAssessmentSortField = 'score';
  private static readonly DEFAULT_ORDER: ProcessAssessmentSortOrder = 'desc';
  private static readonly WINDOW_MS_MAP: Record<
    ProcessAssessmentWindow,
    number
  > = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    // TODO: connect term boundary once semester timeline source is available.
    term: 30 * 24 * 60 * 60 * 1000,
  };

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  async getProcessAssessment(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
  ) {
    return this.buildPayload(classroomId, query, teacherId);
  }

  async exportProcessAssessmentCsv(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
  ) {
    const payload = await this.buildPayload(classroomId, query, teacherId);
    const headers = [
      'studentId',
      'score',
      'riskLevel',
      'submittedTasksRate',
      'submissionsCount',
      'lateSubmissionsCount',
      'lateTasksCount',
      'aiRequestedCount',
      'aiSucceededCount',
      'avgErrorItems',
      'topTags',
    ];
    const rows = payload.items.map((item) => {
      const topTags = item.topTags
        .map((tag) => `${tag.tag}:${tag.count}`)
        .join(';');
      return [
        item.studentId,
        item.score,
        item.riskLevel,
        item.submittedTasksRate,
        item.submissionsCount,
        item.lateSubmissionsCount,
        item.lateTasksCount,
        item.aiRequestedCount,
        item.aiSucceededCount,
        item.avgErrorItems,
        topTags,
      ]
        .map((cell) => this.escapeCsvCell(cell))
        .join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  private async buildPayload(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
  ): Promise<ProcessAssessmentPayload> {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const page = query.page ?? ProcessAssessmentService.DEFAULT_PAGE;
    const limit = Math.min(
      query.limit ?? ProcessAssessmentService.DEFAULT_LIMIT,
      100,
    );
    const sort = PROCESS_ASSESSMENT_SORT_FIELDS.includes(
      query.sort as ProcessAssessmentSortField,
    )
      ? (query.sort as ProcessAssessmentSortField)
      : ProcessAssessmentService.DEFAULT_SORT;
    const order = PROCESS_ASSESSMENT_SORT_ORDERS.includes(
      query.order as ProcessAssessmentSortOrder,
    )
      ? (query.order as ProcessAssessmentSortOrder)
      : ProcessAssessmentService.DEFAULT_ORDER;
    const window = PROCESS_ASSESSMENT_WINDOWS.includes(
      query.window as ProcessAssessmentWindow,
    )
      ? (query.window as ProcessAssessmentWindow)
      : ProcessAssessmentService.DEFAULT_WINDOW;
    const lowerBound = new Date(
      Date.now() - ProcessAssessmentService.WINDOW_MS_MAP[window],
    );

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id')
      .lean<WithId>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    // Window task scope uses publishedAt to reflect assessment exposure window.
    // tasks are still isolated by classroomId.
    const windowClassroomTasks = await this.classroomTaskModel
      .find({
        classroomId: classroomObjectId,
        publishedAt: { $gte: lowerBound },
      })
      .select('_id')
      .lean<WithId[]>()
      .exec();
    const windowTaskIds = windowClassroomTasks.map((task) => task._id);
    const publishedTasksCount = windowTaskIds.length;

    const [total, pageStudentIds] = await Promise.all([
      this.enrollmentService.countStudents(classroomObjectId.toString()),
      this.enrollmentService.listActiveStudentIdsByClassroomPage(
        classroomObjectId,
        page,
        limit,
      ),
    ]);

    if (pageStudentIds.length === 0) {
      return {
        classroomId,
        window,
        generatedAt: new Date().toISOString(),
        page,
        limit,
        total,
        rubric: { ...ProcessAssessmentService.RUBRIC },
        items: [],
      };
    }

    const pageStudentObjectIds = pageStudentIds.map(
      (studentId) => new Types.ObjectId(studentId),
    );
    const submissionAgg =
      windowTaskIds.length === 0
        ? []
        : await this.submissionModel
            .aggregate<SubmissionByStudentAgg>([
              {
                $match: {
                  classroomTaskId: { $in: windowTaskIds },
                  studentId: { $in: pageStudentObjectIds },
                  createdAt: { $gte: lowerBound },
                },
              },
              {
                $group: {
                  _id: '$studentId',
                  submissionsCount: { $sum: 1 },
                  submittedTaskIds: { $addToSet: '$classroomTaskId' },
                  lateSubmissionsCount: {
                    $sum: {
                      $cond: [{ $ifNull: ['$isLate', false] }, 1, 0],
                    },
                  },
                  lateTaskIdsRaw: {
                    $addToSet: {
                      $cond: [
                        { $ifNull: ['$isLate', false] },
                        '$classroomTaskId',
                        null,
                      ],
                    },
                  },
                  submissionIds: { $addToSet: '$_id' },
                },
              },
              {
                $project: {
                  _id: 1,
                  submissionsCount: 1,
                  submittedTasksCount: { $size: '$submittedTaskIds' },
                  lateSubmissionsCount: 1,
                  lateTasksCount: {
                    $size: {
                      $filter: {
                        input: '$lateTaskIdsRaw',
                        as: 'taskId',
                        cond: { $ne: ['$$taskId', null] },
                      },
                    },
                  },
                  submissionIds: 1,
                },
              },
            ] as PipelineStage[])
            .exec();

    const submissionIds = Array.from(
      new Set(
        submissionAgg.flatMap((item) =>
          item.submissionIds.map((submissionId) => submissionId.toString()),
        ),
      ),
    ).map((submissionId) => new Types.ObjectId(submissionId));

    const [jobsAgg, feedbackFacetAgg] = await Promise.all([
      submissionIds.length === 0
        ? Promise.resolve([] as JobsByStudentAgg[])
        : this.aiFeedbackJobModel
            .aggregate<JobsByStudentAgg>([
              {
                $match: {
                  submissionId: { $in: submissionIds },
                  studentId: { $in: pageStudentObjectIds },
                },
              },
              {
                $group: {
                  _id: '$studentId',
                  aiRequestedCount: { $sum: 1 },
                  aiSucceededCount: {
                    $sum: {
                      $cond: [
                        { $eq: ['$status', AiFeedbackJobStatus.Succeeded] },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ] as PipelineStage[])
            .exec(),
      submissionIds.length === 0
        ? Promise.resolve([] as FeedbackFacetResult[])
        : this.feedbackModel
            .aggregate<FeedbackFacetResult>([
              {
                $match: {
                  submissionId: { $in: submissionIds },
                  source: FeedbackSource.AI,
                  createdAt: { $gte: lowerBound },
                },
              },
              {
                $lookup: {
                  from: 'submissions',
                  localField: 'submissionId',
                  foreignField: '_id',
                  pipeline: [{ $project: { _id: 1, studentId: 1 } }],
                  as: 'submission',
                },
              },
              { $unwind: '$submission' },
              {
                $match: {
                  'submission.studentId': { $in: pageStudentObjectIds },
                },
              },
              {
                $facet: {
                  totals: [
                    {
                      $group: {
                        _id: '$submission.studentId',
                        totalFeedbackItems: { $sum: 1 },
                        totalErrorItems: {
                          $sum: {
                            $cond: [
                              { $eq: ['$severity', FeedbackSeverity.Error] },
                              1,
                              0,
                            ],
                          },
                        },
                      },
                    },
                  ],
                  tags: [
                    { $match: { tags: { $exists: true, $ne: [] } } },
                    { $unwind: '$tags' },
                    {
                      $group: {
                        _id: {
                          studentId: '$submission.studentId',
                          tag: '$tags',
                        },
                        count: { $sum: 1 },
                      },
                    },
                    { $sort: { '_id.studentId': 1, count: -1, '_id.tag': 1 } },
                    {
                      $group: {
                        _id: '$_id.studentId',
                        tags: { $push: { tag: '$_id.tag', count: '$count' } },
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        topTags: { $slice: ['$tags', 5] },
                      },
                    },
                  ],
                },
              },
            ] as PipelineStage[])
            .exec(),
    ]);

    const submissionMap = new Map<
      string,
      {
        submissionsCount: number;
        submittedTasksCount: number;
        lateSubmissionsCount: number;
        lateTasksCount: number;
      }
    >();
    for (const row of submissionAgg) {
      submissionMap.set(row._id.toString(), {
        submissionsCount: row.submissionsCount,
        submittedTasksCount: row.submittedTasksCount,
        lateSubmissionsCount: row.lateSubmissionsCount,
        lateTasksCount: row.lateTasksCount,
      });
    }

    const jobMap = new Map<
      string,
      {
        aiRequestedCount: number;
        aiSucceededCount: number;
      }
    >();
    for (const row of jobsAgg) {
      jobMap.set(row._id.toString(), {
        aiRequestedCount: row.aiRequestedCount,
        aiSucceededCount: row.aiSucceededCount,
      });
    }

    const feedbackFacet = feedbackFacetAgg[0] ?? { totals: [], tags: [] };
    const feedbackTotalsMap = new Map<
      string,
      {
        totalFeedbackItems: number;
        totalErrorItems: number;
      }
    >();
    for (const row of feedbackFacet.totals) {
      feedbackTotalsMap.set(row._id.toString(), {
        totalFeedbackItems: row.totalFeedbackItems,
        totalErrorItems: row.totalErrorItems,
      });
    }

    const topTagsMap = new Map<string, Array<{ tag: string; count: number }>>();
    for (const row of feedbackFacet.tags) {
      topTagsMap.set(row._id.toString(), row.topTags);
    }

    // v1 engineering tradeoff: sorting is page-local after Enrollment stable pagination.
    const items = pageStudentIds.map((studentId) => {
      const submissionStats = submissionMap.get(studentId) ?? {
        submissionsCount: 0,
        submittedTasksCount: 0,
        lateSubmissionsCount: 0,
        lateTasksCount: 0,
      };
      const jobStats = jobMap.get(studentId) ?? {
        aiRequestedCount: 0,
        aiSucceededCount: 0,
      };
      const feedbackStats = feedbackTotalsMap.get(studentId) ?? {
        totalFeedbackItems: 0,
        totalErrorItems: 0,
      };
      const submittedTasksRate =
        submissionStats.submittedTasksCount / Math.max(publishedTasksCount, 1);
      const avgFeedbackItems =
        submissionStats.submissionsCount > 0
          ? feedbackStats.totalFeedbackItems / submissionStats.submissionsCount
          : 0;
      const avgErrorItems =
        submissionStats.submissionsCount > 0
          ? feedbackStats.totalErrorItems / submissionStats.submissionsCount
          : 0;
      const riskLevel = this.toRiskLevel(submittedTasksRate, avgErrorItems);
      // Z7 v1: late metrics are display-only and do not directly change risk/score
      // until policy thresholds are explicitly approved.
      const score = this.toScore({
        submittedTasksRate,
        submissionsCount: submissionStats.submissionsCount,
        aiRequestedCount: jobStats.aiRequestedCount,
        avgErrorItems,
      });
      return {
        studentId,
        submittedTasksCount: submissionStats.submittedTasksCount,
        publishedTasksCount,
        submittedTasksRate: Number(submittedTasksRate.toFixed(4)),
        submissionsCount: submissionStats.submissionsCount,
        lateSubmissionsCount: submissionStats.lateSubmissionsCount,
        lateTasksCount: submissionStats.lateTasksCount,
        aiRequestedCount: jobStats.aiRequestedCount,
        aiSucceededCount: jobStats.aiSucceededCount,
        avgFeedbackItems: Number(avgFeedbackItems.toFixed(4)),
        avgErrorItems: Number(avgErrorItems.toFixed(4)),
        topTags: topTagsMap.get(studentId) ?? [],
        riskLevel,
        score,
      } as ProcessAssessmentItem;
    });

    items.sort((left, right) => this.compareItems(left, right, sort, order));

    return {
      classroomId,
      window,
      generatedAt: new Date().toISOString(),
      page,
      limit,
      total,
      rubric: { ...ProcessAssessmentService.RUBRIC },
      items,
    };
  }

  private compareItems(
    left: ProcessAssessmentItem,
    right: ProcessAssessmentItem,
    sort: ProcessAssessmentSortField,
    order: ProcessAssessmentSortOrder,
  ) {
    const leftValue =
      sort === 'riskLevel'
        ? ProcessAssessmentService.RISK_ORDER_MAP[left.riskLevel]
        : left[sort];
    const rightValue =
      sort === 'riskLevel'
        ? ProcessAssessmentService.RISK_ORDER_MAP[right.riskLevel]
        : right[sort];
    if (leftValue !== rightValue) {
      const diff = leftValue - rightValue;
      return order === 'asc' ? diff : -diff;
    }
    return left.studentId.localeCompare(right.studentId);
  }

  private toRiskLevel(
    submittedTasksRate: number,
    avgErrorItems: number,
  ): ProcessAssessmentRiskLevel {
    if (submittedTasksRate < 0.4 || avgErrorItems >= 3) {
      return 'HIGH';
    }
    if (submittedTasksRate < 0.7 || avgErrorItems >= 1) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private toScore(params: {
    submittedTasksRate: number;
    submissionsCount: number;
    aiRequestedCount: number;
    avgErrorItems: number;
  }) {
    const submittedTasksScore =
      params.submittedTasksRate *
      ProcessAssessmentService.RUBRIC.submittedTasksRate *
      100;
    const submissionsCountScore =
      (Math.min(params.submissionsCount, 10) / 10) *
      ProcessAssessmentService.RUBRIC.submissionsCount *
      100;
    // aiRequestedCount is only an engagement proxy and not a final-grade signal.
    const aiRequestQualityProxyScore =
      (Math.min(params.aiRequestedCount, 10) / 10) *
      ProcessAssessmentService.RUBRIC.aiRequestQualityProxy *
      100;
    const codeQualityProxyScore =
      (1 - this.clamp(params.avgErrorItems / 5, 0, 1)) *
      ProcessAssessmentService.RUBRIC.codeQualityProxy *
      100;
    const score =
      submittedTasksScore +
      submissionsCountScore +
      aiRequestQualityProxyScore +
      codeQualityProxyScore;
    return Number(this.clamp(score, 0, 100).toFixed(2));
  }

  private clamp(value: number, min: number, max: number) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  private escapeCsvCell(value: string | number) {
    const normalized = String(value);
    if (/[",\n\r]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
