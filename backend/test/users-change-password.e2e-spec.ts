import {
  authTestEnvironment,
  assertAuthTestConnection,
} from './helpers/auth-test-environment';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';

jest.setTimeout(30000);

describe('Users change password (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let resetTokenModel: Model<PasswordResetToken>;
  let createdUserId = '';

  const userEmail = `users.change-password.${Date.now()}@example.com`;
  let currentPassword = 'TeacherPass123!';

  const loginExpectSuccess = async (
    agent: ReturnType<typeof request.agent>,
    password: string,
  ) => {
    await agent
      .post('/api/auth/login')
      .send({ email: userEmail, password })
      .expect(201);
  };

  beforeAll(async () => {
    await prepareAuthSessionIndexes();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    resetTokenModel = app.get(getModelToken(PasswordResetToken.name));

    const passwordHash = await bcrypt.hash(currentPassword, 10);
    const userId = new Types.ObjectId();
    createdUserId = userId.toString();
    await userModel.create({
      _id: userId,
      email: userEmail,
      passwordHash,
      roles: ['teacher'],
      credentialVersion: 0,
      passwordResetRequestedAt: null,
    });
  });

  afterAll(async () => {
    try {
      if (createdUserId) {
        const userObjectId = new Types.ObjectId(createdUserId);
        const cleanup = await Promise.allSettled([
          sessionModel
            .deleteMany({ userId: userObjectId })
            .maxTimeMS(5000)
            .exec(),
          resetTokenModel
            .deleteMany({ userId: userObjectId })
            .maxTimeMS(5000)
            .exec(),
          userModel.deleteOne({ _id: userObjectId }).maxTimeMS(5000).exec(),
        ]);
        const residual = await Promise.all([
          sessionModel
            .countDocuments({ userId: userObjectId })
            .maxTimeMS(5000)
            .exec(),
          resetTokenModel
            .countDocuments({ userId: userObjectId })
            .maxTimeMS(5000)
            .exec(),
          userModel
            .countDocuments({ _id: userObjectId })
            .maxTimeMS(5000)
            .exec(),
        ]);
        expect(residual).toEqual([0, 0, 0]);
        if (cleanup.some(({ status }) => status === 'rejected')) {
          throw new Error('USERS_PASSWORD_AUTH_FIXTURE_CLEANUP_FAILED');
        }
      }
    } finally {
      try {
        await app?.close();
      } finally {
        authTestEnvironment.restore();
      }
    }
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/api/users/me/change-password')
      .send({
        currentPassword,
        newPassword: 'TeacherPass456!',
      })
      .expect(401);
  });

  it('rejects when current password is incorrect', async () => {
    const agent = request.agent(app.getHttpServer());
    await loginExpectSuccess(agent, currentPassword);

    await agent
      .post('/api/users/me/change-password')
      .send({
        currentPassword: 'WrongPassword!',
        newPassword: 'TeacherPass456!',
      })
      .expect(401);
  });

  it('rejects when new password is blank after trimming', async () => {
    const agent = request.agent(app.getHttpServer());
    await loginExpectSuccess(agent, currentPassword);

    await agent
      .post('/api/users/me/change-password')
      .send({
        currentPassword,
        newPassword: '        ',
      })
      .expect(400)
      .expect(({ body }: { body: { code?: string } }) => {
        expect(body.code).toBe('PASSWORD_POLICY_VIOLATION');
      });
  });

  it('rejects when new password equals current password', async () => {
    const agent = request.agent(app.getHttpServer());
    await loginExpectSuccess(agent, currentPassword);

    await agent
      .post('/api/users/me/change-password')
      .send({
        currentPassword,
        newPassword: currentPassword,
      })
      .expect(400);
  });

  it('changes password, keeps current session, and invalidates other sessions', async () => {
    const primaryAgent = request.agent(app.getHttpServer());
    const secondaryAgent = request.agent(app.getHttpServer());
    await loginExpectSuccess(primaryAgent, currentPassword);
    await loginExpectSuccess(secondaryAgent, currentPassword);

    const nextPassword = 'TeacherPass456!';
    await primaryAgent
      .post('/api/users/me/change-password')
      .send({
        currentPassword,
        newPassword: nextPassword,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ ok: true });
      });

    const profile = await primaryAgent.get('/api/users/me').expect(200);
    const profileBody = profile.body as Record<string, unknown>;
    for (const field of [
      'passwordHash',
      'tokenHash',
      'sessionId',
      'credentialVersion',
      'passwordResetRequestedAt',
    ]) {
      expect(Object.hasOwn(profileBody, field)).toBe(false);
    }
    await secondaryAgent.get('/api/users/me').expect(401);

    const sessionCount = await sessionModel
      .countDocuments({ userId: new Types.ObjectId(createdUserId) })
      .exec();
    expect(sessionCount).toBe(1);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: userEmail, password: currentPassword })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: userEmail, password: nextPassword })
      .expect(201);

    currentPassword = nextPassword;
  });
});
