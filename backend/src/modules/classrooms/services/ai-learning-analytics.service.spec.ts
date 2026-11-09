import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import {
  QueryAiLearningAnalyticsDto,
  QueryAiLearningAnalyticsStudentsDto,
} from '../dto/query-ai-learning-analytics.dto';
import {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES,
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES,
  AI_LEARNING_ANALYTICS_GROWTH_TRENDS,
  AI_LEARNING_ANALYTICS_OUTCOMES,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES,
  AiLearningAnalyticsService,
  buildAiLearningAnalyticsStandardSamples,
  deriveAiLearningAnalyticsEngagementStatus,
  deriveAiLearningAnalyticsOverallOutcome,
  mapAiLearningAnalyticsOverallOutcomeToGrowthTrend,
  normalizeAiLearningAnalyticsCode,
} from './ai-learning-analytics.service';
import { AiFeedbackJobStatus } from '../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const submission = (params: {
  id?: Types.ObjectId;
  studentId: Types.ObjectId;
  classroomTaskId: Types.ObjectId;
  attemptNo: number;
  submittedAt: string;
  codeText: string;
  contentRevision?: number;
  lastEditedAt?: string;
}) => ({
  _id: params.id ?? objectId(),
  studentId: params.studentId,
  classroomTaskId: params.classroomTaskId,
  attemptNo: params.attemptNo,
  submittedAt: new Date(params.submittedAt),
  contentRevision: params.contentRevision,
  lastEditedAt: params.lastEditedAt ? new Date(params.lastEditedAt) : undefined,
  content: { codeText: params.codeText, language: 'typescript' },
});

const job = (params: {
  submissionId: Types.ObjectId;
  status: AiFeedbackJobStatus;
  updatedAt?: string;
  provider?: 'bailian' | 'stub';
  attempts?: number;
  requests?: Array<{ claimNo: number; provider: 'bailian'; model: string }>;
}) => ({
  _id: objectId(),
  submissionId: params.submissionId,
  status: params.status,
  updatedAt: params.updatedAt ? new Date(params.updatedAt) : undefined,
  provider: params.provider,
  attempts: params.attempts,
  requests: params.requests,
});

const feedback = (params: {
  submissionId: Types.ObjectId;
  severity: FeedbackSeverity;
  source?: FeedbackSource;
}) => ({
  _id: objectId(),
  submissionId: params.submissionId,
  source: params.source ?? FeedbackSource.AI,
  severity: params.severity,
});

type ServiceHarnessOptions = {
  activeStudentIds?: Types.ObjectId[];
  classroomTasks?: Array<{
    _id: Types.ObjectId;
    taskId: Types.ObjectId;
    publishedAt: Date;
  }>;
  students?: Array<{
    _id: Types.ObjectId;
    name?: string;
    studentNo?: string;
  }>;
  submissions?: ReturnType<typeof submission>[];
  jobs?: ReturnType<typeof job>[];
  feedbackItems?: ReturnType<typeof feedback>[];
};

const createServiceHarness = (options: ServiceHarnessOptions = {}) => {
  const classroomId = objectId();
  const teacherId = objectId();
  const courseId = objectId();
  const classroomTasks = options.classroomTasks ?? [];
  const activeStudentIds = options.activeStudentIds ?? [];
  const taskTitleRows = classroomTasks.map((classroomTask, index) => ({
    _id: classroomTask.taskId,
    title: `Task ${index + 1}`,
  }));

  const classroomQuery = makeQuery({
    _id: classroomId,
    courseId,
    name: 'Analytics Classroom',
  });
  const courseQuery = makeQuery({
    _id: courseId,
    code: 'AI-101',
    name: 'AI Course',
    term: '2026-Spring',
  });
  const classroomTaskQuery = makeQuery(classroomTasks);
  const taskQuery = makeQuery(taskTitleRows);
  const jobQuery = makeQuery(options.jobs ?? []);
  const feedbackQuery = makeQuery(options.feedbackItems ?? []);
  const userQuery = makeQuery(options.students ?? []);
  let capturedClassroomTaskFilter: unknown;
  let capturedSubmissionFilter: unknown;

  const classroomModel = {
    findOne: jest.fn().mockReturnValue(classroomQuery),
  };
  const courseModel = {
    findById: jest.fn().mockReturnValue(courseQuery),
  };
  const classroomTaskModel = {
    find: jest.fn((filter: unknown) => {
      capturedClassroomTaskFilter = filter;
      return classroomTaskQuery;
    }),
  };
  const taskModel = {
    find: jest.fn().mockReturnValue(taskQuery),
  };
  const submissionModel = {
    find: jest.fn(
      (filter: {
        classroomTaskId: { $in: Types.ObjectId[] };
        studentId: { $in: Types.ObjectId[] };
      }) => {
        capturedSubmissionFilter = filter;
        return makeQuery(
          (options.submissions ?? []).filter(
            (item) =>
              filter.classroomTaskId.$in.some((id) =>
                id.equals(item.classroomTaskId),
              ) && filter.studentId.$in.some((id) => id.equals(item.studentId)),
          ),
        );
      },
    ),
  };
  const aiFeedbackJobModel = {
    find: jest.fn().mockReturnValue(jobQuery),
  };
  const feedbackModel = {
    find: jest.fn().mockReturnValue(feedbackQuery),
  };
  const userModel = {
    find: jest.fn().mockReturnValue(userQuery),
  };
  const enrollmentService = {
    listActiveStudentIds: jest
      .fn()
      .mockResolvedValue(activeStudentIds.map((id) => id.toString())),
  };
  const service = new AiLearningAnalyticsService(
    classroomModel as never,
    courseModel as never,
    classroomTaskModel as never,
    taskModel as never,
    submissionModel as never,
    aiFeedbackJobModel as never,
    feedbackModel as never,
    userModel as never,
    enrollmentService as never,
  );

  return {
    service,
    classroomId,
    teacherId,
    submissionModel,
    aiFeedbackJobModel,
    feedbackModel,
    getCapturedClassroomTaskFilter: () => capturedClassroomTaskFilter,
    getCapturedSubmissionFilter: () => capturedSubmissionFilter,
  };
};

