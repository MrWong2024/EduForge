import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import {
  CLASS_REVIEW_PACK_WINDOWS,
  ClassReviewPackWindow,
  QueryClassReviewPackDto,
} from '../dto/query-class-review-pack.dto';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../../../learning-tasks/schemas/feedback.schema';
import { Submission } from '../../../learning-tasks/schemas/submission.schema';
import { User } from '../../../users/schemas/user.schema';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { AiFeedbackJobService } from '../../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackStatus } from '../../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { AiFeedbackMetricsAggregator } from './ai-feedback-metrics-aggregator.service';
import { WithId } from '../../../../common/types/with-id.type';
import { WithTimestamps } from '../../../../common/types/with-timestamps.type';

type ReviewSubmissionLean = Pick<
  Submission,
  'studentId' | 'attemptNo' | 'isLate'
> &
  WithId &
  WithTimestamps;
type ReviewClassroomTaskLean = Pick<ClassroomTask, 'classroomId'> & WithId;
type IssueTagAgg = { tag: string; count: number };
type IssueTypeAgg = { type: FeedbackType; count: number };
type IssueSeverityAgg = { severity: FeedbackSeverity; count: number };
type ExampleSampleAgg = {
  feedbackId: Types.ObjectId;
  submissionId: Types.ObjectId;
  severity: FeedbackSeverity;
  type: FeedbackType;
  message: string;
  suggestion?: string;
  source: FeedbackSource;
  tags: string[];
  matchedTag: string;
  createdAt?: Date;
};
type ExamplesByTagAgg = {
  tag: string;
  count: number;
  samples: ExampleSampleAgg[];
};
type SubmissionErrorCountAgg = {
  _id: Types.ObjectId;
  count: number;
};
type ReviewFeedbackFacetResult = {
  topTags: IssueTagAgg[];
  topTypes: IssueTypeAgg[];
  topSeverities: IssueSeverityAgg[];
  examplesByTag: ExamplesByTagAgg[];
  latestErrorCountsBySubmission: SubmissionErrorCountAgg[];
};
type ReviewPackExampleItem = {
  feedbackId: string;
  submissionId: string;
  attemptNo: number;
  severity: FeedbackSeverity;
  type: FeedbackType;
  message: string;
  suggestion?: string;
  source: FeedbackSource;
  primaryTag: string;
  matchedTags: string[];
  tags: string[];
};
type TierStudentItem = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
  attemptsCount: number;
  latestErrorCount: number;
};
type TierNotSubmittedItem = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
};
type ReviewPackStudentLean = Pick<User, 'name' | 'studentNo'> & WithId;
type ReviewPackStudentPublic = {
  studentName: string;
  studentNo: string | null;
};
type CommonIssuesByClassroomTaskFacetResult = {
  tags: Array<{
    _id: Types.ObjectId;
    rows: Array<{ tag: string; count: number }>;
  }>;
  types: Array<{
    _id: Types.ObjectId;
    rows: Array<{ type: FeedbackType; count: number }>;
  }>;
  severities: Array<{
    _id: Types.ObjectId;
    rows: Array<{ severity: FeedbackSeverity; count: number }>;
  }>;
};
export type ReviewPackCommonIssues = {
  topTags: Array<{ tag: string; count: number }>;
  topTypes: Array<{ type: FeedbackType; count: number }>;
  topSeverities: Array<{ severity: FeedbackSeverity; count: number }>;
};

@Injectable()
export class ClassReviewPackService {
  private static readonly DEFAULT_WINDOW: ClassReviewPackWindow = '7d';
  private static readonly DEFAULT_TOP_K = 10;
  private static readonly DEFAULT_EXAMPLES_PER_TAG = 2;
  private static readonly GOOD_TIER_LIMIT = 20;
  private static readonly WATCH_TIER_LIMIT = 20;
  private static readonly NOT_SUBMITTED_TIER_LIMIT = 50;
  private static readonly WINDOW_MS_MAP: Record<ClassReviewPackWindow, number> =
    {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
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
    private readonly aiFeedbackMetricsAggregator: AiFeedbackMetricsAggregator,
  ) {}

