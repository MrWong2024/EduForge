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
  submissionId: Types.ObjectId;
  severity: FeedbackSeverity;
  type: FeedbackType;
  message: string;
  suggestion?: string;
  source: FeedbackSource;
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
type TierStudentItem = {
  studentId: string;
  attemptsCount: number;
  latestErrorCount: number;
};

@Injectable()
export class ClassReviewPackService {
  private static readonly DEFAULT_WINDOW: ClassReviewPackWindow = '7d';
  private static readonly DEFAULT_TOP_K = 10;
  private static readonly DEFAULT_EXAMPLES_PER_TAG = 2;
  private static readonly DEFAULT_INCLUDE_STUDENT_TIERS = true;
  private static readonly DEFAULT_INCLUDE_TEACHER_SCRIPT = true;
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
    const includeStudentTiers = this.parseBooleanQuery(
      query.includeStudentTiers,
      ClassReviewPackService.DEFAULT_INCLUDE_STUDENT_TIERS,
    );
    const includeTeacherScript = this.parseBooleanQuery(
      query.includeTeacherScript,
      ClassReviewPackService.DEFAULT_INCLUDE_TEACHER_SCRIPT,
    );
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

    const examples = feedbackFacet.examplesByTag.map((item) => ({
      tag: item.tag,
      count: item.count,
      samples: item.samples.map((sample) => ({
        submissionId: sample.submissionId.toString(),
        attemptNo:
          submissionAttemptMap.get(sample.submissionId.toString()) ?? 0,
        severity: sample.severity,
        type: sample.type,
        message: sample.message,
        suggestion: sample.suggestion,
        source: sample.source,
      })),
    }));

    const latestSubmissionIds = Array.from(
      latestSubmissionByStudentId.values(),
    ).map((submission) => submission._id);
    const latestAiStatusMap =
      includeStudentTiers && latestSubmissionIds.length > 0
        ? await this.aiFeedbackJobService.getStatusMapBySubmissionIds(
            latestSubmissionIds,
          )
        : new Map<string, AiFeedbackStatus>();
    const studentTiers = includeStudentTiers
      ? this.buildStudentTiers(
          activeStudentIds,
          attemptsCountByStudentId,
          latestSubmissionByStudentId,
          latestErrorCountBySubmissionId,
          latestAiStatusMap,
        )
      : undefined;

