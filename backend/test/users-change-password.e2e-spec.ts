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
    throw new Error(
      'MONGO_URI is required for users change-password e2e tests.',
    );
  }
};

describe('Users change password (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
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

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));

    const passwordHash = await bcrypt.hash(currentPassword, 10);
    const user = await userModel.create({
      email: userEmail,
      passwordHash,
      roles: ['teacher'],
    });
    createdUserId = user._id.toString();
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
      .expect(400);
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

    await primaryAgent.get('/api/users/me').expect(200);
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
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });

    currentPassword = nextPassword;
  });
});
