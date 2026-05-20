import { Model, Types } from 'mongoose';
import { Classroom } from '../schemas/classroom.schema';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
} from '../classroom-tasks/classroom-task-status.constants';
import { Submission } from '../../learning-tasks/schemas/submission.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { Feedback } from '../../learning-tasks/schemas/feedback.schema';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import { TeacherClassroomDashboardService } from './teacher-classroom-dashboard.service';
import { TaskStatus } from '../../learning-tasks/schemas/task.schema';
import { User } from '../../users/schemas/user.schema';

type ClassroomTaskFixture = {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  classroomId: Types.ObjectId;
  status?: string;
  title: string;
  stage: number;
  knowledgeModule: string;
  publishedAt: Date;
  dueAt?: Date;
  taskStatus?: string;
  taskCreatedBy?: Types.ObjectId;
};

type UserFixture = {
  _id: Types.ObjectId;
  name?: string;
};

type SubmissionFixture = {
  _id: Types.ObjectId;
  classroomTaskId: Types.ObjectId;
  studentId: Types.ObjectId;
  isLate?: boolean;
  createdAt?: Date;
};

type AiJobFixture = {
  classroomTaskId: Types.ObjectId;
  submissionId?: Types.ObjectId;
  status: AiFeedbackJobStatus;
};

type FeedbackFixture = {
  submissionId?: Types.ObjectId;
  tags: string[];
};

type HarnessData = {
  classroom?: Partial<{
    status: string;
    createdAt: Date;
  }>;
  classroomTasks?: ClassroomTaskFixture[];
  submissions?: SubmissionFixture[];
  aiJobs?: AiJobFixture[];
  feedbacks?: FeedbackFixture[];
  users?: UserFixture[];
  activeStudentIds?: Types.ObjectId[];
};

const objectId = () => new Types.ObjectId();

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

