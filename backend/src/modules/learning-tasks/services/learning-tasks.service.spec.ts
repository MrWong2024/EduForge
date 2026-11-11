import { AiContextReaderService } from '../ai-context/ai-context-reader.service';
import { Enrollment } from '../../classrooms/enrollments/schemas/enrollment.schema';
import { ConfigService } from '@nestjs/config';
import { Model, Mongoose, Schema, Types } from 'mongoose';
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
import { UpdateFeedbackDto } from '../dto/update-feedback.dto';
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
  TASK_VISIBILITY_PRIVATE,
  TASK_VISIBILITY_SHARED,
} from '../task-template-visibility.constants';
import { LearningTasksService } from './learning-tasks.service';

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

const submissionDto: CreateSubmissionDto = {
  content: {
    codeText: 'console.log("ok");',
    language: 'javascript',
  },
};

const createHarness = (
  options: {
    classroomStatus?: ClassroomStatus;
    classroomTaskStatus?: string;
    taskStatus?: TaskStatus;
    submissionStudentId?: Types.ObjectId;
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
    title: 'Current template title',
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
    settings: {},
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
  const configService = { get: jest.fn() };
  const taskModel = { findById: jest.fn(() => makeQuery(task)) };
  const submissionModel = {
    findById: jest.fn(() => makeQuery(submission)),
    findOne: jest.fn<ReturnType<typeof makeQuery>, [Record<string, unknown>]>(
      () => makeQuery(null),
    ),
    create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
    findOneAndUpdate: jest.fn(() =>
      makeQuery({ ...submission, reviewStartedAt: new Date() }),
    ),
  };
  const feedbackModel = {
    exists: jest.fn().mockResolvedValue(null),
    findById: jest.fn(() => makeQuery(null)),
    find: jest.fn(() => makeQuery([])),
    create: jest.fn((payload: Record<string, unknown>) =>
      Promise.resolve({ _id: objectId(), ...payload }),
    ),
  };
  const classroomTaskModel = {
    findById: jest.fn(() => makeQuery(classroomTask)),
    exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
  };
  const classroomModel = {
    findById: jest.fn(() => makeQuery(classroom)),
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
  );

  return {
    service,
    taskModel,
    submissionModel,
    aiFeedbackJobService,
    enrollmentModel,
    classroomTaskModel,
    classroomModel,
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

const createTaskManagementHarness = (
  options: {
    taskStatus?: TaskStatus;
    createdBy?: Types.ObjectId;
    findByIdResult?: unknown;
    findOneResult?: unknown;
  } = {},
) => {
  const teacherId = objectId();
  const taskId = objectId();
  const storedTask = {
    _id: taskId,
    title: 'Task',
    description: 'Description',
    knowledgeModule: 'Module',
    visibility: TASK_VISIBILITY_PRIVATE,
    status: options.taskStatus ?? TaskStatus.Archived,
    createdBy: options.createdBy ?? teacherId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
  const task = {
    ...storedTask,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const findByIdResult =
    'findByIdResult' in options ? options.findByIdResult : storedTask;
  const findOneResult =
    'findOneResult' in options ? options.findOneResult : storedTask;
  const findByIdQuery = makeQuery(findByIdResult);
  const findOneQuery = makeQuery(findOneResult);
  const findQuery = makeQuery([]);
  const taskModel = {
    create: jest.fn((payload: Record<string, unknown>) => ({
      _id: taskId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      ...payload,
    })),
    findById: jest.fn(() => findByIdQuery),
    findOne: jest.fn(() => findOneQuery),
    find: jest.fn<ReturnType<typeof makeQuery>, [Record<string, unknown>]>(
      () => findQuery,
    ),
    countDocuments: jest
      .fn<Promise<number>, [Record<string, unknown>]>()
      .mockResolvedValue(0),
    hydrate: jest.fn((raw: typeof storedTask) => Object.assign(task, raw)),
  };
  const classroomTaskModel = {};
  const userModel = { find: jest.fn(() => makeQuery([])) };
  const aiContextReader = new AiContextReaderService();
  const validateForSave = jest.spyOn(aiContextReader, 'validateForSave');
  const service = new LearningTasksService(
    { get: jest.fn() } as unknown as ConfigService,
    taskModel as unknown as Model<Task>,
    {} as unknown as Model<Submission>,
    {} as unknown as Model<Feedback>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    {} as unknown as Model<Classroom>,
    userModel as unknown as Model<User>,
    {} as unknown as AiFeedbackJobService,
    {} as Model<Enrollment>,
    aiContextReader,
  );

  return {
    service,
    taskModel,
    task,
    storedTask,
    findByIdQuery,
    findOneQuery,
    findQuery,
    userModel,
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
      visibility: TASK_VISIBILITY_PRIVATE,
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
        visibility: TASK_VISIBILITY_PRIVATE,
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
    expect(harness.taskModel.hydrate).toHaveBeenCalledWith(harness.storedTask);
    expect(harness.taskModel.hydrate.mock.calls[0]?.[0]).toBe(
      harness.storedTask,
    );
    expect(harness.storedTask.title).toBe('Task');
    expect(harness.task.save).toHaveBeenCalledTimes(1);
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
    expect(harness.taskModel.hydrate.mock.calls[0]?.[0]).toBe(
      harness.storedTask,
    );
    expect(harness.findOneQuery.lean).toHaveBeenCalledTimes(1);
    expect(harness.findOneQuery.exec).toHaveBeenCalledTimes(1);
    expect(harness.task.save).toHaveBeenCalledTimes(1);
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
    expect(harness.taskModel.hydrate.mock.calls[0]?.[0]).toBe(
      harness.storedTask,
    );
    expect(harness.findByIdQuery.lean).toHaveBeenCalledTimes(1);
    expect(harness.findByIdQuery.exec).toHaveBeenCalledTimes(1);
    expect(harness.task.save).toHaveBeenCalledTimes(1);
  });

  it('rejects archiving DRAFT task templates', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });

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
    expect(harness.task.save).toHaveBeenCalledTimes(1);
  });
});

