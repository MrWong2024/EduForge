import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import http from 'http';
import request from 'supertest';
import { App } from 'supertest/types';
import type * as AppModuleExports from '../src/app.module';
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

const KEEP_DB = process.env.KEEP_E2E_DB === '1';
const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for learning-tasks ai-feedback e2e tests.',
    );
  }
};

type CreatedTaskResponse = {
  id: string;
  title: string;
  status: string;
};

type CreatedCourseResponse = {
  id: string;
  code: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type CreatedClassroomTaskResponse = {
  id: string;
  taskId: string;
};

type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
};

type ProcessOnceResponse = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

const buildMockItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'STYLE',
    severity: 'WARN',
    message: `Mock item ${index + 1}`,
    tags: ['readability'],
  }));

const startMockBailian = (itemsCount = 25, delayMs = 50) =>
  new Promise<{
    server: http.Server;
    url: string;
    getMaxInflightObserved: () => number;
  }>((resolve, reject) => {
    let inflight = 0;
    let maxInflightObserved = 0;
    const server = http.createServer((req, res) => {
      if (!req.url?.includes('/chat/completions') || req.method !== 'POST') {
        res.statusCode = 404;
        res.end();
        return;
      }
      inflight += 1;
      if (inflight > maxInflightObserved) {
        maxInflightObserved = inflight;
      }
      req.on('data', () => {});
      req.on('end', () => {
        const payload = {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: buildMockItems(itemsCount),
                  meta: { model: 'mock' },
                }),
              },
            },
          ],
        };
        setTimeout(() => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
          inflight = Math.max(0, inflight - 1);
        }, delayMs);
      });
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    const startupTimeout = setTimeout(() => {
      server.close();
      reject(new Error('Mock Bailian startup timed out'));
    }, 5000);
    server.once('error', (error) => {
      clearTimeout(startupTimeout);
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      clearTimeout(startupTimeout);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Mock Bailian address unavailable'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        getMaxInflightObserved: () => maxInflightObserved,
      });
    });
  });

