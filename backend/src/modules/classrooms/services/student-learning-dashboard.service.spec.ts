import { Model, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
} from '../classroom-tasks/classroom-task-status.constants';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
import { TaskStatus } from '../../learning-tasks/schemas/task.schema';
import { AiFeedbackJobService } from '../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { StudentLearningDashboardService } from './student-learning-dashboard.service';

type ClassroomFixture = {
  _id: Types.ObjectId;
  name: string;
  courseId: Types.ObjectId;
  status: string;
};

type ClassroomTaskFixture = {
  _id: Types.ObjectId;
  classroomId: Types.ObjectId;
  taskId: Types.ObjectId;
  status?: string;
  taskStatus?: string;
  title: string;
  publishedAt?: Date | null;
  dueAt?: Date | null;
};

type SubmissionFixture = {
  _id: Types.ObjectId;
  classroomTaskId?: Types.ObjectId | null;
  taskId: Types.ObjectId;
  studentId: Types.ObjectId;
  attemptNo: number;
  createdAt: Date;
};

type FeedbackFixture = {
  submissionId: Types.ObjectId;
  source: FeedbackSource;
  severity: FeedbackSeverity;
};

type HarnessData = {
  classrooms?: ClassroomFixture[];
  classroomTasks?: ClassroomTaskFixture[];
  submissions?: SubmissionFixture[];
  feedbacks?: FeedbackFixture[];
};

const objectId = () => new Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (days: number) => new Date(Date.now() + days * DAY_MS);

