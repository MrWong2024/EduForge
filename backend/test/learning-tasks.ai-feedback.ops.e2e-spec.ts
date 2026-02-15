import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const waitMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const KEEP_DB = process.env.KEEP_E2E_DB === '1';
const USE_REAL_AI = process.env.REAL_AI_E2E === '1';

if (USE_REAL_AI) {
  if (!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY_REAL) {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_REAL;
  }
  if (!process.env.OPENROUTER_MODEL) {
    process.env.OPENROUTER_MODEL = 'openai/gpt-4o-mini';
  }
  if (!process.env.OPENROUTER_TIMEOUT_MS) {
    process.env.OPENROUTER_TIMEOUT_MS = '20000';
  }
}

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

type CommonIssuesReport = {
  topTags: Array<{ tag: string; count: number }>;
  examples: Array<{ tag: string; count: number }>;
};

describe('LearningTasks AI Feedback Ops (e2e) - pipeline & debug gate ON', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentId = '';
  let taskId = '';
  let submissionId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

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
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

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
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [teacher, student] = await Promise.all([
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

    teacherId = teacher._id.toString();
    studentId = student._id.toString();
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

    if (KEEP_DB) {
      await app.close();
      return;
    }

    const cleanup: Promise<unknown>[] = [];
    const userIds = [teacherId, studentId].filter(Boolean);
    const submissionObjectId = submissionId
      ? new Types.ObjectId(submissionId)
      : null;

    if (submissionObjectId) {
      cleanup.push(
        feedbackModel.deleteMany({ submissionId: submissionObjectId }),
      );
      cleanup.push(
        aiFeedbackJobModel.deleteMany({ submissionId: submissionObjectId }),
      );
      cleanup.push(submissionModel.deleteOne({ _id: submissionObjectId }));
    }
    if (taskId) {
      cleanup.push(taskModel.deleteOne({ _id: taskId }));
    }
    if (userIds.length > 0) {
      cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
      cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
    }

    await Promise.all(cleanup);
    await app.close();
  });

  it('worker disabled by default, process-once consumes and creates feedback', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createTaskPayload = {
      title: 'AI Feedback Lab',
      description: 'Intro to AI feedback pipeline.',
      knowledgeModule: 'ai-basics',
      stage: 1,
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

    const submissionPayload = {
      content: {
        codeText: 'TODO: stub',
        language: 'typescript',
      },
    };

    const createdSubmission = await studentAgent
      .post(`/api/learning-tasks/tasks/${taskId}/submissions`)
      .send(submissionPayload)
      .expect(201);

    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    submissionId = submissionBody.id;
    expect(submissionBody.attemptNo).toBe(1);

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
    expect(typeof processBody.processed).toBe('number');
    expect(typeof processBody.succeeded).toBe('number');
    expect(typeof processBody.failed).toBe('number');
    expect(typeof processBody.dead).toBe('number');

    const teacherFeedbackPayload = {
      source: 'TEACHER',
      type: 'STYLE',
      severity: 'WARN',
      message: 'Readability can be improved.',
      tags: ['readability'],
    };

    await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send(teacherFeedbackPayload)
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
    const admin = await userModel.create({
      email: adminEmail,
      passwordHash: adminHash,
      roles: ['admin'],
    });

    try {
      await login(teacherAgent, teacherEmail, teacherPassword);
      await login(studentAgent, studentEmail, studentPassword);
      await login(adminAgent, adminEmail, adminPassword);

      await studentAgent
        .get('/api/learning-tasks/ai-feedback/jobs')
        .expect(403);
      await studentAgent
        .post('/api/learning-tasks/ai-feedback/jobs/process-once')
        .send({})
        .expect(403);

      await teacherAgent
        .get('/api/learning-tasks/ai-feedback/jobs')
        .expect(200);
      await adminAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(200);
      await teacherAgent
        .post('/api/learning-tasks/ai-feedback/jobs/process-once')
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.status)) {
            throw new Error(
              `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
            );
          }
        });
      await adminAgent
        .post('/api/learning-tasks/ai-feedback/jobs/process-once')
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.status)) {
            throw new Error(
              `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
            );
          }
        });
    } finally {
      await sessionModel.deleteMany({ userId: admin._id });
      await userModel.deleteOne({ _id: admin._id });
    }
  });
});
