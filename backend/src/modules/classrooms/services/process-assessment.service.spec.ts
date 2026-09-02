import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { QueryProcessAssessmentDto } from '../dto/query-process-assessment.dto';
import { ProcessAssessmentService } from './process-assessment.service';

const CSV_HEADER =
  'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,aiRequestedTasksCount,aiSucceededTasksCount,avgWarnItems,avgErrorItems,topTags';
const RUBRIC = {
  submittedTasksRate: 0.45,
  submissionsCount: 0.15,
  aiRequestQualityProxy: 0.2,
  codeQualityProxy: 0.2,
};

const objectId = () => new Types.ObjectId();

type AggregatePipelineStage = {
  $match?: Record<string, unknown>;
} & Record<string, unknown>;

const makeQuery = <T>(result: T) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const makeAggregate = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const firstMatch = (pipeline: unknown) => {
  const stages = pipeline as AggregatePipelineStage[];
  return stages[0]?.$match ?? {};
};

const objectIdStringsFromMatch = (
  match: Record<string, unknown>,
  field: string,
) => {
  const condition = match[field] as { $in?: Types.ObjectId[] } | undefined;
  return (condition?.$in ?? []).map((id) => id.toString());
};

type BuildPayload = ProcessAssessmentService['buildPayload'];

const createService = (payload: Awaited<ReturnType<BuildPayload>>) => {
  const service = new ProcessAssessmentService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // Isolate CSV serialization while checking the private builder's real signature.
  Object.defineProperty(service, 'buildPayload', {
    value: jest
      .fn<ReturnType<BuildPayload>, Parameters<BuildPayload>>()
      .mockResolvedValue(payload),
  });
  return service;
};

