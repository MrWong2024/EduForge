import { AiContextReaderService } from '../ai-context/ai-context-reader.service';
import type { AiContextRef } from '../ai-context/ai-context.types';
import { Enrollment } from '../../classrooms/enrollments/schemas/enrollment.schema';
import { ConfigService } from '@nestjs/config';
import { Model, mongo, Mongoose, Schema, Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
} from '../../classrooms/classroom-tasks/classroom-task-status.constants';
import {
  Classroom,
  ClassroomStatus,
} from '../../classrooms/schemas/classroom.schema';
import { USER_ROLE_STUDENT } from '../../users/schemas/user-roles.constants';
import { User } from '../../users/schemas/user.schema';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';
import { AiFeedbackJobStatus } from '../ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from '../ai-feedback/services/ai-feedback-job.service';
import { CreateSubmissionDto } from '../dto/create-submission.dto';
import type { UpdateFeedbackDto } from '../dto/update-feedback.dto';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../schemas/feedback.schema';
import {
  Submission,
  SubmissionSchema,
  SubmissionStatus,
} from '../schemas/submission.schema';
import { Task, TaskStatus } from '../schemas/task.schema';
import {
  TASK_TEMPLATE_SCOPE_ALL,
  TASK_VISIBILITY_SHARED,
} from '../task-template-visibility.constants';
import { LearningTasksService } from './learning-tasks.service';

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    session: jest.fn(),
    read: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    setOptions: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.session.mockReturnValue(chain);
  chain.read.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  chain.setOptions.mockReturnValue(chain);
  return chain;
};

const submissionDto: CreateSubmissionDto = {
  content: {
    codeText: 'console.log("ok");',
    language: 'javascript',
  },
};

const makeSubmissionTestSession = () => ({
  id: objectId(),
  startTransaction: jest.fn(),
  inTransaction: jest.fn().mockReturnValue(true),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
});
type SubmissionTestSession = ReturnType<typeof makeSubmissionTestSession>;

const createHarness = (
  options: {
    classroomStatus?: ClassroomStatus;
    classroomTaskStatus?: string;
    taskStatus?: TaskStatus;
    submissionStudentId?: Types.ObjectId;
    submissionCooldownMs?: number;
    dueAt?: Date;
    allowLate?: boolean;
  } = {},
) => {
  const studentId = objectId();
  const teacherId = objectId();
  const classroomId = objectId();
  const classroomTaskId = objectId();
  const taskId = objectId();
  const submissionId = objectId();
  const submission = {
    _id: submissionId,
    taskId,
    classroomTaskId,
    studentId: options.submissionStudentId ?? studentId,
    attemptNo: 1,
    submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    contentRevision: 0,
    status: SubmissionStatus.Submitted,
  };
  const task = {
    _id: taskId,
    createdBy: teacherId,
    status: options.taskStatus ?? TaskStatus.Published,
  };
  const classroomTask = {
    _id: classroomTaskId,
    classroomId,
    taskId,
    status: options.classroomTaskStatus ?? CLASSROOM_TASK_STATUS_ACTIVE,
    taskSnapshot: {
      title: 'Published task',
      description: 'Published description',
      knowledgeModule: 'Module',
    },
    dueAt: options.dueAt,
    settings: { allowLate: options.allowLate },
  };
  const classroom = {
    _id: classroomId,
    teacherId,
    status: options.classroomStatus ?? ClassroomStatus.Active,
  };

  const enrollmentModel = new Mongoose().model<Enrollment>(
    'Enrollment',
    new Schema<Enrollment>(),
  );
  jest.spyOn(enrollmentModel, 'exists').mockResolvedValue({ _id: objectId() });
  const configService = { get: jest.fn(() => options.submissionCooldownMs) };
  const taskModel = { findById: jest.fn(() => makeQuery(task)) };
  const submissionModel = {
    modelName: Submission.name,
    findById: jest.fn(() => makeQuery(submission)),
    findOne: jest.fn<ReturnType<typeof makeQuery>, [Record<string, unknown>]>(
      () => makeQuery(null),
    ),
    create: jest.fn<
      Promise<unknown[]>,
      [Record<string, unknown>[], { session: SubmissionTestSession }]
    >(),
    findOneAndUpdate: jest.fn(() =>
      makeQuery({ ...submission, reviewStartedAt: new Date() }),
    ),
  };
  const feedbackModel = {
    exists: jest.fn().mockResolvedValue(null),
    findById: jest.fn<ReturnType<typeof makeQuery>, [string]>(),
    findOneAndUpdate: jest.fn<
      ReturnType<typeof makeQuery>,
      [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ]
    >(),
  };
  const classroomTaskModel = {
    modelName: ClassroomTask.name,
    findById: jest.fn(() => makeQuery(classroomTask)),
    findOneAndUpdate: jest.fn(() => makeQuery(classroomTask)),
    exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
  };
  const classroomModel = {
    modelName: Classroom.name,
    findById: jest.fn(() => makeQuery(classroom)),
  };
  const transactionModels: Record<string, unknown> = {
    [ClassroomTask.name]: classroomTaskModel,
    [Classroom.name]: classroomModel,
    [Submission.name]: submissionModel,
  };
  const transactionConnection = {
    startSession: jest.fn(() => Promise.resolve(makeSubmissionTestSession())),
    models: transactionModels,
    model: jest.fn((name: string) => transactionModels[name]),
  };
  const userModel = { findById: jest.fn(() => makeQuery(null)) };
  const aiFeedbackJobService = {
    getReviewJob: jest.fn().mockResolvedValue(null),
    ensureJobForSubmission: jest.fn().mockResolvedValue({
      jobId: objectId().toString(),
      status: AiFeedbackJobStatus.Pending,
    }),
  };

  const service = new LearningTasksService(
    configService as unknown as ConfigService,
    taskModel as unknown as Model<Task>,
    submissionModel as unknown as Model<Submission>,
    feedbackModel as unknown as Model<Feedback>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    classroomModel as unknown as Model<Classroom>,
    userModel as unknown as Model<User>,
    aiFeedbackJobService as unknown as AiFeedbackJobService,
    enrollmentModel,
    new AiContextReaderService(),
    transactionConnection as unknown as Connection,
  );

  return {
    service,
    taskModel,
    submissionModel,
    aiFeedbackJobService,
    enrollmentModel,
    classroomTaskModel,
    classroomModel,
    transactionConnection,
    feedbackModel,
    submission,
    task,
    classroomTask,
    classroom,
    ids: {
      studentId,
      teacherId,
      classroomId,
      classroomTaskId,
      taskId,
      submissionId,
    },
  };
};

const makeTaskQuery = (result: unknown) => {
  const query = makeQuery(result);
  const then: PromiseLike<unknown>['then'] = (fulfilled, rejected) =>
    Promise.resolve<unknown>(query.exec()).then(fulfilled, rejected);
  return { ...query, then };
};

type TaskManagementWrite = {
  $set?: Partial<Task>;
  $unset?: Record<string, unknown>;
};