describe('AI learning analytics DTO and public semantics', () => {
  it('locks the public outcome and growth-trend value sets', () => {
    expect(AI_LEARNING_ANALYTICS_OUTCOMES).toEqual([
      'IMPROVED',
      'STABLE',
      'REGRESSED',
      'NOT_COMPARABLE',
    ]);
    expect(AI_LEARNING_ANALYTICS_GROWTH_TRENDS).toEqual([
      'INSUFFICIENT_DATA',
      'IMPROVING',
      'STABLE',
      'DECLINING',
    ]);
    expect(AI_LEARNING_ANALYTICS_DETAILED_OUTCOMES).toEqual([
      'IMPROVED',
      'REMAINED_CLEAN',
      'UNCHANGED_WITH_ISSUES',
      'REGRESSED',
      'NOT_COMPARABLE',
    ]);
    expect(AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES).toEqual([
      'INSUFFICIENT_DATA',
      'IMPROVED_OVERALL',
      'NO_NET_CHANGE',
      'REGRESSED_OVERALL',
    ]);
    expect(AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES).toEqual([
      'NO_SUBMISSION',
      'SUBMITTED_WITHOUT_AI_REQUEST',
      'AI_REQUESTED_WITHOUT_DELIVERY',
      'AI_DELIVERED_WITHOUT_REVISION',
      'REVISED_WITHOUT_COMPARABLE',
      'QUALITY_COMPARABLE',
    ]);
  });

  it('normalizes, deduplicates and validates excluded classroomTaskIds', async () => {
    const firstTaskId = objectId().toString();
    const secondTaskId = objectId().toString();
    const dto = plainToInstance(QueryAiLearningAnalyticsDto, {
      excludedTaskIds: [firstTaskId, `${secondTaskId},${firstTaskId}`],
    });

    expect(dto.excludedTaskIds).toEqual([firstTaskId, secondTaskId]);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects term, invalid excludedTaskIds and out-of-range pagination', async () => {
    const invalidWindow = plainToInstance(QueryAiLearningAnalyticsDto, {
      window: 'term',
    });
    const invalidTask = plainToInstance(QueryAiLearningAnalyticsDto, {
      excludedTaskIds: 'not-an-object-id',
    });
    const invalidPage = plainToInstance(QueryAiLearningAnalyticsStudentsDto, {
      page: 0,
      limit: 101,
    });

    await expect(validate(invalidWindow)).resolves.toHaveLength(1);
    await expect(validate(invalidTask)).resolves.toHaveLength(1);
    await expect(validate(invalidPage)).resolves.toHaveLength(2);
  });

  it('normalizes q and validates search length plus V1.2 filters', async () => {
    const normalized = plainToInstance(QueryAiLearningAnalyticsStudentsDto, {
      q: '  张三  ',
      overallOutcome: 'IMPROVED_OVERALL',
      engagementStatus: 'QUALITY_COMPARABLE',
    });
    const blank = plainToInstance(QueryAiLearningAnalyticsStudentsDto, {
      q: '   ',
    });
    const invalid = plainToInstance(QueryAiLearningAnalyticsStudentsDto, {
      q: 'x'.repeat(101),
      overallOutcome: 'IMPROVING',
      engagementStatus: 'ENGAGED',
    });

    expect(normalized.q).toBe('张三');
    expect(blank.q).toBeUndefined();
    await expect(validate(normalized)).resolves.toHaveLength(0);
    await expect(validate(blank)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.toHaveLength(3);
  });

  it('derives overall outcomes once and maps them to legacy growth trends', () => {
    expect(deriveAiLearningAnalyticsOverallOutcome(0, 10)).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(deriveAiLearningAnalyticsOverallOutcome(2, 1)).toBe(
      'IMPROVED_OVERALL',
    );
    expect(deriveAiLearningAnalyticsOverallOutcome(2, 0)).toBe('NO_NET_CHANGE');
    expect(deriveAiLearningAnalyticsOverallOutcome(2, -1)).toBe(
      'REGRESSED_OVERALL',
    );
    expect(
      AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES.map(
        mapAiLearningAnalyticsOverallOutcomeToGrowthTrend,
      ),
    ).toEqual(['INSUFFICIENT_DATA', 'IMPROVING', 'STABLE', 'DECLINING']);
  });

  it.each([
    [0, 0, 0, 0, 0, 'NO_SUBMISSION'],
    [1, 0, 0, 0, 0, 'SUBMITTED_WITHOUT_AI_REQUEST'],
    [1, 1, 0, 0, 0, 'AI_REQUESTED_WITHOUT_DELIVERY'],
    [1, 1, 1, 0, 0, 'AI_DELIVERED_WITHOUT_REVISION'],
    [1, 1, 1, 1, 0, 'REVISED_WITHOUT_COMPARABLE'],
    [1, 1, 1, 1, 1, 'QUALITY_COMPARABLE'],
    [0, 1, 1, 1, 1, 'NO_SUBMISSION'],
  ] as const)(
    'derives the mutually exclusive engagement stage in priority order',
    (
      submittedTasksCount,
      aiRequestedTasksCount,
      aiDeliveredTasksCount,
      postFeedbackRevisedTasksCount,
      qualityComparableTasksCount,
      expected,
    ) => {
      expect(
        deriveAiLearningAnalyticsEngagementStatus({
          submittedTasksCount,
          aiRequestedTasksCount,
          aiDeliveredTasksCount,
          postFeedbackRevisedTasksCount,
          qualityComparableTasksCount,
        }),
      ).toBe(expected);
    },
  );
});

describe('V1.2 independently specified timelines (no database)', () => {
  const at = (hour: number) =>
    `2026-09-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const timeline = () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const draft = (attemptNo: number, hour: number, codeText = 'base') =>
      submission({
        studentId,
        classroomTaskId,
        attemptNo,
        submittedAt: at(hour),
        codeText,
        contentRevision: 0,
      });
    const reviewed = (
      item: ReturnType<typeof submission>,
      hour: number,
      model = 'model-a',
    ) =>
      job({
        submissionId: item._id,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: at(hour),
        provider: 'bailian',
        attempts: 1,
        requests: [{ claimNo: 1, provider: 'bailian', model }],
      });
    const item = (
      value: ReturnType<typeof submission>,
      severity = FeedbackSeverity.Info,
    ) => feedback({ submissionId: value._id, severity });
    return { studentId, classroomTaskId, draft, reviewed, item };
  };

  it('does not let a historical non-endpoint review contaminate selected comparison source warnings', async () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = t.draft(2, 2),
      c = t.draft(3, 4);
    const submissions = [a, b, c];
    const jobs = [
      t.reviewed(a, 1),
      job({
        submissionId: b._id,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: at(3),
      }),
      t.reviewed(c, 5),
    ];
    const feedbackItems = [
      t.item(a, FeedbackSeverity.Error),
      t.item(b, FeedbackSeverity.Warn),
      t.item(c),
    ];
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      submissions,
      jobs,
      feedbackItems,
    );
    expect(sample.baselineReview?.submissionId).toBe(a._id.toString());
    expect(sample.comparisonReview?.submissionId).toBe(c._id.toString());
    expect(sample).toMatchObject({
      issueLoadBeforeHalfUnits: 2,
      issueLoadAfterHalfUnits: 0,
      issueLoadDeltaHalfUnits: 2,
      detailedOutcome: 'IMPROVED',
    });
    const harness = createServiceHarness({
      activeStudentIds: [t.studentId],
      classroomTasks: [
        {
          _id: t.classroomTaskId,
          taskId: objectId(),
          publishedAt: new Date(at(0)),
        },
      ],
      submissions,
      jobs,
      feedbackItems,
    });
    const overview = await harness.service.getOverview(
      harness.classroomId.toString(),
      {},
      harness.teacherId.toString(),
    );
    expect(
      overview.summary.evidenceSummary.sourceUncertainComparableCount,
    ).toBe(0);
    expect(sample.comparisonWarnings).toEqual([]);
  });

  it.each([false, true])(
    'keeps unknown selected endpoint warnings with baseline only=%s',
    async (baselineOnly) => {
      const t = timeline();
      const a = t.draft(1, 0),
        b = t.draft(2, 2),
        c = t.draft(3, 4);
      const submissions = baselineOnly ? [a] : [a, b, c];
      const jobs = baselineOnly
        ? [
            job({
              submissionId: a._id,
              status: AiFeedbackJobStatus.Succeeded,
              updatedAt: at(1),
            }),
          ]
        : [
            t.reviewed(a, 1),
            t.reviewed(b, 3),
            job({
              submissionId: c._id,
              status: AiFeedbackJobStatus.Succeeded,
              updatedAt: at(5),
            }),
          ];
      const feedbackItems = baselineOnly
        ? [t.item(a)]
        : [
            t.item(a, FeedbackSeverity.Error),
            t.item(b, FeedbackSeverity.Warn),
            t.item(c),
          ];
      const [sample] = buildAiLearningAnalyticsStandardSamples(
        submissions,
        jobs,
        feedbackItems,
      );
      expect(sample.baselineReview?.submissionId).toBe(a._id.toString());
      if (baselineOnly) {
        expect(sample.comparisonReview).toBeNull();
        expect(sample).toMatchObject({
          qualityComparable: false,
          issueLoadBeforeHalfUnits: null,
          issueLoadAfterHalfUnits: null,
          detailedOutcome: 'NOT_COMPARABLE',
        });
      } else {
        expect(sample.comparisonReview?.submissionId).toBe(c._id.toString());
        expect(sample).toMatchObject({
          qualityComparable: true,
          issueLoadBeforeHalfUnits: 2,
          issueLoadAfterHalfUnits: 0,
          issueLoadDeltaHalfUnits: 2,
          detailedOutcome: 'IMPROVED',
        });
      }
      expect(sample.comparisonWarnings).toEqual([
        'SOURCE_UNKNOWN',
        'MODEL_UNKNOWN',
      ]);
      const harness = createServiceHarness({
        activeStudentIds: [t.studentId],
        classroomTasks: [
          {
            _id: t.classroomTaskId,
            taskId: objectId(),
            publishedAt: new Date(at(0)),
          },
        ],
        submissions,
        jobs,
        feedbackItems,
      });
      const overview = await harness.service.getOverview(
        harness.classroomId.toString(),
        {},
        harness.teacherId.toString(),
      );
      expect(
        overview.summary.evidenceSummary.sourceUncertainComparableCount,
      ).toBe(baselineOnly ? 0 : 1);
    },
  );

  it('uses the newest reviewed content, even when an older draft finishes last and the third round reverses improvement', () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = t.draft(2, 2, 'second'),
      c = t.draft(3, 4, 'third');
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [c, a, b],
      [t.reviewed(a, 1), t.reviewed(b, 8), t.reviewed(c, 6)],
      [
        t.item(a, FeedbackSeverity.Error),
        t.item(b),
        t.item(c, FeedbackSeverity.Error),
        t.item(c, FeedbackSeverity.Warn),
      ],
    );
    // Hand calculation: 1 -> 1.5, a regression of half a load unit.
    expect(sample).toMatchObject({
      attemptsCount: 3,
      qualityComparable: true,
      postFeedbackRevised: true,
      issueLoadBeforeHalfUnits: 2,
      issueLoadAfterHalfUnits: 3,
      issueLoadDeltaHalfUnits: -1,
      outcome: 'REGRESSED',
    });
    expect(sample.baselineReview?.submissionId).toBe(a._id.toString());
    expect(sample.comparisonReview?.submissionId).toBe(c._id.toString());
    expect(sample.hasNewerUncomparedRevision).toBe(false);
  });

  it('keeps the first completed intervention when a teacher later reviews an earlier attempt', () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = t.draft(2, 1),
      c = t.draft(3, 3);
    const [before] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c],
      [t.reviewed(b, 2), t.reviewed(c, 4)],
      [t.item(b, FeedbackSeverity.Error), t.item(c)],
    );
    const [after] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c],
      [t.reviewed(a, 9), t.reviewed(b, 2), t.reviewed(c, 4)],
      [t.item(a), t.item(b, FeedbackSeverity.Error), t.item(c)],
    );
    for (const sample of [before, after]) {
      expect(sample.baselineReview?.submissionId).toBe(b._id.toString());
      expect(sample.comparisonReview?.submissionId).toBe(c._id.toString());
      expect(sample.issueLoadDeltaHalfUnits).toBe(2);
    }
  });

  it('recognizes an older attempt edited after feedback without inventing a new submission or revision history', () => {
    const t = timeline();
    const old = {
      ...t.draft(1, 0, ' revised '),
      contentRevision: 1,
      lastEditedAt: new Date(at(4)),
    };
    const baseline = t.draft(2, 1);
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [old, baseline],
      [t.reviewed(baseline, 2), t.reviewed(old, 5)],
      [t.item(baseline, FeedbackSeverity.Error), t.item(old)],
    );
    expect(sample).toMatchObject({
      attemptsCount: 2,
      postFeedbackResubmitted: false,
      postFeedbackRevised: true,
      postFeedbackCodeChanged: true,
      qualityComparable: true,
    });
    expect(sample.baselineReview?.attemptNo).toBe(2);
    expect(sample.comparisonReview).toMatchObject({
      submissionId: old._id.toString(),
      attemptNo: 1,
      contentRevision: 1,
      submittedAt: at(0),
      lastEditedAt: at(4),
      contentVersionAt: at(4),
    });
  });

  it('looks through all existing later versions for code change and preserves meaningful outer whitespace', () => {
    const t = timeline();
    const a = t.draft(1, 0, 'a\r\nb'),
      b = t.draft(2, 2, 'a\nb'),
      c = t.draft(3, 4, ' a\nb');
    const records = [t.reviewed(a, 1)];
    const feedbacks = [t.item(a)];
    const [same] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      records,
      feedbacks,
    );
    const [changed] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c],
      records,
      feedbacks,
    );
    expect(same).toMatchObject({
      postFeedbackRevised: true,
      postFeedbackCodeChanged: false,
    });
    expect(changed.postFeedbackCodeChanged).toBe(true);
  });

  it.each(['none', 'PENDING', 'FAILED', 'empty', 'stub'] as const)(
    'retains a usable comparison and exposes the newer %s version',
    (kind) => {
      const t = timeline();
      const a = t.draft(1, 0),
        b = t.draft(2, 2),
        c = t.draft(3, 4);
      const jobs = [t.reviewed(a, 1), t.reviewed(b, 3)];
      if (kind !== 'none')
        jobs.push({
          ...t.reviewed(c, 5),
          ...(kind === 'stub' ? { provider: 'stub' as const } : {}),
          ...(kind === 'PENDING'
            ? { status: AiFeedbackJobStatus.Pending }
            : {}),
          ...(kind === 'FAILED' ? { status: AiFeedbackJobStatus.Failed } : {}),
        });
      const feedbacks = [
        t.item(a, FeedbackSeverity.Error),
        t.item(b),
        ...(kind === 'stub' ? [t.item(c)] : []),
      ];
      const [sample] = buildAiLearningAnalyticsStandardSamples(
        [a, b, c],
        jobs,
        feedbacks,
      );
      expect(sample.comparisonReview?.submissionId).toBe(b._id.toString());
      expect(sample.latestRevision?.submissionId).toBe(c._id.toString());
      expect(sample.hasNewerUncomparedRevision).toBe(true);
      expect(sample.issueLoadAfterHalfUnits).toBe(0);
      if (kind === 'empty')
        expect(sample.comparisonWarnings).toContain('EMPTY_FEEDBACK');
      if (kind === 'stub')
        expect(sample.comparisonWarnings).toContain(
          'SIMULATED_REVIEW_EXCLUDED',
        );
    },
  );

  it('does not manufacture clean feedback from an empty success, but accepts actual INFO as zero load', () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = t.draft(2, 2);
    const jobs = [t.reviewed(a, 1), t.reviewed(b, 3)];
    const [empty] = buildAiLearningAnalyticsStandardSamples([a, b], jobs, []);
    const [info] = buildAiLearningAnalyticsStandardSamples([a, b], jobs, [
      t.item(a),
      t.item(b),
    ]);
    expect(empty).toMatchObject({
      aiDelivered: false,
      qualityComparable: false,
      issueLoadBeforeHalfUnits: null,
      detailedOutcome: 'NOT_COMPARABLE',
    });
    expect(empty.comparisonWarnings).toContain('EMPTY_FEEDBACK');
    expect(empty.baselineReview).toBeNull();
    expect(empty.latestRevision?.submissionId).toBe(b._id.toString());
    expect(empty.hasNewerUncomparedRevision).toBeNull();
    expect(info).toMatchObject({
      aiDelivered: true,
      qualityComparable: true,
      issueLoadBeforeHalfUnits: 0,
      issueLoadAfterHalfUnits: 0,
      detailedOutcome: 'REMAINED_CLEAN',
    });
  });

  it('keeps historical source uncertain and resolves models only from one request matching the successful claim', () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = t.draft(2, 2);
    const known = t.reviewed(b, 3, 'model-b');
    const old = job({
      submissionId: a._id,
      status: AiFeedbackJobStatus.Succeeded,
      updatedAt: at(1),
    });
    const [historical] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      [old, known],
      [t.item(a), t.item(b)],
    );
    expect(historical.baselineReview).toMatchObject({
      provider: null,
      model: null,
    });
    expect(historical.comparisonWarnings).toEqual(
      expect.arrayContaining(['SOURCE_UNKNOWN', 'MODEL_UNKNOWN']),
    );
    const firstClaim = t.reviewed(a, 1);
    const [missing] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      [{ ...firstClaim, attempts: 2 }, known],
      [t.item(a), t.item(b)],
    );
    expect(missing.baselineReview?.model).toBeNull();
    expect(missing.comparisonWarnings).toContain('MODEL_UNKNOWN');
    expect(missing.comparisonWarnings).not.toContain('SOURCE_UNKNOWN');
    const [matched] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      [
        {
          ...firstClaim,
          attempts: 2,
          requests: [
            { claimNo: 1, provider: 'bailian', model: 'stale' },
            { claimNo: 2, provider: 'bailian', model: 'model-a' },
          ],
        },
        known,
      ],
      [t.item(a), t.item(b)],
    );
    expect(matched.baselineReview?.model).toBe('model-a');
    expect(matched.comparisonWarnings).toContain('MODEL_CHANGED');
    const [ambiguous] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      [
        {
          ...firstClaim,
          requests: [
            { claimNo: 1, provider: 'bailian', model: 'a' },
            { claimNo: 1, provider: 'bailian', model: 'b' },
          ],
        },
        known,
      ],
      [t.item(a), t.item(b)],
    );
    expect(ambiguous.baselineReview?.model).toBeNull();
    const [invalidAttempt] = buildAiLearningAnalyticsStandardSamples(
      [{ ...a, attemptNo: Number.NaN }],
      [t.reviewed(a, 1)],
      [t.item(a)],
    );
    expect(invalidAttempt.baselineReview?.attemptNo).toBeNull();
    expect(invalidAttempt.baselineReview).not.toHaveProperty('requests');
  });

  it('confirms a known newer unreviewed version despite an unrelated historical revision with unknown timing', () => {
    const t = timeline();
    const a = t.draft(2, 0),
      b = t.draft(3, 2),
      c = t.draft(4, 4, 'newer work');
    const d = {
      ...t.draft(1, 0),
      submittedAt: new Date('2026-08-31T23:00:00.000Z'),
      contentRevision: 1,
    };
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c, d],
      [t.reviewed(a, 1), t.reviewed(b, 3)],
      [t.item(a, FeedbackSeverity.Error), t.item(b, FeedbackSeverity.Warn)],
    );
    expect(sample.baselineReview?.submissionId).toBe(a._id.toString());
    expect(sample.comparisonReview?.submissionId).toBe(b._id.toString());
    expect(sample).toMatchObject({
      attemptsCount: 4,
      qualityComparable: true,
      issueLoadBeforeHalfUnits: 2,
      issueLoadAfterHalfUnits: 1,
      issueLoadDeltaHalfUnits: 1,
      detailedOutcome: 'IMPROVED',
      postFeedbackResubmitted: true,
      postFeedbackRevised: true,
      postFeedbackCodeChanged: true,
      latestRevision: null,
    });
    expect(sample.comparisonWarnings).toEqual(['TIME_UNKNOWN']);
    expect(sample.hasNewerUncomparedRevision).toBe(true);
  });

  it('uses the current comparison reference after a newer version is reviewed and preserves uncertainty without a known later version', () => {
    const t = timeline();
    const a = t.draft(2, 0),
      b = t.draft(3, 2),
      c = t.draft(4, 4);
    const d = { ...t.draft(1, 0), contentRevision: 1 };
    const jobs = [t.reviewed(a, 1), t.reviewed(b, 3)];
    const feedbacks = [t.item(a, FeedbackSeverity.Error), t.item(b)];
    const [withoutKnownNewer] = buildAiLearningAnalyticsStandardSamples(
      [a, b, d],
      jobs,
      feedbacks,
    );
    expect(withoutKnownNewer.comparisonReview?.submissionId).toBe(
      b._id.toString(),
    );
    expect(withoutKnownNewer.hasNewerUncomparedRevision).toBeNull();

    const completedJobs = [...jobs, t.reviewed(c, 5)];
    const completedFeedbacks = [...feedbacks, t.item(c)];
    const [reviewedWithUnknown] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c, d],
      completedJobs,
      completedFeedbacks,
    );
    expect(reviewedWithUnknown.comparisonReview?.submissionId).toBe(
      c._id.toString(),
    );
    expect(reviewedWithUnknown.hasNewerUncomparedRevision).toBeNull();
    expect(reviewedWithUnknown.comparisonWarnings).toEqual(['TIME_UNKNOWN']);

    const [reviewedWithoutUnknown] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c],
      completedJobs,
      completedFeedbacks,
    );
    expect(reviewedWithoutUnknown.comparisonReview?.submissionId).toBe(
      c._id.toString(),
    );
    expect(reviewedWithoutUnknown.latestRevision?.submissionId).toBe(
      c._id.toString(),
    );
    expect(reviewedWithoutUnknown.hasNewerUncomparedRevision).toBe(false);

    const [untimedReference] = buildAiLearningAnalyticsStandardSamples(
      [d],
      [t.reviewed(d, 1)],
      [t.item(d)],
    );
    expect(untimedReference.baselineReview?.submissionId).toBe(
      d._id.toString(),
    );
    expect(untimedReference.baselineReview?.contentVersionAt).toBeNull();
    expect(untimedReference.hasNewerUncomparedRevision).toBeNull();
  });

  it('uses the existing stable ordering for a known same-time later version despite unknown historical timing', () => {
    const t = timeline();
    const a = t.draft(2, 0),
      b = t.draft(3, 2),
      c = t.draft(4, 2);
    const d = { ...t.draft(1, 0), contentRevision: 1 };
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [a, b, c, d],
      [t.reviewed(a, 1), t.reviewed(b, 3)],
      [t.item(a), t.item(b)],
    );
    expect(sample.comparisonReview?.submissionId).toBe(b._id.toString());
    expect(sample.latestRevision).toBeNull();
    expect(sample.hasNewerUncomparedRevision).toBe(true);
    expect(sample.comparisonWarnings).toEqual(['TIME_UNKNOWN']);
  });

  it('does not fall back to creation time for a positive revision missing its edit time or invent a completion time', () => {
    const t = timeline();
    const a = t.draft(1, 0),
      b = { ...t.draft(2, 2), contentRevision: 2 };
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [a, b],
      [t.reviewed(a, 1), t.reviewed(b, 3)],
      [t.item(a), t.item(b)],
    );
    expect(sample).toMatchObject({
      qualityComparable: false,
      latestRevision: null,
      hasNewerUncomparedRevision: null,
      postFeedbackResubmitted: true,
      postFeedbackRevised: true,
    });
    expect(sample.comparisonWarnings).toContain('TIME_UNKNOWN');
    for (const lastEditedAt of [new Date('invalid'), new Date(at(0))]) {
      const [invalidEdit] = buildAiLearningAnalyticsStandardSamples(
        [a, { ...b, lastEditedAt }],
        [t.reviewed(a, 1), t.reviewed(b, 3)],
        [t.item(a), t.item(b)],
      );
      expect(invalidEdit.qualityComparable).toBe(false);
      expect(invalidEdit.hasNewerUncomparedRevision).toBeNull();
    }
    const [missingCompletion] = buildAiLearningAnalyticsStandardSamples(
      [a],
      [{ ...t.reviewed(a, 1), updatedAt: undefined }],
      [t.item(a)],
    );
    expect(missingCompletion).toMatchObject({
      aiDelivered: true,
      baselineReview: null,
      qualityComparable: false,
      hasNewerUncomparedRevision: null,
    });
    expect(missingCompletion.comparisonWarnings).toContain('TIME_UNKNOWN');
  });

  it('aggregates one sample per student-task without rounding or double-counting overlapping evidence', async () => {
    const timelines = [timeline(), timeline(), timeline()];
    const submissions: ReturnType<typeof submission>[] = [];
    const jobs: ReturnType<typeof job>[] = [];
    const feedbackItems: ReturnType<typeof feedback>[] = [];
    for (const [index, t] of timelines.entries()) {
      const a = t.draft(1, 0),
        b = t.draft(2, 2);
      submissions.push(a, b);
      jobs.push(
        index === 0
          ? job({
              submissionId: a._id,
              status: AiFeedbackJobStatus.Succeeded,
              updatedAt: at(1),
            })
          : t.reviewed(a, 1),
      );
      jobs.push(t.reviewed(b, 3, index === 1 ? 'model-b' : 'model-a'));
      feedbackItems.push(
        t.item(a, index === 0 ? FeedbackSeverity.Warn : FeedbackSeverity.Info),
        t.item(b),
      );
      if (index === 1) {
        const c = t.draft(3, 4);
        submissions.push(c);
        jobs.push({ ...t.reviewed(c, 5), provider: 'stub' });
        feedbackItems.push(t.item(c));
      }
    }
    const harness = createServiceHarness({
      activeStudentIds: timelines.map((t) => t.studentId),
      classroomTasks: timelines.map((t) => ({
        _id: t.classroomTaskId,
        taskId: objectId(),
        publishedAt: new Date(at(0)),
      })),
      submissions,
      jobs,
      feedbackItems,
    });
    const overview = await harness.service.getOverview(
      harness.classroomId.toString(),
      {},
      harness.teacherId.toString(),
    );
    expect(overview.summary).toMatchObject({
      qualityComparableStudentTaskCount: 3,
      improvedStudentTaskCount: 1,
      remainedCleanStudentTaskCount: 2,
      postFeedbackRevisedStudentTaskCount: 3,
      postFeedbackRevisionRate: 1,
      postFeedbackCodeChangeRate: 0,
      improvedRate: 1 / 3,
      averageIssueLoadBefore: 1 / 6,
      averageIssueLoadAfter: 0,
      averageIssueLoadDelta: 1 / 6,
      evidenceSummary: {
        sourceUncertainComparableCount: 1,
        modelChangedComparableCount: 1,
        simulatedExcludedSampleCount: 1,
      },
    });
    const list = await harness.service.getStudents(
      harness.classroomId.toString(),
      {},
      harness.teacherId.toString(),
    );
    expect(list.methodology.version).toBe('AI_FEEDBACK_INTERVENTION_V1_2');
    expect(
      list.items.reduce(
        (sum, item) => sum + item.qualityComparableTasksCount,
        0,
      ),
    ).toBe(3);
    for (const t of timelines) {
      const detail = await harness.service.getStudentDetail(
        harness.classroomId.toString(),
        t.studentId.toString(),
        {},
        harness.teacherId.toString(),
      );
      expect(detail.summary.postFeedbackRevisedTasksCount).toBe(1);
      expect(
        list.items.find((item) => item.studentId === t.studentId.toString()),
      ).toMatchObject(detail.summary);
      expect(
        detail.summary.improvedTasksCount +
          detail.summary.remainedCleanTasksCount +
          detail.summary.unchangedWithIssuesTasksCount +
          detail.summary.regressedTasksCount,
      ).toBe(detail.summary.qualityComparableTasksCount);
      expect(
        detail.summary.postFeedbackCodeChangedTasksCount,
      ).toBeLessThanOrEqual(detail.summary.postFeedbackRevisedTasksCount);
    }
    expect(
      overview.taskTrends.reduce(
        (sum, task) => sum + task.qualityComparableStudentCount,
        0,
      ),
    ).toBe(3);
  });
});

describe('AI learning analytics standard sample rules', () => {
  it('forms only one sample per student-classroomTask and picks the earliest succeeded anchor using stable submission order', () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const earlierId = new Types.ObjectId('000000000000000000000001');
    const laterId = new Types.ObjectId('000000000000000000000002');
    const postId = new Types.ObjectId('000000000000000000000003');
    const anchor = submission({
      id: earlierId,
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-01-01T00:00:00.000Z',
      codeText: 'anchor',
    });
    const sameAttemptLaterId = submission({
      id: laterId,
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-01-01T00:00:00.000Z',
      codeText: 'not-anchor',
    });
    const post = submission({
      id: postId,
      studentId,
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-01-03T00:00:00.000Z',
      codeText: 'post',
    });

    const samples = buildAiLearningAnalyticsStandardSamples(
      [post, sameAttemptLaterId, anchor],
      [
        job({
          submissionId: laterId,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-01-01T01:00:00.000Z',
        }),
        job({
          submissionId: earlierId,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-01-01T01:00:00.000Z',
        }),
        job({
          submissionId: postId,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-01-03T01:00:00.000Z',
        }),
      ],
      [
        feedback({ submissionId: postId, severity: FeedbackSeverity.Info }),
        feedback({
          submissionId: earlierId,
          severity: FeedbackSeverity.Error,
        }),
        feedback({
          submissionId: laterId,
          severity: FeedbackSeverity.Error,
        }),
        feedback({
          submissionId: laterId,
          severity: FeedbackSeverity.Error,
        }),
      ],
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      attemptsCount: 3,
      aiRequested: true,
      aiDelivered: true,
      postFeedbackResubmitted: true,
      qualityComparable: true,
      issueLoadBeforeHalfUnits: 2,
      issueLoadAfterHalfUnits: 0,
      issueLoadDeltaHalfUnits: 2,
      detailedOutcome: 'IMPROVED',
      outcome: 'IMPROVED',
    });
  });

  it('excludes later content versions formed before baseline feedback completion', () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const anchor = submission({
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-02-01T00:00:00.000Z',
      codeText: 'before',
    });
    const beforeCompletion = submission({
      studentId,
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-02-01T01:00:00.000Z',
      codeText: 'ignored',
    });
    const afterCompletion = submission({
      studentId,
      classroomTaskId,
      attemptNo: 3,
      submittedAt: '2026-02-01T03:00:00.000Z',
      codeText: 'after',
    });
    const samples = buildAiLearningAnalyticsStandardSamples(
      [anchor, beforeCompletion, afterCompletion],
      [
        job({
          submissionId: anchor._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-02-01T02:00:00.000Z',
        }),
        job({
          submissionId: afterCompletion._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-02-01T04:00:00.000Z',
        }),
      ],
      [
        feedback({ submissionId: anchor._id, severity: FeedbackSeverity.Info }),
        feedback({
          submissionId: afterCompletion._id,
          severity: FeedbackSeverity.Info,
        }),
      ],
    );

    expect(samples[0]).toMatchObject({
      postFeedbackResubmitted: true,
      postFeedbackCodeChanged: true,
      qualityComparable: true,
      detailedOutcome: 'REMAINED_CLEAN',
      outcome: 'STABLE',
    });
  });

  it('does not report resubmission when every later attempt predates job completion', () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const anchor = submission({
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-02-01T00:00:00.000Z',
      codeText: 'before',
    });
    const tooEarly = submission({
      studentId,
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-02-01T01:00:00.000Z',
      codeText: 'after',
    });
    const samples = buildAiLearningAnalyticsStandardSamples(
      [anchor, tooEarly],
      [
        job({
          submissionId: anchor._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-02-01T02:00:00.000Z',
        }),
      ],
      [feedback({ submissionId: anchor._id, severity: FeedbackSeverity.Info })],
    );

    expect(samples[0]).toMatchObject({
      aiDelivered: true,
      postFeedbackResubmitted: false,
      postFeedbackCodeChanged: false,
      qualityComparable: false,
      detailedOutcome: 'NOT_COMPARABLE',
      outcome: 'NOT_COMPARABLE',
    });
  });

  it('normalizes only CRLF and preserves outer whitespace for code-change comparison', () => {
    expect(normalizeAiLearningAnalyticsCode('  a\r\n  b  ')).toBe('  a\n  b  ');
    expect(normalizeAiLearningAnalyticsCode('a\r\n  b')).not.toBe(
      normalizeAiLearningAnalyticsCode('\n a\n  b \n'),
    );
    expect(normalizeAiLearningAnalyticsCode('a\n  b')).not.toBe(
      normalizeAiLearningAnalyticsCode('a\nb'),
    );
    expect(normalizeAiLearningAnalyticsCode('a')).not.toBe(
      normalizeAiLearningAnalyticsCode('a // comment'),
    );
  });

  it('uses ERROR=1, WARN=0.5, actual INFO=0 and ignores non-AI feedback', () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const before = submission({
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-03-01T00:00:00.000Z',
      codeText: 'a',
    });
    const after = submission({
      studentId,
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-03-02T00:00:00.000Z',
      codeText: 'b',
    });
    const samples = buildAiLearningAnalyticsStandardSamples(
      [before, after],
      [
        job({
          submissionId: before._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-03-01T01:00:00.000Z',
        }),
        job({
          submissionId: after._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-03-02T01:00:00.000Z',
        }),
      ],
      [
        feedback({ submissionId: after._id, severity: FeedbackSeverity.Info }),
        feedback({
          submissionId: before._id,
          severity: FeedbackSeverity.Error,
        }),
        feedback({
          submissionId: before._id,
          severity: FeedbackSeverity.Warn,
        }),
        feedback({
          submissionId: before._id,
          severity: FeedbackSeverity.Info,
        }),
        feedback({
          submissionId: before._id,
          severity: FeedbackSeverity.Error,
          source: FeedbackSource.Teacher,
        }),
      ],
    );

    expect(samples[0]).toMatchObject({
      issueLoadBeforeHalfUnits: 3,
      issueLoadAfterHalfUnits: 0,
      issueLoadDeltaHalfUnits: 3,
      detailedOutcome: 'IMPROVED',
      outcome: 'IMPROVED',
    });
  });

  it.each([
    [2, 0, 'IMPROVED', 'IMPROVED'],
    [0, 0, 'REMAINED_CLEAN', 'STABLE'],
    [1, 1, 'UNCHANGED_WITH_ISSUES', 'STABLE'],
    [0, 2, 'REGRESSED', 'REGRESSED'],
  ] as const)(
    'classifies beforeHalfUnits=%s afterHalfUnits=%s as %s with legacy %s',
    (beforeHalfUnits, afterHalfUnits, detailedOutcome, outcome) => {
      const studentId = objectId();
      const classroomTaskId = objectId();
      const before = submission({
        studentId,
        classroomTaskId,
        attemptNo: 1,
        submittedAt: '2026-04-01T00:00:00.000Z',
        codeText: 'a',
      });
      const after = submission({
        studentId,
        classroomTaskId,
        attemptNo: 2,
        submittedAt: '2026-04-02T00:00:00.000Z',
        codeText: 'b',
      });
      const toFeedback = (submissionId: Types.ObjectId, halfUnits: number) => [
        ...(halfUnits === 0
          ? [feedback({ submissionId, severity: FeedbackSeverity.Info })]
          : []),
        ...Array.from({ length: Math.floor(halfUnits / 2) }, () =>
          feedback({ submissionId, severity: FeedbackSeverity.Error }),
        ),
        ...(halfUnits % 2 === 1
          ? [feedback({ submissionId, severity: FeedbackSeverity.Warn })]
          : []),
      ];
      const [sample] = buildAiLearningAnalyticsStandardSamples(
        [before, after],
        [
          job({
            submissionId: before._id,
            status: AiFeedbackJobStatus.Succeeded,
            updatedAt: '2026-04-01T01:00:00.000Z',
          }),
          job({
            submissionId: after._id,
            status: AiFeedbackJobStatus.Succeeded,
            updatedAt: '2026-04-02T01:00:00.000Z',
          }),
        ],
        [
          ...toFeedback(before._id, beforeHalfUnits),
          ...toFeedback(after._id, afterHalfUnits),
        ],
      );

      expect(sample).toMatchObject({ detailedOutcome, outcome });
    },
  );

  it('is NOT_COMPARABLE without a later succeeded job', () => {
    const studentId = objectId();
    const classroomTaskId = objectId();
    const before = submission({
      studentId,
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-05-01T00:00:00.000Z',
      codeText: 'a',
    });
    const after = submission({
      studentId,
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-05-02T00:00:00.000Z',
      codeText: 'b',
    });
    const [sample] = buildAiLearningAnalyticsStandardSamples(
      [before, after],
      [
        job({
          submissionId: before._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-05-01T01:00:00.000Z',
        }),
        job({
          submissionId: after._id,
          status: AiFeedbackJobStatus.Failed,
        }),
      ],
      [feedback({ submissionId: before._id, severity: FeedbackSeverity.Info })],
    );

    expect(sample).toMatchObject({
      postFeedbackResubmitted: true,
      qualityComparable: false,
      issueLoadBeforeHalfUnits: null,
      issueLoadAfterHalfUnits: null,
      issueLoadDeltaHalfUnits: null,
      detailedOutcome: 'NOT_COMPARABLE',
      outcome: 'NOT_COMPARABLE',
    });
  });
});

describe('AiLearningAnalyticsService aggregation boundaries', () => {
  it('returns a stable empty-classroom overview', async () => {
    const { service, classroomId, teacherId } = createServiceHarness();

    const result = await service.getOverview(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.context).toMatchObject({
      effectiveTaskCount: 0,
      window: 'all',
    });
    expect(result.methodology).toMatchObject({
      scope: 'AI_FEEDBACK_INTERVENTION_V1',
      version: 'AI_FEEDBACK_INTERVENTION_V1_2',
    });
    expect(result.summary).toMatchObject({
      activeStudentsCount: 0,
      submittedStudentTaskCount: 0,
      aiRequestedStudentTaskCount: 0,
      aiDeliveredStudentTaskCount: 0,
      aiStudentCoverageRate: null,
      aiTaskCoverageRate: null,
      remainedCleanStudentTaskCount: 0,
      unchangedWithIssuesStudentTaskCount: 0,
      remainedCleanRate: null,
      unchangedWithIssuesRate: null,
      regressedRate: null,
      averageIssueLoadDelta: null,
    });
    expect(result.taskTrends).toEqual([]);
  });

  it('keeps zero-submission tasks, real zero coverage and unknown zero-denominator rates distinct', async () => {
    const classroomTaskId = objectId();
    const taskId = objectId();
    const activeStudentId = objectId();
    const { service, classroomId, teacherId } = createServiceHarness({
      activeStudentIds: [activeStudentId],
      classroomTasks: [
        {
          _id: classroomTaskId,
          taskId,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.getOverview(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.summary).toMatchObject({
      activeStudentsCount: 1,
      submittedStudentTaskCount: 0,
      aiStudentCoverageRate: 0,
      aiTaskCoverageRate: null,
      aiDeliveryRate: null,
      postFeedbackResubmissionRate: null,
      postFeedbackCodeChangeRate: null,
      qualityComparableRate: null,
      improvedRate: null,
      remainedCleanRate: null,
      unchangedWithIssuesRate: null,
      regressedRate: null,
      averageIssueLoadBefore: null,
      averageIssueLoadAfter: null,
      averageIssueLoadDelta: null,
    });
    expect(result.taskTrends).toHaveLength(1);
    expect(result.taskTrends[0]).toMatchObject({
      classroomTaskId: classroomTaskId.toString(),
      submittedStudentCount: 0,
      aiRequestedStudentCount: 0,
      qualityComparableStudentCount: 0,
      remainedCleanStudentCount: 0,
      unchangedWithIssuesStudentCount: 0,
      aiTaskCoverageRate: null,
      improvedRate: null,
      remainedCleanRate: null,
      unchangedWithIssuesRate: null,
      regressedRate: null,
    });
  });

  it('keeps a zero-submission ACTIVE student in list and detail with null task-point issue loads', async () => {
    const activeStudentId = objectId();
    const classroomTaskId = objectId();
    const taskId = objectId();
    const { service, classroomId, teacherId } = createServiceHarness({
      activeStudentIds: [activeStudentId],
      students: [
        {
          _id: activeStudentId,
          name: 'Zero Student',
          studentNo: 'S-000',
        },
      ],
      classroomTasks: [
        {
          _id: classroomTaskId,
          taskId,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });

    const list = await service.getStudents(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );
    const detail = await service.getStudentDetail(
      classroomId.toString(),
      activeStudentId.toString(),
      {},
      teacherId.toString(),
    );

    expect(list).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      activeStudentsTotal: 1,
      filters: {
        q: null,
        overallOutcome: null,
        engagementStatus: null,
      },
    });
    expect(list.items[0]).toMatchObject({
      studentId: activeStudentId.toString(),
      submittedTasksCount: 0,
      qualityComparableTasksCount: 0,
      remainedCleanTasksCount: 0,
      unchangedWithIssuesTasksCount: 0,
      overallOutcome: 'INSUFFICIENT_DATA',
      engagementStatus: 'NO_SUBMISSION',
      growthTrend: 'INSUFFICIENT_DATA',
    });
    expect(detail.taskPoints).toHaveLength(1);
    expect(detail.taskPoints[0]).toMatchObject({
      attemptsCount: 0,
      aiRequested: false,
      aiDelivered: false,
      qualityComparable: false,
      baselineReview: null,
      comparisonReview: null,
      hasNewerUncomparedRevision: null,
      comparisonWarnings: [],
      issueLoadBefore: null,
      issueLoadAfter: null,
      issueLoadDelta: null,
      detailedOutcome: 'NOT_COMPARABLE',
      outcome: 'NOT_COMPARABLE',
    });
  });

  it('returns all four growth trends and does not repeat-weight multiple AI jobs within one student-task sample', async () => {
    const classroomTaskId = objectId();
    const taskId = objectId();
    const studentIds = Array.from({ length: 5 }, () => objectId());
    const submissions: ReturnType<typeof submission>[] = [];
    const jobs: ReturnType<typeof job>[] = [];
    const feedbackItems: ReturnType<typeof feedback>[] = [];
    const expectedOutcomes = [
      ['IMPROVED_OVERALL', 'IMPROVING'],
      ['NO_NET_CHANGE', 'STABLE'],
      ['NO_NET_CHANGE', 'STABLE'],
      ['REGRESSED_OVERALL', 'DECLINING'],
      ['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'],
    ];

    for (let index = 0; index < studentIds.length; index += 1) {
      const before = submission({
        studentId: studentIds[index],
        classroomTaskId,
        attemptNo: 1,
        submittedAt: `2026-06-0${index + 1}T00:00:00.000Z`,
        codeText: 'before',
      });
      const after = submission({
        studentId: studentIds[index],
        classroomTaskId,
        attemptNo: 2,
        submittedAt: `2026-06-0${index + 1}T03:00:00.000Z`,
        codeText: 'after',
      });
      submissions.push(before, after);
      if (index < 4) {
        feedbackItems.push(
          feedback({
            submissionId: before._id,
            severity: FeedbackSeverity.Info,
          }),
          feedback({
            submissionId: after._id,
            severity: FeedbackSeverity.Info,
          }),
        );
        jobs.push(
          job({
            submissionId: before._id,
            status: AiFeedbackJobStatus.Succeeded,
            updatedAt: `2026-06-0${index + 1}T01:00:00.000Z`,
          }),
          job({
            submissionId: after._id,
            status: AiFeedbackJobStatus.Succeeded,
            updatedAt: `2026-06-0${index + 1}T04:00:00.000Z`,
          }),
        );
      }
      if (index === 0) {
        feedbackItems.push(
          feedback({
            submissionId: before._id,
            severity: FeedbackSeverity.Error,
          }),
        );
      }
      if (index === 2) {
        feedbackItems.push(
          feedback({
            submissionId: before._id,
            severity: FeedbackSeverity.Warn,
          }),
          feedback({
            submissionId: after._id,
            severity: FeedbackSeverity.Warn,
          }),
        );
      }
      if (index === 3) {
        feedbackItems.push(
          feedback({
            submissionId: after._id,
            severity: FeedbackSeverity.Error,
          }),
        );
      }
    }
    const { service, classroomId, teacherId } = createServiceHarness({
      activeStudentIds: studentIds,
      students: studentIds.map((studentId, index) => ({
        _id: studentId,
        name: `Student ${index + 1}`,
        studentNo: `S-00${index + 1}`,
      })),
      classroomTasks: [
        {
          _id: classroomTaskId,
          taskId,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
      submissions,
      jobs,
      feedbackItems,
    });

    const result = await service.getStudents(
      classroomId.toString(),
      { limit: 20 },
      teacherId.toString(),
    );

    expect(
      result.items.map((item) => [item.overallOutcome, item.growthTrend]),
    ).toEqual(expectedOutcomes);
    for (const item of result.items) {
      expect(item.submittedTasksCount).toBe(1);
      expect(item.aiRequestedTasksCount).toBeLessThanOrEqual(1);
      expect(item.aiDeliveredTasksCount).toBeLessThanOrEqual(1);
      expect(item.stableTasksCount).toBe(
        item.remainedCleanTasksCount + item.unchangedWithIssuesTasksCount,
      );
    }
    expect(result.items[1]).toMatchObject({
      remainedCleanTasksCount: 1,
      unchangedWithIssuesTasksCount: 0,
    });
    expect(result.items[2]).toMatchObject({
      remainedCleanTasksCount: 0,
      unchangedWithIssuesTasksCount: 1,
    });

    const overview = await service.getOverview(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );
    expect(overview.summary.stableStudentTaskCount).toBe(
      overview.summary.remainedCleanStudentTaskCount +
        overview.summary.unchangedWithIssuesStudentTaskCount,
    );
    expect(overview.summary).toMatchObject({
      qualityComparableStudentTaskCount: 4,
      improvedStudentTaskCount: 1,
      remainedCleanStudentTaskCount: 1,
      unchangedWithIssuesStudentTaskCount: 1,
      stableStudentTaskCount: 2,
      regressedStudentTaskCount: 1,
      improvedRate: 0.25,
      remainedCleanRate: 0.25,
      unchangedWithIssuesRate: 0.25,
      regressedRate: 0.25,
    });
    expect(overview.taskTrends[0].stableStudentCount).toBe(
      overview.taskTrends[0].remainedCleanStudentCount +
        overview.taskTrends[0].unchangedWithIssuesStudentCount,
    );
  });

  it('searches only name and studentNo with trimmed case-insensitive substrings', async () => {
    const studentIds = Array.from({ length: 3 }, () => objectId());
    const { service, classroomId, teacherId, submissionModel } =
      createServiceHarness({
        activeStudentIds: studentIds,
        students: [
          { _id: studentIds[0], name: '张三', studentNo: 'CN-001' },
          { _id: studentIds[1], name: 'Alice Chen', studentNo: 'AbC-002' },
          { _id: studentIds[2], name: 'Bob', studentNo: 'EN-003' },
        ],
      });

    const byName = await service.getStudents(
      classroomId.toString(),
      { q: '张' },
      teacherId.toString(),
    );
    const byEnglishName = await service.getStudents(
      classroomId.toString(),
      { q: 'ALICE' },
      teacherId.toString(),
    );
    const byStudentNo = await service.getStudents(
      classroomId.toString(),
      { q: 'bc-00' },
      teacherId.toString(),
    );
    const byStudentId = await service.getStudents(
      classroomId.toString(),
      { q: studentIds[0].toString() },
      teacherId.toString(),
    );

    expect(byName.items.map((item) => item.studentName)).toEqual(['张三']);
    expect(byEnglishName.items.map((item) => item.studentName)).toEqual([
      'Alice Chen',
    ]);
    expect(byStudentNo.items.map((item) => item.studentNo)).toEqual([
      'AbC-002',
    ]);
    expect(byStudentId).toMatchObject({
      total: 0,
      activeStudentsTotal: 3,
      filters: { q: studentIds[0].toString() },
      items: [],
    });
    expect(submissionModel.find).not.toHaveBeenCalled();
  });

  it('paginates q-only candidates before loading only the current-page samples', async () => {
    const studentIds = Array.from({ length: 3 }, () => objectId());
    const classroomTaskId = objectId();
    const { service, classroomId, teacherId, submissionModel } =
      createServiceHarness({
        activeStudentIds: studentIds,
        students: studentIds.map((studentId, index) => ({
          _id: studentId,
          name: `Candidate ${index + 1}`,
          studentNo: `C-00${index + 1}`,
        })),
        classroomTasks: [
          {
            _id: classroomTaskId,
            taskId: objectId(),
            publishedAt: new Date(),
          },
        ],
      });

    const result = await service.getStudents(
      classroomId.toString(),
      { q: 'candidate', page: 2, limit: 1 },
      teacherId.toString(),
    );

    expect(result).toMatchObject({
      page: 2,
      limit: 1,
      total: 3,
      activeStudentsTotal: 3,
    });
    expect(submissionModel.find).toHaveBeenCalledTimes(1);
    const filter = submissionModel.find.mock.calls[0][0] as {
      studentId: { $in: Types.ObjectId[] };
    };
    expect(filter.studentId.$in.map((id) => id.toString())).toEqual([
      studentIds[1].toString(),
    ]);
  });

  it('applies q and metric filters with AND semantics before pagination and reuses one candidate metrics batch', async () => {
    const studentIds = Array.from({ length: 3 }, () => objectId());
    const classroomTaskId = objectId();
    const taskId = objectId();
    const before = submission({
      studentId: studentIds[0],
      classroomTaskId,
      attemptNo: 1,
      submittedAt: '2026-07-01T00:00:00.000Z',
      codeText: 'before',
    });
    const after = submission({
      studentId: studentIds[0],
      classroomTaskId,
      attemptNo: 2,
      submittedAt: '2026-07-02T00:00:00.000Z',
      codeText: 'after',
    });
    const {
      service,
      classroomId,
      teacherId,
      submissionModel,
      aiFeedbackJobModel,
      feedbackModel,
    } = createServiceHarness({
      activeStudentIds: studentIds,
      students: studentIds.map((studentId, index) => ({
        _id: studentId,
        name: `Candidate ${index + 1}`,
        studentNo: `C-00${index + 1}`,
      })),
      classroomTasks: [
        { _id: classroomTaskId, taskId, publishedAt: new Date() },
      ],
      submissions: [before, after],
      jobs: [
        job({
          submissionId: before._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-07-01T01:00:00.000Z',
        }),
        job({
          submissionId: after._id,
          status: AiFeedbackJobStatus.Succeeded,
          updatedAt: '2026-07-02T01:00:00.000Z',
        }),
      ],
      feedbackItems: [
        feedback({ submissionId: after._id, severity: FeedbackSeverity.Info }),
        feedback({
          submissionId: before._id,
          severity: FeedbackSeverity.Error,
        }),
      ],
    });

    const improved = await service.getStudents(
      classroomId.toString(),
      { overallOutcome: 'IMPROVED_OVERALL' },
      teacherId.toString(),
    );
    expect(improved.items.map((item) => item.studentId)).toEqual([
      studentIds[0].toString(),
    ]);
    expect(improved.items[0]).toMatchObject({
      overallOutcome: 'IMPROVED_OVERALL',
      engagementStatus: 'QUALITY_COMPARABLE',
      growthTrend: 'IMPROVING',
    });

    submissionModel.find.mockClear();
    aiFeedbackJobModel.find.mockClear();
    feedbackModel.find.mockClear();
    const filteredPage = await service.getStudents(
      classroomId.toString(),
      {
        q: 'candidate',
        overallOutcome: 'INSUFFICIENT_DATA',
        engagementStatus: 'NO_SUBMISSION',
        page: 2,
        limit: 1,
      },
      teacherId.toString(),
    );

    expect(filteredPage).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      activeStudentsTotal: 3,
      filters: {
        q: 'candidate',
        overallOutcome: 'INSUFFICIENT_DATA',
        engagementStatus: 'NO_SUBMISSION',
      },
    });
    expect(filteredPage.items[0].studentId).toBe(studentIds[2].toString());
    expect(submissionModel.find).toHaveBeenCalledTimes(1);
    expect(aiFeedbackJobModel.find).toHaveBeenCalledTimes(1);
    expect(feedbackModel.find).toHaveBeenCalledTimes(1);
  });

  it('does not load samples when q leaves no ACTIVE candidate', async () => {
    const activeStudentId = objectId();
    const { service, classroomId, teacherId, submissionModel } =
      createServiceHarness({
        activeStudentIds: [activeStudentId],
        students: [
          { _id: activeStudentId, name: 'Only Student', studentNo: 'ONLY-1' },
        ],
        classroomTasks: [
          { _id: objectId(), taskId: objectId(), publishedAt: new Date() },
        ],
      });

    const result = await service.getStudents(
      classroomId.toString(),
      { q: 'missing', overallOutcome: 'INSUFFICIENT_DATA' },
      teacherId.toString(),
    );

    expect(result).toMatchObject({
      total: 0,
      activeStudentsTotal: 1,
      items: [],
    });
    expect(submissionModel.find).not.toHaveBeenCalled();
  });

  it('applies excludedTaskIds and window only to ClassroomTask selection, not the included task submission chain', async () => {
    const activeStudentId = objectId();
    const includedClassroomTaskId = objectId();
    const excludedClassroomTaskId = objectId();
    const taskId = objectId();
    const includedSubmission = submission({
      studentId: activeStudentId,
      classroomTaskId: includedClassroomTaskId,
      attemptNo: 1,
      submittedAt: '2020-01-01T00:00:00.000Z',
      codeText: 'old but included',
    });
    const {
      service,
      classroomId,
      teacherId,
      getCapturedClassroomTaskFilter,
      getCapturedSubmissionFilter,
    } = createServiceHarness({
      activeStudentIds: [activeStudentId],
      classroomTasks: [
        {
          _id: includedClassroomTaskId,
          taskId,
          publishedAt: new Date(),
        },
      ],
      submissions: [includedSubmission],
    });

    const result = await service.getOverview(
      classroomId.toString(),
      { window: '7d', excludedTaskIds: [excludedClassroomTaskId.toString()] },
      teacherId.toString(),
    );

    const taskFilter = getCapturedClassroomTaskFilter() as {
      publishedAt?: { $gte?: Date };
      _id?: { $nin?: Types.ObjectId[] };
    };
    const submissionFilter = getCapturedSubmissionFilter() as Record<
      string,
      unknown
    >;
    expect(taskFilter.publishedAt?.$gte).toBeInstanceOf(Date);
    expect(taskFilter).toHaveProperty('status.$in', ['ACTIVE', 'CLOSED', null]);
    expect(taskFilter._id?.$nin?.map((id) => id.toString())).toEqual([
      excludedClassroomTaskId.toString(),
    ]);
    expect(submissionFilter).not.toHaveProperty('submittedAt');
    expect(submissionFilter).not.toHaveProperty('createdAt');
    expect(result.context.excludedTaskIds).toEqual([
      excludedClassroomTaskId.toString(),
    ]);
    expect(result.summary.submittedStudentTaskCount).toBe(1);
  });

  it('returns a safe 404 for a non-ACTIVE or foreign student detail request', async () => {
    const activeStudentId = objectId();
    const foreignStudentId = objectId();
    const { service, classroomId, teacherId } = createServiceHarness({
      activeStudentIds: [activeStudentId],
    });

    await expect(
      service.getStudentDetail(
        classroomId.toString(),
        foreignStudentId.toString(),
        {},
        teacherId.toString(),
      ),
    ).rejects.toThrow('Student not found');
  });
});