describe('LearningTasksService stored task visibility', () => {
  const invalidVisibilityCases: Array<{ label: string; value?: unknown }> = [
    { label: 'missing' },
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'empty string', value: '' },
    { label: 'whitespace', value: ' \t' },
    { label: 'unknown', value: 'UNKNOWN' },
    { label: 'lowercase shared', value: 'shared' },
    { label: 'lowercase private', value: 'private' },
    { label: 'padded shared', value: ' SHARED ' },
    { label: 'padded private', value: ' PRIVATE ' },
    { label: 'shared array', value: ['SHARED'] },
    { label: 'private array', value: ['PRIVATE'] },
    { label: 'empty array', value: [] },
    { label: 'object', value: { visibility: 'SHARED' } },
    { label: 'number', value: 1 },
    { label: 'boolean', value: true },
  ];

  it.each(['PRIVATE', 'SHARED'] as const)(
    'returns exact stored %s to its author without a visibility default',
    async (visibility) => {
      const harness = createTaskManagementHarness();
      harness.storedTask.visibility = visibility;

      await expect(
        harness.service.getTask(
          harness.ids.taskId.toString(),
          harness.ids.teacherId.toString(),
        ),
      ).resolves.toMatchObject({ visibility });
      expect(harness.taskModel.hydrate).not.toHaveBeenCalled();
      expect(harness.task.save).not.toHaveBeenCalled();
    },
  );

  it.each(invalidVisibilityCases)(
    'rejects stored $label for authors and hides it from non-authors',
    async (testCase) => {
      const harness = createTaskManagementHarness();
      if ('value' in testCase) {
        Reflect.set(harness.storedTask, 'visibility', testCase.value);
      } else {
        Reflect.deleteProperty(harness.storedTask, 'visibility');
      }
      expect(Object.hasOwn(harness.storedTask, 'visibility')).toBe(
        'value' in testCase,
      );

      await expect(
        harness.service.getTask(
          harness.ids.taskId.toString(),
          harness.ids.teacherId.toString(),
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Task has invalid visibility',
      });
      await expect(
        harness.service.getTask(
          harness.ids.taskId.toString(),
          objectId().toString(),
        ),
      ).rejects.toMatchObject({ status: 404, message: 'Task not found' });
      expect(harness.userModel.find).not.toHaveBeenCalled();
      expect(harness.taskModel.hydrate).not.toHaveBeenCalled();
      expect(harness.task.save).not.toHaveBeenCalled();
    },
  );

  it('hides a valid PRIVATE task from a non-author', async () => {
    const harness = createTaskManagementHarness();

    await expect(
      harness.service.getTask(
        harness.ids.taskId.toString(),
        objectId().toString(),
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Task not found' });
    expect(harness.userModel.find).not.toHaveBeenCalled();
  });

  it('keeps an already PUBLISHED legal task publish idempotent', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    await expect(
      harness.service.publishTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).resolves.toMatchObject({
      visibility: 'PRIVATE',
      status: TaskStatus.Published,
    });
    expect(harness.taskModel.hydrate.mock.calls[0]?.[0]).toBe(
      harness.storedTask,
    );
    expect(harness.task.save).not.toHaveBeenCalled();
    expect(harness.validateForSave).not.toHaveBeenCalled();
  });

  const invalidWriteCases: Array<{
    label: string;
    action: 'update' | 'publish' | 'archive';
    status: TaskStatus;
    value?: unknown;
  }> = [
    { label: 'missing update', action: 'update', status: TaskStatus.Draft },
    { label: 'missing publish', action: 'publish', status: TaskStatus.Draft },
    {
      label: 'missing idempotent publish',
      action: 'publish',
      status: TaskStatus.Published,
    },
    {
      label: 'missing archive',
      action: 'archive',
      status: TaskStatus.Published,
    },
    {
      label: 'null update',
      action: 'update',
      status: TaskStatus.Published,
      value: null,
    },
    {
      label: 'array publish',
      action: 'publish',
      status: TaskStatus.Draft,
      value: ['SHARED'],
    },
  ];

  it.each(invalidWriteCases)(
    'rejects $label before hydrate, mutation, reference validation or save',
    async (testCase) => {
      const harness = createTaskManagementHarness({
        taskStatus: testCase.status,
      });
      if ('value' in testCase) {
        Reflect.set(harness.storedTask, 'visibility', testCase.value);
      } else {
        Reflect.deleteProperty(harness.storedTask, 'visibility');
      }
      const before = { ...harness.storedTask };
      const id = harness.ids.taskId.toString();
      const teacherId = harness.ids.teacherId.toString();
      const result =
        testCase.action === 'update'
          ? harness.service.updateTask(
              id,
              { title: 'Must not change', visibility: 'SHARED' },
              teacherId,
            )
          : testCase.action === 'publish'
            ? harness.service.publishTask(id, teacherId)
            : harness.service.archiveTask(id, teacherId);

      await expect(result).rejects.toMatchObject({
        status: 409,
        message: 'Task has invalid visibility',
      });
      expect(harness.storedTask).toEqual(before);
      expect(harness.task.title).toBe('Task');
      expect(harness.task.status).toBe(testCase.status);
      expect(harness.taskModel.hydrate).not.toHaveBeenCalled();
      expect(harness.task.save).not.toHaveBeenCalled();
      expect(harness.validateForSave).not.toHaveBeenCalled();
    },
  );

  it.each(['update', 'publish'] as const)(
    'keeps non-author %s on the owner-scoped 404 path before hydration',
    async (action) => {
      const harness = createTaskManagementHarness({ findOneResult: null });
      Reflect.deleteProperty(harness.storedTask, 'visibility');
      const id = harness.ids.taskId.toString();
      const teacherId = harness.ids.teacherId.toString();
      const result =
        action === 'update'
          ? harness.service.updateTask(id, { visibility: 'SHARED' }, teacherId)
          : harness.service.publishTask(id, teacherId);

      await expect(result).rejects.toMatchObject({
        status: 404,
        message: 'Task not found',
      });
      expect(harness.taskModel.findOne).toHaveBeenCalledWith({
        _id: id,
        createdBy: harness.ids.teacherId,
      });
      expect(harness.taskModel.hydrate).not.toHaveBeenCalled();
      expect(harness.task.save).not.toHaveBeenCalled();
    },
  );

  it('keeps non-author archive on the 403 path for missing visibility', async () => {
    const harness = createTaskManagementHarness({ createdBy: objectId() });
    Reflect.deleteProperty(harness.storedTask, 'visibility');

    await expect(
      harness.service.archiveTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Not allowed to archive task',
    });
    expect(harness.taskModel.hydrate).not.toHaveBeenCalled();
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it.each(['mine', 'shared', 'all'] as const)(
    'applies the complete %s filter before pagination and uses it for total',
    async (scope) => {
      const harness = createTaskManagementHarness();
      await harness.service.listTasks(
        {
          scope,
          status: TaskStatus.Published,
          knowledgeModule: 'Module',
          difficulty: 'medium',
          courseLabel: '通用编程',
          page: 2,
          limit: 1,
        },
        harness.ids.teacherId.toString(),
      );

      const baseFilter: Record<string, unknown> = {
        visibility:
          scope === 'shared' ? 'SHARED' : { $in: ['PRIVATE', 'SHARED'] },
        $expr: { $eq: [{ $type: '$visibility' }, 'string'] },
        status: 'PUBLISHED',
        knowledgeModule: 'Module',
        difficulty: 'medium',
        courseLabel: '通用编程',
      };
      if (scope === 'mine') baseFilter.createdBy = harness.ids.teacherId;
      const expectedFilter =
        scope === 'all'
          ? {
              $and: [
                baseFilter,
                {
                  $or: [
                    { createdBy: harness.ids.teacherId },
                    { visibility: 'SHARED' },
                  ],
                },
              ],
            }
          : baseFilter;
      expect(harness.taskModel.find).toHaveBeenCalledWith(expectedFilter);
      expect(harness.taskModel.countDocuments).toHaveBeenCalledWith(
        expectedFilter,
      );
      expect(harness.taskModel.countDocuments.mock.calls[0]?.[0]).toBe(
        harness.taskModel.find.mock.calls[0]?.[0],
      );
      expect(harness.findQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(harness.findQuery.skip).toHaveBeenCalledWith(1);
      expect(harness.findQuery.limit).toHaveBeenCalledWith(1);
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

  it('keeps non-owner AI requests on the existing forbidden path even with an invalid snapshot', async () => {
    const harness = createHarness({ submissionStudentId: objectId() });
    Reflect.set(harness.classroomTask, 'taskSnapshot', {});

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

    harness.submissionModel.create.mockResolvedValue({
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
    });

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
    expect(harness.submissionModel.create.mock.calls[0][0]).not.toHaveProperty(
      'reviewStartedAt',
    );
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });
});

describe('LearningTasksService invalid classroom snapshots (no database)', () => {
  afterEach(() => jest.restoreAllMocks());
  const message = '课堂任务内容快照缺失或无效，请联系教师核对。';

  it.each([
    { name: 'missing', snapshot: undefined },
    {
      name: 'malformed',
      snapshot: {
        title: 'Invalid snapshot title',
        description: 'Invalid snapshot description',
        knowledgeModule: 42,
      },
    },
  ])(
    'keeps saved work and feedback readable for a $name snapshot while rejecting new submissions, edits and AI before writes',
    async ({ snapshot }) => {
      const h = createHarness();
      if (snapshot === undefined) {
        Reflect.deleteProperty(h.classroomTask, 'taskSnapshot');
      } else {
        Reflect.set(h.classroomTask, 'taskSnapshot', snapshot);
      }
      const content = {
        language: 'javascript',
        codeText: 'saved code',
        submissionNote: 'saved note',
      };
      const meta = { aiUsageDeclaration: 'saved declaration' };
      Object.assign(h.submission, { content, meta });
      const submissionBefore = { ...h.submission };
      const feedback = {
        _id: objectId(),
        submissionId: h.ids.submissionId,
        source: FeedbackSource.Teacher,
        message: 'Saved feedback',
      };
      const student = { id: h.ids.studentId.toString(), roles: ['student'] };
      const detail = await h.service.getSubmissionDetail(
        h.ids.submissionId.toString(),
        student,
      );
      expect(detail).toMatchObject({
        taskTitle: null,
        taskSnapshotAvailable: false,
        content,
        meta,
        editing: { canEdit: false, reason: 'SNAPSHOT_MISSING', message },
        aiReview: { canRequest: false, requestBlockReason: message },
      });
      await expect(
        h.service.createSubmissionForClassroomTask(
          h.ids.taskId.toString(),
          h.ids.classroomTaskId.toString(),
          submissionDto,
          student.id,
        ),
      ).rejects.toMatchObject({ status: 409, message });
      await expect(
        h.service.updateSubmission(
          h.ids.submissionId.toString(),
          { expectedRevision: 0, content },
          student,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { reason: 'SNAPSHOT_MISSING', message },
      });
      for (const actor of [
        student,
        { id: h.ids.teacherId.toString(), roles: ['teacher'] },
      ]) {
        await expect(
          h.service.requestAiFeedback(h.ids.submissionId.toString(), actor, {
            expectedRevision: 0,
          }),
        ).rejects.toMatchObject({ status: 409, message });
      }
      h.feedbackModel.exists.mockResolvedValue({ _id: feedback._id });
      h.feedbackModel.find.mockReturnValue(makeQuery([feedback]));
      await expect(
        h.service.listFeedback(h.ids.submissionId.toString(), student),
      ).resolves.toMatchObject([
        { id: feedback._id.toString(), message: 'Saved feedback' },
      ]);
      await expect(
        h.service.getSubmissionDetail(h.ids.submissionId.toString(), student),
      ).resolves.toMatchObject({
        taskTitle: null,
        taskSnapshotAvailable: false,
        content,
        meta,
        editing: { canEdit: false, reason: 'REVIEW_STARTED' },
      });
      expect(h.submission).toEqual(submissionBefore);
      expect(h.submissionModel.create).not.toHaveBeenCalled();
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(h.feedbackModel.create).not.toHaveBeenCalled();
      expect(
        h.aiFeedbackJobService.ensureJobForSubmission,
      ).not.toHaveBeenCalled();
    },
  );

  it('reads a valid snapshot title independently of the current template', async () => {
    const h = createHarness();
    const detail = await h.service.getSubmissionDetail(
      h.ids.submissionId.toString(),
      { id: h.ids.studentId.toString(), roles: ['student'] },
    );
    expect(h.task.title).toBe('Current template title');
    expect(detail.taskTitle).toBe('Published task');
    expect(detail.taskSnapshotAvailable).toBe(true);
  });

  it.each(['INVALID_STATE', 'REVIEW_STARTED'] as const)(
    'keeps %s ahead of the invalid snapshot editing branch',
    async (reason) => {
      const h = createHarness();
      Reflect.set(h.classroomTask, 'taskSnapshot', {});
      if (reason === 'INVALID_STATE') {
        Reflect.deleteProperty(h.submission, 'contentRevision');
      } else {
        Object.assign(h.submission, { reviewStartedAt: new Date() });
      }
      const before = { ...h.submission };
      await expect(
        h.service.updateSubmission(
          h.ids.submissionId.toString(),
          { expectedRevision: 0, content: submissionDto.content },
          { id: h.ids.studentId.toString(), roles: ['student'] },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SUBMISSION_' + reason },
      });
      expect(h.submission).toEqual(before);
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(
        h.aiFeedbackJobService.ensureJobForSubmission,
      ).not.toHaveBeenCalled();
    },
  );

  it('does not add a snapshot gate to teacher feedback creation', async () => {
    const h = createHarness();
    Reflect.set(h.classroomTask, 'taskSnapshot', []);
    const result = await h.service.createFeedback(
      h.ids.submissionId.toString(),
      {
        expectedRevision: 0,
        source: FeedbackSource.Teacher,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Info,
        message: 'Teacher review remains allowed',
      },
      h.ids.teacherId.toString(),
    );
    expect(result.message).toBe('Teacher review remains allowed');
    expect(h.submissionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.feedbackModel.create).toHaveBeenCalledTimes(1);
    expect(
      h.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });
});

describe('LearningTasksService teacher feedback update authorship', () => {
  const update: UpdateFeedbackDto = {
    type: FeedbackType.Design,
    severity: FeedbackSeverity.Warn,
    message: 'Updated teacher feedback',
    suggestion: 'Extract a focused function',
    tags: ['readability', 'style'],
    scoreHint: 88,
  };
  const createFeedbackHarness = () => {
    const h = createHarness();
    Object.assign(h.submission, {
      contentRevision: 2,
      reviewStartedAt: new Date('2026-01-03T00:00:00.000Z'),
      lastEditedAt: new Date('2026-01-02T00:00:00.000Z'),
      lastEditIsLate: false,
    });
    const feedback = {
      _id: objectId(),
      submissionId: h.ids.submissionId,
      createdBy: h.ids.teacherId,
      source: FeedbackSource.Teacher,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Info,
      message: 'Original teacher feedback',
      suggestion: 'Original suggestion',
      tags: ['naming'],
      scoreHint: 60,
      createdAt: new Date('2026-01-03T00:01:00.000Z'),
      updatedAt: new Date('2026-01-03T00:01:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const feedbackQuery = makeQuery(feedback);
    h.feedbackModel.findById.mockReturnValue(feedbackQuery);
    return { ...h, feedback, feedbackQuery };
  };

  it('updates all writable fields for the classroom owner and author without rewriting authorship or creation time', async () => {
    const h = createFeedbackHarness();
    const createdBy = h.feedback.createdBy;
    const createdAt = h.feedback.createdAt;
    const submissionBefore = { ...h.submission };
    Reflect.deleteProperty(h.classroomTask, 'taskSnapshot');

    const result = await h.service.updateFeedback(
      h.ids.submissionId.toString(),
      h.feedback._id.toString(),
      update,
      h.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: h.feedback._id.toString(),
      submissionId: h.ids.submissionId.toString(),
      createdBy: h.ids.teacherId.toString(),
      source: 'TEACHER',
      type: 'DESIGN',
      severity: 'WARN',
      message: 'Updated teacher feedback',
      suggestion: 'Extract a focused function',
      tags: ['readability', 'style'],
      scoreHint: 88,
      createdAt,
    });
    expect(h.feedback.createdBy).toBe(createdBy);
    expect(h.feedback.createdAt).toBe(createdAt);
    expect(h.feedback.save).toHaveBeenCalledTimes(1);
    expect(h.feedbackQuery.lean).not.toHaveBeenCalled();
    expect(h.submission).toEqual(submissionBefore);
    expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(h.submissionModel.create).not.toHaveBeenCalled();
    expect(
      h.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
  });

  it.each(['missing', 'null', 'other author'] as const)(
    'rejects %s before feedback assignment or save without changing submission facts',
    async (kind) => {
      const h = createFeedbackHarness();
      if (kind === 'missing') {
        Reflect.deleteProperty(h.feedback, 'createdBy');
      } else {
        Reflect.set(
          h.feedback,
          'createdBy',
          kind === 'null' ? null : objectId(),
        );
      }
      expect(Object.hasOwn(h.feedback, 'createdBy')).toBe(kind !== 'missing');
      const feedbackBefore = { ...h.feedback };
      const submissionBefore = { ...h.submission };

      await expect(
        h.service.updateFeedback(
          h.ids.submissionId.toString(),
          h.feedback._id.toString(),
          update,
          h.ids.teacherId.toString(),
        ),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Not allowed to update feedback',
      });
      expect(h.feedback).toEqual(feedbackBefore);
      expect(Object.hasOwn(h.feedback, 'createdBy')).toBe(kind !== 'missing');
      expect(h.feedback.save).not.toHaveBeenCalled();
      expect(h.submission).toEqual(submissionBefore);
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(h.submissionModel.create).not.toHaveBeenCalled();
      expect(
        h.aiFeedbackJobService.ensureJobForSubmission,
      ).not.toHaveBeenCalled();
    },
  );

  it('keeps a feedback belonging to another submission on the 404 path before classroom or author checks', async () => {
    const h = createFeedbackHarness();
    h.feedback.submissionId = objectId();
    Reflect.deleteProperty(h.feedback, 'createdBy');
    const before = { ...h.feedback };

    await expect(
      h.service.updateFeedback(
        h.ids.submissionId.toString(),
        h.feedback._id.toString(),
        update,
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Feedback not found' });
    expect(h.taskModel.findById).not.toHaveBeenCalled();
    expect(h.classroomTaskModel.findById).not.toHaveBeenCalled();
    expect(h.classroomModel.findById).not.toHaveBeenCalled();
    expect(h.feedback).toEqual(before);
    expect(h.feedback.save).not.toHaveBeenCalled();
    expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('preserves the dedicated AI source rejection when a feedback has no teacher author', async () => {
    const h = createFeedbackHarness();
    h.feedback.source = FeedbackSource.AI;
    Reflect.deleteProperty(h.feedback, 'createdBy');
    const before = { ...h.feedback };

    await expect(
      h.service.updateFeedback(
        h.ids.submissionId.toString(),
        h.feedback._id.toString(),
        update,
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Only teacher feedback can be updated',
    });
    expect(h.feedback).toEqual(before);
    expect(h.feedback.save).not.toHaveBeenCalled();
    expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('checks classroom management before feedback source or author eligibility', async () => {
    const h = createFeedbackHarness();
    h.classroom.teacherId = objectId();
    h.feedback.source = FeedbackSource.AI;
    const readAuthor = jest.fn(() => undefined);
    Object.defineProperty(h.feedback, 'createdBy', { get: readAuthor });

    await expect(
      h.service.updateFeedback(
        h.ids.submissionId.toString(),
        h.feedback._id.toString(),
        update,
        h.ids.teacherId.toString(),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Not allowed to update feedback',
    });
    expect(readAuthor).not.toHaveBeenCalled();
    expect(h.feedback.message).toBe('Original teacher feedback');
    expect(h.feedback.save).not.toHaveBeenCalled();
    expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('AI review detail eligibility (no database)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', '0'],
    ['array', [0]],
    ['negative', -1],
    ['fractional', 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])(
    'projects a %s revision as unknown and blocks editing',
    async (_label, revision) => {
      const h = createHarness();
      if (revision === undefined) {
        Reflect.deleteProperty(h.submission, 'contentRevision');
      } else {
        Object.assign(h.submission, { contentRevision: revision });
      }
      const student = { id: h.ids.studentId.toString(), roles: ['student'] };

      const detail = await h.service.getSubmissionDetail(
        h.ids.submissionId.toString(),
        student,
      );
      expect(detail).toMatchObject({
        contentRevision: null,
        editing: { canEdit: false, reason: 'INVALID_STATE' },
        aiReview: { canRequest: true },
      });
      await expect(
        h.service.requestAiFeedback(h.ids.submissionId.toString(), student, {
          expectedRevision: 0,
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SUBMISSION_INVALID_STATE' },
      });
      expect(h.submissionModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(
        h.aiFeedbackJobService.ensureJobForSubmission,
      ).not.toHaveBeenCalled();
    },
  );

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
      contentRevision: 0,
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

  it('requires a persisted content revision in offline Schema validation', () => {
    const schema = SubmissionSchema.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    const model = new Mongoose().model<Submission>('OfflineSubmission', schema);
    const fields = {
      taskId: objectId(),
      classroomTaskId: objectId(),
      studentId: objectId(),
      attemptNo: 1,
      content: submissionDto.content,
      status: SubmissionStatus.Submitted,
    };

    const missing = new model(fields);
    expect(missing.contentRevision).toBeUndefined();
    expect(missing.validateSync()?.errors.contentRevision).toMatchObject({
      kind: 'required',
    });
    expect(
      new model({ ...fields, contentRevision: null }).validateSync()?.errors
        .contentRevision,
    ).toMatchObject({ kind: 'required' });
    expect(
      new model({ ...fields, contentRevision: 0 }).validateSync(),
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
    h.submissionModel.create.mockImplementation((payload) =>
      Promise.resolve({ ...payload, _id: objectId() }),
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
    expect(h.submissionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomTaskId: h.ids.classroomTaskId,
        attemptNo: 1,
        contentRevision: 0,
      }),
    );
  });
});