const createAssessmentHarness = () => {
  const classroomId = objectId();
  const teacherId = objectId();
  const submittedStudentId = objectId();
  const zeroSubmissionStudentId = objectId();
  const includedClassroomTaskId = objectId();
  const excludedClassroomTaskId = objectId();
  const outsideClassroomTaskId = objectId();
  const includedSubmissionId = objectId();
  const excludedSubmissionId = objectId();

  const classroomModel = {
    findOne: jest.fn().mockReturnValue(makeQuery({ _id: classroomId })),
  };
  const classroomTaskModel = {
    find: jest
      .fn()
      .mockReturnValue(
        makeQuery([
          { _id: includedClassroomTaskId },
          { _id: excludedClassroomTaskId },
        ]),
      ),
  };
  const submissionModel = {
    aggregate: jest.fn((pipeline: unknown) => {
      const taskIds = objectIdStringsFromMatch(
        firstMatch(pipeline),
        'classroomTaskId',
      );
      const hasIncludedTask = taskIds.includes(
        includedClassroomTaskId.toString(),
      );
      const hasExcludedTask = taskIds.includes(
        excludedClassroomTaskId.toString(),
      );
      const submissionIds = [
        ...(hasIncludedTask ? [includedSubmissionId] : []),
        ...(hasExcludedTask ? [excludedSubmissionId] : []),
      ];
      if (submissionIds.length === 0) {
        return makeAggregate([]);
      }
      return makeAggregate([
        {
          _id: submittedStudentId,
          submissionsCount: submissionIds.length,
          submittedTasksCount: submissionIds.length,
          iteratedTasksCount: 0,
          lateSubmissionsCount: hasExcludedTask ? 1 : 0,
          lateTasksCount: hasExcludedTask ? 1 : 0,
          submissionIds,
        },
      ]);
    }),
  };
  const aiFeedbackJobModel = {
    aggregate: jest.fn((pipeline: unknown) => {
      const submissionIds = objectIdStringsFromMatch(
        firstMatch(pipeline),
        'submissionId',
      );
      const hasIncludedSubmission = submissionIds.includes(
        includedSubmissionId.toString(),
      );
      const hasExcludedSubmission = submissionIds.includes(
        excludedSubmissionId.toString(),
      );
      const aiRequestedCount =
        (hasIncludedSubmission ? 1 : 0) + (hasExcludedSubmission ? 1 : 0);
      if (aiRequestedCount === 0) {
        return makeAggregate([]);
      }
      return makeAggregate([
        {
          _id: submittedStudentId,
          aiRequestedCount,
          aiSucceededCount: hasIncludedSubmission ? 1 : 0,
          aiRequestedTasksCount: aiRequestedCount,
          aiSucceededTasksCount: hasIncludedSubmission ? 1 : 0,
        },
      ]);
    }),
  };
  const feedbackModel = {
    aggregate: jest.fn((pipeline: unknown) => {
      const submissionIds = objectIdStringsFromMatch(
        firstMatch(pipeline),
        'submissionId',
      );
      const hasIncludedSubmission = submissionIds.includes(
        includedSubmissionId.toString(),
      );
      const hasExcludedSubmission = submissionIds.includes(
        excludedSubmissionId.toString(),
      );
      const totalFeedbackItems =
        (hasIncludedSubmission ? 2 : 0) + (hasExcludedSubmission ? 5 : 0);
      const totalErrorItems = hasExcludedSubmission ? 5 : 0;
      const topTags = [
        ...(hasExcludedSubmission
          ? [
              { tag: 'security', count: 3 },
              { tag: 'bug', count: 2 },
            ]
          : []),
        ...(hasIncludedSubmission
          ? [
              { tag: 'readability', count: 1 },
              { tag: 'logic', count: 1 },
            ]
          : []),
      ];
      if (totalFeedbackItems === 0) {
        return makeAggregate([{ totals: [], tags: [] }]);
      }
      return makeAggregate([
        {
          totals: [
            {
              _id: submittedStudentId,
              reviewedTasksCount: submissionIds.length,
              totalFeedbackItems,
              totalWarnItems: 0,
              totalErrorItems,
            },
          ],
          tags: [{ _id: submittedStudentId, topTags }],
        },
      ]);
    }),
  };
  const userModel = {
    find: jest.fn().mockReturnValue(
      makeQuery([
        {
          _id: submittedStudentId,
          name: 'Submitted Student',
          studentNo: '2026001',
        },
        {
          _id: zeroSubmissionStudentId,
          name: 'Zero Submission Student',
          studentNo: '2026002',
        },
      ]),
    ),
  };
  const enrollmentService = {
    countStudents: jest.fn().mockResolvedValue(2),
    listActiveStudentIds: jest
      .fn()
      .mockResolvedValue([
        submittedStudentId.toString(),
        zeroSubmissionStudentId.toString(),
      ]),
    listActiveStudentIdsByClassroomPage: jest
      .fn()
      .mockResolvedValue([
        submittedStudentId.toString(),
        zeroSubmissionStudentId.toString(),
      ]),
  };
  const service = new ProcessAssessmentService(
    classroomModel as never,
    classroomTaskModel as never,
    submissionModel as never,
    aiFeedbackJobModel as never,
    feedbackModel as never,
    userModel as never,
    enrollmentService as never,
  );

  return {
    classroomId,
    teacherId,
    submittedStudentId,
    zeroSubmissionStudentId,
    includedClassroomTaskId,
    excludedClassroomTaskId,
    outsideClassroomTaskId,
    service,
    submissionModel,
    aiFeedbackJobModel,
    feedbackModel,
  };
};

type TaskDimensionScenario = {
  taskCount: number;
  submittedTasksCount: number;
  submissionsCount: number;
  iteratedTasksCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  aiRequestedTasksCount: number;
  aiSucceededTasksCount: number;
  reviewedTasksCount?: number;
  totalFeedbackItems?: number;
  totalWarnItems?: number;
  totalErrorItems?: number;
};