  async getReviewPack(
    classroomId: string,
    classroomTaskId: string,
    query: QueryClassReviewPackDto,
    teacherId: string,
  ) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const window = CLASS_REVIEW_PACK_WINDOWS.includes(
      query.window as ClassReviewPackWindow,
    )
      ? (query.window as ClassReviewPackWindow)
      : ClassReviewPackService.DEFAULT_WINDOW;
    const topK = query.topK ?? ClassReviewPackService.DEFAULT_TOP_K;
    const examplesPerTag =
      query.examplesPerTag ?? ClassReviewPackService.DEFAULT_EXAMPLES_PER_TAG;
    const lowerBound = new Date(
      Date.now() - ClassReviewPackService.WINDOW_MS_MAP[window],
    );

    // Z5 metric contract:
    // 1) All task-bound metrics are isolated by classroomTaskId.
    // 2) Membership source is Enrollment ACTIVE only.
    // 3) Window filtering is based on submissions.createdAt for review semantics.
    const [classroom, classroomTask] = await Promise.all([
      this.classroomModel
        .findOne({
          _id: classroomObjectId,
          teacherId: new Types.ObjectId(teacherId),
        })
        .select('_id')
        .lean<WithId>()
        .exec(),
      this.classroomTaskModel
        .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
        .select('_id classroomId')
        .lean<ReviewClassroomTaskLean>()
        .exec(),
    ]);
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const activeStudentIds =
      await this.enrollmentService.listActiveStudentIds(classroomObjectId);
    const studentsCount = activeStudentIds.length;
    const activeStudentObjectIds = activeStudentIds.map(
      (studentId) => new Types.ObjectId(studentId),
    );
    const studentPublicMap = new Map<string, ReviewPackStudentPublic>();
    if (activeStudentObjectIds.length > 0) {
      const students = await this.userModel
        .find({ _id: { $in: activeStudentObjectIds } })
        .select('name studentNo')
        .lean<ReviewPackStudentLean[]>()
        .exec();
      for (const student of students) {
        studentPublicMap.set(
          student._id.toString(),
          this.toReviewPackStudentPublic(student),
        );
      }
    }

    const submissions =
      activeStudentObjectIds.length === 0
        ? []
        : await this.submissionModel
            .find({
              classroomTaskId: classroomTaskObjectId,
              studentId: { $in: activeStudentObjectIds },
              createdAt: { $gte: lowerBound },
            })
            .select('_id studentId attemptNo createdAt isLate')
            .sort({ studentId: 1, attemptNo: 1, createdAt: 1 })
            .lean<ReviewSubmissionLean[]>()
            .exec();
    const submissionIds = submissions.map((submission) => submission._id);
    const submissionAttemptMap = new Map<string, number>();
    const attemptsCountByStudentId = new Map<string, number>();
    const latestSubmissionByStudentId = new Map<string, ReviewSubmissionLean>();
    let lateSubmissionsCount = 0;
    const lateStudentIdSet = new Set<string>();

    for (const submission of submissions) {
      const submissionId = submission._id.toString();
      const studentId = submission.studentId.toString();
      if (submission.isLate ?? false) {
        lateSubmissionsCount += 1;
        lateStudentIdSet.add(studentId);
      }
      submissionAttemptMap.set(submissionId, submission.attemptNo);
      const currentCount = attemptsCountByStudentId.get(studentId) ?? 0;
      attemptsCountByStudentId.set(studentId, currentCount + 1);
      const currentLatest = latestSubmissionByStudentId.get(studentId);
      if (!currentLatest) {
        latestSubmissionByStudentId.set(studentId, submission);
        continue;
      }
      const currentTime = currentLatest.createdAt?.getTime() ?? 0;
      const nextTime = submission.createdAt?.getTime() ?? 0;
      if (
        nextTime > currentTime ||
        (nextTime === currentTime &&
          submission.attemptNo > currentLatest.attemptNo)
      ) {
        latestSubmissionByStudentId.set(studentId, submission);
      }
    }

    const submittedStudentsCount = Array.from(
      attemptsCountByStudentId.values(),
    ).filter((count) => count > 0).length;
    const submissionRate =
      studentsCount > 0 ? submittedStudentsCount / studentsCount : 0;
    const attemptsDistribution = this.buildAttemptsDistribution(
      activeStudentIds,
      attemptsCountByStudentId,
    );

