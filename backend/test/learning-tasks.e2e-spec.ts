import { INestApplication } from '@nestjs/common';
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
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for learning-tasks e2e tests.');
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
  aiFeedbackStatus?: string;
};

type CreatedFeedbackResponse = {
  id: string;
  message: string;
};

type PublishedTaskResponse = {
  status: string;
};

type TaskStatsResponse = {
  submissionsCount: number;
  distinctStudentsCount: number;
  topTags?: string[];
};

describe('LearningTasks (e2e)', () => {
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
  let feedbackId = '';

  const teacherEmail = `teacher.${Date.now()}@example.com`;
  const studentEmail = `student.${Date.now()}@example.com`;
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

  beforeAll(async () => {
    ensureMongoUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
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
    console.log('[e2e] feedback collection =', feedbackModel.collection.name);

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

  it('rejects unauthorized and role-mismatched access with expected status codes', async () => {
    await request(app.getHttpServer())
      .get('/api/learning-tasks/tasks')
      .expect(401);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    await studentAgent.post('/api/learning-tasks/tasks').send({}).expect(403);

    await teacherAgent
      .get('/api/learning-tasks/tasks')
      .query({ page: 1, limit: 20 })
      .expect(200);
  });

  it('keeps public and auth-only routes aligned with global session guard', async () => {
    await request(app.getHttpServer()).get('/api').expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: teacherEmail, password: teacherPassword })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
    const rawCookies = loginResponse.headers['set-cookie'];
    const cookies =
      rawCookies === undefined
        ? []
        : Array.isArray(rawCookies)
          ? rawCookies
          : [rawCookies];
    expect(cookies?.some((cookie) => cookie.includes('ef_session='))).toBe(
      true,
    );

    await request(app.getHttpServer()).get('/api/users/me').expect(401);
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await teacherAgent.get('/api/users/me').expect(200);
    await teacherAgent
      .post('/api/auth/logout')
      .send({})
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected logout status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  });

  afterAll(async () => {
    if (KEEP_DB) {
      await app.close();
      return;
    }

    const cleanup: Promise<unknown>[] = [];
    const userIds = [teacherId, studentId].filter(Boolean);

    if (feedbackId) {
      cleanup.push(feedbackModel.deleteOne({ _id: feedbackId }));
    }
    if (submissionId) {
      cleanup.push(
        aiFeedbackJobModel.deleteMany({
          submissionId: new Types.ObjectId(submissionId),
        }),
      );
    }
    if (submissionId) {
      cleanup.push(submissionModel.deleteOne({ _id: submissionId }));
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

  it('teacher creates task, publishes, student submits, teacher feedback, stats', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    await teacherAgent.get('/api/users/me').expect(200);
    await studentAgent.get('/api/users/me').expect(200);

    const createTaskPayload = {
      title: 'Sorting Lab',
      description: 'Implement quicksort.',
      knowledgeModule: 'algorithms',
      stage: 2,
      status: 'DRAFT',
    };

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send(createTaskPayload)
      .expect(201);

    const taskBody = createdTask.body as CreatedTaskResponse;

    expect(typeof taskBody.id).toBe('string');
    expect(typeof taskBody.title).toBe('string');
    expect(typeof taskBody.status).toBe('string');
    taskId = taskBody.id;

    const publishedTask = await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const publishedBody = publishedTask.body as PublishedTaskResponse;
    expect(publishedBody.status).toBe('PUBLISHED');

    const submissionPayload = {
      content: {
        codeText: 'function quicksort(arr) { return arr; }',
        language: 'typescript',
      },
    };

    const createdSubmission = await studentAgent
      .post(`/api/learning-tasks/tasks/${taskId}/submissions`)
      .send(submissionPayload)
      .expect(201);

    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    expect(typeof submissionBody.id).toBe('string');
    expect(submissionBody.attemptNo).toBe(1);
    submissionId = submissionBody.id;
    expect(submissionBody.aiFeedbackStatus).toBe('PENDING');

    const feedbackPayload = {
      source: 'TEACHER',
      type: 'STYLE',
      severity: 'WARN',
      message: 'Naming could be clearer.',
    };

    const createdFeedback = await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send(feedbackPayload)
      .expect(201);

    const feedbackBody = createdFeedback.body as CreatedFeedbackResponse;

    expect(typeof feedbackBody.id).toBe('string');
    expect(typeof feedbackBody.message).toBe('string');
    feedbackId = feedbackBody.id;

    const persistedFeedback = await feedbackModel
      .findById(feedbackId)
      .lean()
      .exec();
    if (!persistedFeedback) {
      console.log('[e2e] feedback not persisted', {
        id: feedbackId,
        persisted: persistedFeedback,
        collection: feedbackModel.collection.name,
      });
    }
    expect(persistedFeedback).toBeTruthy();

    const feedbackList = await teacherAgent
      .get(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .expect(200);

    const list = feedbackList.body as unknown;
    expect(Array.isArray(list)).toBe(true);

    const listArr = list as unknown[];
    expect(listArr.length).toBeGreaterThanOrEqual(1);

    const stats = await teacherAgent
      .get(`/api/learning-tasks/tasks/${taskId}/stats`)
      .expect(200);

    const statsBody = stats.body as TaskStatsResponse;
    expect(statsBody.submissionsCount).toBeGreaterThanOrEqual(1);
    expect(statsBody.distinctStudentsCount).toBeGreaterThanOrEqual(1);
  });
});