describe('LearningTasks AI Feedback Guards (e2e)', () => {
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
  let mockServer: http.Server;
  let mockBaseUrl = '';
  let getMaxInflightObserved: () => number;

  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousProvider: string | undefined;
  let previousApiKey: string | undefined;
  let previousBaseUrl: string | undefined;
  let previousMaxItems: string | undefined;
  let previousMaxConcurrency: string | undefined;
  let previousMaxPerMinute: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;
  let previousCooldown: string | undefined;

  const fixtureNamespace = 'ai-bailian-guards-' + Date.now();
  const teacherEmail = 'teacher.' + fixtureNamespace + '@example.invalid';
  const studentEmail = 'student.' + fixtureNamespace + '@example.invalid';
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';
  const describeDefaultMaxPerMinute = '600';
  const submissionIds: string[] = [];
  const waitMsLocal = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const applyMaxPerMinuteFromEnv = () => {
    const raw = process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE;
    const parsed = Number.parseInt(raw ?? describeDefaultMaxPerMinute, 10);
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

  beforeAll(async () => {
    const mock = await startMockBailian(25, 80);
    mockServer = mock.server;
    mockBaseUrl = mock.url;
    getMaxInflightObserved = mock.getMaxInflightObserved;

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousProvider = process.env.AI_FEEDBACK_PROVIDER;
    process.env.AI_FEEDBACK_PROVIDER = 'bailian';
    previousApiKey = process.env.BAILIAN_API_KEY;
    previousBaseUrl = process.env.BAILIAN_BASE_URL;
    previousMaxItems = process.env.AI_FEEDBACK_MAX_ITEMS;
    process.env.AI_FEEDBACK_MAX_ITEMS = '10';
    previousMaxConcurrency = process.env.AI_FEEDBACK_MAX_CONCURRENCY;
    process.env.AI_FEEDBACK_MAX_CONCURRENCY = '2';
    previousMaxPerMinute =
      process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE;
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      describeDefaultMaxPerMinute;
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstAttemptOnly =
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'false';
    process.env.BAILIAN_API_KEY = 'test-key';
    process.env.BAILIAN_BASE_URL = mockBaseUrl;
    previousCooldown = process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = '0';

    // Validate this suite's mock configuration before creating the application.
    const appModuleExports =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../src/app.module') as typeof AppModuleExports;
    const { AppModule } = appModuleExports;
    ensureMongoUri();

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

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    taskModel = app.get(getModelToken(Task.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);
    expect(process.env.EDUFORGE_DATABASE_PURPOSE).toBe('standard_test');
    expect(userModel.db.name).toBe('eduforge_test');
    userModel.db.set('maxTimeMS', 10000);
    expect(
      await aiFeedbackJobModel.countDocuments({
        status: {
          $in: [AiFeedbackJobStatus.Pending, AiFeedbackJobStatus.Failed],
        },
      }),
    ).toBe(0);
    console.info(
      'Bailian guards E2E: standard_test / ' +
        userModel.db.name +
        '; namespace=' +
        fixtureNamespace +
        '; mock=' +
        mockBaseUrl,
    );

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

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'AI Feedback Guarded',
        description: 'Guarded AI feedback pipeline.',
        knowledgeModule: 'ai-guards',
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

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `AI${Date.now()}`,
        name: 'AI Feedback Guarded',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'AI Feedback Guarded Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskBody =
      createdClassroomTask.body as CreatedClassroomTaskResponse;
    classroomTaskId = classroomTaskBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
  });

  afterEach(() => {
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
      describeDefaultMaxPerMinute;
    if (app) applyMaxPerMinuteFromEnv();
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
    if (previousProvider === undefined) {
      delete process.env.AI_FEEDBACK_PROVIDER;
    } else {
      process.env.AI_FEEDBACK_PROVIDER = previousProvider;
    }
    if (previousApiKey === undefined) {
      delete process.env.BAILIAN_API_KEY;
    } else {
      process.env.BAILIAN_API_KEY = previousApiKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.BAILIAN_BASE_URL;
    } else {
      process.env.BAILIAN_BASE_URL = previousBaseUrl;
    }
    if (previousMaxItems === undefined) {
      delete process.env.AI_FEEDBACK_MAX_ITEMS;
    } else {
      process.env.AI_FEEDBACK_MAX_ITEMS = previousMaxItems;
    }
    if (previousMaxConcurrency === undefined) {
      delete process.env.AI_FEEDBACK_MAX_CONCURRENCY;
    } else {
      process.env.AI_FEEDBACK_MAX_CONCURRENCY = previousMaxConcurrency;
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
    if (previousCooldown === undefined) {
      delete process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    } else {
      process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = previousCooldown;
    }

    try {
      if (!KEEP_DB && userModel) {
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
          await submissionModel.deleteMany({
            _id: { $in: submissionObjectIds },
          });
        }
        if (classroomTaskId) {
          await classroomTaskModel.deleteOne({
            _id: new Types.ObjectId(classroomTaskId),
          });
        }
        if (taskId) {
          await taskModel.deleteOne({ _id: taskId });
        }
        if (classroomId) {
          await classroomModel.deleteOne({
            _id: new Types.ObjectId(classroomId),
          });
        }
        if (courseId) {
          await courseModel.deleteOne({ _id: new Types.ObjectId(courseId) });
        }
        const users = await userModel
          .find({ email: { $in: [teacherEmail, studentEmail] } })
          .select('_id')
          .lean<Array<{ _id: Types.ObjectId }>>()
          .exec();
        const userIds = users.map((user) => user._id);
        if (userIds.length > 0) {
          await sessionModel.deleteMany({ userId: { $in: userIds } });
          await userModel.deleteMany({ _id: { $in: userIds } });
        }
        expect(
          await feedbackModel.countDocuments({
            submissionId: { $in: submissionObjectIds },
          }),
        ).toBe(0);
        expect(
          await aiFeedbackJobModel.countDocuments({
            submissionId: { $in: submissionObjectIds },
          }),
        ).toBe(0);
        expect(
          await submissionModel.countDocuments({
            _id: { $in: submissionObjectIds },
          }),
        ).toBe(0);
        expect(
          await userModel.countDocuments({
            email: { $in: [teacherEmail, studentEmail] },
          }),
        ).toBe(0);
        expect(
          await sessionModel.countDocuments({ userId: { $in: userIds } }),
        ).toBe(0);
        if (taskId)
          expect(await taskModel.countDocuments({ _id: taskId })).toBe(0);
        if (courseId)
          expect(await courseModel.countDocuments({ _id: courseId })).toBe(0);
        if (classroomId)
          expect(
            await classroomModel.countDocuments({ _id: classroomId }),
          ).toBe(0);
        if (classroomTaskId)
          expect(
            await classroomTaskModel.countDocuments({ _id: classroomTaskId }),
          ).toBe(0);
        console.info('Fixture cleanup verified: ' + fixtureNamespace);
      }
    } finally {
      try {
        if (app) await app.close();
      } finally {
        if (mockServer?.listening) {
          mockServer.closeAllConnections();
          await new Promise<void>((resolve) =>
            mockServer.close(() => resolve()),
          );
        }
      }
    }
  });

  it('process-once remains stable under concurrency and caps items', async () => {
    const submissions: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await studentAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
        )
        .send({
          content: {
            codeText: `console.log(${index});`,
            language: 'typescript',
          },
        })
        .expect(201);
      const createdId = (created.body as CreatedSubmissionResponse).id;
      submissions.push(createdId);
      submissionIds.push(createdId);
    }
    await Promise.all(
      submissions.map((submissionId) =>
        studentAgent
          .post(
            `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
          )
          .send({})
          .expect(200),
      ),
    );

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => aiFeedbackProcessor.processOnce(1)),
    );

    expect(responses.length).toBe(5);

    const waitForSucceededJob = async (submissionId: string) => {
      const submissionObjectId = new Types.ObjectId(submissionId);
      let job: AiFeedbackJob | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        job = await aiFeedbackJobModel.findOne({
          submissionId: submissionObjectId,
        });
        if (job?.status === AiFeedbackJobStatus.Succeeded) {
          return job;
        }
        await waitMsLocal(90);
      }
      return job;
    };

    const jobs = await Promise.all(submissions.map(waitForSucceededJob));
    jobs.forEach((job) => {
      expect(job).toBeTruthy();
      expect(job?.status).toBe('SUCCEEDED');
    });

    const feedbackCountA = await feedbackModel.countDocuments({
      submissionId: new Types.ObjectId(submissions[0]),
    });
    expect(feedbackCountA).toBeLessThanOrEqual(2);
    const feedbackCountB = await feedbackModel.countDocuments({
      submissionId: new Types.ObjectId(submissions[1]),
    });
    expect(feedbackCountB).toBeLessThanOrEqual(2);

    expect(getMaxInflightObserved()).toBeGreaterThan(0);
    expect(getMaxInflightObserved()).toBeLessThanOrEqual(2);
  });

  it('local rate limit marks second job as failed with notBefore', async () => {
    process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE = '1';
    applyMaxPerMinuteFromEnv();
    resetGuardsState();
    try {
      const createSubmission = async (label: string) => {
        const created = await studentAgent
          .post(
            `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
          )
          .send({
            content: {
              codeText: `console.log("${label}")`,
              language: 'typescript',
            },
          })
          .expect(201);
        const createdId = (created.body as CreatedSubmissionResponse).id;
        submissionIds.push(createdId);
        return createdId;
      };

      const [submissionAId, submissionBId] = await Promise.all([
        createSubmission('A'),
        createSubmission('B'),
      ]);
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

      const processOnceFirst = await aiFeedbackProcessor.processOnce(1);

      const firstBody = processOnceFirst as ProcessOnceResponse;
      expect(firstBody.processed).toBe(1);

      const findJobWithRetry = async (
        id: string,
        retries = 3,
      ): Promise<AiFeedbackJob | null> => {
        const submissionObjectId = new Types.ObjectId(id);
        let job = await aiFeedbackJobModel.findOne({
          submissionId: submissionObjectId,
        });
        let remaining = retries;
        while (!job && remaining > 0) {
          await waitMsLocal(50);
          job = await aiFeedbackJobModel.findOne({
            submissionId: submissionObjectId,
          });
          remaining -= 1;
        }
        return job ?? null;
      };

      const [jobAAfterFirst, jobBAfterFirst] = await Promise.all([
        findJobWithRetry(submissionAId),
        findJobWithRetry(submissionBId),
      ]);
      const succeededAfterFirst = [jobAAfterFirst, jobBAfterFirst].filter(
        (job) => job?.status === AiFeedbackJobStatus.Succeeded,
      );
      const pendingAfterFirst = [jobAAfterFirst, jobBAfterFirst].filter(
        (job) => job?.status === AiFeedbackJobStatus.Pending,
      );
      expect(succeededAfterFirst.length).toBe(1);
      expect(pendingAfterFirst.length).toBe(1);

      await aiFeedbackProcessor.processOnce(1);

      const nowAfterSecond = Date.now();
      const pendingSubmissionId =
        jobAAfterFirst?.status === AiFeedbackJobStatus.Pending
          ? submissionAId
          : submissionBId;
      let failedJob = await findJobWithRetry(pendingSubmissionId);
      if (failedJob?.status !== AiFeedbackJobStatus.Failed) {
        await waitMsLocal(50);
        failedJob = await findJobWithRetry(pendingSubmissionId, 1);
      }

      expect(failedJob?.status).toBe('FAILED');
      expect(failedJob?.lastError ?? '').toContain('RATE_LIMIT_LOCAL');
      expect(failedJob?.notBefore).toBeTruthy();
      expect(
        failedJob?.notBefore && failedJob.notBefore.getTime() > nowAfterSecond,
      ).toBe(true);
      expect(failedJob?.status).not.toBe('RUNNING');
    } finally {
      process.env.AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE =
        describeDefaultMaxPerMinute;
      applyMaxPerMinuteFromEnv();
    }
  });
});