const makeFindOne = <T>(result: T) => {
  const chain = {
    sort: jest.fn(),
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.sort.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const toIdSet = (values: Types.ObjectId[]) =>
  new Set(values.map((value) => value.toString()));

const getPipelineMatch = (pipeline: unknown[]) => {
  const firstStage = pipeline[0] as { $match?: Record<string, unknown> };
  return firstStage.$match ?? {};
};

const createHarness = (data: HarnessData = {}) => {
  const classroomId = objectId();
  const teacherId = objectId();
  const classroom = {
    _id: classroomId,
    name: 'Class A',
    courseId: objectId(),
    status: data.classroom?.status ?? 'ACTIVE',
    joinCode: 'JOIN01',
    createdAt: data.classroom?.createdAt,
  };
  const classroomTasks = data.classroomTasks ?? [
    {
      _id: objectId(),
      taskId: objectId(),
      classroomId,
      status: CLASSROOM_TASK_STATUS_ACTIVE,
      title: 'Active Task',
      stage: 1,
      knowledgeModule: 'module',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  const defaultPublisherId = objectId();
  const users = data.users ?? [
    { _id: defaultPublisherId, name: 'Template Owner' },
  ];
  const submissions = data.submissions ?? [];
  const aiJobs = data.aiJobs ?? [];
  const feedbacks = data.feedbacks ?? [];
  const activeStudentIds =
    data.activeStudentIds ??
    Array.from(
      new Map(
        submissions.map((submission) => [
          submission.studentId.toString(),
          submission.studentId,
        ]),
      ).values(),
    );

  const filterClassroomTasks = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    const classroomIdValue = match.classroomId as Types.ObjectId | undefined;
    const statusFilter = match.status as { $in?: string[] } | undefined;
    const statuses = new Set(statusFilter?.$in ?? []);
    return classroomTasks
      .filter(
        (task) =>
          (!classroomIdValue ||
            task.classroomId.toString() === classroomIdValue.toString()) &&
          statuses.has(task.status ?? ''),
      )
      .map((task) => ({
        _id: task._id,
        taskId: task.taskId,
        taskPublisherId: task.taskCreatedBy ?? defaultPublisherId,
        classroomTaskStatus: task.status ?? '',
        taskTemplateStatus: task.taskStatus ?? TaskStatus.Published,
        publishedAt: task.publishedAt,
        dueAt: task.dueAt,
        title: task.title,
        stage: task.stage,
        knowledgeModule: task.knowledgeModule,
      }));
  };

  const filterArchiveCandidates = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    const classroomIdValue = match.classroomId as Types.ObjectId | undefined;
    return classroomTasks
      .filter(
        (task) =>
          !classroomIdValue ||
          task.classroomId.toString() === classroomIdValue.toString(),
      )
      .map((task) => ({
        _id: task._id,
        classroomTaskStatus: task.status,
        taskStatus: task.taskStatus ?? TaskStatus.Published,
        publishedAt: task.publishedAt,
        dueAt: task.dueAt,
      }));
  };

  const getSubmissionStats = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    if (match._id === null) {
      return [];
    }
    const classroomTaskIds = toIdSet(
      (match.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const studentIds = toIdSet(
      (match.studentId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const statsByTask = new Map<
      string,
      {
        _id: Types.ObjectId;
        submissionsCount: number;
        studentIds: Set<string>;
        lateSubmissionsCount: number;
        lateStudentIds: Map<string, Types.ObjectId>;
      }
    >();
    for (const submission of submissions) {
      const taskKey = submission.classroomTaskId.toString();
      if (!classroomTaskIds.has(taskKey)) {
        continue;
      }
      if (
        studentIds.size > 0 &&
        !studentIds.has(submission.studentId.toString())
      ) {
        continue;
      }
      const current = statsByTask.get(taskKey) ?? {
        _id: submission.classroomTaskId,
        submissionsCount: 0,
        studentIds: new Set<string>(),
        lateSubmissionsCount: 0,
        lateStudentIds: new Map<string, Types.ObjectId>(),
      };
      current.submissionsCount += 1;
      current.studentIds.add(submission.studentId.toString());
      if (submission.isLate) {
        current.lateSubmissionsCount += 1;
        current.lateStudentIds.set(
          submission.studentId.toString(),
          submission.studentId,
        );
      }
      statsByTask.set(taskKey, current);
    }
    return Array.from(statsByTask.values()).map((stat) => ({
      _id: stat._id,
      submissionsCount: stat.submissionsCount,
      distinctStudentsSubmitted: stat.studentIds.size,
      lateSubmissionsCount: stat.lateSubmissionsCount,
      lateStudentIds: Array.from(stat.lateStudentIds.values()),
    }));
  };

  const getAiFeedbackStats = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    if (match._id === null) {
      return [];
    }
    const classroomTaskIds = toIdSet(
      (match.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const submissionIds = toIdSet(
      (match.submissionId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const stats = new Map<
      string,
      {
        classroomTaskId: Types.ObjectId;
        status: AiFeedbackJobStatus;
        count: number;
      }
    >();
    for (const job of aiJobs) {
      const taskKey = job.classroomTaskId.toString();
      if (!classroomTaskIds.has(taskKey)) {
        continue;
      }
      if (
        submissionIds.size > 0 &&
        (!job.submissionId || !submissionIds.has(job.submissionId.toString()))
      ) {
        continue;
      }
      const key = `${taskKey}:${job.status}`;
      const current = stats.get(key) ?? {
        classroomTaskId: job.classroomTaskId,
        status: job.status,
        count: 0,
      };
      current.count += 1;
      stats.set(key, current);
    }
    return Array.from(stats.values()).map((stat) => ({
      _id: { classroomTaskId: stat.classroomTaskId, status: stat.status },
      count: stat.count,
    }));
  };

  const getTagStats = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    if (match._id === null) {
      return [];
    }
    const submissionIds = toIdSet(
      (match.submissionId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const grouped = new Map<
      string,
      { _id: Types.ObjectId; tags: { tag: string; count: number }[] }
    >();
    for (const feedback of feedbacks) {
      if (!feedback.submissionId) {
        continue;
      }
      if (
        submissionIds.size > 0 &&
        !submissionIds.has(feedback.submissionId.toString())
      ) {
        continue;
      }
      const submission = submissions.find(
        (item) => item._id.toString() === feedback.submissionId?.toString(),
      );
      if (!submission) {
        continue;
      }
      const taskKey = submission.classroomTaskId.toString();
      const current = grouped.get(taskKey) ?? {
        _id: submission.classroomTaskId,
        tags: [],
      };
      for (const tag of feedback.tags) {
        const tagItem = current.tags.find((item) => item.tag === tag);
        if (tagItem) {
          tagItem.count += 1;
        } else {
          current.tags.push({ tag, count: 1 });
        }
      }
      grouped.set(taskKey, current);
    }
    return Array.from(grouped.values());
  };

  const classroomModel = {
    findOne: jest.fn(() => makeQuery(classroom)),
  };
  const classroomTaskModel = {
    aggregate: jest.fn(),
  };
  const aiFeedbackJobModel = {
    aggregate: jest.fn((pipeline: unknown[]) =>
      makeAggregate(getAiFeedbackStats(pipeline)),
    ),
  };
  const feedbackModel = {
    aggregate: jest.fn((pipeline: unknown[]) =>
      makeAggregate(getTagStats(pipeline)),
    ),
  };
  const userModel = {
    find: jest.fn((query: Record<string, { $in?: Types.ObjectId[] }>) => {
      const userIds = toIdSet(query._id?.$in ?? []);
      return makeQuery(
        users.filter((user) => userIds.has(user._id.toString())),
      );
    }),
  };
  const getLastSubmission = (query: Record<string, unknown>) => {
    const classroomTaskIds = toIdSet(
      (query.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const candidates = submissions.filter((submission) =>
      classroomTaskIds.has(submission.classroomTaskId.toString()),
    );
    if (candidates.length === 0) {
      return null;
    }
    const latest = candidates.reduce((currentLatest, submission) => {
      const currentTime = submission.createdAt?.getTime() ?? 0;
      const latestTime = currentLatest.createdAt?.getTime() ?? 0;
      return currentTime > latestTime ? submission : currentLatest;
    });
    return {
      createdAt: latest.createdAt,
    };
  };
  const submissionFindOne = jest.fn((query: Record<string, unknown>) =>
    makeFindOne(getLastSubmission(query)),
  );
  const submissionAggregate = jest.fn((pipeline: unknown[]) =>
    makeAggregate(getSubmissionStats(pipeline)),
  );
  const enrollmentService = {
    countStudents: jest.fn().mockResolvedValue(5),
    listActiveStudentIds: jest
      .fn()
      .mockResolvedValue(
        activeStudentIds.map((studentId) => studentId.toString()),
      ),
  };

  classroomTaskModel.aggregate.mockImplementation((pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    return makeAggregate(
      match.status
        ? filterClassroomTasks(pipeline)
        : filterArchiveCandidates(pipeline),
    );
  });

  const findActiveSubmissions = (filter: Record<string, unknown>) => {
    const classroomTaskIds = toIdSet(
      (filter.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    const studentIds = toIdSet(
      (filter.studentId as { $in?: Types.ObjectId[] })?.$in ?? [],
    );
    return submissions.filter((submission) => {
      if (!classroomTaskIds.has(submission.classroomTaskId.toString())) {
        return false;
      }
      if (
        studentIds.size > 0 &&
        !studentIds.has(submission.studentId.toString())
      ) {
        return false;
      }
      return true;
    });
  };
  const submissionModel = {
    aggregate: submissionAggregate,
    findOne: submissionFindOne,
    find: jest.fn((filter: Record<string, unknown>) =>
      makeQuery(findActiveSubmissions(filter)),
    ),
  };

  const service = new TeacherClassroomDashboardService(
    classroomModel as unknown as Model<Classroom>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    submissionModel as unknown as Model<Submission>,
    feedbackModel as unknown as Model<Feedback>,
    aiFeedbackJobModel as unknown as Model<AiFeedbackJob>,
    userModel as unknown as Model<User>,
    enrollmentService as unknown as EnrollmentService,
  );

  return {
    service,
    classroomModel,
    classroomTaskModel,
    submissionModel,
    feedbackModel,
    userModel,
    ids: { classroomId, teacherId },
  };
};

describe('TeacherClassroomDashboardService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-07T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns only ACTIVE classroomTasks by default', async () => {
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const closeTaskId = objectId();
    const recalledTaskId = objectId();
    const unknownTaskId = objectId();
    const classroomId = objectId();
    const studentId = objectId();
    const activeSubmissionId = objectId();
    const closedSubmissionId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: activeTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Active Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: closedTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          taskStatus: TaskStatus.Draft,
          title: 'Closed Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          _id: closeTaskId,
          taskId: objectId(),
          classroomId,
          status: 'CLOSE',
          title: 'Invalid Close Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          _id: recalledTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_RECALLED,
          title: 'Recalled Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
        {
          _id: unknownTaskId,
          taskId: objectId(),
          classroomId,
          status: 'UNKNOWN',
          title: 'Unknown Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-05T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: activeSubmissionId,
          classroomTaskId: activeTaskId,
          studentId,
          isLate: true,
        },
        {
          _id: closedSubmissionId,
          classroomTaskId: closedTaskId,
          studentId,
          isLate: true,
        },
      ],
      aiJobs: [
        {
          classroomTaskId: activeTaskId,
          submissionId: activeSubmissionId,
          status: AiFeedbackJobStatus.Succeeded,
        },
        {
          classroomTaskId: closedTaskId,
          submissionId: closedSubmissionId,
          status: AiFeedbackJobStatus.Failed,
        },
      ],
      feedbacks: [
        { submissionId: activeSubmissionId, tags: ['correctness'] },
        { submissionId: closedSubmissionId, tags: ['bug-risk'] },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.tasks[0]).toMatchObject({
      classroomTaskId: activeTaskId.toString(),
      classroomTaskStatus: CLASSROOM_TASK_STATUS_ACTIVE,
      taskPublisher: { name: 'Template Owner' },
      taskTemplateStatus: TaskStatus.Published,
      submissionsCount: 1,
      aiFeedback: { succeeded: 1, failed: 0, notRequested: 0 },
      topTags: [{ tag: 'correctness', count: 1 }],
    });
    expect(dashboard.summary).toMatchObject({
      publishedTasksCount: 1,
      lateSubmissionsTotal: 1,
      lateStudentsTotal: 1,
    });
  });

  it('treats includeClosedTasks=false like the default', async () => {
    const classroomId = objectId();
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: activeTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Active Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: closedTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          taskStatus: TaskStatus.Draft,
          title: 'Closed Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
      false,
    );

    const tasks = dashboard.tasks as Array<{ classroomTaskId: string }>;
    expect(tasks.map((task) => task.classroomTaskId)).toEqual([
      activeTaskId.toString(),
    ]);
  });

  it('returns only ACTIVE and CLOSED when includeClosedTasks is true', async () => {
    const classroomId = objectId();
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const closeTaskId = objectId();
    const recalledTaskId = objectId();
    const unknownTaskId = objectId();
    const studentId = objectId();
    const activeSubmissionId = objectId();
    const closedSubmissionId = objectId();
    const closeSubmissionId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: activeTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Active Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: closedTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          taskStatus: TaskStatus.Draft,
          title: 'Closed Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          _id: closeTaskId,
          taskId: objectId(),
          classroomId,
          status: 'CLOSE',
          title: 'Invalid Close Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          _id: recalledTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_RECALLED,
          title: 'Recalled Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
        {
          _id: unknownTaskId,
          taskId: objectId(),
          classroomId,
          status: 'UNKNOWN',
          title: 'Unknown Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-05T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: activeSubmissionId,
          classroomTaskId: activeTaskId,
          studentId,
        },
        {
          _id: closedSubmissionId,
          classroomTaskId: closedTaskId,
          studentId,
        },
        {
          _id: closeSubmissionId,
          classroomTaskId: closeTaskId,
          studentId,
        },
      ],
      aiJobs: [
        {
          classroomTaskId: activeTaskId,
          submissionId: activeSubmissionId,
          status: AiFeedbackJobStatus.Succeeded,
        },
        {
          classroomTaskId: closedTaskId,
          submissionId: closedSubmissionId,
          status: AiFeedbackJobStatus.Failed,
        },
        {
          classroomTaskId: closeTaskId,
          submissionId: closeSubmissionId,
          status: AiFeedbackJobStatus.Dead,
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
      true,
    );

    const tasks = dashboard.tasks as Array<{ classroomTaskStatus: string }>;
    expect(tasks.map((task) => task.classroomTaskStatus)).toEqual([
      CLASSROOM_TASK_STATUS_ACTIVE,
      CLASSROOM_TASK_STATUS_CLOSED,
    ]);
    expect(dashboard.tasks).toHaveLength(2);
    expect(dashboard.summary.publishedTasksCount).toBe(2);
    expect(dashboard.tasks[1]).toMatchObject({
      classroomTaskId: closedTaskId.toString(),
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
      taskPublisher: { name: 'Template Owner' },
      taskTemplateStatus: TaskStatus.Draft,
      submissionsCount: 1,
      aiFeedback: { failed: 1, notRequested: 0 },
    });
  });

  it('excludes REMOVED student submissions from dashboard stats, ai feedback stats, and top tags', async () => {
    const classroomId = objectId();
    const classroomTaskId = objectId();
    const activeStudentId = objectId();
    const removedStudentId = objectId();
    const activeSubmissionId = objectId();
    const removedSubmissionId = objectId();
    const harness = createHarness({
      activeStudentIds: [activeStudentId],
      classroomTasks: [
        {
          _id: classroomTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Task With Mixed Enrollments',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: activeSubmissionId,
          classroomTaskId,
          studentId: activeStudentId,
          isLate: true,
        },
        {
          _id: removedSubmissionId,
          classroomTaskId,
          studentId: removedStudentId,
          isLate: true,
        },
      ],
      aiJobs: [
        {
          classroomTaskId,
          submissionId: activeSubmissionId,
          status: AiFeedbackJobStatus.Succeeded,
        },
        {
          classroomTaskId,
          submissionId: removedSubmissionId,
          status: AiFeedbackJobStatus.Failed,
        },
      ],
      feedbacks: [
        { submissionId: activeSubmissionId, tags: ['correctness'] },
        { submissionId: removedSubmissionId, tags: ['bug-risk'] },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.summary).toMatchObject({
      studentsCount: 1,
      lateSubmissionsTotal: 1,
      lateStudentsTotal: 1,
    });
    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.tasks[0]).toMatchObject({
      classroomTaskId: classroomTaskId.toString(),
      submissionsCount: 1,
      distinctStudentsSubmitted: 1,
      lateSubmissionsCount: 1,
      lateDistinctStudentsCount: 1,
      aiFeedback: {
        pending: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        dead: 0,
        notRequested: 0,
      },
      topTags: [{ tag: 'correctness', count: 1 }],
    });
  });

  it('returns zero submission stats when no ACTIVE students remain but keeps visible tasks', async () => {
    const classroomId = objectId();
    const classroomTaskId = objectId();
    const removedStudentId = objectId();
    const removedSubmissionId = objectId();
    const harness = createHarness({
      activeStudentIds: [],
      classroomTasks: [
        {
          _id: classroomTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Task Without Active Students',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: removedSubmissionId,
          classroomTaskId,
          studentId: removedStudentId,
          isLate: true,
        },
      ],
      aiJobs: [
        {
          classroomTaskId,
          submissionId: removedSubmissionId,
          status: AiFeedbackJobStatus.Failed,
        },
      ],
      feedbacks: [{ submissionId: removedSubmissionId, tags: ['bug-risk'] }],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.summary).toMatchObject({
      studentsCount: 0,
      lateSubmissionsTotal: 0,
      lateStudentsTotal: 0,
    });
    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.tasks[0]).toMatchObject({
      classroomTaskId: classroomTaskId.toString(),
      submissionsCount: 0,
      distinctStudentsSubmitted: 0,
      lateSubmissionsCount: 0,
      lateDistinctStudentsCount: 0,
      aiFeedback: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
        notRequested: 0,
      },
      topTags: [],
    });
  });

  it('keeps ACTIVE dashboard items for DRAFT and ARCHIVED templates and exposes template status', async () => {
    const classroomId = objectId();
    const draftTemplateTaskId = objectId();
    const archivedTemplateTaskId = objectId();
    const draftPublisherId = objectId();
    const archivedPublisherId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: draftTemplateTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          taskStatus: TaskStatus.Draft,
          taskCreatedBy: draftPublisherId,
          title: 'Draft Template Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: archivedTemplateTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          taskStatus: TaskStatus.Archived,
          taskCreatedBy: archivedPublisherId,
          title: 'Archived Template Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: objectId(),
          classroomTaskId: draftTemplateTaskId,
          studentId: objectId(),
        },
      ],
      users: [
        { _id: draftPublisherId, name: 'Draft Owner' },
        { _id: archivedPublisherId, name: 'Archived Owner' },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.tasks).toHaveLength(2);
    expect(dashboard.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classroomTaskId: draftTemplateTaskId.toString(),
          classroomTaskStatus: CLASSROOM_TASK_STATUS_ACTIVE,
          taskTemplateStatus: TaskStatus.Draft,
          taskPublisher: {
            id: draftPublisherId.toString(),
            name: 'Draft Owner',
          },
          submissionsCount: 1,
        }),
        expect.objectContaining({
          classroomTaskId: archivedTemplateTaskId.toString(),
          classroomTaskStatus: CLASSROOM_TASK_STATUS_ACTIVE,
          taskTemplateStatus: TaskStatus.Archived,
          taskPublisher: {
            id: archivedPublisherId.toString(),
            name: 'Archived Owner',
          },
          submissionsCount: 0,
        }),
      ]),
    );
    expect(dashboard.summary.publishedTasksCount).toBe(2);
  });

  it('does not let task publication, classroom status, or dueAt override classroomTask.status', async () => {
    const classroomId = objectId();
    const closedTaskId = objectId();
    const harness = createHarness({
      classroomTasks: [
        {
          _id: closedTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Published Template Closed Instance',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          dueAt: new Date('2026-12-31T00:00:00.000Z'),
        },
      ],
    });

    const defaultDashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );
    const includeClosedDashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
      true,
    );

    expect(defaultDashboard.tasks).toEqual([]);
    expect(includeClosedDashboard.tasks).toHaveLength(1);
    expect(includeClosedDashboard.tasks[0]).toMatchObject({
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
    });
  });

  it('does not suggest archiving when an ACTIVE classroom has a current active task', async () => {
    const classroomId = objectId();
    const activeTaskId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: activeTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Current Active Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          dueAt: new Date('2026-04-27T00:00:00.000Z'),
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.archiveSuggestion).toMatchObject({
      suggested: false,
      reason: null,
      message: null,
      latestActiveTaskDueAt: '2026-04-27T00:00:00.000Z',
    });
  });

  it('suggests archiving when an old ACTIVE classroom has no active tasks and no recent submissions', async () => {
    const classroomId = objectId();
    const oldTaskId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: oldTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Old Active Instance',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          dueAt: new Date('2026-04-06T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: objectId(),
          classroomTaskId: oldTaskId,
          studentId: objectId(),
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.archiveSuggestion).toMatchObject({
      suggested: true,
      reason: 'NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS',
      message: '该班级近期无活跃任务和学生提交，建议归档。',
      lastSubmissionAt: '2026-03-01T00:00:00.000Z',
      latestActiveTaskDueAt: null,
    });
  });

  it('does not suggest archiving when a recent submission exists', async () => {
    const classroomId = objectId();
    const oldTaskId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: oldTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Old Active Instance',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          dueAt: new Date('2026-04-06T00:00:00.000Z'),
        },
      ],
      submissions: [
        {
          _id: objectId(),
          classroomTaskId: oldTaskId,
          studentId: objectId(),
          createdAt: new Date('2026-04-30T00:00:00.000Z'),
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.archiveSuggestion).toMatchObject({
      suggested: false,
      reason: null,
      lastSubmissionAt: '2026-04-30T00:00:00.000Z',
    });
  });

  it('protects new classrooms from archive suggestions', async () => {
    const classroomId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2026-04-30T00:00:00.000Z') },
      classroomTasks: [],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.archiveSuggestion).toMatchObject({
      suggested: false,
      reason: null,
      message: null,
    });
  });

  it('uses the 90-day no-due publishedAt window for active tasks', async () => {
    const classroomId = objectId();
    const currentTaskId = objectId();
    const historicalTaskId = objectId();
    const currentHarness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: currentTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'No Due Current Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-03-08T00:00:00.000Z'),
        },
      ],
    });
    const historicalHarness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: historicalTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'No Due Historical Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-02-05T00:00:00.000Z'),
        },
      ],
    });

    const currentDashboard = await currentHarness.service.getDashboard(
      classroomId.toString(),
      currentHarness.ids.teacherId.toString(),
    );
    const historicalDashboard = await historicalHarness.service.getDashboard(
      classroomId.toString(),
      historicalHarness.ids.teacherId.toString(),
    );

    expect(currentDashboard.archiveSuggestion.suggested).toBe(false);
    expect(historicalDashboard.archiveSuggestion.suggested).toBe(true);
  });

  it('ignores CLOSED, RECALLED, and non-PUBLISHED tasks when deciding active tasks', async () => {
    const classroomId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: objectId(),
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Closed Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-05-01T00:00:00.000Z'),
          dueAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          _id: objectId(),
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_RECALLED,
          title: 'Recalled Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-05-01T00:00:00.000Z'),
          dueAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          _id: objectId(),
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          taskStatus: TaskStatus.Draft,
          title: 'Draft Template Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-05-01T00:00:00.000Z'),
          dueAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
      true,
    );

    expect(dashboard.archiveSuggestion.suggested).toBe(true);
  });

  it('does not suggest archive for non-ACTIVE classrooms', async () => {
    const classroomId = objectId();
    const harness = createHarness({
      classroom: {
        status: 'ARCHIVED',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      classroomTasks: [],
    });

    const dashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(dashboard.archiveSuggestion).toMatchObject({
      suggested: false,
      reason: null,
      inactiveDays: null,
    });
  });

  it('keeps archive suggestions independent from includeClosedTasks', async () => {
    const classroomId = objectId();
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const harness = createHarness({
      classroom: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      classroomTasks: [
        {
          _id: activeTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_ACTIVE,
          title: 'Old Active Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          dueAt: new Date('2026-04-06T00:00:00.000Z'),
        },
        {
          _id: closedTaskId,
          taskId: objectId(),
          classroomId,
          status: CLASSROOM_TASK_STATUS_CLOSED,
          title: 'Closed Task',
          stage: 1,
          knowledgeModule: 'module',
          publishedAt: new Date('2026-05-01T00:00:00.000Z'),
          dueAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });

    const defaultDashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
    );
    const includeClosedDashboard = await harness.service.getDashboard(
      classroomId.toString(),
      harness.ids.teacherId.toString(),
      true,
    );

    expect(defaultDashboard.archiveSuggestion).toEqual(
      includeClosedDashboard.archiveSuggestion,
    );
    expect(defaultDashboard.archiveSuggestion.suggested).toBe(true);
    expect(includeClosedDashboard.tasks).toHaveLength(2);
  });

  it('checks teacher ownership before returning dashboard data', async () => {
    const harness = createHarness();

    await harness.service.getDashboard(
      harness.ids.classroomId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(harness.classroomModel.findOne).toHaveBeenCalledWith({
      _id: harness.ids.classroomId.toString(),
      teacherId: new Types.ObjectId(harness.ids.teacherId.toString()),
    });
  });
});