const makeQuery = <T>(result: T) => {
  const chain = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const makeAggregate = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const toIdSet = (values: Types.ObjectId[]) =>
  new Set(values.map((value) => value.toString()));

const createHarness = (data: HarnessData = {}) => {
  const studentId = data.submissions?.[0]?.studentId ?? objectId();
  const classroomId = data.classroomTasks?.[0]?.classroomId ?? objectId();
  const taskId =
    data.classroomTasks?.[0]?.taskId ??
    data.submissions?.[0]?.taskId ??
    objectId();
  const classroomTaskId =
    data.classroomTasks?.[0]?._id ??
    data.submissions?.[0]?.classroomTaskId ??
    objectId();
  const classroom: ClassroomFixture = {
    _id: classroomId,
    name: 'Class A',
    courseId: objectId(),
    status: ClassroomStatus.Active,
  };
  const classroomTask: ClassroomTaskFixture = {
    _id: classroomTaskId,
    classroomId,
    taskId,
    status: CLASSROOM_TASK_STATUS_ACTIVE,
    title: 'Task A',
    publishedAt: addDays(-1),
  };
  const classrooms = data.classrooms ?? [classroom];
  const classroomTasks = (data.classroomTasks ?? [classroomTask]).map(
    (task) => ({
      ...task,
      status: Object.prototype.hasOwnProperty.call(task, 'status')
        ? task.status
        : CLASSROOM_TASK_STATUS_ACTIVE,
    }),
  );
  const submissions = data.submissions ?? [];
  const feedbacks = data.feedbacks ?? [];
  const filterClassrooms = (filter: Record<string, unknown>) => {
    const idFilter = filter._id as { $in?: Types.ObjectId[] } | undefined;
    const ids = toIdSet(idFilter?.$in ?? []);
    return classrooms.filter(
      (item) =>
        (ids.size === 0 || ids.has(item._id.toString())) &&
        (!filter.status || item.status === filter.status),
    );
  };
  const filterClassroomTasks = (pipeline: unknown[]) => {
    const firstStage = pipeline[0] as
      | {
          $match?: {
            classroomId?: { $in?: Types.ObjectId[] };
            status?: string;
          };
        }
      | undefined;
    const match = firstStage?.$match ?? {};
    const ids = toIdSet(match.classroomId?.$in ?? []);
    const taskStatusStage = pipeline.find((stage) => {
      const matchRecord = (stage as { $match?: Record<string, unknown> })
        .$match;
      return Boolean(matchRecord?.['task.status']);
    }) as { $match?: { 'task.status'?: string } } | undefined;
    const taskStatus = taskStatusStage?.$match?.['task.status'];
    return classroomTasks.filter(
      (task) =>
        (ids.size === 0 || ids.has(task.classroomId.toString())) &&
        (!match.status || task.status === match.status) &&
        (!taskStatus ||
          (task.taskStatus ?? TaskStatus.Published) === taskStatus),
    );
  };
  const filterSubmissions = (filter: Record<string, unknown>) => {
    const studentId = filter.studentId as Types.ObjectId | undefined;
    const orClauses = (filter.$or as Array<Record<string, unknown>>) ?? [];
    const classroomTaskClause = orClauses[0] as
      | { classroomTaskId?: { $in?: Types.ObjectId[] } }
      | undefined;
    const fallbackClause = orClauses[1] as
      | { taskId?: { $in?: Types.ObjectId[] } }
      | undefined;
    const classroomTaskIds = toIdSet(
      classroomTaskClause?.classroomTaskId?.$in ?? [],
    );
    const taskIds = toIdSet(fallbackClause?.taskId?.$in ?? []);
    return submissions.filter((submission) => {
      if (
        studentId &&
        submission.studentId.toString() !== studentId.toString()
      ) {
        return false;
      }
      const classroomTaskId = submission.classroomTaskId?.toString();
      if (classroomTaskId) {
        return classroomTaskIds.has(classroomTaskId);
      }
      return taskIds.has(submission.taskId.toString());
    });
  };

  const classroomModel = {
    find: jest.fn((filter: Record<string, unknown>) =>
      makeQuery(filterClassrooms(filter)),
    ),
    countDocuments: jest
      .fn()
      .mockImplementation((filter: Record<string, unknown>) =>
        Promise.resolve(filterClassrooms(filter).length),
      ),
  };
  const classroomTaskModel = {
    aggregate: jest.fn((pipeline: unknown[]) => {
      const matchedTasks = filterClassroomTasks(pipeline);
      const hasGroupStage = pipeline.some((stage) =>
        Boolean((stage as { $group?: unknown }).$group),
      );
      if (hasGroupStage) {
        const grouped = Array.from(
          new Map(
            matchedTasks.map((task) => [
              task.classroomId.toString(),
              { _id: task.classroomId },
            ]),
          ).values(),
        );
        return makeAggregate(grouped);
      }
      return makeAggregate(matchedTasks);
    }),
  };
  const submissionModel = {
    find: jest.fn((filter: Record<string, unknown>) =>
      makeQuery(filterSubmissions(filter)),
    ),
  };
  const feedbackModel = {
    find: jest.fn((filter: Record<string, unknown>) => {
      const submissionFilter = filter.submissionId as {
        $in?: Types.ObjectId[];
      };
      const sourceFilter = filter.source as { $in?: FeedbackSource[] };
      const submissionIds = new Set(
        (submissionFilter.$in ?? []).map((id) => id.toString()),
      );
      const sources = new Set(sourceFilter.$in ?? []);
      return makeQuery(
        feedbacks.filter(
          (feedback) =>
            submissionIds.has(feedback.submissionId.toString()) &&
            sources.has(feedback.source),
        ),
      );
    }),
  };
  const enrollmentService = {
    listActiveClassroomIdsByUser: jest
      .fn()
      .mockResolvedValue(classrooms.map((item) => item._id)),
  };
  const aiFeedbackJobService = {
    getStatusMapBySubmissionIds: jest.fn().mockResolvedValue(new Map()),
  };

  const service = new StudentLearningDashboardService(
    classroomModel as unknown as Model<Classroom>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    submissionModel as unknown as Model<Submission>,
    feedbackModel as unknown as Model<Feedback>,
    enrollmentService as unknown as EnrollmentService,
    aiFeedbackJobService as unknown as AiFeedbackJobService,
  );

  return {
    service,
    classroomModel,
    classroomTaskModel,
    submissionModel,
    feedbackModel,
    ids: { studentId, classroomId, taskId, classroomTaskId },
  };
};

describe('StudentLearningDashboardService', () => {
  const getFirstTask = async (
    service: StudentLearningDashboardService,
    studentId: Types.ObjectId,
  ) => {
    const dashboard = await service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );
    return dashboard.items[0].tasks[0];
  };

  it('returns NOT_SUBMITTED when the student has no submissions', async () => {
    const { service, feedbackModel, ids } = createHarness();

    const task = await getFirstTask(service, ids.studentId);

    expect(task.completionStatus).toEqual({
      status: 'NOT_SUBMITTED',
      severity: null,
      source: null,
      latestSubmissionId: null,
      teacherFeedbackCount: 0,
      aiFeedbackCount: 0,
      teacherWorstSeverity: null,
      aiWorstSeverity: null,
    });
    expect(feedbackModel.find).not.toHaveBeenCalled();
  });

  it('returns NO_FEEDBACK when the latest submission has no teacher or AI feedback', async () => {
    const submission = {
      _id: objectId(),
      classroomTaskId: objectId(),
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const harness = createHarness({ submissions: [submission] });

    const task = await getFirstTask(harness.service, harness.ids.studentId);

    expect(task.completionStatus).toMatchObject({
      status: 'NO_FEEDBACK',
      severity: null,
      source: null,
      latestSubmissionId: submission._id.toString(),
    });
  });

  it.each([
    [FeedbackSeverity.Info, 'QUALIFIED'],
    [FeedbackSeverity.Warn, 'QUALIFIED_WITH_WARNINGS'],
    [FeedbackSeverity.Error, 'UNQUALIFIED'],
  ])('maps latest AI %s feedback to %s', async (severity, expectedStatus) => {
    const submission = {
      _id: objectId(),
      classroomTaskId: objectId(),
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const harness = createHarness({
      classroomTasks: [
        {
          _id: submission.classroomTaskId,
          classroomId: objectId(),
          taskId: submission.taskId,
          title: 'Task A',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [submission],
      feedbacks: [
        {
          submissionId: submission._id,
          source: FeedbackSource.AI,
          severity,
        },
      ],
    });

    const task = await getFirstTask(harness.service, harness.ids.studentId);

    expect(task.completionStatus).toMatchObject({
      status: expectedStatus,
      severity,
      source: FeedbackSource.AI,
      aiFeedbackCount: 1,
      aiWorstSeverity: severity,
    });
  });

  it('lets teacher INFO override AI ERROR on the latest submission', async () => {
    const submission = {
      _id: objectId(),
      classroomTaskId: objectId(),
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const harness = createHarness({
      classroomTasks: [
        {
          _id: submission.classroomTaskId,
          classroomId: objectId(),
          taskId: submission.taskId,
          title: 'Task A',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [submission],
      feedbacks: [
        {
          submissionId: submission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: submission._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Info,
        },
      ],
    });

    const task = await getFirstTask(harness.service, harness.ids.studentId);

    expect(task.completionStatus).toMatchObject({
      status: 'QUALIFIED',
      severity: FeedbackSeverity.Info,
      source: FeedbackSource.Teacher,
      teacherFeedbackCount: 1,
      aiFeedbackCount: 1,
      teacherWorstSeverity: FeedbackSeverity.Info,
      aiWorstSeverity: FeedbackSeverity.Error,
    });
  });

  it('uses the worst teacher severity when multiple teacher feedback items exist', async () => {
    const submission = {
      _id: objectId(),
      classroomTaskId: objectId(),
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const harness = createHarness({
      classroomTasks: [
        {
          _id: submission.classroomTaskId,
          classroomId: objectId(),
          taskId: submission.taskId,
          title: 'Task A',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [submission],
      feedbacks: [
        {
          submissionId: submission._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: submission._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Warn,
        },
        {
          submissionId: submission._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Error,
        },
      ],
    });

    const task = await getFirstTask(harness.service, harness.ids.studentId);

    expect(task.completionStatus).toMatchObject({
      status: 'UNQUALIFIED',
      severity: FeedbackSeverity.Error,
      source: FeedbackSource.Teacher,
      teacherFeedbackCount: 3,
      teacherWorstSeverity: FeedbackSeverity.Error,
    });
  });

  it('uses the worst AI severity when no teacher feedback exists', async () => {
    const submission = {
      _id: objectId(),
      classroomTaskId: objectId(),
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const harness = createHarness({
      classroomTasks: [
        {
          _id: submission.classroomTaskId,
          classroomId: objectId(),
          taskId: submission.taskId,
          title: 'Task A',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [submission],
      feedbacks: [
        {
          submissionId: submission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: submission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Warn,
        },
      ],
    });

    const task = await getFirstTask(harness.service, harness.ids.studentId);

    expect(task.completionStatus).toMatchObject({
      status: 'QUALIFIED_WITH_WARNINGS',
      severity: FeedbackSeverity.Warn,
      source: FeedbackSource.AI,
      aiFeedbackCount: 2,
      aiWorstSeverity: FeedbackSeverity.Warn,
    });
  });

  it('does not mix feedback from historical submissions or other submissions', async () => {
    const classroomTaskId = objectId();
    const taskId = objectId();
    const oldSubmission = {
      _id: objectId(),
      classroomTaskId,
      taskId,
      studentId: objectId(),
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const latestSubmission = {
      _id: objectId(),
      classroomTaskId,
      taskId,
      studentId: oldSubmission.studentId,
      attemptNo: 2,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    };
    const unrelatedSubmissionId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: classroomTaskId,
          classroomId: objectId(),
          taskId,
          title: 'Task A',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [latestSubmission, oldSubmission],
      feedbacks: [
        {
          submissionId: oldSubmission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: unrelatedSubmissionId,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: latestSubmission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
      ],
    });

    const task = await getFirstTask(harness.service, oldSubmission.studentId);

    expect(task.completionStatus).toMatchObject({
      status: 'QUALIFIED',
      severity: FeedbackSeverity.Info,
      source: FeedbackSource.AI,
      latestSubmissionId: latestSubmission._id.toString(),
      aiFeedbackCount: 1,
    });
    const feedbackFilter = harness.feedbackModel.find.mock.calls[0][0] as {
      submissionId: { $in: Types.ObjectId[] };
    };
    expect(feedbackFilter.submissionId.$in.map((id) => id.toString())).toEqual([
      latestSubmission._id.toString(),
    ]);
  });

  it('returns only ACTIVE classroomTasks when a classroom also has CLOSED tasks', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const activeClassroomTaskId = objectId();
    const closedClassroomTaskId = objectId();
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const activeSubmission = {
      _id: objectId(),
      classroomTaskId: activeClassroomTaskId,
      taskId: activeTaskId,
      studentId,
      attemptNo: 1,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const closedSubmission = {
      _id: objectId(),
      classroomTaskId: closedClassroomTaskId,
      taskId: closedTaskId,
      studentId,
      attemptNo: 1,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    };
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: activeClassroomTaskId,
          classroomId,
          taskId: activeTaskId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Active Task',
          publishedAt: addDays(-1),
        },
        {
          _id: closedClassroomTaskId,
          classroomId,
          taskId: closedTaskId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Closed Task',
          publishedAt: addDays(-1),
        },
      ],
      submissions: [activeSubmission, closedSubmission],
      feedbacks: [
        {
          submissionId: activeSubmission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: closedSubmission._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Error,
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.items).toHaveLength(1);
    expect(dashboard.items[0].tasks).toHaveLength(1);
    expect(dashboard.items[0].tasks[0]).toMatchObject({
      classroomTaskId: activeClassroomTaskId.toString(),
      title: 'Active Task',
      completionStatus: {
        status: 'QUALIFIED',
        source: FeedbackSource.AI,
      },
    });
    const submissionFilter = harness.submissionModel.find.mock.calls[0][0] as {
      $or: Array<{ classroomTaskId?: { $in?: Types.ObjectId[] } }>;
    };
    expect(
      submissionFilter.$or[0].classroomTaskId?.$in?.map((id) => id.toString()),
    ).toEqual([activeClassroomTaskId.toString()]);
  });

  it('removes classrooms that only have CLOSED classroomTasks and counts final items', async () => {
    const classroomId = objectId();
    const closedClassroomTaskId = objectId();
    const closedTaskId = objectId();
    const studentId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Closed Only Class',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: closedClassroomTaskId,
          classroomId,
          taskId: closedTaskId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Closed Task',
          publishedAt: addDays(-1),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.items).toEqual([]);
    expect(dashboard.total).toBe(0);
    expect(harness.submissionModel.find).not.toHaveBeenCalled();
    expect(harness.feedbackModel.find).not.toHaveBeenCalled();
  });

  it('filters by classroomTask.status instead of task publication state', async () => {
    const classroomId = objectId();
    const closedClassroomTaskId = objectId();
    const closedTaskId = objectId();
    const studentId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: closedClassroomTaskId,
          classroomId,
          taskId: closedTaskId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Published Template But Closed Instance',
          publishedAt: addDays(-1),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.items).toEqual([]);
    const aggregateCalls = harness.classroomTaskModel.aggregate.mock
      .calls as unknown as Array<[unknown[]]>;
    const activeStatusMatched = (aggregateCalls[0]?.[0] ?? []).some((stage) => {
      const stageRecord = stage as Record<string, unknown>;
      const matchRecord = stageRecord.$match as
        | Record<string, unknown>
        | undefined;
      return matchRecord?.status === CLASSROOM_TASK_STATUS_ACTIVE;
    });
    expect(activeStatusMatched).toBe(true);
  });

  it('does not return classroomTasks with missing or unknown status', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const unknownStatusTaskId = objectId();
    const missingStatusTaskId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: objectId(),
          classroomId,
          taskId: unknownStatusTaskId,
          status: 'UNKNOWN',
          title: 'Unknown Status Task',
          publishedAt: addDays(-1),
        },
        {
          _id: objectId(),
          classroomId,
          taskId: missingStatusTaskId,
          status: undefined,
          title: 'Missing Status Task',
          publishedAt: addDays(-1),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.items).toEqual([]);
    expect(dashboard.total).toBe(0);
  });

  it('returns current and recently expired tasks by default with visibility fields', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const currentTaskId = objectId();
    const recentTaskId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: objectId(),
          classroomId,
          taskId: currentTaskId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Future Due Task',
          publishedAt: addDays(-1),
          dueAt: addDays(3),
        },
        {
          _id: objectId(),
          classroomId,
          taskId: recentTaskId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Recently Expired Task',
          publishedAt: addDays(-20),
          dueAt: addDays(-10),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Future Due Task',
          studentVisibilityStatus: 'CURRENT',
          isHistorical: false,
        }),
        expect.objectContaining({
          title: 'Recently Expired Task',
          studentVisibilityStatus: 'RECENTLY_EXPIRED',
          isHistorical: false,
        }),
      ]),
    );
  });

  it('hides long-expired and stale no-due tasks by default before querying submissions', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const longExpiredClassroomTaskId = objectId();
    const staleNoDueClassroomTaskId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Historical Only Class',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: longExpiredClassroomTaskId,
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Expired 31 Days Ago',
          publishedAt: addDays(-45),
          dueAt: addDays(-31),
        },
        {
          _id: staleNoDueClassroomTaskId,
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'No Due Old Published',
          publishedAt: addDays(-91),
        },
      ],
      submissions: [
        {
          _id: objectId(),
          classroomTaskId: longExpiredClassroomTaskId,
          taskId: objectId(),
          studentId,
          attemptNo: 1,
          createdAt: addDays(-30),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.items).toEqual([]);
    expect(dashboard.total).toBe(0);
    expect(harness.submissionModel.find).not.toHaveBeenCalled();
    expect(harness.feedbackModel.find).not.toHaveBeenCalled();
  });

  it('returns historical tasks when includeHistorical is true', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const longExpiredClassroomTaskId = objectId();
    const staleNoDueClassroomTaskId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: longExpiredClassroomTaskId,
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Expired 31 Days Ago',
          publishedAt: addDays(-45),
          dueAt: addDays(-31),
        },
        {
          _id: staleNoDueClassroomTaskId,
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'No Due Old Published',
          publishedAt: addDays(-91),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
      true,
    );

    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Expired 31 Days Ago',
          studentVisibilityStatus: 'HISTORICAL',
          isHistorical: true,
        }),
        expect.objectContaining({
          title: 'No Due Old Published',
          studentVisibilityStatus: 'HISTORICAL',
          isHistorical: true,
        }),
      ]),
    );
  });

  it('returns recent no-due tasks and hides missing-date tasks by default', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: objectId(),
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'No Due Recent Published',
          publishedAt: addDays(-60),
        },
        {
          _id: objectId(),
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Missing Dates',
          publishedAt: null,
          dueAt: null,
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
    );

    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].tasks).toEqual([
      expect.objectContaining({
        title: 'No Due Recent Published',
        studentVisibilityStatus: 'CURRENT',
        isHistorical: false,
      }),
    ]);
  });

  it('does not return archived classrooms even when includeHistorical is true', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Archived Class',
          courseId: objectId(),
          status: ClassroomStatus.Archived,
        },
      ],
      classroomTasks: [
        {
          _id: objectId(),
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Active Task In Archived Class',
          publishedAt: addDays(-1),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
      true,
    );

    expect(dashboard.items).toEqual([]);
    expect(dashboard.total).toBe(0);
  });

  it('returns classroomTasks whose linked templates are archived', async () => {
    const classroomId = objectId();
    const studentId = objectId();
    const harness = createHarness({
      classrooms: [
        {
          _id: classroomId,
          name: 'Class A',
          courseId: objectId(),
          status: ClassroomStatus.Active,
        },
      ],
      classroomTasks: [
        {
          _id: objectId(),
          classroomId,
          taskId: objectId(),
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          taskStatus: TaskStatus.Archived,
          title: 'Archived Template Task',
          publishedAt: addDays(-1),
        },
      ],
    });

    const dashboard = await harness.service.getMyLearningDashboard(
      {},
      studentId.toString(),
      true,
    );

    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].tasks).toEqual([
      expect.objectContaining({
        title: 'Archived Template Task',
      }),
    ]);
  });
});
