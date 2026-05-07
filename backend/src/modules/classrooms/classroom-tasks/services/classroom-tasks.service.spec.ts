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
import {
  CLASSROOM_TASK_STATUS_ACTIVE,
  CLASSROOM_TASK_STATUS_CLOSED,
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
};

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

const createHarness = (options: HarnessOptions = {}) => {
  const studentId = options.submissions?.[0]?.studentId ?? objectId();
  const classroomId = objectId();
  const classroomTaskId =
    options.submissions?.[0]?.classroomTaskId ?? objectId();
  const taskId = options.submissions?.[0]?.taskId ?? objectId();
  const submissions = options.submissions ?? [];
  const feedbacks = options.feedbacks ?? [];

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
  };
  const courseModel = {};
  const classroomTaskModel = {
    findOne: jest.fn(() => makeQuery(classroomTask)),
  };
  const taskModel = {
    findById: jest.fn(() => makeQuery(task)),
  };
  const submissionModel = {
    find: jest.fn(() => makeQuery(submissions)),
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
    findById: jest.fn(() => makeQuery({ roles: ['student'] })),
  };
  const enrollmentService = {
    isStudentActiveInClassroom: jest
      .fn()
      .mockResolvedValue(options.isMember ?? true),
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

  it('rejects submissions when the task template is not published', async () => {
    const harness = createHarness({ taskStatus: TaskStatus.Draft });

    await expect(
      harness.service.createClassroomTaskSubmission(
        harness.ids.classroomId.toString(),
        harness.ids.classroomTaskId.toString(),
        submissionDto,
        harness.ids.studentId.toString(),
      ),
    ).rejects.toThrow('任务未发布，不能继续提交。');
    expect(
      harness.learningTasksService.createSubmissionForClassroomTask,
    ).not.toHaveBeenCalled();
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