const createTaskDimensionHarness = (scenario: TaskDimensionScenario) => {
  const classroomId = objectId();
  const teacherId = objectId();
  const studentId = objectId();
  const classroomTaskIds = Array.from({ length: scenario.taskCount }, () =>
    objectId(),
  );
  const submissionIds = Array.from({ length: scenario.submissionsCount }, () =>
    objectId(),
  );

  const classroomModel = {
    findOne: jest.fn().mockReturnValue(makeQuery({ _id: classroomId })),
  };
  const classroomTaskModel = {
    find: jest
      .fn()
      .mockReturnValue(
        makeQuery(classroomTaskIds.map((taskId) => ({ _id: taskId }))),
      ),
  };
  const submissionModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate(
        scenario.submissionsCount > 0
          ? [
              {
                _id: studentId,
                submissionsCount: scenario.submissionsCount,
                submittedTasksCount: scenario.submittedTasksCount,
                iteratedTasksCount: scenario.iteratedTasksCount,
                lateSubmissionsCount: 0,
                lateTasksCount: 0,
                submissionIds,
              },
            ]
          : [],
      ),
    ),
  };
  const aiFeedbackJobModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate(
        scenario.aiRequestedCount > 0
          ? [
              {
                _id: studentId,
                aiRequestedCount: scenario.aiRequestedCount,
                aiSucceededCount: scenario.aiSucceededCount,
                aiRequestedTasksCount: scenario.aiRequestedTasksCount,
                aiSucceededTasksCount: scenario.aiSucceededTasksCount,
              },
            ]
          : [],
      ),
    ),
  };
  const reviewedTasksCount = scenario.reviewedTasksCount ?? 0;
  const feedbackModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate([
        {
          totals:
            reviewedTasksCount > 0
              ? [
                  {
                    _id: studentId,
                    reviewedTasksCount,
                    totalFeedbackItems: scenario.totalFeedbackItems ?? 0,
                    totalWarnItems: scenario.totalWarnItems ?? 0,
                    totalErrorItems: scenario.totalErrorItems ?? 0,
                  },
                ]
              : [],
          tags: [],
        },
      ]),
    ),
  };
  const userModel = {
    find: jest.fn().mockReturnValue(
      makeQuery([
        {
          _id: studentId,
          name: 'Scenario Student',
          studentNo: 'S-001',
        },
      ]),
    ),
  };
  const enrollmentService = {
    countStudents: jest.fn().mockResolvedValue(1),
    listActiveStudentIds: jest.fn().mockResolvedValue([studentId.toString()]),
    listActiveStudentIdsByClassroomPage: jest
      .fn()
      .mockResolvedValue([studentId.toString()]),
  };
  const service = new ProcessAssessmentService(
    classroomModel as never,
    classroomTaskModel as never,
    submissionModel as never,
    aiFeedbackJobModel as never,
    feedbackModel as never,
    userModel as never,
    enrollmentService as never,
  );

  return { classroomId, teacherId, studentId, service };
};

