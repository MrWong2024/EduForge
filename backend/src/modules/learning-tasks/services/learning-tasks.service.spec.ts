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
import { LearningTasksService } from './learning-tasks.service';

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
  const taskModel = {
    findById: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(findByIdResult),
    })),
    findOne: jest.fn().mockResolvedValue(task),
  };
  const service = new LearningTasksService(
    { get: jest.fn() } as unknown as ConfigService,
    taskModel as unknown as Model<Task>,
    {} as unknown as Model<Submission>,
    {} as unknown as Model<Feedback>,
    {} as unknown as Model<ClassroomTask>,
    {} as unknown as Model<Classroom>,
    {} as unknown as Model<User>,
    {} as unknown as AiFeedbackJobService,
  );

  return { service, taskModel, task, ids: { teacherId, taskId } };
};

describe('LearningTasksService task template restore', () => {
  it('restores an archived task owned by the teacher to DRAFT', async () => {
    const harness = createTaskManagementHarness();

    const result = await harness.service.restoreTask(
      harness.ids.taskId.toString(),
      harness.ids.teacherId.toString(),
    );

    expect(result).toMatchObject({
      id: harness.ids.taskId.toString(),
      status: TaskStatus.Draft,
      createdBy: harness.ids.teacherId.toString(),
    });
    expect(harness.task.status).toBe(TaskStatus.Draft);
    expect(harness.task.save).toHaveBeenCalledTimes(1);
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

  it('rejects restoring a DRAFT task without saving', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Draft,
    });

    await expect(
      harness.service.restoreTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Only archived tasks can be restored');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

  it('rejects restoring a PUBLISHED task without saving', async () => {
    const harness = createTaskManagementHarness({
      taskStatus: TaskStatus.Published,
    });

    await expect(
      harness.service.restoreTask(
        harness.ids.taskId.toString(),
        harness.ids.teacherId.toString(),
      ),
    ).rejects.toThrow('Only archived tasks can be restored');
    expect(harness.task.save).not.toHaveBeenCalled();
  });

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

  it('rejects student AI requests when the task template is not published without creating a job', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Draft });

    await expect(
      harness.service.requestAiFeedback(
        harness.ids.submissionId.toString(),
        { id: harness.ids.studentId.toString(), roles: [USER_ROLE_STUDENT] },
        {},
      ),
    ).rejects.toThrow('任务未发布，不能请求 AI 反馈。');
    expect(
      harness.aiFeedbackJobService.ensureJobForSubmission,
    ).not.toHaveBeenCalled();
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

  it('rejects classroom submissions for unpublished task templates before creating submission or AI job', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Draft });

    await expect(
      harness.service.createSubmissionForClassroomTask(
        harness.ids.taskId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('任务未发布，不能继续提交。');
    expect(harness.submissionModel.create).not.toHaveBeenCalled();
    expect(harness.aiFeedbackJobService.enqueue).not.toHaveBeenCalled();
  });
});