const createTaskManagementHarness = (
  options: {
    taskStatus?: TaskStatus;
    createdBy?: Types.ObjectId;
    findByIdResult?: unknown;
    findOneResult?: unknown;
    aiContextRefs?: AiContextRef[];
  } = {},
) => {
  const teacherId = objectId();
  const taskId = objectId();
  const task: Task & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
    save: jest.Mock<Promise<void>, []>;
  } = {
    _id: taskId,
    title: 'Task',
    description: 'Description',
    knowledgeModule: 'Module',
    status: options.taskStatus ?? TaskStatus.Archived,
    createdBy: options.createdBy ?? teacherId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...(options.aiContextRefs === undefined
      ? {}
      : { aiContextRefs: options.aiContextRefs }),
    save: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const findByIdResult =
    'findByIdResult' in options ? options.findByIdResult : task;
  const findOneResult =
    'findOneResult' in options ? options.findOneResult : findByIdResult;
  const taskModel = {
    create: jest.fn((payload: Record<string, unknown>) => ({
      _id: taskId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      ...payload,
    })),
    findById: jest.fn(() => makeTaskQuery(findByIdResult)),
    findOne: jest.fn((_filter: Record<string, unknown>) => {
      void _filter;
      return makeTaskQuery(findOneResult);
    }),
    findOneAndUpdate: jest.fn(
      (
        _filter: Record<string, unknown>,
        update: TaskManagementWrite,
        _options?: Record<string, unknown>,
      ) => {
        void _filter;
        void _options;
        Object.assign(task, update.$set);
        for (const field of Object.keys(update.$unset ?? {})) {
          Reflect.deleteProperty(task, field);
        }
        return makeTaskQuery({ ...task });
      },
    ),
  };
  const aiContextReader = new AiContextReaderService();
  const validateForSave = jest
    .spyOn(aiContextReader, 'validateForSave')
    .mockResolvedValue(undefined);
  const classroomTaskModel = {};
  const service = new LearningTasksService(
    { get: jest.fn() } as unknown as ConfigService,
    taskModel as unknown as Model<Task>,
    {} as unknown as Model<Submission>,
    {} as unknown as Model<Feedback>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    {} as unknown as Model<Classroom>,
    {} as unknown as Model<User>,
    {} as unknown as AiFeedbackJobService,
    {} as Model<Enrollment>,
    aiContextReader,
    {} as Connection,
  );

  return {
    service,
    taskModel,
    task,
    validateForSave,
    ids: { teacherId, taskId },
  };
};

describe('LearningTasksService task template lifecycle', () => {
  it('keeps ordinary updateTask blocked for archived tasks', async () => {
    const harness = createTaskManagementHarness();

    await expect(
      harness.service.updateTask(
        harness.ids.taskId.toString(),
        { title: 'Updated title' },
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Archived tasks cannot be updated');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('creates DRAFT task templates by default when status is omitted', async () => {
    const harness = createTaskManagementHarness();

    const result = await harness.service.createTask(
      {
        title: 'Task',
        description: 'Description',
        knowledgeModule: 'Module',
      },
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Draft,
      createdBy: harness.ids.teacherId.toString(),
      publishedAt: undefined,
    });
    expect(result).not.toHaveProperty('stage');
    expect(harness.taskModel.create.mock.calls[0]?.[0]).not.toHaveProperty(
      'stage',
    );
    expect(harness.taskModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.Draft,
      }),
    );
  });

  it('creates PUBLISHED task templates with publishedAt set', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });

    const result = await harness.service.createTask(
      {
        title: 'Task',
        description: 'Description',
        knowledgeModule: 'Module',
        status: TaskStatus.Published,
      },
      harness.ids.teacherId.toString(),
    );

    expect(result.id).toBe(harness.ids.taskId.toString());
    expect(result.status).toBe(TaskStatus.Published);
    expect(result.createdBy).toBe(harness.ids.teacherId.toString());
    expect(result.publishedAt).toBeInstanceOf(Date);
    const createPayload = harness.taskModel.create.mock.calls[0]?.[0] as
      { status: TaskStatus; publishedAt?: Date } | undefined;
    expect(createPayload?.status).toBe(TaskStatus.Published);
    expect(createPayload?.publishedAt).toBeInstanceOf(Date);
  });

  it('rejects creating ARCHIVED task templates', async () => {
    const harness = createTaskManagementHarness();

    await expect(
      harness.service.createTask(
        {
          title: 'Task',
          description: 'Description',
          knowledgeModule: 'Module',
          status: TaskStatus.Archived,
        },
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Task templates cannot be created as archived');
    expect(harness.taskModel.create).not.toHaveBeenCalled();
  });

  it('rejects DRAFT to PUBLISHED status changes through PATCH', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });

    await expect(
      harness.service.updateTask(
        harness.ids.taskId.toString(),
        { status: TaskStatus.Published },
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow(
      'Task template status must be changed through lifecycle actions',
    );
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects PUBLISHED to DRAFT status changes through PATCH', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    await expect(
      harness.service.updateTask(
        harness.ids.taskId.toString(),
        { status: TaskStatus.Draft },
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow(
      'Task template status must be changed through lifecycle actions',
    );
    expect(harness.task.status).toBe(TaskStatus.Published);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects PUBLISHED to ARCHIVED status changes through PATCH', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    await expect(
      harness.service.updateTask(
        harness.ids.taskId.toString(),
        { status: TaskStatus.Archived },
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow(
      'Task template status must be changed through lifecycle actions',
    );
    expect(harness.task.status).toBe(TaskStatus.Published);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('ignores same status in PATCH and still updates other mutable fields', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    const result = await harness.service.updateTask(
      harness.ids.taskId.toString(),
      {
        status: TaskStatus.Published,
        title: 'Updated title',
        description: 'Updated description',
      },
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Published,
      title: 'Updated title',
      description: 'Updated description',
    });
    expect(harness.task.status).toBe(TaskStatus.Published);
    expect(harness.task.title).toBe('Updated title');
    expect(harness.task.description).toBe('Updated description');
    expect(harness.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('publishes DRAFT task templates', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });

    const result = await harness.service.publishTask(
      harness.ids.taskId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Published,
    });
    expect(result.publishedAt).toBeDefined();
    expect(harness.task.status).toBe(TaskStatus.Published);
    expect(harness.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects publishing ARCHIVED task templates', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Archived,
    });

    await expect(
      harness.service.publishTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Archived task templates cannot be published');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('archives PUBLISHED task templates for the author', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    const result = await harness.service.archiveTask(
      harness.ids.taskId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Archived,
    });
    expect(harness.task.status).toBe(TaskStatus.Archived);
    expect(harness.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects archiving DRAFT task templates', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });
    harness.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Only published task templates can be archived');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects archiving already ARCHIVED task templates', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Archived,
    });
    harness.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Only published task templates can be archived');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects archiving a PUBLISHED task template for non-authors', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
      createdBy: objectId(),
    });
    harness.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Not allowed to archive task');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects archiving a missing task template', async () => {
    const harness = createTaskManagementHarness({ findByIdResult: null });
    harness.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Task not found');
  });

  it('allows archiving published task templates even if classrooms already use them', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).resolves.toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Archived,
    });
    expect(harness.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects restoring an archived task template with the clone-as-draft message', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Archived,
    });

    await expect(
      harness.service.restoreTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow(
      'Archived task templates cannot be restored to draft; clone as draft instead',
    );
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects restoring a task owned by another teacher', async () => {
    const harness = createTaskManagementHarness({ createdBy: objectId() });

    await expect(
      harness.service.restoreTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Not allowed to restore task');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects restoring a missing task', async () => {
    const harness = createTaskManagementHarness({ findByIdResult: null });

    await expect(
      harness.service.restoreTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Task not found');
  });
});

