import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  runClassroomTaskTransaction,
} from '../src/lib/classroom-task-transaction';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'node:http';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import { AiFeedbackWorker } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const waitMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

afterAll(() => authTestEnvironment.restore());

function objectIds(ids: string[]) {
  return { $in: ids.filter(Boolean).map((id) => new Types.ObjectId(id)) };
}

async function assertNoForeignJobs(
  connection: Connection,
  jobs: Model<AiFeedbackJob>,
  ownedSubmissions: string[] = [],
) {
  const db = connection.db;
  if (!db)
    throw new Error('AI feedback ops fixture connection is unavailable.');
  const foreignJobs = await db.collection(jobs.collection.name).countDocuments(
    {
      submissionId: { $nin: objectIds(ownedSubmissions).$in },
      status: {
        $in: [
          AiFeedbackJobStatus.Pending,
          AiFeedbackJobStatus.Failed,
          AiFeedbackJobStatus.Running,
        ],
      },
    },
    { timeoutMS: 5000, readPreference: 'primary' },
  );
  if (foreignJobs !== 0)
    throw new Error('AI feedback ops E2E found foreign nonterminal Jobs.');
}

async function assertOpsDatabaseGate(
  app: INestApplication<App>,
  independent: Connection,
  jobs: Model<AiFeedbackJob>,
  mode: 'manual' | 'stub worker',
) {
  const defaultConnection = app.get<Connection>(getConnectionToken());
  const transactionConnection = app.get<Connection>(
    getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
  );
  for (const connection of [
    defaultConnection,
    transactionConnection,
    independent,
  ])
    await assertAuthTestConnection(connection);

  await runClassroomTaskTransaction(transactionConnection, (transaction) =>
    transaction
      .model(jobs)
      .exists({ _id: new Types.ObjectId() })
      .session(transaction.session)
      .setOptions(transaction.readOptions())
      .exec(),
  );
  await assertNoForeignJobs(independent, jobs);
  console.info('AI feedback ops DB gates passed.', {
    mode,
    default: defaultConnection.db?.databaseName,
    transaction: transactionConnection.db?.databaseName,
    independent: independent.db?.databaseName,
    readOnlyTransaction: 'committed',
    foreignNonterminalJobs: 0,
  });
}

async function cleanupOpsFixtures(
  app: INestApplication<App>,
  connection: Connection,
  ids: {
    userIds: string[];
    submissionIds: string[];
    classroomTaskId: string;
    classroomId: string;
    taskId: string;
    courseId: string;
  },
  mode: 'manual' | 'stub worker',
) {
  const db = connection.db;
  if (!db)
    throw new Error('AI feedback ops fixture connection is unavailable.');
  const userIds = objectIds(ids.userIds);
  const submissionIds = objectIds(ids.submissionIds);
  const classroomIds = objectIds([ids.classroomId]);
  const ownedRows = [
    [Feedback.name, { submissionId: submissionIds }],
    [AiFeedbackJob.name, { submissionId: submissionIds }],
    [Submission.name, { _id: submissionIds }],
    [Enrollment.name, { classroomId: classroomIds }],
    [ClassroomTask.name, { _id: objectIds([ids.classroomTaskId]) }],
    [Classroom.name, { _id: classroomIds }],
    [Task.name, { _id: objectIds([ids.taskId]) }],
    [Course.name, { _id: objectIds([ids.courseId]) }],
    [Session.name, { userId: userIds }],
    [PasswordResetToken.name, { userId: userIds }],
    [User.name, { _id: userIds }],
  ] as const;
  const collection = (modelName: string) =>
    db.collection(
      app.get<Model<unknown>>(getModelToken(modelName)).collection.name,
    );
  for (const [name, filter] of ownedRows)
    await collection(name).deleteMany(filter, { timeoutMS: 5000 });

  const residual = await Promise.all(
    ownedRows.map(async ([name, filter]) => [
      name,
      await collection(name).countDocuments(filter, {
        timeoutMS: 5000,
        readPreference: 'primary',
      }),
    ]),
  );
  console.info('AI feedback ops scoped residual:', {
    mode,
    ...Object.fromEntries(residual),
  });
  expect(residual.map(([, count]) => count)).toEqual(
    Array<number>(ownedRows.length).fill(0),
  );
}

