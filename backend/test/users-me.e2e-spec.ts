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

type MeResponse = {
  id: string;
  email: string;
  roles: string[];
  status: string;
  name?: string;
  studentNo?: string;
  employeeNo?: string;
  createdAt?: string;
};

function expectPublicUser(body: MeResponse): void {
  for (const field of [
    'passwordHash',
    'token',
    'tokenHash',
    'sessionId',
    'credentialVersion',
    'passwordResetRequestedAt',
  ]) {
    expect(Object.hasOwn(body, field)).toBe(false);
  }
}

describe('Users /me profile update (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let resetTokenModel: Model<PasswordResetToken>;
  let agent: ReturnType<typeof request.agent>;
  let createdUserId = '';

  const userEmail = `users.me.${Date.now()}@example.com`;
  const userPassword = 'TeacherPass123!';

  const login = async () => {
    await agent
      .post('/api/auth/login')
      .send({ email: userEmail, password: userPassword })
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

    agent = request.agent(app.getHttpServer());
    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    resetTokenModel = app.get(getModelToken(PasswordResetToken.name));

    const passwordHash = await bcrypt.hash(userPassword, 10);
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

    await login();
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
          throw new Error('USERS_ME_AUTH_FIXTURE_CLEANUP_FAILED');
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

  it('allows authenticated user to update name', async () => {
    const updated = await agent
      .patch('/api/users/me')
      .send({ name: 'Professor Wang' })
      .expect(200);
    const body = updated.body as MeResponse;
    expectPublicUser(body);

    expect(body.name).toBe('Professor Wang');
    expect(body.email).toBe(userEmail);
  });

  it('allows authenticated user to update studentNo and employeeNo', async () => {
    const patched = await agent
      .patch('/api/users/me')
      .send({
        studentNo: '20260001',
        employeeNo: 'T0001',
      })
      .expect(200);
    const patchBody = patched.body as MeResponse;
    expectPublicUser(patchBody);

    expect(patchBody.studentNo).toBe('20260001');
    expect(patchBody.employeeNo).toBe('T0001');

    const fetched = await agent.get('/api/users/me').expect(200);
    const getBody = fetched.body as MeResponse;
    expectPublicUser(getBody);
    expect(getBody).toEqual(patchBody);
  });

  it('does not allow updating email, roles, or status via PATCH /api/users/me', async () => {
    const before = await agent.get('/api/users/me').expect(200);
    const beforeBody = before.body as MeResponse;
    expectPublicUser(beforeBody);

    await agent
      .patch('/api/users/me')
      .send({
        email: 'hacker@example.com',
        roles: ['admin'],
        status: 'suspended',
      })
      .expect(400);

    const after = await agent.get('/api/users/me').expect(200);
    const afterBody = after.body as MeResponse;
    expectPublicUser(afterBody);

    expect(afterBody.email).toBe(beforeBody.email);
    expect(afterBody.roles).toEqual(beforeBody.roles);
    expect(afterBody.status).toBe(beforeBody.status);
  });

  it.each([
    { field: 'credentialVersion', value: 99 },
    { field: 'passwordResetRequestedAt', value: new Date(0).toISOString() },
    { field: 'sessionId', value: new Types.ObjectId().toString() },
    { field: 'tokenHash', value: 'client-controlled' },
    { field: 'passwordHash', value: 'client-controlled' },
  ])(
    'rejects internal field $field in profile updates',
    async ({ field, value }) => {
      const before = await agent.get('/api/users/me').expect(200);
      const beforeBody = before.body as MeResponse;
      expectPublicUser(beforeBody);
      const beforeCredentials = await userModel
        .findById(createdUserId)
        .select({ _id: 0, credentialVersion: 1, passwordResetRequestedAt: 1 })
        .lean<{
          credentialVersion: number;
          passwordResetRequestedAt: Date | null;
        }>()
        .exec();

      await agent
        .patch('/api/users/me')
        .send({ [field]: value })
        .expect(400);

      const after = await agent.get('/api/users/me').expect(200);
      const afterBody = after.body as MeResponse;
      expectPublicUser(afterBody);
      expect(afterBody).toEqual(beforeBody);
      const afterCredentials = await userModel
        .findById(createdUserId)
        .select({ _id: 0, credentialVersion: 1, passwordResetRequestedAt: 1 })
        .lean<{
          credentialVersion: number;
          passwordResetRequestedAt: Date | null;
        }>()
        .exec();
      expect(afterCredentials).toEqual(beforeCredentials);
    },
  );

  it('handles empty patch payload without corrupting data', async () => {
    const before = await agent.get('/api/users/me').expect(200);
    const beforeBody = before.body as MeResponse;
    expectPublicUser(beforeBody);

    const patched = await agent.patch('/api/users/me').send({}).expect(200);
    const patchBody = patched.body as MeResponse;
    expectPublicUser(patchBody);

    expect(patchBody).toEqual(beforeBody);
  });
});
