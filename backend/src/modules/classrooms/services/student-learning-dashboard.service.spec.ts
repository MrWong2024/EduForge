import { Model, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';
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
  title: string;
  publishedAt: Date;
  dueAt?: Date;
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
    status: 'ACTIVE',
  };
  const classroomTask: ClassroomTaskFixture = {
    _id: classroomTaskId,
    classroomId,
    taskId,
    title: 'Task A',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const classrooms = data.classrooms ?? [classroom];
  const classroomTasks = data.classroomTasks ?? [classroomTask];
  const submissions = data.submissions ?? [];
  const feedbacks = data.feedbacks ?? [];

  const classroomModel = {
    find: jest.fn(() => makeQuery(classrooms)),
    countDocuments: jest.fn().mockResolvedValue(classrooms.length),
  };
  const classroomTaskModel = {
    aggregate: jest.fn(() => makeAggregate(classroomTasks)),
  };
  const submissionModel = {
    find: jest.fn(() => makeQuery(submissions)),
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
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
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
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
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
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
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
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
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
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
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
});