    const [{ jobs, errors }, feedbackFacets] = await Promise.all([
      this.aiFeedbackMetricsAggregator.aggregateJobsByClassroomTaskIds(
        [classroomTaskObjectId],
        lowerBound,
        'createdAt',
      ),
      this.aggregateReviewFeedbackFacets(submissionIds, topK, examplesPerTag),
    ]);
    const feedbackFacet = feedbackFacets[0] ?? {
      topTags: [],
      topTypes: [],
      topSeverities: [],
      examplesByTag: [],
      latestErrorCountsBySubmission: [],
    };

    const latestErrorCountBySubmissionId = new Map<string, number>();
    for (const item of feedbackFacet.latestErrorCountsBySubmission) {
      latestErrorCountBySubmissionId.set(item._id.toString(), item.count);
    }

    const examples = this.buildReviewPackExamples(
      feedbackFacet.examplesByTag,
      submissionAttemptMap,
    );

    const latestSubmissionIds = Array.from(
      latestSubmissionByStudentId.values(),
    ).map((submission) => submission._id);
    const latestAiStatusMap =
      latestSubmissionIds.length > 0
        ? await this.aiFeedbackJobService.getStatusMapBySubmissionIds(
            latestSubmissionIds,
          )
        : new Map<string, AiFeedbackStatus>();
    const resolvedStudentTiers = this.buildStudentTiers(
      activeStudentIds,
      attemptsCountByStudentId,
      latestSubmissionByStudentId,
      latestErrorCountBySubmissionId,
      latestAiStatusMap,
      studentPublicMap,
    );

