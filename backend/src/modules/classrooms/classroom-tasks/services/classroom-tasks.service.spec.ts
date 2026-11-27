import { AiContextReaderService } from '../../../learning-tasks/ai-context/ai-context-reader.service';
import { Model, mongo, Types } from 'mongoose';
import type { Connection } from 'mongoose';
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
import { User, UserStatus } from '../../../users/schemas/user.schema';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { AiFeedbackJob } from '../../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from '../../../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { LearningTasksService } from '../../../learning-tasks/services/learning-tasks.service';
import { WithId } from '../../../../common/types/with-id.type';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
} from '../classroom-task-status.constants';
import { ClassroomTasksService } from './classroom-tasks.service';
import type { UpdateClassroomTaskDto } from '../dto/update-classroom-task.dto';

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
  tags?: string[];
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
    read: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.read.mockReturnValue(chain);
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
    taskSnapshot: {
      title: 'Published task',
      description: 'Published description',
      knowledgeModule: 'Module',
    },
    settings: {},
  };
  const task = {
    _id: taskId,
    title: 'Task A',
    description: 'Task Description',
    knowledgeModule: 'module',
    status: options.taskStatus ?? TaskStatus.Published,
    createdBy: studentId,
  };

  const classroomModel = {
    modelName: Classroom.name,
    exists: jest.fn(() => makeExecOnly({ _id: classroomId })),
    findById: jest.fn(() => makeQuery(classroom)),
    findOne: jest.fn(() => makeQuery({ ...classroom, teacherId: studentId })),
    findOneAndUpdate: jest.fn(() => makeQuery(classroom)),
  };
  const courseModel = {};
  const transactionSession = {
    startTransaction: jest.fn(),
    inTransaction: jest.fn().mockReturnValue(true),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const classroomTaskModel = {
    modelName: ClassroomTask.name,
    create: jest.fn((instances: ClassroomTask[]) =>
      Promise.resolve([{ ...instances[0], _id: classroomTaskId }]),
    ),
    deleteOne: jest.fn(() => makeExecOnly({ deletedCount: 1 })),
    findOne: jest.fn(() => makeQuery(classroomTask)),
    findOneAndUpdate: jest.fn(() => makeQuery(classroomTask)),
  };
  const taskModel = {
    findById: jest.fn(() => makeQuery(task)),
  };
  const filterSubmissions = (filter: Record<string, unknown>) => {
    const classroomTaskIdFilter = filter.classroomTaskId as
      Types.ObjectId | undefined;
    const studentIdFilter = filter.studentId as
      Types.ObjectId | { $in?: Types.ObjectId[] } | undefined;
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
        submission.classroomTaskId?.toString() !==
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
    modelName: Submission.name,
    exists: jest.fn().mockResolvedValue(null),
    find: jest.fn((filter: Record<string, unknown>) =>
      makeQuery(filterSubmissions(filter)),
    ),
    countDocuments: jest.fn((filter: Record<string, unknown>) =>
      Promise.resolve(filterSubmissions(filter).length),
    ),
  };
  const aiFeedbackJobModel = {
    modelName: AiFeedbackJob.name,
    exists: jest.fn(),
  };
  const transactionModels: Record<string, unknown> = {
    [Classroom.name]: classroomModel,
    [ClassroomTask.name]: classroomTaskModel,
    [Submission.name]: submissionModel,
    [AiFeedbackJob.name]: aiFeedbackJobModel,
  };
  const transactionConnection = {
    startSession: jest.fn().mockResolvedValue(transactionSession),
    models: transactionModels,
    model: jest.fn((name: string) => transactionModels[name]),
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
  const aiContextReader = new AiContextReaderService();

  const service = new ClassroomTasksService(
    classroomModel as unknown as Model<Classroom>,
    courseModel as unknown as Model<Course>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    taskModel as unknown as Model<Task>,
    submissionModel as unknown as Model<Submission>,
    aiFeedbackJobModel as unknown as Model<AiFeedbackJob>,
    feedbackModel as unknown as Model<Feedback>,
    userModel as unknown as Model<User>,
    enrollmentService as unknown as EnrollmentService,
    aiFeedbackJobService as unknown as AiFeedbackJobService,
    learningTasksService as unknown as LearningTasksService,
    aiContextReader,
    transactionConnection as unknown as Connection,
  );

  return {
    service,
    classroomModel,
    classroomTaskModel,
    classroomTask,
    submissionModel,
    aiFeedbackJobModel,
    transactionSession,
    transactionConnection,
    taskModel,
    task,
    aiContextReader,
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

describe('ClassroomTasksService deleteClassroomTask', () => {
  const setup = (
    submissionId: Types.ObjectId | null = null,
    jobId: Types.ObjectId | null = null,
  ) => {
    const harness = createHarness({ userRoles: ['teacher'] });
    const { ids } = harness;
    const submissionQuery = makeExecOnly(
      submissionId ? { _id: submissionId } : null,
    );
    const jobQuery = makeExecOnly(jobId ? { _id: jobId } : null);
    const submissionSession = jest.fn(() => ({
      setOptions: jest.fn(() => submissionQuery),
    }));
    const jobSession = jest.fn(() => ({
      setOptions: jest.fn(() => jobQuery),
    }));
    harness.submissionModel.exists.mockReturnValueOnce({
      session: submissionSession,
    });
    harness.aiFeedbackJobModel.exists.mockReturnValueOnce({
      session: jobSession,
    });
    return {
      ...harness,
      submissionSession,
      jobSession,
      remove: () =>
        harness.service.deleteClassroomTask(
          ids.classroomId.toString(),
          ids.classroomTaskId.toString(),
          ids.studentId.toString(),
        ),
    };
  };

  it('uses the same session for the scoped parent delete and both existence checks', async () => {
    const harness = setup();
    await expect(harness.remove()).resolves.toEqual({ ok: true });
    expect(harness.classroomModel.exists).toHaveBeenCalledWith({
      _id: harness.ids.classroomId,
      teacherId: harness.ids.studentId,
    });
    expect(harness.transactionConnection.startSession).toHaveBeenCalledTimes(1);
    expect(harness.classroomTaskModel.deleteOne).toHaveBeenCalledWith(
      {
        _id: harness.ids.classroomTaskId,
        classroomId: harness.ids.classroomId,
      },
      expect.objectContaining({ session: harness.transactionSession }),
    );
    const scope = { classroomTaskId: harness.ids.classroomTaskId };
    expect(harness.submissionModel.exists).toHaveBeenCalledWith(scope);
    expect(harness.aiFeedbackJobModel.exists).toHaveBeenCalledWith(scope);
    expect(harness.submissionSession).toHaveBeenCalledWith(
      harness.transactionSession,
    );
    expect(harness.jobSession).toHaveBeenCalledWith(harness.transactionSession);
  });

  it.each(['submission', 'job'])(
    'rejects the transaction when a directly linked %s exists',
    async (kind) => {
      const linkedId = objectId();
      const harness = setup(
        kind === 'submission' ? linkedId : null,
        kind === 'job' ? linkedId : null,
      );
      await expect(harness.remove()).rejects.toMatchObject({
        response: { statusCode: 409, code: 'CLASSROOM_TASK_NOT_EMPTY' },
      });
      expect(harness.transactionSession.abortTransaction).toHaveBeenCalledTimes(
        1,
      );
      expect(
        harness.transactionSession.commitTransaction,
      ).not.toHaveBeenCalled();
    },
  );
});

describe('ClassroomTasksService createClassroomTask transaction', () => {
  function setup() {
    const harness = createHarness({ userRoles: ['teacher'] });
    const publish = () =>
      harness.service.createClassroomTask(
        harness.ids.classroomId.toString(),
        { taskId: harness.ids.taskId.toString() },
        harness.ids.studentId.toString(),
      );
    return { ...harness, publish };
  }

  it('reuses the same validated snapshot if the transaction body retries', async () => {
    const harness = setup();
    const reference = { archivePath: 'task.zip', entryPaths: ['chapter.md'] };
    const description = harness.task.description;
    const template = { ...harness.task, aiContextRefs: [reference] };
    harness.taskModel.findById.mockReturnValueOnce(makeQuery(template));
    const validate = jest
      .spyOn(harness.aiContextReader, 'validateForSave')
      .mockResolvedValue(undefined);
    const writeConflict = new mongo.MongoServerError({ code: 112 });
    writeConflict.addErrorLabel(
      mongo.MongoErrorLabel.TransientTransactionError,
    );
    const losingWrite = makeQuery(null);
    losingWrite.exec.mockImplementationOnce(() => {
      template.description = 'Changed template description';
      reference.entryPaths[0] = 'replaced.md';
      return Promise.reject(writeConflict);
    });
    harness.classroomModel.findOneAndUpdate.mockReturnValueOnce(losingWrite);

    await expect(harness.publish()).resolves.toMatchObject({
      taskSnapshotAvailable: true,
      task: { description },
    });
    expect(harness.taskModel.findById).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith([
      { archivePath: 'task.zip', entryPaths: ['chapter.md'] },
    ]);
    expect(harness.classroomModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(harness.transactionSession.abortTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.transactionSession.commitTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.classroomTaskModel.create).toHaveBeenCalledTimes(1);
    expect(harness.classroomTaskModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          taskSnapshot: expect.objectContaining({
            description,
            aiContextRefs: [
              { archivePath: 'task.zip', entryPaths: ['chapter.md'] },
            ],
          }) as unknown,
        }),
      ],
      { session: harness.transactionSession },
    );
  });

  it('maps an insert collision on the classroom and task unique key to 400', async () => {
    const harness = setup();
    harness.classroomTaskModel.create.mockRejectedValueOnce(
      new mongo.MongoServerError({
        code: 11000,
        keyPattern: { classroomId: 1, taskId: 1 },
      }),
    );

    await expect(harness.publish()).rejects.toMatchObject({
      status: 400,
      message: 'Task already published to classroom',
    });
    expect(harness.transactionSession.abortTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.transactionSession.commitTransaction).not.toHaveBeenCalled();
  });

  it('propagates an insert collision on a different unique key', async () => {
    const harness = setup();
    const collision = new mongo.MongoServerError({
      code: 11000,
      keyPattern: { _id: 1 },
    });
    harness.classroomTaskModel.create.mockRejectedValueOnce(collision);

    await expect(harness.publish()).rejects.toBe(collision);
    expect(harness.classroomTaskModel.create).toHaveBeenCalledTimes(1);
  });
});

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
          status: UserStatus.Active,
          name: 'Active Student',
          studentNo: 'S001',
          employeeNo: undefined,
        },
        {
          _id: removedStudentId,
          email: 'removed@example.com',
          roles: ['student'],
          status: UserStatus.Active,
          name: 'Removed Student',
          studentNo: 'S999',
          employeeNo: undefined,
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
      {} as unknown as Model<AiFeedbackJob>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
      new AiContextReaderService(),
      {} as Connection,
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
      {} as unknown as Model<AiFeedbackJob>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
      new AiContextReaderService(),
      {} as Connection,
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
      {} as unknown as Model<AiFeedbackJob>,
      {} as unknown as Model<Feedback>,
      userModel as unknown as Model<User>,
      {} as unknown as EnrollmentService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as LearningTasksService,
      new AiContextReaderService(),
      {} as Connection,
    );

    await service.listPublishableTaskTemplates(
      classroomId.toString(),
      {
        page: 2,
        limit: 10,
        onlyMine: true,
        knowledgeModule: 'module-a',
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
        createdBy: teacherId,
      },
    });
    expect(taskModel.countDocuments).toHaveBeenCalledWith({
      status: TaskStatus.Published,
      _id: { $nin: [excludedTaskId] },
      knowledgeModule: 'module-a',
      createdBy: teacherId,
    });
    expect(itemsPipeline).toContainEqual({ $skip: 10 });
    expect(itemsPipeline).toContainEqual({ $limit: 10 });
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

  it('derives latest summary and completion from one full read and batches history', async () => {
    const base = createHarness();
    const earlier = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 1,
    });
    const latest = submissionFixture({
      classroomTaskId: base.ids.classroomTaskId,
      taskId: base.ids.taskId,
      studentId: base.ids.studentId,
      attemptNo: 2,
    });
    const harness = createHarness({
      submissions: [earlier, latest],
      feedbacks: [
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Info,
          tags: ['style'],
        },
        {
          submissionId: latest._id,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
          tags: ['correctness', 'style'],
        },
      ],
    });

    const detail = await harness.service.getMyTaskDetail(
      harness.ids.classroomId.toString(),
      harness.ids.classroomTaskId.toString(),
      { includeFeedbackItems: 'true', feedbackLimit: 1 },
      harness.ids.studentId.toString(),
    );

    expect(detail.latest).toMatchObject({
      submissionId: latest._id.toString(),
      feedbackSummary: {
        totalItems: 2,
        severityBreakdown: { INFO: 1, WARN: 0, ERROR: 1 },
        topTags: [
          { tag: 'style', count: 2 },
          { tag: 'correctness', count: 1 },
        ],
      },
      feedbackItems: [
        { source: FeedbackSource.AI, severity: FeedbackSeverity.Info },
      ],
    });
    expect(detail.latest?.feedbackSummary).toEqual(
      detail.submissions.at(-1)?.feedbackSummary,
    );
    expect(detail.completionStatus).toMatchObject({
      status: 'UNQUALIFIED',
      severity: FeedbackSeverity.Error,
      source: FeedbackSource.AI,
      aiFeedbackCount: 2,
      aiWorstSeverity: FeedbackSeverity.Error,
    });
    expect(harness.feedbackModel.find).toHaveBeenCalledTimes(1);
    expect(harness.feedbackModel.aggregate).toHaveBeenCalledTimes(2);
    const historyOnly = {
      $match: {
        submissionId: { $in: [earlier._id] },
        source: FeedbackSource.AI,
      },
    };
    expect(harness.feedbackModel.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([historyOnly]),
    );
    expect(harness.feedbackModel.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([historyOnly]),
    );
  });
});

