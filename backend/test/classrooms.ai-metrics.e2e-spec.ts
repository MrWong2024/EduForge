import {
  assertAuthTestConnection,
  authTestEnvironment,
} from './helpers/auth-test-environment';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackGuardsService } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-guards.service';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const DEFAULT_MAX_PER_MINUTE = '30';

type CreatedCourseResponse = {
  id: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type CreatedTaskResponse = {
  id: string;
};

type CreatedClassroomTaskResponse = {
  id: string;
};

type CreatedSubmissionResponse = {
  id: string;
};

type ProcessOnceResponse = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

type AiMetricsResponse = {
  classroomId: string;
  classroomTaskId: string;
  generatedAt: string;
  window: string;
  summary: {
    jobs: {
      total: number;
      succeeded: number;
      failed: number;
      dead: number;
      pending: number;
      running: number;
    };
    successRate: number;
    avgAttempts: number;
    avgLatencyMs: number | null;
  };
  errors: Array<{ code: string; count: number }>;
  feedback: {
    avgItemsPerSubmission: number;
    totalItems: number;
    topTags: Array<{ tag: string; count: number }>;
  };
};

type WeeklyAiHealthResponse = {
  aiHealth: {
    jobs: AiMetricsResponse['summary']['jobs'];
    rateLimitRatio: number;
    timeoutRatio: number;
    errors: AiMetricsResponse['errors'];
  };
};

describe('Classrooms AI Metrics (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let configService: ConfigService;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let courseId = '';
  let taskId = '';
  let classroomAId = '';
  let classroomBId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  let classroomSyntheticId = '';
  let classroomTaskSyntheticId = '';
  const submissionIds: string[] = [];
  let databaseVerified = false;

  const teacherId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const teacherEmail = `teacher.metrics.${Date.now()}@example.com`;
  const studentEmail = `student.metrics.${Date.now()}@example.com`;
  const syntheticPassword = '12345678';

  const login = async (
    agent: ReturnType<typeof request.agent>,
    email: string,
    password: string,
  ) => {
    await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  };

  const applyMaxPerMinuteFromEnv = () => {
    const raw = process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE;
    const parsed = Number.parseInt(raw ?? DEFAULT_MAX_PER_MINUTE, 10);
    const guards = app.get<AiFeedbackGuardsService>(AiFeedbackGuardsService);
    (guards as unknown as { maxPerMinute: number }).maxPerMinute =
      Number.isFinite(parsed) ? parsed : 30;
  };

  const resetGuardsState = () => {
    const guards = app.get<AiFeedbackGuardsService>(AiFeedbackGuardsService);
    const internals = guards as unknown as {
      usageMap?: Map<string, number[]>;
      queue?: unknown[];
      inFlight?: number;
    };
    internals.usageMap?.clear();
    if (Array.isArray(internals.queue)) {
      internals.queue.length = 0;
    }
    if (typeof internals.inFlight === 'number') {
      internals.inFlight = 0;
    }
  };

  const createSubmissionForClassroomTask = async (
    classroomId: string,
    classroomTaskId: string,
    codeText: string,
  ) => {
    const created = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText,
          language: 'typescript',
        },
      })
      .expect(201);
    const submission = created.body as CreatedSubmissionResponse;
    submissionIds.push(submission.id);
    return submission.id;
  };

  const processOwnedJobs = async (
    batchSize: number,
  ): Promise<ProcessOnceResponse> => {
    const foreignJob = await aiFeedbackJobModel.exists({
      status: {
        $in: [
          AiFeedbackJobStatus.Pending,
          AiFeedbackJobStatus.Failed,
          AiFeedbackJobStatus.Running,
        ],
      },
      submissionId: { $nin: submissionIds.map((id) => new Types.ObjectId(id)) },
    });
    if (foreignJob)
      throw new Error('AI metrics fixture cannot claim foreign jobs');
    return aiFeedbackProcessor.processOnce(batchSize);
  };

  beforeAll(async () => {
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      DEFAULT_MAX_PER_MINUTE;
    process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = '0';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use(cookieParser());
    await app.init();
    configService = app.get(ConfigService);
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

    await assertAuthTestConnection(userModel.db);
    databaseVerified = true;
    expect(configService.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    console.info(
      'AI metrics database gate: standard_test / eduforge_test / local rs0 / root@admin verified',
    );

    const passwordHash = await bcrypt.hash(syntheticPassword, 10);

    await Promise.all([
      userModel.create({
        _id: teacherId,
        email: teacherEmail,
        passwordHash,
        roles: ['teacher'],
      }),
      userModel.create({
        _id: studentId,
        email: studentEmail,
        passwordHash,
        roles: ['student'],
      }),
    ]);

    await login(teacherAgent, teacherEmail, syntheticPassword);
    await login(studentAgent, studentEmail, syntheticPassword);
    applyMaxPerMinuteFromEnv();

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `AI${Date.now()}`,
        name: 'AI Metrics',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const [createdClassroomA, createdClassroomB] = await Promise.all([
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Metrics-A' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Metrics-B' })
        .expect(201),
    ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    classroomAId = classroomABody.id;
    classroomBId = classroomBBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'AI Metrics Task',
        description: 'Collect ai metrics in classroom scope.',
        knowledgeModule: 'ai-metrics',
        status: 'DRAFT',
      })
      .expect(201);
    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const [createdClassroomTaskA, createdClassroomTaskB] = await Promise.all([
      teacherAgent
        .post(`/api/classrooms/${classroomAId}/tasks`)
        .send({ taskId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomBId}/tasks`)
        .send({ taskId })
        .expect(201),
    ]);
    const classroomTaskABody =
      createdClassroomTaskA.body as CreatedClassroomTaskResponse;
    const classroomTaskBBody =
      createdClassroomTaskB.body as CreatedClassroomTaskResponse;
    classroomTaskAId = classroomTaskABody.id;
    classroomTaskBId = classroomTaskBBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBBody.joinCode })
      .expect(201);
  });

  afterEach(() => {
    if (!databaseVerified) return;
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      DEFAULT_MAX_PER_MINUTE;
    applyMaxPerMinuteFromEnv();
    resetGuardsState();
  });

  const cleanupOwnedFixtures = async () => {
    await assertAuthTestConnection(userModel.db);
    const submissionObjectIds = submissionIds.map(
      (id) => new Types.ObjectId(id),
    );
    if (submissionObjectIds.length > 0) {
      await feedbackModel.deleteMany({
        submissionId: { $in: submissionObjectIds },
      });
      await aiFeedbackJobModel.deleteMany({
        submissionId: { $in: submissionObjectIds },
      });
      await submissionModel.deleteMany({ _id: { $in: submissionObjectIds } });
    }
    const classroomTaskIds = [
      classroomTaskAId,
      classroomTaskBId,
      classroomTaskSyntheticId,
    ]
      .filter(Boolean)
      .map((id) => new Types.ObjectId(id));
    if (classroomTaskIds.length > 0) {
      await classroomTaskModel.deleteMany({ _id: { $in: classroomTaskIds } });
    }
    if (taskId) {
      await taskModel.deleteOne({ _id: new Types.ObjectId(taskId) });
    }
    const classroomIds = [classroomAId, classroomBId, classroomSyntheticId]
      .filter(Boolean)
      .map((id) => new Types.ObjectId(id));
    if (classroomIds.length > 0) {
      await app
        .get<Model<Enrollment>>(getModelToken(Enrollment.name))
        .deleteMany({ classroomId: { $in: classroomIds } });
      await classroomModel.deleteMany({ _id: { $in: classroomIds } });
    }
    if (courseId) {
      await courseModel.deleteOne({ _id: new Types.ObjectId(courseId) });
    }
    const userIds = [teacherId, studentId];
    await sessionModel.deleteMany({ userId: { $in: userIds } });
    await userModel.deleteMany({ _id: { $in: userIds } });
  };

  afterAll(async () => {
    try {
      if (databaseVerified) await cleanupOwnedFixtures();
    } finally {
      try {
        await app?.close();
      } finally {
        authTestEnvironment.restore();
      }
    }
  });

  it('returns classroomTask-scoped AI runtime metrics', async () => {
    resetGuardsState();
    const submissionAId = await createSubmissionForClassroomTask(
      classroomAId,
      classroomTaskAId,
      'function alphaMetric() { return "A"; }',
    );
    const submissionBId = await createSubmissionForClassroomTask(
      classroomBId,
      classroomTaskBId,
      'function betaMetric() { return "B"; }',
    );
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionAId}/ai-feedback/request`,
      )
      .send({ expectedRevision: 0 })
      .expect(200);
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionBId}/ai-feedback/request`,
      )
      .send({ expectedRevision: 0 })
      .expect(200);

    const processBody = await processOwnedJobs(10);
    expect(processBody.processed).toBeGreaterThanOrEqual(2);

    const responseA = await teacherAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/ai-metrics`,
      )
      .query({ window: '24h' })
      .expect(200);
    const bodyA = responseA.body as AiMetricsResponse;

    expect(bodyA.classroomId).toBe(classroomAId);
    expect(bodyA.classroomTaskId).toBe(classroomTaskAId);
    expect(bodyA.classroomTaskId).not.toBe(classroomTaskBId);
    expect(bodyA.summary.jobs.total).toBeGreaterThanOrEqual(1);
    expect(bodyA.summary.jobs.succeeded).toBe(1);
    expect(bodyA.summary.avgAttempts).toBe(1);
    expect(bodyA.feedback.totalItems).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(bodyA.errors)).toBe(true);

    const responseB = await teacherAgent
      .get(
        `/api/classrooms/${classroomBId}/tasks/${classroomTaskBId}/ai-metrics`,
      )
      .query({ window: '24h' })
      .expect(200);
    const bodyB = responseB.body as AiMetricsResponse;

    expect(bodyB.classroomTaskId).toBe(classroomTaskBId);
    expect(bodyA.summary.jobs.total).toBe(1);
    expect(bodyB.summary.jobs.total).toBe(1);

    await teacherAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/ai-metrics`,
      )
      .query({ window: 'all' })
      .expect(400);
  });

  it('reports RATE_LIMIT_LOCAL errors when local per-classroomTask throttling triggers', async () => {
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE = '1';
    applyMaxPerMinuteFromEnv();
    resetGuardsState();

    const firstSubmissionId = await createSubmissionForClassroomTask(
      classroomAId,
      classroomTaskAId,
      'function limitedMetricOne() { return "L1"; }',
    );
    const secondSubmissionId = await createSubmissionForClassroomTask(
      classroomAId,
      classroomTaskAId,
      'function limitedMetricTwo() { return "L2"; }',
    );
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${firstSubmissionId}/ai-feedback/request`,
      )
      .send({ expectedRevision: 0 })
      .expect(200);
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionId}/ai-feedback/request`,
      )
      .send({ expectedRevision: 0 })
      .expect(200);

    const firstProcess = await processOwnedJobs(1);
    const secondProcess = await processOwnedJobs(1);
    expect(firstProcess.processed).toBeGreaterThanOrEqual(1);
    expect(secondProcess.processed).toBeGreaterThanOrEqual(1);

    const metrics = await teacherAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/ai-metrics`,
      )
      .query({ window: '24h', includeTags: false })
      .expect(200);
    const metricsBody = metrics.body as AiMetricsResponse;

    const rateLimitLocal = metricsBody.errors.find(
      (item) => item.code === 'RATE_LIMIT_LOCAL',
    );
    expect(rateLimitLocal).toBeDefined();
    expect(rateLimitLocal?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(metricsBody.feedback.topTags).toEqual([]);
  });

  it('counts processing attempts, Worker errors and specific Provider errors through HTTP', async () => {
    const classroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Metrics synthetic jobs' })
      .expect(201);
    const classroomBody = classroom.body as CreatedClassroomResponse;
    classroomSyntheticId = classroomBody.id;
    const classroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomSyntheticId}/tasks`)
      .send({ taskId })
      .expect(201);
    classroomTaskSyntheticId = (
      classroomTask.body as CreatedClassroomTaskResponse
    ).id;
    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const readMetrics = async () => {
      const response = await teacherAgent
        .get(
          `/api/classrooms/${classroomSyntheticId}/tasks/${classroomTaskSyntheticId}/ai-metrics`,
        )
        .query({ window: '24h' })
        .expect(200);
      return response.body as AiMetricsResponse;
    };
    const insertOwnedJob = async (
      status: AiFeedbackJobStatus,
      attempts: number,
      failure?: {
        failureCode: AiFeedbackJob['failureCode'];
        lastError: string | { code: string };
      },
    ) => {
      const submissionId = await createSubmissionForClassroomTask(
        classroomSyntheticId,
        classroomTaskSyntheticId,
        `export const metricsFixture = ${submissionIds.length};`,
      );
      const now = new Date();
      // Direct insert also exercises the legacy structured lastError reader.
      await aiFeedbackJobModel.collection.insertOne({
        submissionId: new Types.ObjectId(submissionId),
        classroomTaskId: new Types.ObjectId(classroomTaskSyntheticId),
        taskId: new Types.ObjectId(taskId),
        studentId,
        status,
        attempts,
        maxAttempts: 3,
        createdAt: now,
        updatedAt: now,
        ...failure,
      });
    };

    const empty = await readMetrics();
    expect(empty.summary.jobs.total).toBe(0);
    expect(empty.summary.avgAttempts).toBe(0);
    await insertOwnedJob(AiFeedbackJobStatus.Pending, 0);
    await insertOwnedJob(AiFeedbackJobStatus.Succeeded, 2);
    const mixed = await readMetrics();
    expect(mixed.summary.jobs).toMatchObject({
      total: 2,
      pending: 1,
      succeeded: 1,
    });
    expect(mixed.summary.avgAttempts).toBe(1);

    const workerCodes = [
      'AI_CONTEXT_UNAVAILABLE',
      'AI_CONTEXT_LIMIT_EXCEEDED',
      'TASK_INELIGIBLE',
      'LEGACY_JOB_UNSUPPORTED',
      'INTERNAL_ERROR',
    ] as const;
    for (const code of workerCodes) {
      await insertOwnedJob(AiFeedbackJobStatus.Dead, 1, {
        failureCode: code,
        lastError: `AI_FEEDBACK: ${code}`,
      });
    }
    await insertOwnedJob(AiFeedbackJobStatus.Dead, 1, {
      failureCode: 'RATE_LIMITED',
      lastError: 'AI_FEEDBACK: RATE_LIMIT_LOCAL',
    });
    await insertOwnedJob(AiFeedbackJobStatus.Dead, 1, {
      failureCode: 'RATE_LIMITED',
      lastError: '{"code":"RATE_LIMIT_UPSTREAM"}',
    });
    await insertOwnedJob(AiFeedbackJobStatus.Dead, 1, {
      failureCode: 'UPSTREAM_UNAVAILABLE',
      lastError: { code: 'TIMEOUT' },
    });

    const metrics = await readMetrics();
    expect(metrics.summary.jobs).toMatchObject({ total: 10, dead: 8 });
    const weekly = await teacherAgent
      .get(`/api/classrooms/${classroomSyntheticId}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    const { aiHealth } = weekly.body as WeeklyAiHealthResponse;
    expect(aiHealth.jobs.total).toBe(10);
    expect(aiHealth.rateLimitRatio).toBe(0.2);
    expect(aiHealth.timeoutRatio).toBe(0.1);

    expect(metrics.errors).toEqual([
      { code: 'AI_CONTEXT_LIMIT_EXCEEDED', count: 1 },
      { code: 'AI_CONTEXT_UNAVAILABLE', count: 1 },
      { code: 'INTERNAL_ERROR', count: 1 },
      { code: 'LEGACY_JOB_UNSUPPORTED', count: 1 },
      { code: 'RATE_LIMIT_LOCAL', count: 1 },
      { code: 'RATE_LIMIT_UPSTREAM', count: 1 },
      { code: 'TASK_INELIGIBLE', count: 1 },
      { code: 'TIMEOUT', count: 1 },
    ]);
    expect(aiHealth.errors).toEqual(metrics.errors);
  });
});
