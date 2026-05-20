import { Model, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../../schemas/classroom.schema';
import { Course } from '../../../courses/schemas/course.schema';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import { Task, TaskStatus } from '../../../learning-tasks/schemas/task.schema';
import { Submission } from '../../../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../../learning-tasks/schemas/feedback.schema';
import { User } from '../../../users/schemas/user.schema';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { AiFeedbackJobService } from '../../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { LearningTasksService } from '../../../learning-tasks/services/learning-tasks.service';
import { WithId } from '../../../../common/types/with-id.type';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
} from '../classroom-task-status.constants';
import { ClassroomTasksService } from './classroom-tasks.service';

type SubmissionFixture = Pick<
  Submission,
  'classroomTaskId' | 'taskId' | 'studentId' | 'attemptNo'
> & {
  _id: Types.ObjectId;
  createdAt: Date;
};

type FeedbackFixture = {
  submissionId: Types.ObjectId;
  source: FeedbackSource;
  severity: FeedbackSeverity;
};

type HarnessOptions = {
  submissions?: SubmissionFixture[];
  feedbacks?: FeedbackFixture[];
  classroomStatus?: ClassroomStatus;
  classroomTaskStatus?: string;
  taskStatus?: TaskStatus;
  isMember?: boolean;
  userRoles?: string[];
  activeStudentIds?: Types.ObjectId[];
  users?: Array<
    Pick<
      User,
      'email' | 'roles' | 'status' | 'name' | 'studentNo' | 'employeeNo'
    > &
      WithId
  >;
};

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const makeAggregate = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const makeExecOnly = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const createHarness = (options: HarnessOptions = {}) => {
  const studentId = options.submissions?.[0]?.studentId ?? objectId();
  const classroomId = objectId();
  const classroomTaskId =
    options.submissions?.[0]?.classroomTaskId ?? objectId();
  const taskId = options.submissions?.[0]?.taskId ?? objectId();
  const submissions = options.submissions ?? [];
  const feedbacks = options.feedbacks ?? [];
  const activeStudentIds =
    options.activeStudentIds ??
    Array.from(
      new Map(
        submissions.map((submission) => [
          submission.studentId.toString(),
          submission.studentId,
        ]),
      ).values(),
    );
  const users =
    options.users ??
    Array.from(
      new Map(
        submissions.map((submission) => [
          submission.studentId.toString(),
          {
            _id: submission.studentId,
            email: `${submission.studentId.toString()}@example.com`,
            roles: ['student'],
            status: 'active',
            name: `Student-${submission.attemptNo}`,
            studentNo: `S${submission.attemptNo}`,
            employeeNo: null,
          },
        ]),
      ).values(),
    );

  const classroom = {
    _id: classroomId,
    name: 'Class A',
    courseId: objectId(),
    status: options.classroomStatus ?? ClassroomStatus.Active,
  };
  const classroomTask = {
    _id: classroomTaskId,
    classroomId,
    taskId,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: options.classroomTaskStatus ?? CLASSROOM_TASK_STATUS_ACTIVE,
  };
  const task = {
    _id: taskId,
    title: 'Task A',
    description: 'Task Description',
    knowledgeModule: 'module',
    stage: 1,
    status: options.taskStatus ?? TaskStatus.Published,
  };

  const classroomModel = {
    findById: jest.fn(() => makeQuery(classroom)),
    findOne: jest.fn(() => makeQuery({ ...classroom, teacherId: studentId })),
  };
  const courseModel = {};
  const classroomTaskModel = {
    findOne: jest.fn(() => makeQuery(classroomTask)),
  };
  const taskModel = {
    findById: jest.fn(() => makeQuery(task)),
  };
  const filterSubmissions = (filter: Record<string, unknown>) => {
    const classroomTaskIdFilter = filter.classroomTaskId as
      | Types.ObjectId
      | undefined;
    const studentIdFilter = filter.studentId as
      | Types.ObjectId
      | { $in?: Types.ObjectId[] }
      | undefined;
    const studentIdFilterValues =
      studentIdFilter && !(studentIdFilter instanceof Types.ObjectId)
        ? (studentIdFilter.$in ?? [])
        : [];
    const activeStudentIdSet = new Set(
      studentIdFilterValues.map((studentId) => studentId.toString()),
    );
    return submissions.filter((submission) => {
      if (
        classroomTaskIdFilter &&
        submission.classroomTaskId.toString() !==
          classroomTaskIdFilter.toString()
      ) {
        return false;
      }
      if (studentIdFilter instanceof Types.ObjectId) {
        return submission.studentId.toString() === studentIdFilter.toString();
      }
      if (
        activeStudentIdSet.size > 0 &&
        !activeStudentIdSet.has(submission.studentId.toString())
      ) {
        return false;
      }
      return true;
    });
  };
  const submissionModel = {
    find: jest.fn((filter: Record<string, unknown>) =>
      makeQuery(filterSubmissions(filter)),
    ),
    countDocuments: jest.fn((filter: Record<string, unknown>) =>
      Promise.resolve(filterSubmissions(filter).length),
    ),
  };
  const feedbackModel = {
    find: jest.fn((filter: Record<string, unknown>) => {
      const submissionId = filter.submissionId as Types.ObjectId;
      const sourceFilter = filter.source as { $in?: FeedbackSource[] };
      const sources = new Set(sourceFilter.$in ?? []);
      return makeQuery(
        feedbacks.filter(
          (feedback) =>
            feedback.submissionId.toString() === submissionId.toString() &&
            sources.has(feedback.source),
        ),
      );
    }),
    aggregate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
  };
  const userModel = {
    findById: jest.fn(() =>
      makeQuery({ roles: options.userRoles ?? ['student'] }),
    ),
    find: jest.fn((filter: { _id?: { $in?: Types.ObjectId[] } }) => {
      const userIds = filter._id?.$in ?? [];
      const ids = new Set(userIds.map((id) => id.toString()));
      return makeQuery(users.filter((user) => ids.has(user._id.toString())));
    }),
  };
  const enrollmentService = {
    isStudentActiveInClassroom: jest
      .fn()
      .mockResolvedValue(options.isMember ?? true),
    listActiveStudentIds: jest
      .fn()
      .mockResolvedValue(
        activeStudentIds.map((studentId) => studentId.toString()),
      ),
  };
  const aiFeedbackJobService = {
    getStatusMapBySubmissionIds: jest.fn().mockResolvedValue(new Map()),
  };

  const learningTasksService = {
    createSubmissionForClassroomTask: jest.fn().mockResolvedValue({
      id: objectId().toString(),
    }),
  };

  const service = new ClassroomTasksService(
    classroomModel as unknown as Model<Classroom>,
    courseModel as unknown as Model<Course>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    taskModel as unknown as Model<Task>,
    submissionModel as unknown as Model<Submission>,
    feedbackModel as unknown as Model<Feedback>,
    userModel as unknown as Model<User>,
    enrollmentService as unknown as EnrollmentService,
    aiFeedbackJobService as unknown as AiFeedbackJobService,
    learningTasksService as unknown as LearningTasksService,
  );

  return {
    service,
    feedbackModel,
    learningTasksService,
    ids: { studentId, classroomId, classroomTaskId, taskId },
  };
};

