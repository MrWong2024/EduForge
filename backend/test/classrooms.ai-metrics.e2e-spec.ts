import { INestApplication, ValidationPipe } from '@nestjs/common';
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
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';
const DEFAULT_MAX_PER_MINUTE = '1000';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classrooms ai-metrics e2e.');
  }
};

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
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let courseId = '';
  let taskId = '';
  let classroomAId = '';
  let classroomBId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  const submissionIds: string[] = [];

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousMaxPerMinute: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.metrics.${Date.now()}@example.com`;
  const studentEmail = `student.metrics.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

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

  beforeAll(async () => {
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousMaxPerMinute =
      process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE;
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      DEFAULT_MAX_PER_MINUTE;
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstAttemptOnly =
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'false';

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

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
    ]);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
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
        stage: 1,
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
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      DEFAULT_MAX_PER_MINUTE;
    applyMaxPerMinuteFromEnv();
    resetGuardsState();
  });

  afterAll(async () => {
    if (previousWorkerEnabled === undefined) {
      delete process.env.AI_FEEDBACK_WORKER_ENABLED;
    } else {
      process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
    }
    if (previousDebugEnabled === undefined) {
      delete process.env.AI_FEEDBACK_DEBUG_ENABLED;
    } else {
      process.env.AI_FEEDBACK_DEBUG_ENABLED = previousDebugEnabled;
    }
    if (previousMaxPerMinute === undefined) {
      delete process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE;
    } else {
      process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
        previousMaxPerMinute;
    }
    if (previousAutoOnSubmit === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = previousAutoOnSubmit;
    }
    if (previousFirstAttemptOnly === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY =
        previousFirstAttemptOnly;
    }

    if (!KEEP_DB) {
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
      if (classroomTaskAId || classroomTaskBId) {
        const classroomTaskIds = [classroomTaskAId, classroomTaskBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (classroomTaskIds.length > 0) {
          await classroomTaskModel.deleteMany({
            _id: { $in: classroomTaskIds },
          });
        }
      }
      if (taskId) {
        await taskModel.deleteOne({ _id: new Types.ObjectId(taskId) });
      }
      if (classroomAId || classroomBId) {
        const classroomIds = [classroomAId, classroomBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (classroomIds.length > 0) {
          await classroomModel.deleteMany({ _id: { $in: classroomIds } });
        }
      }
      if (courseId) {
        await courseModel.deleteOne({ _id: new Types.ObjectId(courseId) });
      }
      const users = await userModel
        .find({ email: { $in: [teacherEmail, studentEmail] } })
        .select('_id')
        .lean()
        .exec();
      const userIds = users.map((user) => user._id);
      if (userIds.length > 0) {
        await sessionModel.deleteMany({ userId: { $in: userIds } });
        await userModel.deleteMany({ _id: { $in: userIds } });
      }
    }
    await app.close();
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
      .send({})
      .expect(200);
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionBId}/ai-feedback/request`,
      )
      .send({})
      .expect(200);

    const processBody = (await aiFeedbackProcessor.processOnce(
      10,
    )) as ProcessOnceResponse;
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
    expect(bodyA.summary.jobs.succeeded).toBeGreaterThanOrEqual(1);
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
      .send({})
      .expect(200);
    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionId}/ai-feedback/request`,
      )
      .send({})
      .expect(200);

    const firstProcess = (await aiFeedbackProcessor.processOnce(
      1,
    )) as ProcessOnceResponse;
    const secondProcess = (await aiFeedbackProcessor.processOnce(
      1,
    )) as ProcessOnceResponse;
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
});