describe('QueryProcessAssessmentDto', () => {
  it('normalizes comma-separated excludedTaskIds', async () => {
    const firstTaskId = objectId().toString();
    const secondTaskId = objectId().toString();
    const dto = plainToInstance(QueryProcessAssessmentDto, {
      excludedTaskIds: `${firstTaskId}, ${secondTaskId}`,
    });

    expect(dto.excludedTaskIds).toEqual([firstTaskId, secondTaskId]);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('normalizes repeated excludedTaskIds and filters empty values', async () => {
    const firstTaskId = objectId().toString();
    const secondTaskId = objectId().toString();
    const dto = plainToInstance(QueryProcessAssessmentDto, {
      excludedTaskIds: [firstTaskId, `${secondTaskId},`, ''],
    });

    expect(dto.excludedTaskIds).toEqual([firstTaskId, secondTaskId]);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('treats empty excludedTaskIds as an empty array', async () => {
    const dto = plainToInstance(QueryProcessAssessmentDto, {
      excludedTaskIds: '',
    });

    expect(dto.excludedTaskIds).toEqual([]);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid excludedTaskIds', async () => {
    const dto = plainToInstance(QueryProcessAssessmentDto, {
      excludedTaskIds: 'not-a-mongo-id',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('excludedTaskIds');
  });
});

describe('ProcessAssessmentService task-dimension scoring', () => {
  it.each<[string, TaskDimensionScenario, Record<string, unknown>]>([
    [
      'scores 98 for one covered task with one submission and successful AI',
      {
        taskCount: 1,
        submittedTasksCount: 1,
        submissionsCount: 1,
        iteratedTasksCount: 0,
        aiRequestedCount: 1,
        aiSucceededCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
      },
      {
        score: 98,
        riskLevel: 'LOW',
        avgWarnItems: 0,
        avgErrorItems: 0,
      },
    ],
    [
      'scores 100 when the single covered task is iterated',
      {
        taskCount: 1,
        submittedTasksCount: 1,
        submissionsCount: 2,
        iteratedTasksCount: 1,
        aiRequestedCount: 1,
        aiSucceededCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
      },
      {
        score: 100,
        riskLevel: 'LOW',
      },
    ],
    [
      'scores 78 for one covered task without AI usage',
      {
        taskCount: 1,
        submittedTasksCount: 1,
        submissionsCount: 1,
        iteratedTasksCount: 0,
        aiRequestedCount: 0,
        aiSucceededCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      },
      {
        score: 78,
        riskLevel: 'LOW',
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      },
    ],
    [
      'scores 93 when the latest task feedback has one WARN',
      {
        taskCount: 1,
        submittedTasksCount: 1,
        submissionsCount: 1,
        iteratedTasksCount: 0,
        aiRequestedCount: 1,
        aiSucceededCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
        reviewedTasksCount: 1,
        totalFeedbackItems: 1,
        totalWarnItems: 1,
        totalErrorItems: 0,
      },
      {
        score: 93,
        riskLevel: 'LOW',
        avgFeedbackItems: 1,
        avgWarnItems: 1,
        avgErrorItems: 0,
      },
    ],
    [
      'scores 88 when the latest task feedback has one ERROR',
      {
        taskCount: 1,
        submittedTasksCount: 1,
        submissionsCount: 1,
        iteratedTasksCount: 0,
        aiRequestedCount: 1,
        aiSucceededCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
        reviewedTasksCount: 1,
        totalFeedbackItems: 1,
        totalWarnItems: 0,
        totalErrorItems: 1,
      },
      {
        score: 88,
        riskLevel: 'MEDIUM',
        avgFeedbackItems: 1,
        avgWarnItems: 0,
        avgErrorItems: 1,
      },
    ],
    [
      'scores 36 when one of five tasks is repeatedly submitted and AI requested',
      {
        taskCount: 5,
        submittedTasksCount: 1,
        submissionsCount: 6,
        iteratedTasksCount: 1,
        aiRequestedCount: 5,
        aiSucceededCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
      },
      {
        score: 36,
        riskLevel: 'HIGH',
        submittedTasksRate: 0.2,
        iteratedTasksCount: 1,
        aiRequestedTasksCount: 1,
        aiSucceededTasksCount: 1,
      },
    ],
    [
      'scores 98 when all five tasks are covered once with successful AI',
      {
        taskCount: 5,
        submittedTasksCount: 5,
        submissionsCount: 5,
        iteratedTasksCount: 0,
        aiRequestedCount: 5,
        aiSucceededCount: 5,
        aiRequestedTasksCount: 5,
        aiSucceededTasksCount: 5,
      },
      {
        score: 98,
        riskLevel: 'LOW',
        submittedTasksRate: 1,
      },
    ],
    [
      'scores 99 when all five tasks are covered and three tasks are iterated',
      {
        taskCount: 5,
        submittedTasksCount: 5,
        submissionsCount: 8,
        iteratedTasksCount: 3,
        aiRequestedCount: 5,
        aiSucceededCount: 5,
        aiRequestedTasksCount: 5,
        aiSucceededTasksCount: 5,
      },
      {
        score: 99,
        riskLevel: 'LOW',
        iteratedTasksCount: 3,
      },
    ],
    [
      'scores 78 when all five tasks are covered without AI',
      {
        taskCount: 5,
        submittedTasksCount: 5,
        submissionsCount: 5,
        iteratedTasksCount: 0,
        aiRequestedCount: 0,
        aiSucceededCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      },
      {
        score: 78,
        riskLevel: 'LOW',
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      },
    ],
    [
      'scores 0 and marks HIGH risk when there are no submissions',
      {
        taskCount: 1,
        submittedTasksCount: 0,
        submissionsCount: 0,
        iteratedTasksCount: 0,
        aiRequestedCount: 0,
        aiSucceededCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
      },
      {
        score: 0,
        riskLevel: 'HIGH',
        submittedTasksCount: 0,
        submittedTasksRate: 0,
        iteratedTasksCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
        avgFeedbackItems: 0,
        avgWarnItems: 0,
        avgErrorItems: 0,
      },
    ],
  ])('%s', async (_name, scenario, expected) => {
    const { classroomId, teacherId, service } =
      createTaskDimensionHarness(scenario);

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.rubric).toEqual(RUBRIC);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject(expected);
  });
});

describe('ProcessAssessmentService getProcessAssessment', () => {
  it('keeps active students with zero submissions in the list and fixes their score at 0', async () => {
    const {
      classroomId,
      teacherId,
      submittedStudentId,
      zeroSubmissionStudentId,
      service,
    } = createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.items).toHaveLength(2);
    const zeroSubmissionItem = result.items.find(
      (item) => item.studentId === zeroSubmissionStudentId.toString(),
    );
    expect(zeroSubmissionItem).toBeDefined();
    expect(zeroSubmissionItem).toMatchObject({
      studentId: zeroSubmissionStudentId.toString(),
      submissionsCount: 0,
      score: 0,
    });
    expect(zeroSubmissionItem?.score).not.toBe(20);

    const submittedItem = result.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );
    expect(submittedItem).toBeDefined();
    expect(submittedItem).toMatchObject({
      submissionsCount: 2,
      submittedTasksCount: 2,
      iteratedTasksCount: 0,
      lateSubmissionsCount: 1,
      lateTasksCount: 1,
      aiRequestedCount: 2,
      aiSucceededCount: 1,
      aiRequestedTasksCount: 2,
      aiSucceededTasksCount: 1,
      avgFeedbackItems: 3.5,
      avgWarnItems: 0,
      avgErrorItems: 2.5,
      score: 76,
    });
    expect(submittedItem?.score).toBeGreaterThan(0);
  });

  it('keeps existing results when excludedTaskIds is empty', async () => {
    const { classroomId, teacherId, submittedStudentId, service } =
      createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      { excludedTaskIds: [] },
      teacherId.toString(),
    );

    const submittedItem = result.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );
    expect(submittedItem).toMatchObject({
      publishedTasksCount: 2,
      submissionsCount: 2,
      iteratedTasksCount: 0,
      lateSubmissionsCount: 1,
      aiRequestedCount: 2,
      aiRequestedTasksCount: 2,
      avgWarnItems: 0,
      avgErrorItems: 2.5,
      score: 76,
    });
  });

  it('recalculates all metrics from effectiveTaskIds when one task is excluded', async () => {
    const {
      classroomId,
      teacherId,
      submittedStudentId,
      includedClassroomTaskId,
      excludedClassroomTaskId,
      service,
      submissionModel,
    } = createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      { excludedTaskIds: [excludedClassroomTaskId.toString()] },
      teacherId.toString(),
    );

    const submittedItem = result.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );
    expect(submittedItem).toMatchObject({
      publishedTasksCount: 1,
      submittedTasksCount: 1,
      submittedTasksRate: 1,
      submissionsCount: 1,
      iteratedTasksCount: 0,
      lateSubmissionsCount: 0,
      lateTasksCount: 0,
      aiRequestedCount: 1,
      aiSucceededCount: 1,
      aiRequestedTasksCount: 1,
      aiSucceededTasksCount: 1,
      avgFeedbackItems: 2,
      avgWarnItems: 0,
      avgErrorItems: 0,
      riskLevel: 'LOW',
      score: 98,
    });
    expect(submittedItem?.topTags).toEqual([
      { tag: 'readability', count: 1 },
      { tag: 'logic', count: 1 },
    ]);
    const submissionPipeline = submissionModel.aggregate.mock.calls[0][0];
    const taskIds = objectIdStringsFromMatch(
      firstMatch(submissionPipeline),
      'classroomTaskId',
    );
    expect(taskIds).toEqual([includedClassroomTaskId.toString()]);
  });

  it('ignores valid excludedTaskIds outside the current classroom task window', async () => {
    const {
      classroomId,
      teacherId,
      submittedStudentId,
      outsideClassroomTaskId,
      service,
    } = createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      { excludedTaskIds: [outsideClassroomTaskId.toString()] },
      teacherId.toString(),
    );

    const submittedItem = result.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );
    expect(submittedItem).toMatchObject({
      publishedTasksCount: 2,
      submissionsCount: 2,
      iteratedTasksCount: 0,
      lateSubmissionsCount: 1,
      aiRequestedCount: 2,
      aiRequestedTasksCount: 2,
      avgWarnItems: 0,
      avgErrorItems: 2.5,
      score: 76,
    });
  });

  it('keeps active students with zero task metrics when all tasks are excluded', async () => {
    const {
      classroomId,
      teacherId,
      includedClassroomTaskId,
      excludedClassroomTaskId,
      service,
      submissionModel,
      aiFeedbackJobModel,
      feedbackModel,
    } = createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      {
        excludedTaskIds: [
          includedClassroomTaskId.toString(),
          excludedClassroomTaskId.toString(),
        ],
      },
      teacherId.toString(),
    );

    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item).toMatchObject({
        publishedTasksCount: 0,
        submittedTasksCount: 0,
        submittedTasksRate: 0,
        submissionsCount: 0,
        iteratedTasksCount: 0,
        lateSubmissionsCount: 0,
        lateTasksCount: 0,
        aiRequestedCount: 0,
        aiSucceededCount: 0,
        aiRequestedTasksCount: 0,
        aiSucceededTasksCount: 0,
        avgFeedbackItems: 0,
        avgWarnItems: 0,
        avgErrorItems: 0,
        topTags: [],
        riskLevel: 'LOW',
        score: 0,
      });
    }
    expect(submissionModel.aggregate).not.toHaveBeenCalled();
    expect(aiFeedbackJobModel.aggregate).not.toHaveBeenCalled();
    expect(feedbackModel.aggregate).not.toHaveBeenCalled();
  });

  it('rejects invalid excludedTaskIds at service level', async () => {
    const { classroomId, teacherId, service } = createAssessmentHarness();

    await expect(
      service.getProcessAssessment(
        classroomId.toString(),
        { excludedTaskIds: ['not-a-mongo-id'] },
        teacherId.toString(),
      ),
    ).rejects.toThrow('excludedTaskIds must contain valid ObjectIds');
  });
});