const submissionFixture = (params: {
  classroomTaskId: Types.ObjectId;
  taskId: Types.ObjectId;
  studentId: Types.ObjectId;
  attemptNo: number;
  createdAt?: Date;
}): SubmissionFixture => ({
  _id: objectId(),
  classroomTaskId: params.classroomTaskId,
  taskId: params.taskId,
  studentId: params.studentId,
  attemptNo: params.attemptNo,
  createdAt:
    params.createdAt ??
    new Date(`2026-01-0${Math.min(params.attemptNo, 9)}T00:00:00.000Z`),
});

const getMyTaskDetailCompletionStatus = async (
  service: ClassroomTasksService,
  ids: {
    classroomId: Types.ObjectId;
    classroomTaskId: Types.ObjectId;
    studentId: Types.ObjectId;
  },
  query: { includeFeedbackItems?: string; feedbackLimit?: number } = {},
) => {
  const detail = (await service.getMyTaskDetail(
    ids.classroomId.toString(),
    ids.classroomTaskId.toString(),
    query,
    ids.studentId.toString(),
  )) as {
    classroom: {
      status: ClassroomStatus;
    };
    classroomTask: {
      status: string;
    };
    task: {
      status: TaskStatus;
    };
    completionStatus: {
      status: string;
      severity: FeedbackSeverity | null;
      source: FeedbackSource | null;
      latestSubmissionId: string | null;
      teacherFeedbackCount: number;
      aiFeedbackCount: number;
      teacherWorstSeverity: FeedbackSeverity | null;
      aiWorstSeverity: FeedbackSeverity | null;
    };
    participationStatus: {
      readOnly: boolean;
      canSubmit: boolean;
      canRequestAiFeedback: boolean;
      reason: 'ACTIVE' | 'CLASSROOM_NOT_ACTIVE' | 'CLASSROOM_TASK_NOT_ACTIVE';
      message: string | null;
    };
    latest: { submissionId: string } | null;
  };
  return detail;
};

