import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
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
import { Feedback } from '../schemas/feedback.schema';
import { Submission } from '../schemas/submission.schema';
import { Task, TaskStatus } from '../schemas/task.schema';
import {
  TASK_TEMPLATE_SCOPE_ALL,
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
  };
  const task = {
    _id: taskId,
    status: options.taskStatus ?? TaskStatus.Published,
  };
  const classroomTask = {
    _id: classroomTaskId,
    classroomId,
    taskId,
    status: options.classroomTaskStatus ?? CLASSROOM_TASK_STATUS_ACTIVE,
  };
  const classroom = {
    _id: classroomId,
    status: options.classroomStatus ?? ClassroomStatus.Active,
  };

  const configService = { get: jest.fn() };
  const taskModel = { findById: jest.fn(() => makeQuery(task)) };
  const submissionModel = {
    findById: jest.fn(() => makeQuery(submission)),
    findOne: jest.fn(() => makeQuery(null)),
    create: jest.fn(),
  };
  const feedbackModel = {};
  const classroomTaskModel = {
    findById: jest.fn(() => makeQuery(classroomTask)),
    exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
  };
  const classroomModel = {
    findById: jest.fn(() => makeQuery(classroom)),
  };
  const userModel = {};
  const aiFeedbackJobService = {
    enqueue: jest.fn(),
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
  );

  return {
    service,
    taskModel,
    submissionModel,
    aiFeedbackJobService,
    ids: { studentId, classroomId, classroomTaskId, taskId, submissionId },
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
  const task = {
    _id: taskId,
    title: 'Task',
    description: 'Description',
    knowledgeModule: 'Module',
    stage: 1,
    status: options.taskStatus ?? TaskStatus.Archived,
    createdBy: options.createdBy ?? teacherId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const findByIdResult =
    'findByIdResult' in options ? options.findByIdResult : task;
  const findOneResult =
    'findOneResult' in options ? options.findOneResult : task;
  const taskModel = {
    create: jest.fn((payload: Record<string, unknown>) => ({
      _id: taskId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      ...payload,
    })),
    findById: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(findByIdResult),
    })),
    findOne: jest.fn().mockResolvedValue(findOneResult),
  };
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
  );

  return {
    service,
    taskModel,
    task,
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
        stage: 1,
      },
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Draft,
      createdBy: harness.ids.teacherId.toString(),
      publishedAt: undefined,
    });
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
        stage: 1,
        status: TaskStatus.Published,
      },
      harness.ids.teacherId.toString(),
    );

    expect(result.id).toBe(harness.ids.taskId.toString());
    expect(result.status).toBe(TaskStatus.Published);
    expect(result.createdBy).toBe(harness.ids.teacherId.toString());
    expect(result.publishedAt).toBeInstanceOf(Date);
    const createPayload = harness.taskModel.create.mock.calls[0]?.[0] as
      | { status: TaskStatus; publishedAt?: Date }
      | undefined;
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
          stage: 1,
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
    stage: 1,
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
    const taskModel = {
      findById: jest.fn(() => makeQuery(task)),
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
    expect(userModel.find).toHaveBeenCalledTimes(1);
  });
});

describe('LearningTasksService student participation status gates', () => {
  it('allows students to request AI for ACTIVE classroom, ACTIVE classroomTask and PUBLISHED task submissions', async () => {
    const harness = createHarness();

    const result = await harness.service.requestAiFeedback(
      harness.ids.submissionId.toString(),
      { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
      {},
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
        {},
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
        {},
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
      {},
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
        {},
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
    expect(harness.aiFeedbackJobService.enqueue).not.toHaveBeenCalled();
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
    expect(harness.aiFeedbackJobService.enqueue).not.toHaveBeenCalled();
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
    harness.aiFeedbackJobService.enqueue.mockResolvedValue(undefined);

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
  });
});