    return {
      classroomId,
      classroomTaskId,
      window,
      generatedAt: new Date().toISOString(),
      overview: {
        studentsCount,
        submittedStudentsCount,
        submissionRate,
        attemptsDistribution,
        lateSubmissionsCount,
        lateStudentsCount: lateStudentIdSet.size,
        ai: {
          jobsTotal: jobs.total,
          successRate: jobs.total > 0 ? jobs.succeeded / jobs.total : 0,
          errorsTop: errors.slice(0, topK),
        },
      },
      commonIssues: {
        topTags: feedbackFacet.topTags,
        topTypes: feedbackFacet.topTypes,
        topSeverities: feedbackFacet.topSeverities,
      },
      examples,
      studentTiers: resolvedStudentTiers,
    };
  }

  async aggregateCommonIssuesBySubmissionIds(
    submissionIds: Types.ObjectId[],
    topK: number,
  ): Promise<ReviewPackCommonIssues> {
    const rows = await this.aggregateReviewFeedbackFacets(
      submissionIds,
      topK,
      ClassReviewPackService.DEFAULT_EXAMPLES_PER_TAG,
    );
    const commonIssues = rows[0] ?? {
      topTags: [],
      topTypes: [],
      topSeverities: [],
    };
    return {
      topTags: commonIssues.topTags,
      topTypes: commonIssues.topTypes,
      topSeverities: commonIssues.topSeverities,
    };
  }

  async aggregateCommonIssuesByClassroomTaskIds(
    classroomTaskIds: Types.ObjectId[],
    lowerBound: Date,
    topK: number,
    activeStudentIds?: Types.ObjectId[],
  ) {
    const result = new Map<string, ReviewPackCommonIssues>();
    for (const classroomTaskId of classroomTaskIds) {
      result.set(classroomTaskId.toString(), {
        topTags: [],
        topTypes: [],
        topSeverities: [],
      });
    }
    if (classroomTaskIds.length === 0 || topK <= 0) {
      return result;
    }
    if (activeStudentIds && activeStudentIds.length === 0) {
      return result;
    }

    const submissionMatch: Record<string, unknown> = {
      classroomTaskId: { $in: classroomTaskIds },
      createdAt: { $gte: lowerBound },
    };
    if (activeStudentIds && activeStudentIds.length > 0) {
      submissionMatch.studentId = { $in: activeStudentIds };
    }

    const rows = await this.feedbackModel
      .aggregate<CommonIssuesByClassroomTaskFacetResult>([
        {
          $lookup: {
            from: 'submissions',
            localField: 'submissionId',
            foreignField: '_id',
            pipeline: [
              {
                $match: submissionMatch,
              },
              { $project: { _id: 1, classroomTaskId: 1 } },
            ],
            as: 'submission',
          },
        },
        { $unwind: '$submission' },
        {
          $facet: {
            tags: [
              { $match: { tags: { $exists: true, $ne: [] } } },
              { $unwind: '$tags' },
              {
                $group: {
                  _id: {
                    classroomTaskId: '$submission.classroomTaskId',
                    tag: '$tags',
                  },
                  count: { $sum: 1 },
                },
              },
              {
                $sort: {
                  '_id.classroomTaskId': 1,
                  count: -1,
                  '_id.tag': 1,
                },
              },
              {
                $group: {
                  _id: '$_id.classroomTaskId',
                  rows: {
                    $push: {
                      tag: '$_id.tag',
                      count: '$count',
                    },
                  },
                },
              },
              { $project: { _id: 1, rows: { $slice: ['$rows', topK] } } },
            ],
            types: [
              {
                $group: {
                  _id: {
                    classroomTaskId: '$submission.classroomTaskId',
                    type: '$type',
                  },
                  count: { $sum: 1 },
                },
              },
              {
                $sort: {
                  '_id.classroomTaskId': 1,
                  count: -1,
                  '_id.type': 1,
                },
              },
              {
                $group: {
                  _id: '$_id.classroomTaskId',
                  rows: {
                    $push: {
                      type: '$_id.type',
                      count: '$count',
                    },
                  },
                },
              },
              { $project: { _id: 1, rows: { $slice: ['$rows', topK] } } },
            ],
            severities: [
              {
                $group: {
                  _id: {
                    classroomTaskId: '$submission.classroomTaskId',
                    severity: '$severity',
                  },
                  count: { $sum: 1 },
                },
              },
              {
                $sort: {
                  '_id.classroomTaskId': 1,
                  count: -1,
                  '_id.severity': 1,
                },
              },
              {
                $group: {
                  _id: '$_id.classroomTaskId',
                  rows: {
                    $push: {
                      severity: '$_id.severity',
                      count: '$count',
                    },
                  },
                },
              },
              { $project: { _id: 1, rows: { $slice: ['$rows', topK] } } },
            ],
          },
        },
      ] as PipelineStage[])
      .exec();
    const facet = rows[0] ?? { tags: [], types: [], severities: [] };

    for (const row of facet.tags) {
      const current = result.get(row._id.toString());
      if (!current) {
        continue;
      }
      current.topTags = row.rows;
      result.set(row._id.toString(), current);
    }
    for (const row of facet.types) {
      const current = result.get(row._id.toString());
      if (!current) {
        continue;
      }
      current.topTypes = row.rows;
      result.set(row._id.toString(), current);
    }
    for (const row of facet.severities) {
      const current = result.get(row._id.toString());
      if (!current) {
        continue;
      }
      current.topSeverities = row.rows;
      result.set(row._id.toString(), current);
    }

    return result;
  }

  private async aggregateReviewFeedbackFacets(
    submissionIds: Types.ObjectId[],
    topK: number,
    examplesPerTag: number,
  ) {
    if (submissionIds.length === 0) {
      return [] as ReviewFeedbackFacetResult[];
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          submissionId: { $in: submissionIds },
        },
      },
      {
        $facet: {
          topTags: [
            { $match: { tags: { $exists: true, $ne: [] } } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: topK },
            { $project: { _id: 0, tag: '$_id', count: 1 } },
          ],
          topTypes: [
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: topK },
            { $project: { _id: 0, type: '$_id', count: 1 } },
          ],
          topSeverities: [
            { $group: { _id: '$severity', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: topK },
            { $project: { _id: 0, severity: '$_id', count: 1 } },
          ],
          examplesByTag: [
            { $match: { tags: { $exists: true, $ne: [] } } },
            {
              $addFields: {
                allTags: '$tags',
                severityRank: {
                  $switch: {
                    branches: [
                      {
                        case: { $eq: ['$severity', FeedbackSeverity.Error] },
                        then: 3,
                      },
                      {
                        case: { $eq: ['$severity', FeedbackSeverity.Warn] },
                        then: 2,
                      },
                      {
                        case: { $eq: ['$severity', FeedbackSeverity.Info] },
                        then: 1,
                      },
                    ],
                    default: 0,
                  },
                },
              },
            },
            { $unwind: '$tags' },
            { $sort: { tags: 1, severityRank: -1, createdAt: -1, _id: 1 } },
            {
              $group: {
                _id: '$tags',
                count: { $sum: 1 },
                samples: {
                  $push: {
                    feedbackId: '$_id',
                    submissionId: '$submissionId',
                    severity: '$severity',
                    type: '$type',
                    message: '$message',
                    suggestion: '$suggestion',
                    source: '$source',
                    tags: '$allTags',
                    matchedTag: '$tags',
                    createdAt: '$createdAt',
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                tag: '$_id',
                count: 1,
                samples: { $slice: ['$samples', examplesPerTag] },
              },
            },
            { $sort: { count: -1, tag: 1 } },
            { $limit: topK },
          ],
          latestErrorCountsBySubmission: [
            {
              $match: {
                source: FeedbackSource.AI,
                severity: FeedbackSeverity.Error,
              },
            },
            { $group: { _id: '$submissionId', count: { $sum: 1 } } },
          ],
        },
      },
    ];

    return this.feedbackModel
      .aggregate<ReviewFeedbackFacetResult>(pipeline)
      .exec();
  }

  private buildReviewPackExamples(
    examplesByTag: ExamplesByTagAgg[],
    submissionAttemptMap: Map<string, number>,
  ): ReviewPackExampleItem[] {
    const dedupedByFeedbackId = new Map<
      string,
      ReviewPackExampleItem & { matchedTagSet: Set<string> }
    >();

    for (const group of examplesByTag) {
      for (const sample of group.samples) {
        const feedbackId = sample.feedbackId.toString();
        const submissionId = sample.submissionId.toString();
        const matchedTag =
          this.normalizeTagText(sample.matchedTag) ??
          this.normalizeTagText(group.tag) ??
          '未分类';
        const normalizedTags = this.normalizeExampleTags(sample.tags);
        const tags = normalizedTags.length > 0 ? normalizedTags : [matchedTag];
        const existing = dedupedByFeedbackId.get(feedbackId);

        if (!existing) {
          const matchedTagSet = new Set<string>();
          matchedTagSet.add(matchedTag);
          dedupedByFeedbackId.set(feedbackId, {
            feedbackId,
            submissionId,
            attemptNo: submissionAttemptMap.get(submissionId) ?? 0,
            severity: sample.severity,
            type: sample.type,
            message: sample.message,
            suggestion: sample.suggestion,
            source: sample.source,
            primaryTag: matchedTag,
            matchedTags: [],
            tags,
            matchedTagSet,
          });
          continue;
        }

        existing.matchedTagSet.add(matchedTag);
        if (existing.tags.length === 0 && tags.length > 0) {
          existing.tags = tags;
        }
      }
    }

    return Array.from(dedupedByFeedbackId.values())
      .sort((left, right) => {
        const severityDiff =
          this.getFeedbackSeverityRank(right.severity) -
          this.getFeedbackSeverityRank(left.severity);
        if (severityDiff !== 0) {
          return severityDiff;
        }
        return left.feedbackId.localeCompare(right.feedbackId);
      })
      .map(({ matchedTagSet, ...item }) => ({
        ...item,
        matchedTags: Array.from(matchedTagSet).sort((left, right) =>
          left.localeCompare(right),
        ),
      }));
  }

  private getFeedbackSeverityRank(severity: FeedbackSeverity) {
    if (severity === FeedbackSeverity.Error) {
      return 3;
    }
    if (severity === FeedbackSeverity.Warn) {
      return 2;
    }
    if (severity === FeedbackSeverity.Info) {
      return 1;
    }
    return 0;
  }

  private normalizeExampleTags(tags: string[]) {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const tag of tags) {
      const normalized = this.normalizeTagText(tag);
      if (!normalized) {
        continue;
      }
      const normalizedKey = normalized.toLowerCase();
      if (seen.has(normalizedKey)) {
        continue;
      }
      seen.add(normalizedKey);
      result.push(normalized);
    }
    return result;
  }

  private normalizeTagText(value: string | null | undefined) {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private buildAttemptsDistribution(
    activeStudentIds: string[],
    attemptsCountByStudentId: Map<string, number>,
  ) {
    const distribution = { '0': 0, '1': 0, '2': 0, '3plus': 0 };
    for (const studentId of activeStudentIds) {
      const count = attemptsCountByStudentId.get(studentId) ?? 0;
      if (count === 0) {
        distribution['0'] += 1;
      } else if (count === 1) {
        distribution['1'] += 1;
      } else if (count === 2) {
        distribution['2'] += 1;
      } else {
        distribution['3plus'] += 1;
      }
    }
    return distribution;
  }

  private buildStudentTiers(
    activeStudentIds: string[],
    attemptsCountByStudentId: Map<string, number>,
    latestSubmissionByStudentId: Map<string, ReviewSubmissionLean>,
    latestErrorCountBySubmissionId: Map<string, number>,
    latestAiStatusMap: Map<string, AiFeedbackStatus>,
    studentPublicMap: Map<string, ReviewPackStudentPublic>,
  ) {
    const good: TierStudentItem[] = [];
    const watch: TierStudentItem[] = [];
    const notSubmitted: TierNotSubmittedItem[] = [];

    for (const studentId of activeStudentIds) {
      const studentPublic =
        studentPublicMap.get(studentId) ??
        this.getFallbackReviewPackStudentPublic();
      const attemptsCount = attemptsCountByStudentId.get(studentId) ?? 0;
      if (attemptsCount === 0) {
        notSubmitted.push({
          studentId,
          studentName: studentPublic.studentName,
          studentNo: studentPublic.studentNo,
        });
        continue;
      }

      const latestSubmission = latestSubmissionByStudentId.get(studentId);
      if (!latestSubmission) {
        watch.push({
          studentId,
          studentName: studentPublic.studentName,
          studentNo: studentPublic.studentNo,
          attemptsCount,
          latestErrorCount: 0,
        });
        continue;
      }

      const latestSubmissionId = latestSubmission._id.toString();
      const latestErrorCount =
        latestErrorCountBySubmissionId.get(latestSubmissionId) ?? 0;
      const latestAiStatus =
        latestAiStatusMap.get(latestSubmissionId) ??
        AiFeedbackStatus.NotRequested;
      const entry = {
        studentId,
        studentName: studentPublic.studentName,
        studentNo: studentPublic.studentNo,
        attemptsCount,
        latestErrorCount,
      };
      if (
        latestErrorCount === 0 &&
        latestAiStatus === AiFeedbackStatus.Succeeded
      ) {
        good.push(entry);
      } else {
        watch.push(entry);
      }
    }

    good.sort((left, right) => left.studentId.localeCompare(right.studentId));
    watch.sort((left, right) => left.studentId.localeCompare(right.studentId));
    notSubmitted.sort((left, right) =>
      left.studentId.localeCompare(right.studentId),
    );

    return {
      good: good.slice(0, ClassReviewPackService.GOOD_TIER_LIMIT),
      watch: watch.slice(0, ClassReviewPackService.WATCH_TIER_LIMIT),
      notSubmitted: notSubmitted.slice(
        0,
        ClassReviewPackService.NOT_SUBMITTED_TIER_LIMIT,
      ),
    };
  }

  private toReviewPackStudentPublic(
    student: ReviewPackStudentLean,
  ): ReviewPackStudentPublic {
    const studentName =
      typeof student.name === 'string' && student.name.trim()
        ? student.name.trim()
        : '未知学生';
    const studentNo =
      typeof student.studentNo === 'string' && student.studentNo.trim()
        ? student.studentNo.trim()
        : null;
    return {
      studentName,
      studentNo,
    };
  }

  private getFallbackReviewPackStudentPublic(): ReviewPackStudentPublic {
    return {
      studentName: '未知学生',
      studentNo: null,
    };
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