const submissionDto = {
  content: {
    codeText: 'console.log("ok");',
    language: 'javascript',
  },
};

describe('ClassroomTasksService createClassroomTaskSubmission participation status', () => {
  it('allows ACTIVE classroom, ACTIVE classroomTask and PUBLISHED task submissions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).resolves.toBeDefined();
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).toHaveBeenCalledWith(
      harness.ids.taskId.toString(),
      harness.ids.classroomTaskId.toString(),
      submissionDto,
      harness.ids.studentId.toString(),
    );
  });

  it('rejects submissions when the classroom is archived before creating submission', async () => {
    const harness = createHarness({
      classroomStatus: ClassroomStatus.Archived,
    });

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('班级已归档，不能继续提交该任务。');
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).not.toHaveBeenCalled();
  });

  it('rejects submissions when the classroomTask is closed even before dueAt', async () => {
    const harness = createHarness({
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
    });

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('课堂任务已关闭，不能继续提交。');
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).not.toHaveBeenCalled();
  });

  it('allows submissions when the task template is archived', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Archived });

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).resolves.toBeDefined();
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).toHaveBeenCalledWith(
      harness.ids.taskId.toString(),
      harness.ids.classroomTaskId.toString(),
      submissionDto,
      harness.ids.studentId.toString(),
    );
  });

  it('keeps non-member submissions on the existing forbidden path', async () => {
    const harness = createHarness({ isMember: false });

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('Not allowed to submit classroom tasks');
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).not.toHaveBeenCalled();
  });
});