describe('ClassroomTasksService conditional classroom task writes', () => {
  const activeSource = {
    $expr: {
      $not: [{ $in: [{ $ifNull: ['$status', null] }, ['CLOSED', 'RECALLED']] }],
    },
  };
  const closedSource = {
    $expr: { $eq: [{ $ifNull: ['$status', null] }, 'CLOSED'] },
  };
  const editableSettings = {
    $expr: { $ne: [{ $ifNull: ['$status', null] }, 'RECALLED'] },
  };
  const conflictMessage = '课堂任务状态已变化，请刷新后再操作。';

  const setup = (status: unknown, options: HarnessOptions = {}) => {
    const harness = createHarness({ ...options, userRoles: ['teacher'] });
    const initialTask = {
      ...harness.classroomTask,
      status,
      createdBy: harness.ids.studentId,
    };
    harness.classroomTaskModel.findOne.mockReturnValueOnce(
      makeQuery(initialTask),
    );
    harness.classroomTaskModel.findOneAndUpdate.mockReturnValue(
      makeQuery(initialTask),
    );
    const scope = {
      _id: harness.ids.classroomTaskId,
      classroomId: harness.ids.classroomId,
    };
    return {
      ...harness,
      initialTask,
      scope,
      setStatus: (nextStatus: ClassroomTask['status']) =>
        harness.service.updateClassroomTaskStatus(
          harness.ids.classroomId.toString(),
          harness.ids.classroomTaskId.toString(),
          { status: nextStatus },
          harness.ids.studentId.toString(),
        ),
      setSettings: (dto: UpdateClassroomTaskDto) =>
        harness.service.updateClassroomTask(
          harness.ids.classroomId.toString(),
          harness.ids.classroomTaskId.toString(),
          dto,
          harness.ids.studentId.toString(),
        ),
    };
  };

  const loseWrite = (
    harness: ReturnType<typeof setup>,
    latest: { status?: unknown } | null,
  ) => {
    harness.classroomTaskModel.findOneAndUpdate.mockReturnValueOnce(
      makeQuery(null),
    );
    const reread = makeQuery(latest);
    harness.classroomTaskModel.findOne.mockReturnValueOnce(reread);
    return reread;
  };

  const expectScopedRereadWithoutReplay = (
    harness: ReturnType<typeof setup>,
    reread: ReturnType<typeof makeQuery>,
  ) => {
    expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.classroomTaskModel.findOne).toHaveBeenCalledTimes(2);
    expect(harness.classroomTaskModel.findOne).toHaveBeenNthCalledWith(
      2,
      harness.scope,
    );
    expect(reread.read).toHaveBeenCalledWith('primary');
    expect(reread.select).toHaveBeenCalledWith('status');
    expect(reread.read.mock.invocationCallOrder[0]).toBeLessThan(
      reread.select.mock.invocationCallOrder[0],
    );
    expect(reread.select.mock.invocationCallOrder[0]).toBeLessThan(
      reread.lean.mock.invocationCallOrder[0],
    );
    expect(reread.lean.mock.invocationCallOrder[0]).toBeLessThan(
      reread.exec.mock.invocationCallOrder[0],
    );
    expect(reread.lean).toHaveBeenCalledTimes(1);
    expect(reread.exec).toHaveBeenCalledTimes(1);
    expect(harness.classroomModel.findOne).toHaveBeenCalledTimes(1);
    expect(harness.taskModel.findById).not.toHaveBeenCalled();
  };

  const expectPlainConflict = async (action: Promise<unknown>) => {
    const failure: unknown = await action.catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 409, message: conflictMessage });
    expect(failure).toHaveProperty('response', {
      message: conflictMessage,
      error: 'Conflict',
      statusCode: 409,
    });
  };

  it.each([
    ['ACTIVE', CLASSROOM_TASK_STATUS_ACTIVE],
    ['missing status', undefined],
    ['null status', null],
    ['unknown status', 'UNKNOWN'],
    ['CLOSED inside an array', ['CLOSED']],
    ['RECALLED inside an array', ['RECALLED']],
  ] as const)(
    'closes the normalized ACTIVE source group for %s with the exact scoped predicate',
    async (_description, status) => {
      const harness = setup(status);
      harness.classroomTaskModel.findOneAndUpdate.mockReturnValueOnce(
        makeQuery({ ...harness.initialTask, status: 'CLOSED' }),
      );

      await expect(
        harness.setStatus(CLASSROOM_TASK_STATUS_CLOSED),
      ).resolves.toMatchObject({ status: 'CLOSED' });

      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
        { ...harness.scope, ...activeSource },
        { $set: { status: 'CLOSED' } },
        { returnDocument: 'after' },
      );
      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledTimes(
        1,
      );
      expect(harness.classroomTaskModel.findOne).toHaveBeenCalledTimes(1);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it.each([
    [CLASSROOM_TASK_STATUS_ACTIVE, activeSource],
    [CLASSROOM_TASK_STATUS_CLOSED, closedSource],
  ] as const)(
    'recalls a %s task with one scoped source-state write and no submission check',
    async (status, predicate) => {
      const harness = setup(status);
      harness.classroomTaskModel.findOneAndUpdate.mockReturnValueOnce(
        makeQuery({ ...harness.initialTask, status: 'RECALLED' }),
      );

      await expect(
        harness.setStatus(CLASSROOM_TASK_STATUS_RECALLED),
      ).resolves.toMatchObject({ status: 'RECALLED' });

      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledTimes(
        1,
      );
      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
        { ...harness.scope, ...predicate },
        { $set: { status: 'RECALLED' } },
        { returnDocument: 'after' },
      );
    },
  );

  it('reopens only an exact CLOSED source with a guarded single write', async () => {
    const harness = setup(CLASSROOM_TASK_STATUS_CLOSED);
    harness.classroomTaskModel.findOneAndUpdate.mockReturnValueOnce(
      makeQuery({ ...harness.initialTask, status: 'ACTIVE' }),
    );

    await expect(
      harness.setStatus(CLASSROOM_TASK_STATUS_ACTIVE),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { ...harness.scope, ...closedSource },
      { $set: { status: 'ACTIVE' } },
      { returnDocument: 'after' },
    );
    expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.submissionModel.exists).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVE', 'ACTIVE', 'Classroom task status is already ACTIVE'],
    ['CLOSED', 'CLOSED', 'Classroom task status is already CLOSED'],
    ['RECALLED', 'RECALLED', 'Classroom task status is already RECALLED'],
    [
      'RECALLED',
      'ACTIVE',
      'Recalled classroom tasks cannot be reopened or closed',
    ],
    [
      'RECALLED',
      'CLOSED',
      'Recalled classroom tasks cannot be reopened or closed',
    ],
  ] as const)(
    'keeps the existing %s to %s rejection before writing',
    async (source, target, message) => {
      const harness = setup(source);

      await expect(harness.setStatus(target)).rejects.toMatchObject({
        status: 400,
        message,
      });

      expect(
        harness.classroomTaskModel.findOneAndUpdate,
      ).not.toHaveBeenCalled();
      expect(harness.classroomTaskModel.findOne).toHaveBeenCalledTimes(1);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it.each(['status', 'settings'] as const)(
    'returns 404 when the target disappears after a missed %s write',
    async (operation) => {
      const harness = setup(CLASSROOM_TASK_STATUS_ACTIVE);
      const reread = loseWrite(harness, null);
      const action =
        operation === 'status'
          ? harness.setStatus(CLASSROOM_TASK_STATUS_CLOSED)
          : harness.setSettings({ allowLate: false });

      await expect(action).rejects.toMatchObject({
        status: 404,
        message: 'Classroom task not found',
      });

      expectScopedRereadWithoutReplay(harness, reread);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['ACTIVE', 'CLOSED', 'CLOSED', 'Classroom task status is already CLOSED'],
    ['CLOSED', 'ACTIVE', 'ACTIVE', 'Classroom task status is already ACTIVE'],
    [
      'ACTIVE',
      'RECALLED',
      'RECALLED',
      'Classroom task status is already RECALLED',
    ],
    [
      'ACTIVE',
      'CLOSED',
      'RECALLED',
      'Recalled classroom tasks cannot be reopened or closed',
    ],
  ] as const)(
    'returns the existing 400 when %s to %s loses to current state %s',
    async (source, target, current, message) => {
      const harness = setup(source);
      const reread = loseWrite(harness, { status: current });

      await expect(harness.setStatus(target)).rejects.toMatchObject({
        status: 400,
        message,
      });

      expectScopedRereadWithoutReplay(harness, reread);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['ACTIVE', 'CLOSED', 'ACTIVE'],
    ['CLOSED', 'ACTIVE', 'CLOSED'],
    ['ACTIVE', 'RECALLED', 'ACTIVE'],
    ['ACTIVE', 'RECALLED', 'CLOSED'],
    ['ACTIVE', 'CLOSED', ['RECALLED']],
  ] as const)(
    'returns plain 409 without replay when %s to %s remains allowed after a miss',
    async (source, target, current) => {
      const harness = setup(source);
      const reread = loseWrite(harness, { status: current });

      await expectPlainConflict(harness.setStatus(target));

      expectScopedRereadWithoutReplay(harness, reread);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['ACTIVE', CLASSROOM_TASK_STATUS_ACTIVE],
    ['CLOSED', CLASSROOM_TASK_STATUS_CLOSED],
    ['missing status', undefined],
    ['null status', null],
    ['unknown status', 'UNKNOWN'],
    ['RECALLED inside an array', ['RECALLED']],
  ] as const)(
    'keeps settings editable for %s while excluding only exact RECALLED at the write',
    async (_description, status) => {
      const harness = setup(status, {
        classroomStatus: ClassroomStatus.Archived,
        taskStatus: TaskStatus.Archived,
      });
      const dueAt = new Date('2026-02-01T00:00:00.000Z');
      harness.classroomTaskModel.findOneAndUpdate.mockReturnValueOnce(
        makeQuery({
          ...harness.initialTask,
          dueAt,
          settings: { allowLate: false },
        }),
      );

      await expect(
        harness.setSettings({ dueAt: dueAt.toISOString(), allowLate: false }),
      ).resolves.toMatchObject({
        dueAt,
        settings: { allowLate: false },
        task: { title: 'Published task', status: TaskStatus.Archived },
      });

      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
        { ...harness.scope, ...editableSettings },
        { $set: { dueAt, 'settings.allowLate': false } },
        { returnDocument: 'after' },
      );
      expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledTimes(
        1,
      );
      expect(harness.classroomTaskModel.findOne).toHaveBeenCalledTimes(1);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );

  it('clears dueAt with unset and preserves omitted settings', async () => {
    const harness = setup(CLASSROOM_TASK_STATUS_CLOSED);

    await expect(harness.setSettings({ dueAt: null })).resolves.toMatchObject({
      status: 'CLOSED',
      dueAt: undefined,
    });

    expect(harness.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { ...harness.scope, ...editableSettings },
      { $unset: { dueAt: 1 } },
      { returnDocument: 'after' },
    );
  });

  it.each([
    [
      'RECALLED',
      { allowLate: false },
      'Recalled classroom tasks cannot be updated',
    ],
    ['ACTIVE', {}, 'At least one updatable field is required'],
  ] as const)(
    'keeps the existing settings rejection for %s before writing',
    async (status, dto, message) => {
      const harness = setup(status);

      await expect(harness.setSettings(dto)).rejects.toMatchObject({
        status: 400,
        message,
      });

      expect(
        harness.classroomTaskModel.findOneAndUpdate,
      ).not.toHaveBeenCalled();
      expect(harness.classroomTaskModel.findOne).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the existing settings 400 after a concurrent recall', async () => {
    const harness = setup(CLASSROOM_TASK_STATUS_ACTIVE);
    const reread = loseWrite(harness, { status: 'RECALLED' });

    await expect(
      harness.setSettings({ allowLate: false }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Recalled classroom tasks cannot be updated',
    });

    expectScopedRereadWithoutReplay(harness, reread);
    expect(harness.submissionModel.exists).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['CLOSED', 'CLOSED'],
    ['missing status', undefined],
    ['null status', null],
    ['RECALLED inside an array', ['RECALLED']],
  ] as const)(
    'returns plain 409 without replay when settings remain editable for %s',
    async (_description, status) => {
      const harness = setup(CLASSROOM_TASK_STATUS_ACTIVE);
      const reread = loseWrite(harness, { status });

      await expectPlainConflict(harness.setSettings({ allowLate: false }));

      expectScopedRereadWithoutReplay(harness, reread);
      expect(harness.submissionModel.exists).not.toHaveBeenCalled();
    },
  );
});