describe('ProcessAssessmentService exportProcessAssessmentCsv', () => {
  it('prefixes CSV with UTF-8 BOM and preserves header order with Chinese text', async () => {
    const service = createService({
      classroomId: 'classroom-1',
      window: 'all',
      generatedAt: '2026-05-20T00:00:00.000Z',
      page: 1,
      limit: 50,
      total: 1,
      rubric: RUBRIC,
      items: [
        {
          studentId: 'student-1',
          studentName: '张三',
          studentNo: '2025001',
          submittedTasksCount: 1,
          publishedTasksCount: 2,
          submittedTasksRate: 0.5,
          submissionsCount: 2,
          iteratedTasksCount: 1,
          lateSubmissionsCount: 1,
          lateTasksCount: 1,
          aiRequestedCount: 2,
          aiSucceededCount: 1,
          aiRequestedTasksCount: 1,
          aiSucceededTasksCount: 1,
          avgFeedbackItems: 1.5,
          avgWarnItems: 0.25,
          avgErrorItems: 0.5,
          topTags: [{ tag: '中文标签', count: 2 }],
          riskLevel: 'MEDIUM',
          score: 83,
        },
      ],
    });

    const result = await service.exportProcessAssessmentCsv(
      'classroom-1',
      {},
      'teacher-1',
    );

    expect(result.startsWith('\uFEFF')).toBe(true);
    const [headerLine, firstDataLine] = result.slice(1).split('\n');
    expect(headerLine).toBe(CSV_HEADER);
    expect(firstDataLine).toContain('张三');
    expect(firstDataLine).toContain('中文标签:2');
  });

  it('returns BOM plus header row when there are no items', async () => {
    const service = createService({
      classroomId: 'classroom-1',
      window: 'all',
      generatedAt: '2026-05-20T00:00:00.000Z',
      page: 1,
      limit: 50,
      total: 0,
      rubric: RUBRIC,
      items: [],
    });

    const result = await service.exportProcessAssessmentCsv(
      'classroom-1',
      {},
      'teacher-1',
    );

    expect(result).toBe(`\uFEFF${CSV_HEADER}`);
  });

  it('exports zero-submission active students with score 0 while preserving BOM and columns', async () => {
    const { classroomId, teacherId, zeroSubmissionStudentId, service } =
      createAssessmentHarness();

    const result = await service.exportProcessAssessmentCsv(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.startsWith('\uFEFF')).toBe(true);
    const [headerLine, ...dataLines] = result.slice(1).split('\n');
    expect(headerLine).toBe(CSV_HEADER);
    const zeroSubmissionLine = dataLines.find((line) =>
      line.includes(zeroSubmissionStudentId.toString()),
    );
    expect(zeroSubmissionLine).toBeDefined();
    expect(zeroSubmissionLine?.split(',')[3]).toBe('0');
  });

  it('exports CSV using the same excludedTaskIds scoring scope as JSON', async () => {
    const {
      classroomId,
      teacherId,
      submittedStudentId,
      excludedClassroomTaskId,
      service,
    } = createAssessmentHarness();
    const query = { excludedTaskIds: [excludedClassroomTaskId.toString()] };
    const jsonResult = await service.getProcessAssessment(
      classroomId.toString(),
      query,
      teacherId.toString(),
    );
    const jsonItem = jsonResult.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );

    const csvResult = await service.exportProcessAssessmentCsv(
      classroomId.toString(),
      query,
      teacherId.toString(),
    );

    expect(csvResult.startsWith('\uFEFF')).toBe(true);
    const [headerLine, ...dataLines] = csvResult.slice(1).split('\n');
    expect(headerLine).toBe(CSV_HEADER);
    const submittedLine = dataLines.find((line) =>
      line.includes(submittedStudentId.toString()),
    );
    expect(submittedLine).toBeDefined();
    expect(submittedLine?.split(',')[3]).toBe(String(jsonItem?.score));
    expect(submittedLine?.split(',')[3]).toBe('98');
  });
});