describe('ClassroomTasksService listClassroomTaskSubmissions ACTIVE enrollment filter', () => {
  it('returns only ACTIVE student submissions and keeps total aligned with items filter', async () => {
    const classroomTaskId = objectId();
    const taskId = objectId();
    const activeStudentId = objectId();
    const removedStudentId = objectId();
    const activeSubmission = submissionFixture({
      classroomTaskId,
      taskId,
      studentId: activeStudentId,
      attemptNo: 2,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const removedSubmission = submissionFixture({
      classroomTaskId,
      taskId,
      studentId: removedStudentId,
      attemptNo: 1,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    const harness = createHarness({
      userRoles: ['teacher'],
      activeStudentIds: [activeStudentId],
      submissions: [activeSubmission, removedSubmission],
      users: [
        {
          _id: activeStudentId,
          email: 'active@example.com',
          roles: ['student'],
          status: 'active',
          name: 'Active Student',
          studentNo: 'S001',
          employeeNo: null,
        },
        {
          _id: removedStudentId,
          email: 'removed@example.com',
          roles: ['student'],
          status: 'active',
          name: 'Removed Student',
          studentNo: 'S999',
          employeeNo: null,
        },
      ],
    });

    const result = await harness.service.listClassroomTaskSubmissions(
      harness.ids.classroomId.toString(),
      classroomTaskId.toString(),
      { page: 1, limit: 20 },
      harness.ids.studentId.toString(),
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: activeSubmission._id.toString(),
      classroomTaskId: classroomTaskId.toString(),
      student: {
        id: activeStudentId.toString(),
        name: 'Active Student',
        studentNo: 'S001',
      },
    });
    expect(result.items.map((item) => item.id)).not.toContain(
      removedSubmission._id.toString(),
    );
  });

  it('returns empty items and zero total when there are no ACTIVE students', async () => {
    const classroomTaskId = objectId();
    const taskId = objectId();
    const removedStudentId = objectId();
    const removedSubmission = submissionFixture({
      classroomTaskId,
      taskId,
      studentId: removedStudentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      userRoles: ['teacher'],
      activeStudentIds: [],
      submissions: [removedSubmission],
    });

    const result = await harness.service.listClassroomTaskSubmissions(
      harness.ids.classroomId.toString(),
      classroomTaskId.toString(),
      { page: 1, limit: 20 },
      harness.ids.studentId.toString(),
    );

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });
});

describe('ClassroomTasksService listClassroomTasks publisher contract', () => {
  it('returns taskPublisher summaries without changing classroomTask or template status fields', async () => {
    const classroomId = objectId();
    const teacherId = objectId();
    const publisherId = objectId();
    const missingPublisherId = objectId();
    const classroom = {
      _id: classroomId,
      name: 'Class A',
      teacherId,
      courseId: objectId(),
      status: ClassroomStatus.Active,
    };
    const items = [
      {
        _id: objectId(),
        classroomId,
        taskId: objectId(),
        status: CLASSROOM_TASK_STATUS_ACTIVE,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: teacherId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        task: {
          title: 'Published Template',
          description: 'Description',
          knowledgeModule: 'module',
          stage: 1,
          status: TaskStatus.Published,
          createdBy: publisherId,
        },
      },
      {
        _id: objectId(),
        classroomId,
        taskId: objectId(),
        status: CLASSROOM_TASK_STATUS_CLOSED,
        publishedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdBy: teacherId,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
        task: {
          title: 'Draft Template',
          description: 'Description',
          knowledgeModule: 'module',
          stage: 2,
          status: TaskStatus.Draft,
          createdBy: missingPublisherId,
        },
      },
    ];
    const classroomModel = {
      findById: jest.fn(() => makeQuery(classroom)),
    };
    const classroomTaskModel = {
      aggregate: jest.fn((pipeline: unknown[]) =>
        makeAggregate(
          pipeline.some(
            (stage) => '$count' in (stage as Record<string, unknown>),
          )
            ? [{ total: items.length }]
            : items,
        ),
      ),
    };
    const userModel = {
      findById: jest.fn(() => makeQuery({ roles: ['teacher'] })),
      find: jest.fn(() =>
        makeQuery([{ _id: publisherId, name: 'Publisher One' }]),
      ),
    };
    const service = new ClassroomTasksService(
      classroomModel as unknown as Model<Classroom>,
      {} as unknown as Model<Course>,
      classroomTaskModel as unknown as Model<ClassroomTask>,
      {} as unknown as Model<Task>,
      {} as unknown as Model<Submission>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
    );

    const result = await service.listClassroomTasks(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      status: CLASSROOM_TASK_STATUS_ACTIVE,
      taskPublisher: {
        id: publisherId.toString(),
        name: 'Publisher One',
      },
      task: {
        status: TaskStatus.Published,
      },
    });
    expect(result.items[1]).toMatchObject({
      status: CLASSROOM_TASK_STATUS_CLOSED,
      taskPublisher: {
        id: missingPublisherId.toString(),
      },
      task: {
        status: TaskStatus.Draft,
      },
    });
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });
});

describe('ClassroomTasksService listPublishableTaskTemplates publisher contract', () => {
  it('returns publisher summaries for current page candidates with one batched user lookup', async () => {
    const classroomId = objectId();
    const courseId = objectId();
    const teacherId = objectId();
    const publisherIdA = objectId();
    const publisherIdB = objectId();
    const missingPublisherId = objectId();
    const excludedTaskId = objectId();
    const classroom = {
      _id: classroomId,
      courseId,
    };
    const items = [
      {
        _id: objectId(),
        title: 'Shared Template A',
        description: 'Description A',
        knowledgeModule: 'module-a',
        stage: 1,
        status: TaskStatus.Published,
        createdBy: publisherIdA,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        publishedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        _id: objectId(),
        title: 'Shared Template B',
        description: 'Description B',
        knowledgeModule: 'module-b',
        stage: 2,
        status: TaskStatus.Published,
        createdBy: publisherIdB,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        updatedAt: new Date('2026-01-05T00:00:00.000Z'),
        publishedAt: new Date('2026-01-06T00:00:00.000Z'),
      },
      {
        _id: objectId(),
        title: 'Shared Template Missing Publisher',
        description: 'Description C',
        knowledgeModule: 'module-c',
        stage: 3,
        status: TaskStatus.Published,
        createdBy: missingPublisherId,
        createdAt: new Date('2026-01-07T00:00:00.000Z'),
        updatedAt: new Date('2026-01-08T00:00:00.000Z'),
        publishedAt: new Date('2026-01-09T00:00:00.000Z'),
      },
    ];
    const classroomModel = {
      findOne: jest.fn(() => makeQuery(classroom)),
    };
    const courseModel = {
      findById: jest.fn(() =>
        makeQuery({ _id: courseId, courseLabel: 'CS101' }),
      ),
    };
    const classroomTaskModel = {
      distinct: jest.fn(() => makeExecOnly([excludedTaskId])),
    };
    const taskModel = {
      aggregate: jest.fn(() => makeAggregate(items)),
      countDocuments: jest.fn().mockResolvedValue(items.length),
    };
    const userModel = {
      findById: jest.fn(() => makeQuery({ roles: ['teacher'] })),
      find: jest.fn(() =>
        makeQuery([
          {
            _id: publisherIdA,
            name: 'Publisher A',
            email: 'a@example.com',
            roles: ['teacher'],
            status: 'active',
          },
          {
            _id: publisherIdB,
            name: 'Publisher B',
            email: 'b@example.com',
            roles: ['teacher'],
            status: 'active',
          },
        ]),
      ),
    };
    const service = new ClassroomTasksService(
      classroomModel as unknown as Model<Classroom>,
      courseModel as unknown as Model<Course>,
      classroomTaskModel as unknown as Model<ClassroomTask>,
      taskModel as unknown as Model<Task>,
      {} as unknown as Model<Submission>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
    );

    const result = await service.listPublishableTaskTemplates(
      classroomId.toString(),
      { page: 1, limit: 20 },
      teacherId.toString(),
    );

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      createdBy: publisherIdA.toString(),
      createdById: publisherIdA.toString(),
      publisher: { id: publisherIdA.toString(), name: 'Publisher A' },
    });
    expect(result.items[1]).toMatchObject({
      createdBy: publisherIdB.toString(),
      createdById: publisherIdB.toString(),
      publisher: { id: publisherIdB.toString(), name: 'Publisher B' },
    });
    expect(result.items[2]).toMatchObject({
      createdBy: missingPublisherId.toString(),
      createdById: missingPublisherId.toString(),
      publisher: { id: missingPublisherId.toString() },
    });
    expect(result.items[0].publisher).not.toHaveProperty('email');
    expect(result.items[0].publisher).not.toHaveProperty('roles');
    expect(result.items[0].publisher).not.toHaveProperty('status');
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });

  it('keeps existing publishable filters when onlyMine and query filters are provided', async () => {
    const classroomId = objectId();
    const courseId = objectId();
    const teacherId = objectId();
    const excludedTaskId = objectId();
    const classroom = {
      _id: classroomId,
      courseId,
    };
    const classroomModel = {
      findOne: jest.fn(() => makeQuery(classroom)),
    };
    const courseModel = {
      findById: jest.fn(() =>
        makeQuery({ _id: courseId, courseLabel: 'CS101' }),
      ),
    };
    const classroomTaskModel = {
      distinct: jest.fn(() => makeExecOnly([excludedTaskId])),
    };
    const taskModel = {
      aggregate: jest.fn(() => makeAggregate([])),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const userModel = {
      findById: jest.fn(() => makeQuery({ roles: ['teacher'] })),
      find: jest.fn(() => makeQuery([])),
    };
    const service = new ClassroomTasksService(
      classroomModel as unknown as Model<Classroom>,
      courseModel as unknown as Model<Course>,
      classroomTaskModel as unknown as Model<ClassroomTask>,
      taskModel as unknown as Model<Task>,
      {} as unknown as Model<Submission>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
    );

    await service.listPublishableTaskTemplates(
      classroomId.toString(),
      {
        page: 2,
        limit: 10,
        onlyMine: true,
        knowledgeModule: 'module-a',
        stage: 3,
      },
      teacherId.toString(),
    );

    const aggregateCalls = taskModel.aggregate.mock.calls as unknown as Array<
      [Array<Record<string, unknown>>, ...unknown[]]
    >;
    const firstAggregateCall = aggregateCalls[0];
    if (!firstAggregateCall) {
      throw new Error('Expected taskModel.aggregate to be called');
    }
    const itemsPipeline = firstAggregateCall[0];
    expect(itemsPipeline[0]).toEqual({
      $match: {
        status: TaskStatus.Published,
        _id: { $nin: [excludedTaskId] },
        knowledgeModule: 'module-a',
        stage: 3,
        createdBy: teacherId,
      },
    });
    expect(taskModel.countDocuments).toHaveBeenCalledWith({
      status: TaskStatus.Published,
      _id: { $nin: [excludedTaskId] },
      knowledgeModule: 'module-a',
      stage: 3,
      createdBy: teacherId,
    });
  });
});

describe('ClassroomTasksService getMyTaskDetail participationStatus', () => {
  it('returns ACTIVE participationStatus and stable status fields for active contexts', async () => {
    const harness = createHarness();

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.classroom.status).toBe(ClassroomStatus.Active);
    expect(detail.classroomTask.status).toBe(CLASSROOM_TASK_STATUS_ACTIVE);
    expect(detail.task.status).toBe(TaskStatus.Published);
    expect(detail.participationStatus).toEqual({
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: true,
      reason: 'ACTIVE',
      message: null,
    });
  });

  it('returns CLASSROOM_NOT_ACTIVE when classroom is archived', async () => {
    const harness = createHarness({
      classroomStatus: ClassroomStatus.Archived,
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.participationStatus).toEqual({
      readOnly: true,
      canSubmit: false,
      canRequestAiFeedback: false,
      reason: 'CLASSROOM_NOT_ACTIVE',
      message: '班级已归档或不可参与，仅可查看历史提交与反馈。',
    });
  });

  it.each([CLASSROOM_TASK_STATUS_CLOSED, CLASSROOM_TASK_STATUS_RECALLED])(
    'returns CLASSROOM_TASK_NOT_ACTIVE when classroomTask is %s',
    async (classroomTaskStatus) => {
      const harness = createHarness({ classroomTaskStatus });

      const detail = await getMyTaskDetailCompletionStatus(
        harness.service,
        harness.ids,
      );

      expect(detail.participationStatus).toEqual({
        readOnly: true,
        canSubmit: false,
        canRequestAiFeedback: false,
        reason: 'CLASSROOM_TASK_NOT_ACTIVE',
        message: '课堂任务已关闭或不可参与，仅可查看历史提交与反馈。',
      });
    },
  );

  it('returns ACTIVE when task template is archived but classroom runtime stays active', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Archived });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.participationStatus).toEqual({
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: true,
      reason: 'ACTIVE',
      message: null,
    });
  });

  it('prioritizes classroom status over classroomTask and task status', async () => {
    const harness = createHarness({
      classroomStatus: ClassroomStatus.Archived,
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
      taskStatus: TaskStatus.Draft,
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.participationStatus.reason).toBe('CLASSROOM_NOT_ACTIVE');
  });

  it('prioritizes classroomTask status over template status', async () => {
    const harness = createHarness({
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
      taskStatus: TaskStatus.Archived,
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.participationStatus.reason).toBe('CLASSROOM_TASK_NOT_ACTIVE');
  });
});

