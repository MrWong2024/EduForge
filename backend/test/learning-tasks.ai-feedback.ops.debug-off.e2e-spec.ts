import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for learning-tasks ai-feedback e2e tests.',
    );
  }
};

describe('LearningTasks AI Feedback Ops (e2e) - debug gate OFF', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let adminAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let adminId = '';
  let previousDebugEnabled: string | undefined;
  let previousWorkerEnabled: string | undefined;

  const teacherEmail = `teacher.debugoff.${Date.now()}@example.com`;
  const adminEmail = `admin.debugoff.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const adminPassword = 'AdminPass123!';

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

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'false';

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
    adminAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));

    const [teacherHash, adminHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(adminPassword, 10),
    ]);

    const [teacher, admin] = await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: adminEmail,
        passwordHash: adminHash,
        roles: ['admin'],
      }),
    ]);

    teacherId = teacher._id.toString();
    adminId = admin._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(adminAgent, adminEmail, adminPassword);
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

    const userIds = [teacherId, adminId].filter(Boolean);
    if (userIds.length > 0) {
      await sessionModel.deleteMany({ userId: { $in: userIds } });
      await userModel.deleteMany({ _id: { $in: userIds } });
    }

    await app.close();
  });

  it('returns 404 for teacher and admin on debug ops routes', async () => {
    await teacherAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(404);
    await teacherAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect(404);
    await adminAgent.get('/api/learning-tasks/ai-feedback/jobs').expect(404);
    await adminAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect(404);
  });
});