    const actionItems = this.buildActionItems(
      attemptsDistribution,
      feedbackFacet.topTags,
      feedbackFacet.topSeverities,
      submittedStudentsCount,
      studentsCount,
      lateSubmissionsCount,
      lateStudentIdSet.size,
    );
    const teacherScript = includeTeacherScript
      ? this.buildTeacherScript(feedbackFacet.topTags, examples, actionItems)
      : [];

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
      studentTiers: studentTiers ?? {
        good: [],
        watch: [],
        notSubmitted: [],
      },
      actionItems,
      teacherScript,
    };
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
            { $unwind: '$tags' },
            {
              $addFields: {
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
            { $sort: { tags: 1, severityRank: -1, createdAt: -1, _id: 1 } },
            {
              $group: {
                _id: '$tags',
                count: { $sum: 1 },
                samples: {
                  $push: {
                    submissionId: '$submissionId',
                    severity: '$severity',
                    type: '$type',
                    message: '$message',
                    suggestion: '$suggestion',
                    source: '$source',
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
  ) {
    const good: TierStudentItem[] = [];
    const watch: TierStudentItem[] = [];
    const notSubmitted: Array<{ studentId: string }> = [];

    for (const studentId of activeStudentIds) {
      const attemptsCount = attemptsCountByStudentId.get(studentId) ?? 0;
      if (attemptsCount === 0) {
        notSubmitted.push({ studentId });
        continue;
      }

      const latestSubmission = latestSubmissionByStudentId.get(studentId);
      if (!latestSubmission) {
        watch.push({ studentId, attemptsCount, latestErrorCount: 0 });
        continue;
      }

      const latestSubmissionId = latestSubmission._id.toString();
      const latestErrorCount =
        latestErrorCountBySubmissionId.get(latestSubmissionId) ?? 0;
      const latestAiStatus =
        latestAiStatusMap.get(latestSubmissionId) ??
        AiFeedbackStatus.NotRequested;
      const entry = { studentId, attemptsCount, latestErrorCount };
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

  private buildActionItems(
    attemptsDistribution: {
      '0': number;
      '1': number;
      '2': number;
      '3plus': number;
    },
    topTags: IssueTagAgg[],
    topSeverities: IssueSeverityAgg[],
    submittedStudentsCount: number,
    studentsCount: number,
    lateSubmissionsCount: number,
    lateStudentsCount: number,
  ) {
    const actions: Array<{ title: string; why: string; how: string }> = [];
    const topTagNames = topTags.map((item) => item.tag.toLowerCase());
    const hasReadabilityOrNaming = topTagNames.some(
      (tag) => tag.includes('readability') || tag.includes('naming'),
    );
    if (hasReadabilityOrNaming) {
      actions.push({
        title: '可读性与命名规范讲评',
        why: '高频标签指向代码可读性与命名一致性问题，影响同伴协作和后续维护。',
        how: '用 1 个正例和 1 个反例对比命名、函数职责与注释粒度，并给出统一命名清单。',
      });
    } else {
      actions.push({
        title: '代码规范复盘',
        why: '共性问题集中在基础实现质量，统一规范可快速降低重复错误。',
        how: '课堂上演示提交前 3 步检查：命名、边界、输出可读性，形成固定提交清单。',
      });
    }

    const errorSeverityCount =
      topSeverities.find((item) => item.severity === FeedbackSeverity.Error)
        ?.count ?? 0;
    const totalSeverityCount = topSeverities.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    const errorRatio =
      totalSeverityCount > 0 ? errorSeverityCount / totalSeverityCount : 0;
    if (errorSeverityCount > 0 && errorRatio >= 0.25) {
      actions.push({
        title: '边界条件与异常处理强化',
        why: 'ERROR 级问题占比较高，说明核心逻辑在边界输入下稳定性不足。',
        how: '安排 10 分钟边界样例演练：空输入、极值、非法参数，各组补齐 guard 条件并复测。',
      });
    } else {
      actions.push({
        title: '从 WARN 到 ERROR 的预防演练',
        why: '当前高严重级问题可控，但仍需前置预防避免后续升级。',
        how: '选 2 条 WARN 反馈进行改写演示，强调如何在编码阶段提前规避风险。',
      });
    }

    if (attemptsDistribution['0'] > 0) {
      actions.push({
        title: '未提交学生补交与辅导安排',
        why: `当前未提交 ${attemptsDistribution['0']} 人，已影响整体任务覆盖率。`,
        how: '课后安排补交流程：24 小时内补交 + 次日 15 分钟答疑；老师跟踪完成清单。',
      });
    } else {
      const retryCount =
        attemptsDistribution['2'] + attemptsDistribution['3plus'];
      actions.push({
        title: '二次提交优化策略',
        why: `多次尝试学生 ${retryCount} 人，说明迭代意识存在但改进路径需要更明确。`,
        how: '要求二次提交附 3 行改进说明：改了什么、为什么改、如何验证结果。',
      });
    }

    actions.push({
      title: 'Late submission management routine',
      why:
        lateSubmissionsCount > 0
          ? `Detected ${lateSubmissionsCount} late submissions from ${lateStudentsCount} students in this window.`
          : 'No late submissions were detected, but a fixed routine prevents deadline drift.',
      how: 'Set reminders at T-24h and T-1h, then run a same-day catch-up slot for late learners and track closure in the next class.',
    });

    if (actions.length < 3) {
      actions.push({
        title: '课堂目标回收',
        why: '确保本节复盘形成可落地改进闭环。',
        how: `按提交覆盖率 ${submittedStudentsCount}/${studentsCount} 复核本次目标并布置下一次达成标准。`,
      });
    }
    return actions.slice(0, 5);
  }

  private buildTeacherScript(
    topTags: IssueTagAgg[],
    examples: Array<{
      tag: string;
      count: number;
      samples: Array<{
        submissionId: string;
        attemptNo: number;
        severity: FeedbackSeverity;
        type: FeedbackType;
        message: string;
        suggestion?: string;
        source: FeedbackSource;
      }>;
    }>,
    actionItems: Array<{ title: string; why: string; how: string }>,
  ) {
    const primaryTags = topTags.slice(0, 3).map((item) => item.tag);
    const firstExampleMessage = this.truncateScriptMessage(
      examples[0]?.samples[0]?.message ??
        '暂无典型样例，先从提交覆盖率和共性问题入手。',
    );
    const secondExampleMessage = this.truncateScriptMessage(
      examples[1]?.samples[0]?.message ?? firstExampleMessage,
    );

    return [
      {
        minute: '0-2',
        topic: '任务概览与目标',
        talkingPoints: [
          '先说明本次任务的达成度：提交覆盖率、尝试次数分布、AI 成功率。',
          `本节重点标签：${primaryTags.length > 0 ? primaryTags.join(' / ') : '待补充观察'}`,
        ],
      },
      {
        minute: '2-4',
        topic: '共性问题讲评',
        talkingPoints: [
          `样例 1：${firstExampleMessage}`,
          '强调如何从反馈的 severity/type 判断优先修复顺序。',
        ],
      },
      {
        minute: '4-6',
        topic: '典型样例对照',
        talkingPoints: [
          `样例 2：${secondExampleMessage}`,
          '对照高质量写法，给出可立即套用的修正模板。',
        ],
      },
      {
        minute: '6-8',
        topic: '分层教学动作',
        talkingPoints: actionItems.slice(0, 2).map((item) => item.title),
      },
      {
        minute: '8-10',
        topic: '课后执行与验收',
        talkingPoints: actionItems.slice(0, 3).map((item) => item.how),
      },
    ];
  }

  private truncateScriptMessage(message: string) {
    const trimmed = message.trim();
    if (trimmed.length <= 120) {
      return trimmed;
    }
    return `${trimmed.slice(0, 117)}...`;
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
}