describe('ClassroomTasksService getMyTaskDetail completionStatus', () => {
  it('returns NOT_SUBMITTED when there is no latest submission', async () => {
    const harness = createHarness();

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.latest).toBeNull();
    expect(detail.completionStatus).toEqual({
      status: 'NOT_SUBMITTED',
      severity: null,
      source: null,
      latestSubmissionId: null,
      teacherFeedbackCount: 0,
      aiFeedbackCount: 0,
      teacherWorstSeverity: null,
      aiWorstSeverity: null,
    });
    expect(harness.feedbackModel.find).not.toHaveBeenCalled();
  });

  it('returns NO_FEEDBACK when latest has no teacher or AI feedback', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({ submissions: [latest] });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'NO_FEEDBACK',
      severity: null,
      source: null,
      latestSubmissionId: latest._id.toString(),
    });
  });

  it.each([
    [FeedbackSeverity.Info, 'QUALIFIED'],
    [FeedbackSeverity.Warn, 'QUALIFIED_WITH_WARNINGS'],
    [FeedbackSeverity.Error, 'UNQUALIFIED'],
  ])('maps latest AI %s feedback to %s', async (severity, expectedStatus) => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: expectedStatus,
      severity,
      source: FeedbackSource.AI,
      aiFeedbackCount: 1,
      aiWorstSeverity: severity,
    });
  });

  it('lets teacher INFO override AI ERROR on latest', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Info,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'QUALIFIED',
      severity: FeedbackSeverity.Info,
      source: FeedbackSource.Teacher,
      teacherFeedbackCount: 1,
      aiFeedbackCount: 1,
      teacherWorstSeverity: FeedbackSeverity.Info,
      aiWorstSeverity: FeedbackSeverity.Error,
    });
  });

  it('uses worst teacher severity when latest has multiple teacher feedback items', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Warn,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Error,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'UNQUALIFIED',
      severity: FeedbackSeverity.Error,
      source: FeedbackSource.Teacher,
      teacherFeedbackCount: 3,
      teacherWorstSeverity: FeedbackSeverity.Error,
    });
  });

  it('uses worst AI severity when latest has multiple AI feedback items and no teacher feedback', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Warn,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'QUALIFIED_WITH_WARNINGS',
      severity: FeedbackSeverity.Warn,
      source: FeedbackSource.AI,
      aiFeedbackCount: 2,
      aiWorstSeverity: FeedbackSeverity.Warn,
    });
  });

  it('does not let historical submission ERROR affect latest INFO', async () => {
    const base = createHarness();
    const oldSubmission = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 2,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const harness = createHarness({
      submissions: [oldSubmission, latest],
      feedbacks: [
        {
          submissionId: oldSubmission._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'QUALIFIED',
      severity: FeedbackSeverity.Info,
      source: FeedbackSource.AI,
      latestSubmissionId: latest._id.toString(),
      aiFeedbackCount: 1,
    });
    const completionFindFilter = harness.feedbackModel.find.mock
      .calls[0][0] as {
      submissionId: Types.ObjectId;
    };
    expect(completionFindFilter.submissionId.toString()).toBe(
      latest._id.toString(),
    );
  });

  it('does not mix feedback from another classroomTask submission', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const otherSubmissionId = objectId();
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: otherSubmissionId,
          source: FeedbackSource.Teacher,
          severity: FeedbackSeverity.Error,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'QUALIFIED',
      source: FeedbackSource.AI,
      aiFeedbackCount: 1,
      teacherFeedbackCount: 0,
    });
  });

  it('calculates completionStatus when includeFeedbackItems is false', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Warn,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
      { includeFeedbackItems: 'false' },
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'QUALIFIED_WITH_WARNINGS',
      severity: FeedbackSeverity.Warn,
      source: FeedbackSource.AI,
    });
  });

  it('calculates completionStatus from all latest feedback even when feedbackLimit is 1', async () => {
    const base = createHarness();
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const harness = createHarness({
      submissions: [latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
        },
      ],
    });

    const detail = await getMyTaskDetailCompletionStatus(
      harness.service,
      harness.ids,
      { includeFeedbackItems: 'true', feedbackLimit: 1 },
    );

    expect(detail.completionStatus).toMatchObject({
      status: 'UNQUALIFIED',
      severity: FeedbackSeverity.Error,
      source: FeedbackSource.AI,
      aiFeedbackCount: 2,
      aiWorstSeverity: FeedbackSeverity.Error,
    });
  });
});