describe('LearningTasksService task template conditional writes (no database)', () => {
  type Operation = 'patch' | 'publish' | 'archive';
  const references = (archive = 'unit-a.zip'): AiContextRef[] => [
    { archivePath: archive, entryPaths: ['first.md', 'second.md'] },
  ];
  const invoke = (
    harness: ReturnType<typeof createTaskManagementHarness>,
    operation: Operation,
  ) => {
    const id = harness.ids.taskId.toString();
    const author = harness.ids.teacherId.toString();
    if (operation === 'patch') {
      return harness.service.updateTask(id, { title: 'Changed title' }, author);
    }
    return operation === 'publish'
      ? harness.service.publishTask(id, author)
      : harness.service.archiveTask(id, author);
  };
  const setup = (operation: Operation) =>
    createTaskManagementHarness({
      taskStatus:
        operation === 'publish' ? TaskStatus.Draft : TaskStatus.Published,
      aiContextRefs: references(),
    });

  it.each(['patch', 'publish'] as const)(
    '%s preserves author-scoped not-found without attempting a write',
    async (operation) => {
      const h = createTaskManagementHarness({ findOneResult: null });
      await expect(invoke(h, operation)).rejects.toMatchObject({
        status: 404,
        message: 'Task not found',
      });
      expect(h.taskModel.findOne).toHaveBeenCalledWith({
        _id: h.ids.taskId.toString(),
        createdBy: h.ids.teacherId,
      });
      expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(h.validateForSave).not.toHaveBeenCalled();
    },
  );

  it.each(['archive', 'restore'] as const)(
    '%s keeps an existing foreign template forbidden instead of author-scoped 404',
    async (operation) => {
      const h = createTaskManagementHarness({
        taskStatus: TaskStatus.Published,
        createdBy: objectId(),
      });
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
      const request =
        operation === 'archive'
          ? h.service.archiveTask(
              h.ids.taskId.toString(),
              h.ids.teacherId.toString(),
            )
          : h.service.restoreTask(
              h.ids.taskId.toString(),
              h.ids.teacherId.toString(),
            );
      await expect(request).rejects.toMatchObject({
        status: 403,
        message: `Not allowed to ${operation} task`,
      });
      expect(h.task.save).not.toHaveBeenCalled();
      if (operation === 'archive') {
        expect(h.taskModel.findOne).toHaveBeenCalledWith({
          _id: h.ids.taskId.toString(),
        });
      } else {
        expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['patch', 'publish', 'archive'] as const)(
    '%s returns the atomic after-document rather than its pre-read object',
    async (operation) => {
      const h = setup(operation);
      const written = {
        ...h.task,
        title: 'Authoritative after-document',
        status:
          operation === 'archive' ? TaskStatus.Archived : TaskStatus.Published,
        publishedAt: new Date('2026-03-01T01:02:03.456Z'),
        updatedAt: new Date('2026-03-02T01:02:03.456Z'),
      };
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(written));
      await expect(invoke(h, operation)).resolves.toMatchObject({
        title: 'Authoritative after-document',
        status: written.status,
        publishedAt: new Date('2026-03-01T01:02:03.456Z'),
        updatedAt: new Date('2026-03-02T01:02:03.456Z'),
      });
      expect(h.task.title).toBe('Task');
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.taskModel.findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({
        _id: h.ids.taskId.toString(),
        createdBy: h.ids.teacherId,
        status:
          operation === 'patch'
            ? { $in: [TaskStatus.Draft, TaskStatus.Published] }
            : operation === 'publish'
              ? TaskStatus.Draft
              : TaskStatus.Published,
      });
      expect(h.taskModel.findOneAndUpdate.mock.calls[0]?.[2]).toMatchObject({
        returnDocument: 'after',
        runValidators: true,
      });
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it('allows omitted status to span DRAFT to PUBLISHED while only writing requested fields', async () => {
    const h = createTaskManagementHarness({ taskStatus: TaskStatus.Draft });
    const written = {
      ...h.task,
      title: 'Changed title',
      status: TaskStatus.Published,
      publishedAt: new Date('2026-03-01T01:02:03.456Z'),
    };
    h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(written));
    await expect(invoke(h, 'patch')).resolves.toMatchObject({
      title: 'Changed title',
      status: TaskStatus.Published,
    });
    const [filter, update] = h.taskModel.findOneAndUpdate.mock.calls[0] ?? [];
    expect(filter).toMatchObject({
      _id: h.ids.taskId.toString(),
      createdBy: h.ids.teacherId,
      status: { $in: [TaskStatus.Draft, TaskStatus.Published] },
    });
    expect(update).toEqual({ $set: { title: 'Changed title' } });
  });

  it('requires explicit status to remain equal at the conditional write', async () => {
    const h = createTaskManagementHarness({ taskStatus: TaskStatus.Draft });
    const reread = { ...h.task, status: TaskStatus.Published };
    h.taskModel.findOne
      .mockReturnValueOnce(makeTaskQuery(h.task))
      .mockReturnValueOnce(makeTaskQuery(reread));
    h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
    await expect(
      h.service.updateTask(
        h.ids.taskId.toString(),
        { title: 'Changed title', status: TaskStatus.Draft },
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Task template status must be changed through lifecycle actions',
    });
    expect(h.taskModel.findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({
      status: TaskStatus.Draft,
    });
    expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.taskModel.findOne).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['empty PATCH', {}],
    ['same-status-only PATCH', { status: TaskStatus.Published }],
  ] as const)(
    '%s validates references and returns a fresh permitted read without writing timestamps',
    async (_name, dto) => {
      const h = setup('patch');
      const reread = {
        ...h.task,
        title: 'Unrelated concurrent edit',
        updatedAt: new Date('2026-03-02T01:02:03.456Z'),
      };
      const initialQuery = makeTaskQuery(h.task);
      const rereadQuery = makeTaskQuery(reread);
      h.taskModel.findOne
        .mockReturnValueOnce(initialQuery)
        .mockReturnValueOnce(rereadQuery);
      await expect(
        h.service.updateTask(
          h.ids.taskId.toString(),
          dto,
          h.ids.teacherId.toString(),
        ),
      ).resolves.toMatchObject({
        title: 'Unrelated concurrent edit',
        updatedAt: new Date('2026-03-02T01:02:03.456Z'),
      });
      expect(h.validateForSave).toHaveBeenCalledWith(references());
      expect(h.taskModel.findOne).toHaveBeenCalledTimes(2);
      expect(initialQuery.read).toHaveBeenCalledWith('primary');
      expect(rereadQuery.read).toHaveBeenCalledWith('primary');
      expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty PATCH when references change after its required validation', async () => {
    const h = setup('patch');
    h.taskModel.findOne
      .mockReturnValueOnce(makeTaskQuery(h.task))
      .mockReturnValueOnce(
        makeTaskQuery({ ...h.task, aiContextRefs: references('unit-b.zip') }),
      );
    await expect(
      h.service.updateTask(
        h.ids.taskId.toString(),
        {},
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: '任务模板已变化，请刷新后再操作。',
    });
    expect(h.validateForSave).toHaveBeenCalledTimes(1);
    expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still rejects an empty PATCH if the template is archived during reference validation', async () => {
    const h = setup('patch');
    h.taskModel.findOne
      .mockReturnValueOnce(makeTaskQuery(h.task))
      .mockReturnValueOnce(
        makeTaskQuery({ ...h.task, status: TaskStatus.Archived }),
      );
    await expect(
      h.service.updateTask(
        h.ids.taskId.toString(),
        {},
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Archived tasks cannot be updated',
    });
    expect(h.validateForSave).toHaveBeenCalledTimes(1);
    expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(h.task.save).not.toHaveBeenCalled();
  });

  it.each([
    ['patch', TaskStatus.Archived, 'Archived tasks cannot be updated'],
    [
      'publish',
      TaskStatus.Archived,
      'Archived task templates cannot be published',
    ],
    [
      'archive',
      TaskStatus.Archived,
      'Only published task templates can be archived',
    ],
    [
      'archive',
      TaskStatus.Draft,
      'Only published task templates can be archived',
    ],
  ] as const)(
    '%s classifies a write miss with current %s as its original 400',
    async (operation, status, message) => {
      const h = setup(operation);
      const initialQuery = makeTaskQuery(h.task);
      const rereadQuery = makeTaskQuery({ ...h.task, status });
      if (operation !== 'archive')
        h.taskModel.findOne.mockReturnValueOnce(initialQuery);
      h.taskModel.findOne.mockReturnValueOnce(rereadQuery);
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
      await expect(invoke(h, operation)).rejects.toMatchObject({
        status: 400,
        message,
      });
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.taskModel.findOne).toHaveBeenCalledTimes(
        operation === 'archive' ? 1 : 2,
      );
      expect(rereadQuery.read).toHaveBeenCalledWith('primary');
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it.each(['patch', 'publish', 'archive'] as const)(
    '%s preserves missing-resource 404 after one write miss reread',
    async (operation) => {
      const h = setup(operation);
      if (operation !== 'archive')
        h.taskModel.findOne.mockReturnValueOnce(makeTaskQuery(h.task));
      h.taskModel.findOne.mockReturnValueOnce(makeTaskQuery(null));
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
      await expect(invoke(h, operation)).rejects.toMatchObject({
        status: 404,
        message: 'Task not found',
      });
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const finalScope = h.taskModel.findOne.mock.calls.at(-1)?.[0];
      expect(finalScope).toEqual(
        operation === 'archive'
          ? { _id: h.ids.taskId.toString() }
          : { _id: h.ids.taskId.toString(), createdBy: h.ids.teacherId },
      );
    },
  );

  it.each(['patch', 'publish', 'archive'] as const)(
    '%s rejects a still-eligible write miss as ordinary 409 without replay',
    async (operation) => {
      const h = setup(operation);
      const current = { ...h.task, aiContextRefs: references('unit-b.zip') };
      if (operation !== 'archive')
        h.taskModel.findOne.mockReturnValueOnce(makeTaskQuery(h.task));
      h.taskModel.findOne.mockReturnValueOnce(makeTaskQuery(current));
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
      await expect(invoke(h, operation)).rejects.toMatchObject({
        status: 409,
        message: '任务模板已变化，请刷新后再操作。',
      });
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it('returns the winning first publishedAt after another request published the draft', async () => {
    const h = setup('publish');
    const publishedAt = new Date('2026-03-01T01:02:03.456Z');
    h.taskModel.findOne
      .mockReturnValueOnce(makeTaskQuery(h.task))
      .mockReturnValueOnce(
        makeTaskQuery({
          ...h.task,
          status: TaskStatus.Published,
          publishedAt,
          aiContextRefs: references('unit-b.zip'),
        }),
      );
    h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(null));
    await expect(invoke(h, 'publish')).resolves.toMatchObject({
      status: TaskStatus.Published,
      publishedAt,
    });
    expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.validateForSave).toHaveBeenCalledTimes(1);
  });

  it('does not validate ZIP or rewrite time for an already-published template', async () => {
    const h = setup('patch');
    h.task.publishedAt = new Date('2026-03-01T01:02:03.456Z');
    await expect(invoke(h, 'publish')).resolves.toMatchObject({
      publishedAt: new Date('2026-03-01T01:02:03.456Z'),
    });
    expect(h.validateForSave).not.toHaveBeenCalled();
    expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(h.task.save).not.toHaveBeenCalled();
  });

  it.each(['patch', 'publish'] as const)(
    '%s propagates reference validation failures without a partial write',
    async (operation) => {
      const h = setup(operation);
      const error = new Error('reference validation failed');
      h.validateForSave.mockRejectedValueOnce(error);
      await expect(invoke(h, operation)).rejects.toBe(error);
      expect(h.taskModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(h.taskModel.findOne).toHaveBeenCalledTimes(1);
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it.each(['patch', 'publish', 'archive'] as const)(
    '%s propagates unknown write outcomes without fallback reads or replay',
    async (operation) => {
      const h = setup(operation);
      const error = new Error('write acknowledgement unavailable');
      const write = makeTaskQuery(null);
      write.exec.mockRejectedValueOnce(error);
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(write);
      await expect(invoke(h, operation)).rejects.toBe(error);
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.taskModel.findOne).toHaveBeenCalledTimes(
        operation === 'archive' ? 0 : 1,
      );
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );

  it.each(['patch', 'publish', 'archive'] as const)(
    '%s never replays an atomic success when response mapping fails',
    async (operation) => {
      const h = setup(operation);
      const error = new Error('response mapping failed');
      const written = { ...h.task };
      Object.defineProperty(written, 'title', {
        get: () => {
          throw error;
        },
      });
      h.taskModel.findOneAndUpdate.mockReturnValueOnce(makeTaskQuery(written));
      await expect(invoke(h, operation)).rejects.toBe(error);
      expect(h.taskModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.taskModel.findOne).toHaveBeenCalledTimes(
        operation === 'archive' ? 0 : 1,
      );
      expect(h.task.save).not.toHaveBeenCalled();
    },
  );
});

describe('LearningTasksService task template publisher contract', () => {
  const createTask = (params: {
    id?: Types.ObjectId;
    createdBy: Types.ObjectId;
    title: string;
    status?: TaskStatus;
  }) => ({
    _id: params.id ?? objectId(),
    title: params.title,
    description: 'Description',
    knowledgeModule: 'Module',
    courseLabel: 'Course',
    visibility: TASK_VISIBILITY_SHARED,
    status: params.status ?? TaskStatus.Published,
    createdBy: params.createdBy,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });

  it('returns publisher summaries for task template list items including shared templates', async () => {
    const currentTeacherId = objectId();
    const otherTeacherId = objectId();
    const tasks = [
      createTask({ createdBy: currentTeacherId, title: 'Mine' }),
      createTask({ createdBy: otherTeacherId, title: 'Shared' }),
    ];
    const taskModel = {
      find: jest.fn(() => makeQuery(tasks)),
      countDocuments: jest.fn().mockResolvedValue(tasks.length),
    };
    const userModel = {
      find: jest.fn(() =>
        makeQuery([
          {
            _id: currentTeacherId,
            name: 'Current Teacher',
            email: 'hidden@example.com',
          },
          { _id: otherTeacherId, name: 'Other Teacher', roles: ['teacher'] },
        ]),
      ),
    };
    const service = new LearningTasksService(
      { get: jest.fn() } as unknown as ConfigService,
      taskModel as unknown as Model<Task>,
      {} as unknown as Model<Submission>,
      {} as unknown as Model<Feedback>,
      {} as unknown as Model<ClassroomTask>,
      {} as unknown as Model<Classroom>,
      userModel as unknown as Model<User>,
      {} as unknown as AiFeedbackJobService,
      {} as Model<Enrollment>,
      new AiContextReaderService(),
      {} as Connection,
    );

    const result = await service.listTasks(
      { scope: TASK_TEMPLATE_SCOPE_ALL },
      currentTeacherId.toString(),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].publisher).toEqual({
      id: currentTeacherId.toString(),
      name: 'Current Teacher',
    });
    expect(result.items[1].publisher).toEqual({
      id: otherTeacherId.toString(),
      name: 'Other Teacher',
    });
    expect(result.items[0].publisher).not.toHaveProperty('email');
    expect(result.items[1].publisher).not.toHaveProperty('roles');
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });

  it('returns publisher summary for shared task template detail visible to a non-author', async () => {
    const currentTeacherId = objectId();
    const otherTeacherId = objectId();
    const task = createTask({
      createdBy: otherTeacherId,
      title: 'Shared Detail',
    });
    const legacyTask = { ...task, stage: 4 };
    const taskModel = {
      findById: jest.fn(() => makeQuery(legacyTask)),
    };
    const userModel = {
      find: jest.fn(() =>
        makeQuery([
          {
            _id: otherTeacherId,
            name: 'Other Teacher',
            status: 'ACTIVE',
          },
        ]),
      ),
    };
    const service = new LearningTasksService(
      { get: jest.fn() } as unknown as ConfigService,
      taskModel as unknown as Model<Task>,
      {} as unknown as Model<Submission>,
      {} as unknown as Model<Feedback>,
      {} as unknown as Model<ClassroomTask>,
      {} as unknown as Model<Classroom>,
      userModel as unknown as Model<User>,
      {} as unknown as AiFeedbackJobService,
      {} as Model<Enrollment>,
      new AiContextReaderService(),
      {} as Connection,
    );

    const result = await service.getTask(
      task._id.toString(),
      currentTeacherId.toString(),
    );

    expect(result.publisher).toEqual({
      id: otherTeacherId.toString(),
      name: 'Other Teacher',
    });
    expect(result.publisher).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('stage');
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });
});

describe('LearningTasksService student participation status gates', () => {
  it('allows students to request AI for ACTIVE classroom, ACTIVE classroomTask and PUBLISHED task submissions', async () => {
    const harness = createHarness();

    const result = await harness.service.requestAiFeedback(
      harness.ids.submissionId.toString(),
      { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
      { expectedRevision: 0 },
    );

    expect(result).toMatchObject({
      submissionId: harness.ids.submissionId.toString(),
      status: AiFeedbackJobStatus.Pending,
      aiFeedbackStatus: AiFeedbackStatus.Pending,
    });
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects student AI requests when the classroom is archived without creating a job', async () => {
    const harness = createHarness({
      classroomStatus: ClassroomStatus.Archived,
    });

    await expect(
      harness.service.requestAiFeedback(
        harness.ids.submissionId.toString(),
        { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
        { expectedRevision: 0 },
      ),
    ).rejects.toThrow('班级已归档，不能请求 AI 反馈。');
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('rejects student AI requests when the classroomTask is closed without creating a job', async () => {
    const harness = createHarness({
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
    });

    await expect(
      harness.service.requestAiFeedback(
        harness.ids.submissionId.toString(),
        { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
        { expectedRevision: 0 },
      ),
    ).rejects.toThrow('课堂任务已关闭，不能请求 AI 反馈。');
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('allows student AI requests for archived classroom-task templates', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Archived });

    const result = await harness.service.requestAiFeedback(
      harness.ids.submissionId.toString(),
      { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
      { expectedRevision: 0 },
    );

    expect(result).toMatchObject({
      submissionId: harness.ids.submissionId.toString(),
      status: AiFeedbackJobStatus.Pending,
      aiFeedbackStatus: AiFeedbackStatus.Pending,
    });
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).toHaveBeenCalledTimes(1);
  });

  it('keeps non-owner AI requests on the existing forbidden path', async () => {
    const harness = createHarness({ submissionStudentId: objectId() });

    await expect(
      harness.service.requestAiFeedback(
        harness.ids.submissionId.toString(),
        { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
        { expectedRevision: 0 },
      ),
    ).rejects.toThrow('Not allowed to request AI feedback');
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('rejects classroom submissions for archived classrooms before creating submission or AI job', async () => {
    const harness = createHarness({
      classroomStatus: ClassroomStatus.Archived,
    });

    await expect(
      harness.service.createSubmissionForClassroomTask(
        harness.ids.taskId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('班级已归档，不能继续提交该任务。');
    expect(harness.submissionModel.create).not.toHaveBeenCalled();
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('rejects classroom submissions for closed classroomTasks before creating submission or AI job', async () => {
    const harness = createHarness({
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
    });

    await expect(
      harness.service.createSubmissionForClassroomTask(
        harness.ids.taskId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('课堂任务已关闭，不能继续提交。');
    expect(harness.submissionModel.create).not.toHaveBeenCalled();
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('allows classroom submissions for archived task templates when runtime state is active', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Archived });

    harness.submissionModel.create.mockResolvedValue([
      {
        _id: objectId(),
        taskId: harness.ids.taskId,
        classroomTaskId: harness.ids.classroomTaskId,
        studentId: harness.ids.studentId,
        attemptNo: 1,
        submittedAt: new Date('2026-01-02T00:00:00.000Z'),
        isLate: false,
        lateBySeconds: 0,
        content: submissionDto.content,
        meta: undefined,
        status: 'SUBMITTED',
      },
    ]);

    await expect(
      harness.service.createSubmissionForClassroomTask(
        harness.ids.taskId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).resolves.toMatchObject({
      taskId: harness.ids.taskId.toString(),
      classroomTaskId: harness.ids.classroomTaskId.toString(),
    });
    expect(harness.submissionModel.create).toHaveBeenCalledTimes(1);
    expect(
      harness.submissionModel.create.mock.calls[0][0][0],
    ).not.toHaveProperty('reviewStartedAt');
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });
});

describe('AI review detail eligibility (no database)', () => {
  afterEach(() => jest.restoreAllMocks());
  it('reuses request eligibility for an authorized detail with no Job', async () => {
    const h = createHarness();
    const detail = await h.service.getSubmissionDetail(
      h.ids.submissionId.toString(),
      { id: h.ids.studentId.toString(), roles: ['student'] },
    );
    expect(detail.aiReview).toMatchObject({
      canRequest: true,
      requestBlockReason: null,
      provider: null,
      inputCoverage: 'NOT_SENT',
      usage: { reservedRequests: 0, totalTokens: 0 },
    });
  });
  it('propagates internal eligibility errors instead of presenting an ordinary block', async () => {
    const h = createHarness();
    const error = new Error('synthetic query failure');
    jest.spyOn(h.enrollmentModel, 'exists').mockRejectedValue(error);
    await expect(
      h.service.getSubmissionDetail(h.ids.submissionId.toString(), {
        id: h.ids.studentId.toString(),
        roles: ['student'],
      }),
    ).rejects.toBe(error);
  });
  it('does not read any AI facts before the existing ownership gate', async () => {
    const h = createHarness();
    await expect(
      h.service.getSubmissionDetail(h.ids.submissionId.toString(), {
        id: new Types.ObjectId().toString(),
        roles: ['student'],
      }),
    ).rejects.toThrow('Not allowed to view submission detail');
    expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
  });
});

describe('Submission classroom association contract (no database)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requires a classroomTaskId in offline Schema validation without adding a default', () => {
    const schema = SubmissionSchema.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    const model = new Mongoose().model<Submission>('OfflineSubmission', schema);
    const fields = {
      taskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      content: submissionDto.content,
      status: SubmissionStatus.Submitted,
    };
    const missing = new model(fields);
    expect(missing.classroomTaskId).toBeUndefined();
    expect(missing.validateSync()?.errors.classroomTaskId).toMatchObject({
      kind: 'required',
    });
    expect(
      new model({ ...fields, classroomTaskId: null }).validateSync()?.errors
        .classroomTaskId,
    ).toMatchObject({ kind: 'required' });
    expect(
      new model({ ...fields, classroomTaskId: objectId() }).validateSync(),
    ).toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['hex string', objectId().toString()],
    ['invalid string', 'invalid-reference'],
    ['number', 7],
    ['object', {}],
    ['ObjectId array', [objectId()]],
  ])(
    'rejects %s classroomTaskId before reading AI or freezing content',
    async (_label, value) => {
      const h = createHarness();
      if (value === undefined)
        Reflect.deleteProperty(h.submission, 'classroomTaskId');
      else Reflect.set(h.submission, 'classroomTaskId', value);
      const owner = { id: h.ids.studentId.toString(), roles: ['student'] };
      for (const action of [
        () =>
          h.service.getSubmissionDetail(h.ids.submissionId.toString(), owner),
        () =>
          h.service.requestAiFeedback(h.ids.submissionId.toString(), owner, {
            expectedRevision: 0,
          }),
      ]) {
        await expect(action()).rejects.toMatchObject({
          status: 409,
          message: 'Submission has no valid classroom task',
        });
      }
      expect(h.classroomTaskModel.findById).not.toHaveBeenCalled();
      expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
      expect(
        h.aiFeedbackJobService.ensureJobForSubmission,
      ).not.toHaveBeenCalled();
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing classroom task', 404, 'Classroom task not found'],
    ['task mismatch', 409, 'Submission does not match classroom task'],
    ['missing classroom', 404, 'Classroom not found'],
  ])(
    'rejects %s with the public association error before AI reads',
    async (kind, status, message) => {
      const h = createHarness();
      if (kind === 'missing classroom task')
        h.classroomTaskModel.findById.mockImplementation(() => makeQuery(null));
      else if (kind === 'task mismatch')
        Reflect.set(h.classroomTask, 'taskId', objectId());
      else h.classroomModel.findById.mockImplementation(() => makeQuery(null));
      await expect(
        h.service.getSubmissionDetail(h.ids.submissionId.toString(), {
          id: h.ids.studentId.toString(),
          roles: ['student'],
        }),
      ).rejects.toMatchObject({ status, message });
      expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('does not grant the template author another classroom teacher authority', async () => {
    const h = createHarness();
    Reflect.set(h.classroom, 'teacherId', objectId());
    await expect(
      h.service.getSubmissionDetail(h.ids.submissionId.toString(), {
        id: h.ids.teacherId.toString(),
        roles: ['teacher'],
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Not allowed to view submission detail',
    });
    expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
  });

  it('keeps a non-owner student feedback request forbidden before inspecting invalid associations', async () => {
    const h = createHarness();
    Reflect.deleteProperty(h.submission, 'classroomTaskId');
    await expect(
      h.service.listFeedback(h.ids.submissionId.toString(), {
        id: objectId().toString(),
        roles: ['student'],
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Not allowed to view feedback',
    });
    expect(h.taskModel.findById).not.toHaveBeenCalled();
    expect(h.classroomTaskModel.findById).not.toHaveBeenCalled();
    expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
  });

  it('lets the owner read a valid historical submission without active enrollment or classroom', async () => {
    const h = createHarness({ classroomStatus: ClassroomStatus.Archived });
    jest.spyOn(h.enrollmentModel, 'exists').mockResolvedValue(null);
    await expect(
      h.service.getSubmissionDetail(h.ids.submissionId.toString(), {
        id: h.ids.studentId.toString(),
        roles: ['student'],
      }),
    ).resolves.toMatchObject({
      id: h.ids.submissionId.toString(),
      classroomTaskId: h.ids.classroomTaskId.toString(),
    });
  });

  it('allocates attempts and checks cooldown only within the classroom instance', async () => {
    const h = createHarness();
    const highestAttempt = makeQuery(null);
    const recentSubmission = makeQuery(null);
    const classroomQuery = makeQuery(h.classroom);
    h.classroomModel.findById.mockReturnValueOnce(classroomQuery);
    h.submissionModel.findOne
      .mockReturnValueOnce(highestAttempt)
      .mockReturnValueOnce(recentSubmission);
    h.submissionModel.create.mockImplementation(([payload]) =>
      Promise.resolve([{ ...payload, _id: objectId() }]),
    );
    await h.service.createSubmissionForClassroomTask(
      h.ids.taskId.toString(),
      h.ids.classroomTaskId.toString(),
      submissionDto,
      h.ids.studentId.toString(),
    );
    expect(h.submissionModel.findOne).toHaveBeenCalledTimes(2);
    for (const [filter] of h.submissionModel.findOne.mock.calls)
      expect(filter).toEqual({
        studentId: h.ids.studentId,
        classroomTaskId: h.ids.classroomTaskId,
      });
    const [, { session }] = h.submissionModel.create.mock.calls[0];
    expect(h.transactionConnection.startSession).toHaveBeenCalledTimes(1);
    expect(h.classroomTaskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: h.ids.classroomTaskId },
      { $inc: { __v: 1 } },
      expect.objectContaining({
        session,
        timestamps: false,
        returnDocument: 'after',
      }),
    );
    expect(classroomQuery.session).toHaveBeenCalledWith(session);
    expect(highestAttempt.session).toHaveBeenCalledWith(session);
    expect(recentSubmission.session).toHaveBeenCalledWith(session);
    expect(h.submissionModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          classroomTaskId: h.ids.classroomTaskId,
          attemptNo: 1,
          contentRevision: 0,
        }),
      ],
      { session },
    );
  });
});

describe('Teacher feedback atomic edit (no database)', () => {
  const setup = () => {
    const h = createHarness();
    const feedback = {
      _id: objectId(),
      submissionId: h.ids.submissionId,
      source: FeedbackSource.Teacher,
      createdBy: h.ids.teacherId,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Info,
      message: 'Original feedback',
      suggestion: 'Original suggestion',
      tags: ['style'],
      scoreHint: 50,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T01:00:00.000Z'),
    };
    h.feedbackModel.findById.mockReturnValue(makeQuery(feedback));
    const update = (dto: UpdateFeedbackDto) =>
      h.service.updateFeedback(
        h.ids.submissionId.toString(),
        feedback._id.toString(),
        dto,
        h.ids.teacherId.toString(),
      );
    return { ...h, feedback, update };
  };

  it('updates only supplied fields and serializes the record returned by the write', async () => {
    const h = setup();
    const dto = {
      type: FeedbackType.Design,
      message: '  Updated feedback\n',
      suggestion: '',
      tags: [],
      scoreHint: 0,
      source: FeedbackSource.AI,
      createdBy: h.ids.studentId,
    };
    const after = {
      ...h.feedback,
      type: FeedbackType.Design,
      severity: FeedbackSeverity.Warn,
      message: dto.message,
      suggestion: '',
      tags: ['other'],
      scoreHint: 0,
      updatedAt: new Date('2026-01-01T02:00:00.000Z'),
    };
    h.feedbackModel.findOneAndUpdate.mockReturnValue(makeQuery(after));

    await expect(h.update(dto)).resolves.toEqual({
      id: h.feedback._id.toString(),
      submissionId: h.ids.submissionId.toString(),
      createdBy: h.ids.teacherId.toString(),
      source: FeedbackSource.Teacher,
      type: FeedbackType.Design,
      severity: FeedbackSeverity.Warn,
      message: dto.message,
      suggestion: '',
      tags: ['other'],
      scoreHint: 0,
      createdAt: h.feedback.createdAt,
      updatedAt: after.updatedAt,
    });
    expect(h.feedbackModel.findById).toHaveBeenCalledTimes(1);
    expect(h.feedbackModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.feedbackModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: h.feedback._id,
        submissionId: h.ids.submissionId,
        source: FeedbackSource.Teacher,
        $or: [{ createdBy: h.ids.teacherId }, { createdBy: null }],
      },
      {
        $set: {
          type: FeedbackType.Design,
          message: dto.message,
          suggestion: '',
          tags: ['other'],
          scoreHint: 0,
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('backfills the author on a same-value patch without writing omitted fields', async () => {
    const h = setup();
    h.feedbackModel.findById.mockReturnValue(
      makeQuery({ ...h.feedback, createdBy: undefined }),
    );
    h.feedbackModel.findOneAndUpdate.mockReturnValue(makeQuery(h.feedback));

    await expect(
      h.update({ message: h.feedback.message }),
    ).resolves.toMatchObject({
      createdBy: h.ids.teacherId.toString(),
      message: h.feedback.message,
      tags: h.feedback.tags,
    });
    const [[filter, update]] = h.feedbackModel.findOneAndUpdate.mock.calls;
    expect(filter.$or).toEqual([
      { createdBy: h.ids.teacherId },
      { createdBy: null },
    ]);
    expect(update).toEqual({
      $set: { message: h.feedback.message, createdBy: h.ids.teacherId },
    });
  });

  it.each([
    {
      reason: 'the record is gone',
      latest: null,
      status: 404,
      message: 'Feedback not found',
    },
    {
      reason: 'the record belongs to another submission',
      latest: { submissionId: objectId() },
      status: 404,
      message: 'Feedback not found',
    },
    {
      reason: 'the source is no longer teacher feedback',
      latest: { source: FeedbackSource.AI },
      status: 403,
      message: 'Only teacher feedback can be updated',
    },
    {
      reason: 'another teacher became the author',
      latest: { createdBy: objectId() },
      status: 403,
      message: 'Not allowed to update feedback',
    },
  ])(
    'classifies a missed write when $reason',
    async ({ latest, status, message }) => {
      const h = setup();
      h.feedbackModel.findById.mockReturnValueOnce(makeQuery(h.feedback));
      h.feedbackModel.findById.mockReturnValueOnce(
        makeQuery(latest && { ...h.feedback, ...latest }),
      );
      h.feedbackModel.findOneAndUpdate.mockReturnValue(makeQuery(null));

      await expect(
        h.update({ message: 'Updated feedback' }),
      ).rejects.toMatchObject({
        status,
        message,
      });
      expect(h.feedbackModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(h.feedbackModel.findById).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['another unique index', { code: 11000, keyPattern: { _id: 1 } }],
    ['a missing key pattern', { code: 11000 }],
  ])('propagates a duplicate-key error for %s', async (_label, details) => {
    const h = setup();
    const error = new mongo.MongoServerError(details);
    const write = makeQuery(null);
    write.exec.mockRejectedValue(error);
    h.feedbackModel.findOneAndUpdate.mockReturnValue(write);

    await expect(h.update({ message: 'Updated feedback' })).rejects.toBe(error);
    expect(h.feedbackModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports a conflict only for the exact feedback unique key', async () => {
    const h = setup();
    const write = makeQuery(null);
    write.exec.mockRejectedValue(
      new mongo.MongoServerError({
        code: 11000,
        keyPattern: {
          submissionId: 1,
          source: 1,
          type: 1,
          severity: 1,
          message: 1,
        },
      }),
    );
    h.feedbackModel.findOneAndUpdate.mockReturnValue(write);

    await expect(
      h.update({ message: 'Updated feedback' }),
    ).rejects.toMatchObject({
      status: 409,
      message:
        '该作品已有相同类型、严重程度和正文的教师反馈，请核对后修改本条反馈。',
    });
  });
});

describe('Classroom submission attempt allocation (no database)', () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  const duplicate = (
    keyPattern: Record<string, number> = {
      classroomTaskId: 1,
      studentId: 1,
      attemptNo: 1,
    },
  ) => new mongo.MongoServerError({ code: 11000, keyPattern });

  const setup = (options: Parameters<typeof createHarness>[0] = {}) => {
    const h = createHarness(options);
    h.submissionModel.create.mockImplementation(([payload]) =>
      Promise.resolve([{ ...payload, _id: objectId() }]),
    );
    const submit = () =>
      h.service.createSubmissionForClassroomTask(
        h.ids.taskId.toString(),
        h.ids.classroomTaskId.toString(),
        submissionDto,
        h.ids.studentId.toString(),
      );
    return { ...h, submit };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => jest.useRealTimers());

  it('allows the exact cooldown boundary and stores the same round time and lateness', async () => {
    const h = setup({ dueAt: new Date(now.getTime() - 1900) });
    jest.setSystemTime(now.getTime() - 1);
    const maxAttempt = makeQuery({ attemptNo: 4 });
    const recentSubmission = makeQuery({
      submittedAt: new Date(now.getTime() - 300000),
    });
    recentSubmission.exec.mockImplementationOnce(() => {
      jest.setSystemTime(now);
      return Promise.resolve({ submittedAt: new Date(now.getTime() - 300000) });
    });
    h.submissionModel.findOne
      .mockReturnValueOnce(maxAttempt)
      .mockReturnValueOnce(recentSubmission);

    await expect(h.submit()).resolves.toMatchObject({ attemptNo: 5 });
    expect(maxAttempt.read).toHaveBeenCalledWith('primary');
    expect(recentSubmission.read).toHaveBeenCalledWith('primary');
    expect(maxAttempt.sort).toHaveBeenCalledWith({ attemptNo: -1 });
    expect(recentSubmission.sort).toHaveBeenCalledWith({
      submittedAt: -1,
      _id: -1,
    });
    expect(maxAttempt.exec.mock.invocationCallOrder[0]).toBeLessThan(
      recentSubmission.exec.mock.invocationCallOrder[0],
    );
    expect(h.submissionModel.create.mock.calls[0][0][0]).toMatchObject({
      attemptNo: 5,
      submittedAt: now,
      isLate: true,
      lateBySeconds: 1,
      contentRevision: 0,
    });
  });

  it('rechecks the newest time after a target collision and caps future timestamps at the full window', async () => {
    const h = setup({ submissionCooldownMs: 1501 });
    h.submissionModel.findOne
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(
        makeQuery({
          attemptNo: 7,
          submittedAt: new Date(now.getTime() - 5000),
        }),
      )
      .mockReturnValueOnce(
        makeQuery({ submittedAt: new Date(now.getTime() + 10) }),
      );
    h.submissionModel.create.mockRejectedValueOnce(duplicate());

    await expect(h.submit()).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'SUBMISSION_COOLDOWN_ACTIVE',
        cooldownMs: 1501,
        cooldownSeconds: 2,
        retryAfterMs: 1501,
        retryAfterSeconds: 2,
        message:
          '提交过于频繁。当前设置的提交冷却时间为 2 秒，请约 2 秒后再试。',
      },
    });
    expect(h.submissionModel.findOne).toHaveBeenCalledTimes(4);
    expect(h.submissionModel.create).toHaveBeenCalledTimes(1);
  });

  it('reallocates an attempt and refreshes the recorded time after a collision with cooldown disabled', async () => {
    const h = setup({ submissionCooldownMs: 0 });
    const firstRead = makeQuery(null);
    const retryRead = makeQuery({ attemptNo: 1 });
    h.submissionModel.findOne
      .mockReturnValueOnce(firstRead)
      .mockReturnValueOnce(retryRead);
    const nextTime = new Date(now.getTime() + 1000);
    h.submissionModel.create.mockImplementationOnce(() => {
      jest.setSystemTime(nextTime);
      return Promise.reject(duplicate());
    });

    await expect(h.submit()).resolves.toMatchObject({ attemptNo: 2 });
    expect(h.transactionConnection.startSession).toHaveBeenCalledTimes(2);
    expect(h.submissionModel.findOne).toHaveBeenCalledTimes(2);
    const [[, firstOptions], [[retryPayload], retryOptions]] =
      h.submissionModel.create.mock.calls;
    expect(retryOptions.session).not.toBe(firstOptions.session);
    expect(firstRead.session).toHaveBeenCalledWith(firstOptions.session);
    expect(retryRead.session).toHaveBeenCalledWith(retryOptions.session);
    expect(retryPayload).toMatchObject({ attemptNo: 2, submittedAt: nextTime });
    expect(
      h.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('prefers the established late-submission error even when a retry also hits cooldown', async () => {
    const h = setup({ dueAt: now, allowLate: false });
    h.submissionModel.findOne
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(makeQuery({ attemptNo: 1 }))
      .mockReturnValueOnce(makeQuery({ submittedAt: now }));
    h.submissionModel.create.mockImplementationOnce(() => {
      jest.setSystemTime(now.getTime() + 1);
      return Promise.reject(duplicate());
    });

    await expect(h.submit()).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'LATE_SUBMISSION_NOT_ALLOWED',
        message: 'Late submission is not allowed for this classroom task',
      },
    });
    expect(h.submissionModel.create).toHaveBeenCalledTimes(1);
  });

  it('stops after three confirmed collisions and returns a plain conflict when cooldown is disabled', async () => {
    const h = setup({ submissionCooldownMs: 0 });
    h.submissionModel.create.mockRejectedValue(duplicate());

    await expect(h.submit()).rejects.toMatchObject({
      status: 409,
      message: '提交编号分配冲突，请刷新提交记录后重试。',
    });
    expect(h.submissionModel.create).toHaveBeenCalledTimes(3);
    expect(h.submissionModel.findOne).toHaveBeenCalledTimes(3);
  });

  it('checks cooldown once more after the third collision without attempting a fourth insert', async () => {
    const h = setup({ submissionCooldownMs: 2100 });
    h.submissionModel.create.mockRejectedValue(duplicate());
    for (let index = 0; index < 6; index += 1) {
      h.submissionModel.findOne.mockReturnValueOnce(makeQuery(null));
    }
    h.submissionModel.findOne.mockReturnValueOnce(
      makeQuery({ submittedAt: new Date(now.getTime() - 1100) }),
    );

    await expect(h.submit()).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'SUBMISSION_COOLDOWN_ACTIVE',
        cooldownMs: 2100,
        cooldownSeconds: 3,
        retryAfterMs: 1000,
        retryAfterSeconds: 1,
      },
    });
    expect(h.submissionModel.create).toHaveBeenCalledTimes(3);
    expect(h.submissionModel.findOne).toHaveBeenCalledTimes(7);
  });

  it.each([
    ['unrelated uniqueness error', duplicate({ _id: 1 })],
    [
      'wrong key order',
      duplicate({ attemptNo: 1, studentId: 1, classroomTaskId: 1 }),
    ],
    ['unknown write result', new Error('connection lost during insert')],
  ] as const)('propagates a %s without retrying', async (_name, error) => {
    const h = setup();
    h.submissionModel.create.mockRejectedValueOnce(error);

    await expect(h.submit()).rejects.toBe(error);
    expect(h.submissionModel.create).toHaveBeenCalledTimes(1);
  });

  it('propagates an unknown commit outcome without replaying the insert', async () => {
    const h = setup();
    const error = duplicate();
    error.addErrorLabel('UnknownTransactionCommitResult');
    const session = makeSubmissionTestSession();
    session.commitTransaction.mockRejectedValue(error);
    h.transactionConnection.startSession.mockResolvedValueOnce(session);

    await expect(h.submit()).rejects.toBe(error);
    expect(h.transactionConnection.startSession).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(2);
    expect(h.submissionModel.create).toHaveBeenCalledTimes(1);
    expect(h.aiFeedbackJobService.getReviewJob).not.toHaveBeenCalled();
  });

  it('does not reinsert after an editing read fails following a successful insert', async () => {
    const h = setup();
    const error = duplicate();
    h.aiFeedbackJobService.getReviewJob.mockRejectedValueOnce(error);

    await expect(h.submit()).rejects.toBe(error);
    expect(h.submissionModel.create).toHaveBeenCalledTimes(1);
  });

  it('does not start inserting when a required read finishes after the transaction budget', async () => {
    const h = setup();
    const cooldown = makeQuery(null);
    cooldown.exec.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 10_001)),
    );
    h.submissionModel.findOne
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(cooldown);

    const submission = h.submit();
    const rejection = expect(submission).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await jest.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(h.submissionModel.create).not.toHaveBeenCalled();
    expect(h.transactionConnection.startSession).toHaveBeenCalledTimes(1);
  });
});
