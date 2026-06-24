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
import { User } from '../../users/schemas/user.schema';

type SubmissionByStudentAgg = {
  _id: Types.ObjectId;
  submissionsCount: number;
  submittedTasksCount: number;
  iteratedTasksCount: number;
  lateSubmissionsCount: number;
  lateTasksCount: number;
  submissionIds: Types.ObjectId[];
};
type JobsByStudentAgg = {
  _id: Types.ObjectId;
  aiRequestedCount: number;
  aiSucceededCount: number;
  aiRequestedTasksCount: number;
  aiSucceededTasksCount: number;
};
type FeedbackTotalsByStudentAgg = {
  _id: Types.ObjectId;
  reviewedTasksCount: number;
  totalFeedbackItems: number;
  totalWarnItems: number;
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
type ProcessAssessmentStudentPublicInfo = {
  studentName: string;
  studentNo: string | null;
};
type ProcessAssessmentItem = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
  submittedTasksCount: number;
  publishedTasksCount: number;
  submittedTasksRate: number;
  submissionsCount: number;
  iteratedTasksCount: number;
  lateSubmissionsCount: number;
  lateTasksCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  aiRequestedTasksCount: number;
  aiSucceededTasksCount: number;
  avgFeedbackItems: number;
  avgWarnItems: number;
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
type ProcessAssessmentBuildOptions = {
  forceAllActiveStudents?: boolean;
  maxLimit?: number;
};

@Injectable()
export class ProcessAssessmentService {
  // v1 rubric constants:
  // score is process-assessment reference only and must not be used as final grade arbitration.
  private static readonly RUBRIC = {
    submittedTasksRate: 0.45,
    submissionsCount: 0.15,
    aiRequestQualityProxy: 0.2,
    codeQualityProxy: 0.2,
  } as const;
  private static readonly RISK_ORDER_MAP: Record<
    ProcessAssessmentRiskLevel,
    number
  > = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  };
  private static readonly DEFAULT_WINDOW: ProcessAssessmentWindow = 'all';
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly DEFAULT_SORT: ProcessAssessmentSortField = 'score';
  private static readonly DEFAULT_ORDER: ProcessAssessmentSortOrder = 'desc';
  private static readonly WINDOW_MS_MAP: Record<
    Exclude<ProcessAssessmentWindow, 'all'>,
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
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  async getProcessAssessment(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
  ) {
    return this.buildPayload(classroomId, query, teacherId);
  }

  async getProcessAssessmentForSnapshot(
    classroomId: string,
    window: ProcessAssessmentWindow | undefined,
    teacherId: string,
  ) {
    return this.buildPayload(
      classroomId,
      {
        window,
        page: 1,
        limit: 1000,
        sort: 'score',
        order: 'desc',
      },
      teacherId,
      {
        forceAllActiveStudents: true,
        maxLimit: 1000,
      },
    );
  }

  async exportProcessAssessmentCsv(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
  ) {
    const payload = await this.buildPayload(classroomId, query, teacherId);
    const headers = [
      'studentName',
      'studentNo',
      'studentId',
      'score',
      'riskLevel',
      'submittedTasksRate',
      'submissionsCount',
      'iteratedTasksCount',
      'lateSubmissionsCount',
      'lateTasksCount',
      'aiRequestedCount',
      'aiSucceededCount',
      'aiRequestedTasksCount',
      'aiSucceededTasksCount',
      'avgWarnItems',
      'avgErrorItems',
      'topTags',
    ];
    const rows = payload.items.map((item) => {
      const topTags = item.topTags
        .map((tag) => `${tag.tag}:${tag.count}`)
        .join(';');
      return [
        item.studentName,
        item.studentNo ?? '',
        item.studentId,
        item.score,
        item.riskLevel,
        item.submittedTasksRate,
        item.submissionsCount,
        item.iteratedTasksCount,
        item.lateSubmissionsCount,
        item.lateTasksCount,
        item.aiRequestedCount,
        item.aiSucceededCount,
        item.aiRequestedTasksCount,
        item.aiSucceededTasksCount,
        item.avgWarnItems,
        item.avgErrorItems,
        topTags,
      ]
        .map((cell) => this.escapeCsvCell(cell))
        .join(',');
    });
    const csvBody = [headers.join(','), ...rows].join('\n');
    return `\uFEFF${csvBody}`;
  }

  private async buildPayload(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    teacherId: string,
    options?: ProcessAssessmentBuildOptions,
  ): Promise<ProcessAssessmentPayload> {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const page = query.page ?? ProcessAssessmentService.DEFAULT_PAGE;
    const limit = Math.min(
      query.limit ?? ProcessAssessmentService.DEFAULT_LIMIT,
      options?.maxLimit ?? 100,
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
    const { window, lowerBound } = this.resolveWindow(query.window);
    const excludedTaskIdSet = this.buildExcludedTaskIdSet(
      query.excludedTaskIds,
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
    const taskMatch: Record<string, unknown> = {
      classroomId: classroomObjectId,
    };
    if (lowerBound) {
      taskMatch.publishedAt = { $gte: lowerBound };
    }
    const windowClassroomTasks = await this.classroomTaskModel
      .find(taskMatch)
      .select('_id')
      .lean<WithId[]>()
      .exec();
    let effectiveClassroomTasks = windowClassroomTasks;
    if (excludedTaskIdSet.size > 0) {
      const filteredClassroomTasks: WithId[] = [];
      for (const task of windowClassroomTasks) {
        if (!excludedTaskIdSet.has(task._id.toString())) {
          filteredClassroomTasks.push(task);
        }
      }
      effectiveClassroomTasks = filteredClassroomTasks;
    }
    const effectiveTaskIds = effectiveClassroomTasks.map((task) => task._id);
    const publishedTasksCount = effectiveTaskIds.length;

    const [total, pageStudentIds] = options?.forceAllActiveStudents
      ? await (async () => {
          const allStudentIds =
            await this.enrollmentService.listActiveStudentIds(
              classroomObjectId,
            );
          return [allStudentIds.length, allStudentIds] as const;
        })()
      : await Promise.all([
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
    const studentPublicMap =
      await this.buildStudentPublicInfoMap(pageStudentObjectIds);
    const submissionMatch: Record<string, unknown> = {
      classroomTaskId: { $in: effectiveTaskIds },
      studentId: { $in: pageStudentObjectIds },
    };
    if (lowerBound) {
      submissionMatch.createdAt = { $gte: lowerBound };
    }
    const submissionAgg =
      effectiveTaskIds.length === 0
        ? []
        : await this.submissionModel
            .aggregate<SubmissionByStudentAgg>([
              {
                $match: submissionMatch,
              },
              {
                $group: {
                  _id: {
                    studentId: '$studentId',
                    classroomTaskId: '$classroomTaskId',
                  },
                  submissionsCount: { $sum: 1 },
                  lateSubmissionsCount: {
                    $sum: {
                      $cond: [{ $ifNull: ['$isLate', false] }, 1, 0],
                    },
                  },
                  hasLateTask: {
                    $max: {
                      $cond: [{ $ifNull: ['$isLate', false] }, 1, 0],
                    },
                  },
                  submissionIds: { $addToSet: '$_id' },
                },
              },
              {
                $group: {
                  _id: '$_id.studentId',
                  submissionsCount: { $sum: '$submissionsCount' },
                  submittedTasksCount: { $sum: 1 },
                  iteratedTasksCount: {
                    $sum: {
                      $cond: [{ $gte: ['$submissionsCount', 2] }, 1, 0],
                    },
                  },
                  lateSubmissionsCount: { $sum: '$lateSubmissionsCount' },
                  lateTasksCount: { $sum: '$hasLateTask' },
                  submissionIdBuckets: { $push: '$submissionIds' },
                },
              },
              {
                $project: {
                  _id: 1,
                  submissionsCount: 1,
                  submittedTasksCount: 1,
                  iteratedTasksCount: 1,
                  lateSubmissionsCount: 1,
                  lateTasksCount: 1,
                  submissionIds: {
                    $reduce: {
                      input: '$submissionIdBuckets',
                      initialValue: [],
                      in: {
                        $setUnion: ['$$value', '$$this'],
                      },
                    },
                  },
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

    const feedbackMatch: Record<string, unknown> = {
      submissionId: { $in: submissionIds },
      source: FeedbackSource.AI,
    };
    if (lowerBound) {
      feedbackMatch.createdAt = { $gte: lowerBound };
    }
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
                $lookup: {
                  from: 'submissions',
                  localField: 'submissionId',
                  foreignField: '_id',
                  pipeline: [
                    { $project: { _id: 1, classroomTaskId: 1, studentId: 1 } },
                  ],
                  as: 'submission',
                },
              },
              { $unwind: '$submission' },
              {
                $match: {
                  'submission.classroomTaskId': { $in: effectiveTaskIds },
                  'submission.studentId': { $in: pageStudentObjectIds },
                },
              },
              {
                $group: {
                  _id: {
                    studentId: '$studentId',
                    classroomTaskId: '$submission.classroomTaskId',
                  },
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
              {
                $group: {
                  _id: '$_id.studentId',
                  aiRequestedCount: { $sum: '$aiRequestedCount' },
                  aiSucceededCount: { $sum: '$aiSucceededCount' },
                  aiRequestedTasksCount: { $sum: 1 },
                  aiSucceededTasksCount: {
                    $sum: {
                      $cond: [{ $gt: ['$aiSucceededCount', 0] }, 1, 0],
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
                $match: feedbackMatch,
              },
              {
                $lookup: {
                  from: 'submissions',
                  localField: 'submissionId',
                  foreignField: '_id',
                  pipeline: [
                    {
                      $project: {
                        _id: 1,
                        studentId: 1,
                        classroomTaskId: 1,
                        createdAt: 1,
                      },
                    },
                  ],
                  as: 'submission',
                },
              },
              { $unwind: '$submission' },
              {
                $match: {
                  'submission.studentId': { $in: pageStudentObjectIds },
                  'submission.classroomTaskId': { $in: effectiveTaskIds },
                },
              },
              {
                $group: {
                  _id: {
                    studentId: '$submission.studentId',
                    classroomTaskId: '$submission.classroomTaskId',
                    submissionId: '$submissionId',
                  },
                  submissionCreatedAt: { $max: '$submission.createdAt' },
                  feedbackCreatedAt: { $max: '$createdAt' },
                  feedbackItems: { $sum: 1 },
                  warnItems: {
                    $sum: {
                      $cond: [
                        { $eq: ['$severity', FeedbackSeverity.Warn] },
                        1,
                        0,
                      ],
                    },
                  },
                  errorItems: {
                    $sum: {
                      $cond: [
                        { $eq: ['$severity', FeedbackSeverity.Error] },
                        1,
                        0,
                      ],
                    },
                  },
                  tagBuckets: { $push: { $ifNull: ['$tags', []] } },
                },
              },
              {
                $sort: {
                  '_id.studentId': 1,
                  '_id.classroomTaskId': 1,
                  submissionCreatedAt: -1,
                  feedbackCreatedAt: -1,
                  '_id.submissionId': -1,
                },
              },
              {
                $group: {
                  _id: {
                    studentId: '$_id.studentId',
                    classroomTaskId: '$_id.classroomTaskId',
                  },
                  feedbackItems: { $first: '$feedbackItems' },
                  warnItems: { $first: '$warnItems' },
                  errorItems: { $first: '$errorItems' },
                  tagBuckets: { $first: '$tagBuckets' },
                },
              },
              {
                $facet: {
                  totals: [
                    {
                      $group: {
                        _id: '$_id.studentId',
                        reviewedTasksCount: { $sum: 1 },
                        totalFeedbackItems: { $sum: '$feedbackItems' },
                        totalWarnItems: { $sum: '$warnItems' },
                        totalErrorItems: { $sum: '$errorItems' },
                      },
                    },
                  ],
                  tags: [
                    {
                      $project: {
                        _id: 1,
                        tags: {
                          $reduce: {
                            input: '$tagBuckets',
                            initialValue: [],
                            in: { $concatArrays: ['$$value', '$$this'] },
                          },
                        },
                      },
                    },
                    { $match: { tags: { $exists: true, $ne: [] } } },
                    { $unwind: '$tags' },
                    {
                      $group: {
                        _id: {
                          studentId: '$_id.studentId',
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
        iteratedTasksCount: number;
        lateSubmissionsCount: number;
        lateTasksCount: number;
      }
    >();
    for (const row of submissionAgg) {
      submissionMap.set(row._id.toString(), {
        submissionsCount: row.submissionsCount,
        submittedTasksCount: row.submittedTasksCount,
        iteratedTasksCount: row.iteratedTasksCount,
        lateSubmissionsCount: row.lateSubmissionsCount,
        lateTasksCount: row.lateTasksCount,
      });
    }

    const jobMap = new Map<
      string,
      {
        aiRequestedCount: number;
        aiSucceededCount: number;
        aiRequestedTasksCount: number;
        aiSucceededTasksCount: number;
      }
    >();
    for (const row of jobsAgg) {
      jobMap.set(row._id.toString(), {
        aiRequestedCount: row.aiRequestedCount,
        aiSucceededCount: row.aiSucceededCount,
        aiRequestedTasksCount: row.aiRequestedTasksCount,
        aiSucceededTasksCount: row.aiSucceededTasksCount,
      });
    }

    const feedbackFacet = feedbackFacetAgg[0] ?? { totals: [], tags: [] };
    const feedbackTotalsMap = new Map<
      string,
      {
        reviewedTasksCount: number;
        totalFeedbackItems: number;
        totalWarnItems: number;
        totalErrorItems: number;
      }
    >();
    for (const row of feedbackFacet.totals) {
      feedbackTotalsMap.set(row._id.toString(), {
        reviewedTasksCount: row.reviewedTasksCount,
        totalFeedbackItems: row.totalFeedbackItems,
        totalWarnItems: row.totalWarnItems,
        totalErrorItems: row.totalErrorItems,
      });
    }

    const topTagsMap = new Map<string, Array<{ tag: string; count: number }>>();
    for (const row of feedbackFacet.tags) {
      topTagsMap.set(row._id.toString(), row.topTags);
    }

    // v1 engineering tradeoff: sorting is page-local after Enrollment stable pagination.
    const items = pageStudentIds.map((studentId) => {
      const studentPublic =
        studentPublicMap.get(studentId) ?? this.toFallbackStudentPublicInfo();
      const submissionStats = submissionMap.get(studentId) ?? {
        submissionsCount: 0,
        submittedTasksCount: 0,
        iteratedTasksCount: 0,
        lateSubmissionsCount: 0,
        lateTasksCount: 0,
      };
      const jobStats = jobMap.get(studentId) ?? {
        aiRequestedCount: 0,
        aiSucceededCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      };
      const feedbackStats = feedbackTotalsMap.get(studentId) ?? {
        reviewedTasksCount: 0,
        totalFeedbackItems: 0,
        totalWarnItems: 0,
        totalErrorItems: 0,
      };
      const submittedTasksRate =
        publishedTasksCount > 0
          ? this.clamp(
              submissionStats.submittedTasksCount / publishedTasksCount,
              0,
              1,
            )
          : 0;
      const avgFeedbackItems =
        feedbackStats.reviewedTasksCount > 0
          ? feedbackStats.totalFeedbackItems / feedbackStats.reviewedTasksCount
          : 0;
      const avgWarnItems =
        feedbackStats.reviewedTasksCount > 0
          ? feedbackStats.totalWarnItems / feedbackStats.reviewedTasksCount
          : 0;
      const avgErrorItems =
        feedbackStats.reviewedTasksCount > 0
          ? feedbackStats.totalErrorItems / feedbackStats.reviewedTasksCount
          : 0;
      const normalizedAvgFeedbackItems = Number(avgFeedbackItems.toFixed(4));
      const normalizedAvgWarnItems = Number(avgWarnItems.toFixed(4));
      const normalizedAvgErrorItems = Number(avgErrorItems.toFixed(4));
      const riskLevel = this.toRiskLevel({
        effectiveTaskCount: publishedTasksCount,
        submissionsCount: submissionStats.submissionsCount,
        taskCoverageRatio: submittedTasksRate,
        avgWarnItems: normalizedAvgWarnItems,
        avgErrorItems: normalizedAvgErrorItems,
      });
      // Z7 v1: late metrics are display-only and do not directly change risk/score
      // until policy thresholds are explicitly approved.
      const score = this.toScore({
        effectiveTaskCount: publishedTasksCount,
        submittedTasksCount: submissionStats.submittedTasksCount,
        submissionsCount: submissionStats.submissionsCount,
        iteratedTasksCount: submissionStats.iteratedTasksCount,
        aiRequestedTasksCount: jobStats.aiRequestedTasksCount,
        aiSucceededTasksCount: jobStats.aiSucceededTasksCount,
        avgWarnItems: normalizedAvgWarnItems,
        avgErrorItems: normalizedAvgErrorItems,
      });
      return {
        studentId,
        studentName: studentPublic.studentName,
        studentNo: studentPublic.studentNo,
        submittedTasksCount: submissionStats.submittedTasksCount,
        publishedTasksCount,
        submittedTasksRate: Number(submittedTasksRate.toFixed(4)),
        submissionsCount: submissionStats.submissionsCount,
        iteratedTasksCount: submissionStats.iteratedTasksCount,
        lateSubmissionsCount: submissionStats.lateSubmissionsCount,
        lateTasksCount: submissionStats.lateTasksCount,
        aiRequestedCount: jobStats.aiRequestedCount,
        aiSucceededCount: jobStats.aiSucceededCount,
        aiRequestedTasksCount: jobStats.aiRequestedTasksCount,
        aiSucceededTasksCount: jobStats.aiSucceededTasksCount,
        avgFeedbackItems: normalizedAvgFeedbackItems,
        avgWarnItems: normalizedAvgWarnItems,
        avgErrorItems: normalizedAvgErrorItems,
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

  private resolveWindow(window: ProcessAssessmentWindow | undefined) {
    const resolved = PROCESS_ASSESSMENT_WINDOWS.includes(
      window as ProcessAssessmentWindow,
    )
      ? (window as ProcessAssessmentWindow)
      : ProcessAssessmentService.DEFAULT_WINDOW;
    if (resolved === 'all') {
      return { window: resolved, lowerBound: null };
    }
    const lowerBound = new Date(
      Date.now() - ProcessAssessmentService.WINDOW_MS_MAP[resolved],
    );
    return { window: resolved, lowerBound };
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

  private toRiskLevel(params: {
    effectiveTaskCount: number;
    submissionsCount: number;
    taskCoverageRatio: number;
    avgWarnItems: number;
    avgErrorItems: number;
  }): ProcessAssessmentRiskLevel {
    if (params.effectiveTaskCount <= 0) {
      return 'LOW';
    }
    if (params.submissionsCount <= 0) {
      return 'HIGH';
    }
    if (params.taskCoverageRatio < 0.4) {
      return 'HIGH';
    }
    if (params.avgErrorItems >= 2) {
      return 'HIGH';
    }
    if (params.taskCoverageRatio < 0.8) {
      return 'MEDIUM';
    }
    if (params.avgErrorItems >= 1) {
      return 'MEDIUM';
    }
    if (params.avgWarnItems >= 2) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private toScore(params: {
    effectiveTaskCount: number;
    submittedTasksCount: number;
    submissionsCount: number;
    iteratedTasksCount: number;
    aiRequestedTasksCount: number;
    aiSucceededTasksCount: number;
    avgWarnItems: number;
    avgErrorItems: number;
  }) {
    if (params.effectiveTaskCount <= 0 || params.submissionsCount <= 0) {
      return 0;
    }

    const taskCoverageRatio = this.clamp(
      params.submittedTasksCount / params.effectiveTaskCount,
      0,
      1,
    );
    const iterationTaskRatio = this.clamp(
      params.iteratedTasksCount / params.effectiveTaskCount,
      0,
      1,
    );
    const submissionEngagementRatio = this.clamp(
      taskCoverageRatio * 0.85 + iterationTaskRatio * 0.15,
      0,
      1,
    );
    const aiTaskCoverageRatio = this.clamp(
      params.aiRequestedTasksCount / params.effectiveTaskCount,
      0,
      1,
    );
    const aiTaskSuccessRate =
      params.aiRequestedTasksCount > 0
        ? this.clamp(
            params.aiSucceededTasksCount / params.aiRequestedTasksCount,
            0,
            1,
          )
        : 0;
    const aiQualityRatio = this.clamp(
      aiTaskCoverageRatio * (0.8 + aiTaskSuccessRate * 0.2),
      0,
      1,
    );
    const qualityPenalty = params.avgWarnItems * 0.5 + params.avgErrorItems;
    const codeQualityRatio = this.clamp(1 - qualityPenalty / 2, 0, 1);

    const submittedTasksRateScore =
      taskCoverageRatio *
      ProcessAssessmentService.RUBRIC.submittedTasksRate *
      100;
    const submissionsCountScore =
      submissionEngagementRatio *
      ProcessAssessmentService.RUBRIC.submissionsCount *
      100;
    const aiRequestQualityProxyScore =
      aiQualityRatio *
      ProcessAssessmentService.RUBRIC.aiRequestQualityProxy *
      100;
    const codeQualityProxyScore =
      codeQualityRatio * ProcessAssessmentService.RUBRIC.codeQualityProxy * 100;
    const score =
      submittedTasksRateScore +
      submissionsCountScore +
      aiRequestQualityProxyScore +
      codeQualityProxyScore;
    return Math.round(this.clamp(score, 0, 100));
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

  private buildExcludedTaskIdSet(excludedTaskIds: string[] | undefined) {
    const excludedTaskIdSet = new Set<string>();
    for (const taskId of excludedTaskIds ?? []) {
      const trimmedTaskId = taskId.trim();
      if (trimmedTaskId.length === 0) {
        continue;
      }
      if (
        !/^[0-9a-fA-F]{24}$/.test(trimmedTaskId) ||
        !Types.ObjectId.isValid(trimmedTaskId)
      ) {
        throw new BadRequestException(
          'excludedTaskIds must contain valid ObjectIds',
        );
      }
      excludedTaskIdSet.add(new Types.ObjectId(trimmedTaskId).toString());
    }
    return excludedTaskIdSet;
  }

  private async buildStudentPublicInfoMap(studentIds: Types.ObjectId[]) {
    const students = await this.userModel
      .find({ _id: { $in: studentIds } })
      .select('_id name studentNo')
      .lean<Array<WithId & { name?: string; studentNo?: string }>>()
      .exec();

    const studentPublicMap = new Map<
      string,
      ProcessAssessmentStudentPublicInfo
    >();
    for (const student of students) {
      studentPublicMap.set(
        student._id.toString(),
        this.toStudentPublicInfo(student),
      );
    }
    return studentPublicMap;
  }

  private toStudentPublicInfo(student: {
    name?: string;
    studentNo?: string;
  }): ProcessAssessmentStudentPublicInfo {
    const normalizedName = student.name?.trim();
    const normalizedStudentNo = student.studentNo?.trim();
    return {
      studentName:
        normalizedName && normalizedName.length > 0
          ? normalizedName
          : '未知学生',
      studentNo:
        normalizedStudentNo && normalizedStudentNo.length > 0
          ? normalizedStudentNo
          : null,
    };
  }

  private toFallbackStudentPublicInfo(): ProcessAssessmentStudentPublicInfo {
    return {
      studentName: '未知学生',
      studentNo: null,
    };
  }
}