type CreatedTaskResponse = {
  id: string;
  title: string;
  status: string;
};

type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
  contentRevision: number;
};

type ProcessOnceResponse = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

type JobListItem = {
  id: string;
  submissionId: string;
  status: string;
  attempts: number;
};

type SubmissionListItem = {
  id: string;
  aiFeedbackStatus?: string;
};

type SubmissionDetailBody = {
  id: string;
  aiFeedbackStatus?: string;
  contentRevision: number;
  content?: {
    codeText?: string | null;
    language?: string | null;
  };
};

type RequestAiFeedbackResponse = {
  submissionId: string;
  jobId: string;
  status: string;
  aiFeedbackStatus: string;
};

type CommonIssuesReport = {
  topTags: Array<{ tag: string; count: number }>;
  examples: Array<{ tag: string; count: number }>;
};

describe('LearningTasks AI Feedback Ops (e2e) - pipeline & debug gate ON', () => {
  let app: INestApplication<App>;
  let independentConnection: Connection;
  let databaseVerified = false;
  let userModel: Model<User>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  const teacherId = new Types.ObjectId().toHexString();
  const studentId = new Types.ObjectId().toHexString();
  const adminId = new Types.ObjectId().toHexString();
  let courseId = '',
    classroomId = '',
    classroomTaskId = '';
  let taskId = '';
  let submissionId = '';

  const teacherEmail = `teacher.ai.${Date.now()}@example.com`;
  const studentEmail = `student.ai.${Date.now()}@example.com`;
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

  const findJobBySubmission = (jobs: JobListItem[], id: string) =>
    jobs.find((job) => job.submissionId === id);
  const findSubmissionById = (items: SubmissionListItem[], id: string) =>
    items.find((item) => item.id === id);

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
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

    userModel = app.get(getModelToken(User.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    await assertOpsDatabaseGate(
      app,
      independentConnection,
      aiFeedbackJobModel,
      'manual',
    );
    databaseVerified = true;
    app.get(ConfigService).set('AI_FEEDBACK_DEBUG_ENABLED', 'true');
    await app.init();
    app.get(ConfigService).set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await Promise.all([
      userModel.create({
        _id: teacherId,
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        _id: studentId,
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
    ]);
  });

  afterAll(async () => {
    try {
      if (databaseVerified)
        await cleanupOpsFixtures(
          app,
          independentConnection,
          {
            userIds: [teacherId, studentId, adminId],
            submissionIds: [submissionId],
            classroomTaskId,
            classroomId,
            taskId,
            courseId,
          },
          'manual',
        );
    } finally {
      await Promise.all([app?.close(), independentConnection?.close()]);
    }
  });

  it('worker disabled by default, process-once consumes and creates feedback', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createTaskPayload = {
      title: 'AI Feedback Lab',
      description: 'Intro to AI feedback pipeline.',
      knowledgeModule: 'ai-basics',
      status: 'DRAFT',
    };

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send(createTaskPayload)
      .expect(201);

    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);
    const course = await teacherAgent
      .post('/api/courses')
      .send({
        code: 'fixture-' + taskId,
        name: 'Synthetic task course',
        term: '2026',
      })
      .expect(201);
    courseId = (course.body as { id: string }).id;
    const classroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Synthetic task classroom' })
      .expect(201);
    const room = classroom.body as { id: string; joinCode: string };
    classroomId = room.id;
    const instance = await teacherAgent
      .post('/api/classrooms/' + classroomId + '/tasks')
      .send({ taskId })
      .expect(201);
    classroomTaskId = (instance.body as { id: string }).id;
    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: room.joinCode })
      .expect(201);

    const submissionPayload = {
      content: {
        codeText: 'TODO: stub',
        language: 'typescript',
      },
    };

    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send(submissionPayload)
      .expect(201);

    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    submissionId = submissionBody.id;
    expect(submissionBody.attemptNo).toBe(1);

    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionBody.contentRevision })
      .expect(200);

    const pendingJobs = await teacherAgent
      .get('/api/learning-tasks/ai-feedback/jobs')
      .query({ status: 'PENDING', limit: 20 })
      .expect(200);

    const pendingList = pendingJobs.body as JobListItem[];
    const pendingJob = findJobBySubmission(pendingList, submissionId);
    expect(pendingJob).toBeTruthy();
    expect(pendingJob?.status).toBe('PENDING');
    expect(typeof pendingJob?.attempts).toBe('number');

    const mineBefore = await studentAgent
      .get(`/api/learning-tasks/tasks/${taskId}/submissions/mine`)
      .expect(200);

    const mineBeforeList = mineBefore.body as SubmissionListItem[];
    const mineBeforeItem = findSubmissionById(mineBeforeList, submissionId);
    expect(mineBeforeItem).toBeTruthy();
    expect(mineBeforeItem?.aiFeedbackStatus).toBe('PENDING');

    await waitMs(500);

    const pendingJobsAgain = await teacherAgent
      .get('/api/learning-tasks/ai-feedback/jobs')
      .query({ status: 'PENDING', limit: 20 })
      .expect(200);

    const pendingListAgain = pendingJobsAgain.body as JobListItem[];
    const pendingJobAgain = findJobBySubmission(pendingListAgain, submissionId);
    expect(pendingJobAgain).toBeTruthy();
    expect(pendingJobAgain?.status).toBe('PENDING');

    await teacherAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({ batchSize: 0 })
      .expect(400);

    await assertNoForeignJobs(independentConnection, aiFeedbackJobModel, [
      submissionId,
    ]);
    const processOnce = await teacherAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });

    const processBody = processOnce.body as ProcessOnceResponse;
    expect(processBody).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      dead: 0,
    });

    const teacherFeedbackPayload = {
      source: 'TEACHER',
      type: 'STYLE',
      severity: 'WARN',
      message: 'Readability can be improved.',
      tags: ['readability'],
    };

    await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({
        expectedRevision: submissionBody.contentRevision,
        ...teacherFeedbackPayload,
      })
      .expect(201);

    const succeededJobs = await teacherAgent
      .get('/api/learning-tasks/ai-feedback/jobs')
      .query({ status: 'SUCCEEDED', limit: 20 })
      .expect(200);

    const succeededList = succeededJobs.body as JobListItem[];
    const succeededJob = findJobBySubmission(succeededList, submissionId);
    expect(succeededJob).toBeTruthy();
    expect(succeededJob?.status).toBe('SUCCEEDED');

    const mineAfter = await studentAgent
      .get(`/api/learning-tasks/tasks/${taskId}/submissions/mine`)
      .expect(200);

    const mineAfterList = mineAfter.body as SubmissionListItem[];
    const mineAfterItem = findSubmissionById(mineAfterList, submissionId);
    expect(mineAfterItem).toBeTruthy();
    expect(mineAfterItem?.aiFeedbackStatus).toBe('SUCCEEDED');

    const feedbackList = await teacherAgent
      .get(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .expect(200);

    const feedbackItems = feedbackList.body as unknown[];
    expect(Array.isArray(feedbackItems)).toBe(true);
    expect(feedbackItems.length).toBeGreaterThanOrEqual(1);

    const hasValidFeedback = feedbackItems.some((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const feedback = item as Record<string, unknown>;
      return (
        typeof feedback.source === 'string' &&
        typeof feedback.type === 'string' &&
        typeof feedback.severity === 'string' &&
        typeof feedback.message === 'string'
      );
    });
    expect(hasValidFeedback).toBe(true);

    const commonIssues = await teacherAgent
      .get(`/api/learning-tasks/tasks/${taskId}/reports/common-issues`)
      .query({ limit: 10 })
      .expect(200);

    const commonIssuesBody = commonIssues.body as CommonIssuesReport;
    const tags = commonIssuesBody.topTags.map((item) => item.tag);
    expect(tags).toContain('readability');
    expect(commonIssuesBody.examples.length).toBeGreaterThanOrEqual(1);
    expect(typeof commonIssuesBody.examples[0].count).toBe('number');
  });

  it('enforces role checks for debug ops when debug gate is ON', async () => {
    const adminEmail = `admin.ai.${Date.now()}@example.com`;
    const adminPassword = 'AdminPass123!';
    const adminAgent = request.agent(app.getHttpServer());
    const adminHash = await bcrypt.hash(adminPassword, 10);
    await userModel.create({
      _id: adminId,
      email: adminEmail,
      passwordHash: adminHash,
      roles: ['admin'],
    });

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
    await login(adminAgent, adminEmail, adminPassword);

    await studentAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(403);
    await studentAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect(403);

    await teacherAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(200);
    await adminAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(200);
    for (const agent of [teacherAgent, adminAgent]) {
      await assertNoForeignJobs(independentConnection, aiFeedbackJobModel, [
        submissionId,
      ]);
      await agent
        .post('/api/learning-tasks/ai-feedback/jobs/process-once')
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.status)) {
            throw new Error(
              `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
            );
          }
        });
    }
  });
});

describe('LearningTasks AI Feedback Ops (e2e) - stub worker default loop', () => {
  let app: INestApplication<App>;
  let independentConnection: Connection;
  let databaseVerified = false;
  let processOnceSpy: jest.SpiedFunction<AiFeedbackProcessor['processOnce']>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  const teacherId = new Types.ObjectId().toHexString();
  const studentId = new Types.ObjectId().toHexString();
  let courseId = '',
    classroomId = '',
    classroomTaskId = '';
  let taskId = '';
  const submissionIds: string[] = [];

  const teacherEmail = `teacher.worker.${Date.now()}@example.com`;
  const studentEmail = `student.worker.${Date.now()}@example.com`;
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

  const waitForDetailStatus = async (
    submissionId: string,
    expected: string,
    maxAttempts = 40,
  ) => {
    let lastBody: SubmissionDetailBody | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const detailRes = await studentAgent
        .get(`/api/learning-tasks/submissions/${submissionId}`)
        .expect(200);
      lastBody = detailRes.body as SubmissionDetailBody;
      if (lastBody.aiFeedbackStatus === expected) {
        return lastBody;
      }
      await waitMs(150);
    }
    return lastBody;
  };

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
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

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    await assertOpsDatabaseGate(
      app,
      independentConnection,
      aiFeedbackJobModel,
      'stub worker',
    );
    databaseVerified = true;
    // AppModule validates env at import time; set typed worker overrides before init.
    const configService = app.get(ConfigService);
    configService.set('AI_FEEDBACK_DEBUG_ENABLED', 'false');
    configService.set('AI_FEEDBACK_WORKER_ENABLED', true);
    configService.set('AI_FEEDBACK_WORKER_INTERVAL_MS', 120);
    configService.set('AI_FEEDBACK_WORKER_BATCH_SIZE', 2);
    // Observe real processing without replacing the stub worker lifecycle.
    processOnceSpy = jest.spyOn(app.get(AiFeedbackProcessor), 'processOnce');
    await app.init();
    app.get(ConfigService).set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await Promise.all([
      userModel.create({
        _id: teacherId,
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        _id: studentId,
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
        title: 'AI Worker Loop Task',
        description: 'Validate stub worker loop.',
        knowledgeModule: 'ai-worker',
        status: 'DRAFT',
      })
      .expect(201);

    taskId = (createdTask.body as CreatedTaskResponse).id;
    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);
    const course = await teacherAgent
      .post('/api/courses')
      .send({
        code: 'fixture-' + taskId,
        name: 'Synthetic task course',
        term: '2026',
      })
      .expect(201);
    courseId = (course.body as { id: string }).id;
    const classroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Synthetic task classroom' })
      .expect(201);
    const room = classroom.body as { id: string; joinCode: string };
    classroomId = room.id;
    const instance = await teacherAgent
      .post('/api/classrooms/' + classroomId + '/tasks')
      .send({ taskId })
      .expect(201);
    classroomTaskId = (instance.body as { id: string }).id;
    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: room.joinCode })
      .expect(201);
  });

  afterAll(async () => {
    try {
      if (!databaseVerified) return;
      // Stop new ticks and drain already started work before fixture/DB cleanup.
      app.get(AiFeedbackWorker).onModuleDestroy();
      const inFlight = processOnceSpy.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value);
      const drained = await Promise.allSettled(inFlight);
      processOnceSpy.mockRestore();
      await cleanupOpsFixtures(
        app,
        independentConnection,
        {
          userIds: [teacherId, studentId],
          submissionIds,
          classroomTaskId,
          classroomId,
          taskId,
          courseId,
        },
        'stub worker',
      );
      expect(drained.every(({ status }) => status === 'fulfilled')).toBe(true);
    } finally {
      await Promise.all([app?.close(), independentConnection?.close()]);
    }

    expect(aiFeedbackJobModel.db.readyState).toBe(0);
    const httpServer: unknown = app.getHttpServer();
    expect(httpServer).toBeInstanceOf(Server);
    if (httpServer instanceof Server) expect(httpServer.listening).toBe(false);
    console.info('A2 stub Worker stopped and drained; app/DB closed.');
  });

  it('runs request -> PENDING -> worker SUCCEEDED and exposes detail/feedback', async () => {
    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'TODO: refine this worker-path sample',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionId = (createdSubmission.body as CreatedSubmissionResponse)
      .id;
    submissionIds.push(submissionId);

    const detailBefore = await studentAgent
      .get(`/api/learning-tasks/submissions/${submissionId}`)
      .expect(200);
    const detailBeforeStatus = (detailBefore.body as SubmissionDetailBody)
      .aiFeedbackStatus;
    expect(detailBeforeStatus).toBe('NOT_REQUESTED');

    await assertNoForeignJobs(
      independentConnection,
      aiFeedbackJobModel,
      submissionIds,
    );
    const requestResult = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({
        expectedRevision: (detailBefore.body as SubmissionDetailBody)
          .contentRevision,
        reason: 'worker-loop-check',
      })
      .expect(200);
    expect(
      ['PENDING', 'RUNNING', 'SUCCEEDED'].includes(
        (requestResult.body as RequestAiFeedbackResponse).status,
      ),
    ).toBe(true);
    expect(
      ['PENDING', 'RUNNING', 'SUCCEEDED'].includes(
        (requestResult.body as RequestAiFeedbackResponse).aiFeedbackStatus,
      ),
    ).toBe(true);

    const detailAfter = await waitForDetailStatus(submissionId, 'SUCCEEDED');
    expect(detailAfter).toBeTruthy();
    expect(detailAfter?.aiFeedbackStatus).toBe('SUCCEEDED');
    expect(detailAfter?.content?.codeText).toContain('worker-path');

    const feedbackList = await studentAgent
      .get(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .expect(200);
    const feedbackItems = feedbackList.body as Array<Record<string, unknown>>;
    expect(Array.isArray(feedbackItems)).toBe(true);
    expect(feedbackItems.length).toBeGreaterThanOrEqual(1);
    const hasAiSource = feedbackItems.some((item) => item.source === 'AI');
    expect(hasAiSource).toBe(true);
  });

  it('keeps NOT_REQUESTED when no job exists', async () => {
    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function untouchedSubmission() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionId = (createdSubmission.body as CreatedSubmissionResponse)
      .id;
    submissionIds.push(submissionId);

    await waitMs(500);

    const detail = await studentAgent
      .get(`/api/learning-tasks/submissions/${submissionId}`)
      .expect(200);
    expect((detail.body as SubmissionDetailBody).aiFeedbackStatus).toBe(
      'NOT_REQUESTED',
    );
  });
});
