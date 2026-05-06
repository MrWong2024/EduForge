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
};

type SubmissionFixture = {
  _id: Types.ObjectId;
  classroomTaskId: Types.ObjectId;
  studentId: Types.ObjectId;
  isLate?: boolean;
};

type AiJobFixture = {
  classroomTaskId: Types.ObjectId;
  status: AiFeedbackJobStatus;
};

type FeedbackFixture = {
  classroomTaskId: Types.ObjectId;
  tags: string[];
};

type HarnessData = {
  classroomTasks?: ClassroomTaskFixture[];
  submissions?: SubmissionFixture[];
  aiJobs?: AiJobFixture[];
  feedbacks?: FeedbackFixture[];
};

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.lean.mockReturnValue(chain);
  return chain;
};

const makeAggregate = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

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
    status: 'ACTIVE',
    joinCode: 'JOIN01',
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
  const submissions = data.submissions ?? [];
  const aiJobs = data.aiJobs ?? [];
  const feedbacks = data.feedbacks ?? [];

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
        classroomTaskStatus: task.status ?? '',
        publishedAt: task.publishedAt,
        dueAt: task.dueAt,
        title: task.title,
        stage: task.stage,
        knowledgeModule: task.knowledgeModule,
      }));
  };

  const getSubmissionStats = (pipeline: unknown[]) => {
    const match = getPipelineMatch(pipeline);
    const classroomTaskIds = toIdSet(
      (match.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
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
    const classroomTaskIds = toIdSet(
      (match.classroomTaskId as { $in?: Types.ObjectId[] })?.$in ?? [],
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
    const submissionMatchStage = pipeline.find((stage) => {
      const match = (stage as { $match?: Record<string, unknown> }).$match;
      return Boolean(match?.['submission.classroomTaskId']);
    }) as { $match?: Record<string, { $in?: Types.ObjectId[] }> } | undefined;
    const classroomTaskIds = toIdSet(
      submissionMatchStage?.$match?.['submission.classroomTaskId']?.$in ?? [],
    );
    const grouped = new Map<
      string,
      { _id: Types.ObjectId; tags: { tag: string; count: number }[] }
    >();
    for (const feedback of feedbacks) {
      const taskKey = feedback.classroomTaskId.toString();
      if (!classroomTaskIds.has(taskKey)) {
        continue;
      }
      const current = grouped.get(taskKey) ?? {
        _id: feedback.classroomTaskId,
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
    aggregate: jest.fn((pipeline: unknown[]) =>
      makeAggregate(filterClassroomTasks(pipeline)),
    ),
  };
  const submissionModel = {
    aggregate: jest.fn((pipeline: unknown[]) =>
      makeAggregate(getSubmissionStats(pipeline)),
    ),
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
  const enrollmentService = {
    countStudents: jest.fn().mockResolvedValue(5),
  };

  const service = new TeacherClassroomDashboardService(
    classroomModel as unknown as Model<Classroom>,
    classroomTaskModel as unknown as Model<ClassroomTask>,
    submissionModel as unknown as Model<Submission>,
    feedbackModel as unknown as Model<Feedback>,
    aiFeedbackJobModel as unknown as Model<AiFeedbackJob>,
    enrollmentService as unknown as EnrollmentService,
  );

  return {
    service,
    classroomModel,
    classroomTaskModel,
    submissionModel,
    feedbackModel,
    ids: { classroomId, teacherId },
  };
};

describe('TeacherClassroomDashboardService', () => {
  it('returns only ACTIVE classroomTasks by default', async () => {
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const closeTaskId = objectId();
    const recalledTaskId = objectId();
    const unknownTaskId = objectId();
    const classroomId = objectId();
    const studentId = objectId();
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
          title: 'Historical Close Task',
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
          _id: objectId(),
          classroomTaskId: activeTaskId,
          studentId,
          isLate: true,
        },
        {
          _id: objectId(),
          classroomTaskId: closedTaskId,
          studentId,
          isLate: true,
        },
      ],
      aiJobs: [
        {
          classroomTaskId: activeTaskId,
          status: AiFeedbackJobStatus.Succeeded,
        },
        { classroomTaskId: closedTaskId, status: AiFeedbackJobStatus.Failed },
      ],
      feedbacks: [
        { classroomTaskId: activeTaskId, tags: ['correctness'] },
        { classroomTaskId: closedTaskId, tags: ['bug-risk'] },
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

  it('returns ACTIVE, CLOSED, and CLOSE when includeClosedTasks is true', async () => {
    const classroomId = objectId();
    const activeTaskId = objectId();
    const closedTaskId = objectId();
    const closeTaskId = objectId();
    const recalledTaskId = objectId();
    const unknownTaskId = objectId();
    const studentId = objectId();
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
          title: 'Historical Close Task',
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
        { _id: objectId(), classroomTaskId: activeTaskId, studentId },
        { _id: objectId(), classroomTaskId: closedTaskId, studentId },
        { _id: objectId(), classroomTaskId: closeTaskId, studentId },
      ],
      aiJobs: [
        {
          classroomTaskId: activeTaskId,
          status: AiFeedbackJobStatus.Succeeded,
        },
        { classroomTaskId: closedTaskId, status: AiFeedbackJobStatus.Failed },
        { classroomTaskId: closeTaskId, status: AiFeedbackJobStatus.Dead },
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
      'CLOSE',
    ]);
    expect(dashboard.tasks).toHaveLength(3);
    expect(dashboard.summary.publishedTasksCount).toBe(3);
    expect(dashboard.tasks[1]).toMatchObject({
      classroomTaskId: closedTaskId.toString(),
      classroomTaskStatus: CLASSROOM_TASK_STATUS_CLOSED,
      submissionsCount: 1,
      aiFeedback: { failed: 1, notRequested: 0 },
    });
    expect(dashboard.tasks[2]).toMatchObject({
      classroomTaskId: closeTaskId.toString(),
      classroomTaskStatus: 'CLOSE',
      submissionsCount: 1,
      aiFeedback: { dead: 1, notRequested: 0 },
    });
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
