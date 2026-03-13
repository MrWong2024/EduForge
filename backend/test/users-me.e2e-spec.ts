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

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for users /me e2e tests.');
  }
};

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

describe('Users /me profile update (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let agent: ReturnType<typeof request.agent>;
  let createdUserId = '';

  const userEmail = `users.me.${Date.now()}@example.com`;
  const userPassword = 'TeacherPass123!';

  const login = async () => {
    await agent
      .post('/api/auth/login')
      .send({ email: userEmail, password: userPassword })
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use(cookieParser());
    await app.init();

    agent = request.agent(app.getHttpServer());
    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));

    const passwordHash = await bcrypt.hash(userPassword, 10);
    const user = await userModel.create({
      email: userEmail,
      passwordHash,
      roles: ['teacher'],
    });
    createdUserId = user._id.toString();

    await login();
  });

  afterAll(async () => {
    if (!KEEP_DB && createdUserId) {
      const userObjectId = new Types.ObjectId(createdUserId);
      await Promise.all([
        sessionModel.deleteMany({ userId: userObjectId }),
        userModel.deleteOne({ _id: userObjectId }),
      ]);
    }
    await app.close();
  });

  it('allows authenticated user to update name', async () => {
    const updated = await agent
      .patch('/api/users/me')
      .send({ name: 'Professor Wang' })
      .expect(200);
    const body = updated.body as MeResponse;

    expect(body.name).toBe('Professor Wang');
    expect(body.email).toBe(userEmail);
    expect(body).not.toHaveProperty('passwordHash');
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

    expect(patchBody.studentNo).toBe('20260001');
    expect(patchBody.employeeNo).toBe('T0001');
    expect(patchBody).not.toHaveProperty('passwordHash');

    const fetched = await agent.get('/api/users/me').expect(200);
    const getBody = fetched.body as MeResponse;
    expect(getBody).toEqual(patchBody);
  });

  it('does not allow updating email, roles, or status via PATCH /api/users/me', async () => {
    const before = await agent.get('/api/users/me').expect(200);
    const beforeBody = before.body as MeResponse;

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

    expect(afterBody.email).toBe(beforeBody.email);
    expect(afterBody.roles).toEqual(beforeBody.roles);
    expect(afterBody.status).toBe(beforeBody.status);
    expect(afterBody).not.toHaveProperty('passwordHash');
  });

  it('handles empty patch payload without corrupting data', async () => {
    const before = await agent.get('/api/users/me').expect(200);
    const beforeBody = before.body as MeResponse;

    const patched = await agent.patch('/api/users/me').send({}).expect(200);
    const patchBody = patched.body as MeResponse;

    expect(patchBody).toEqual(beforeBody);
  });
});
