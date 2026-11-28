import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { randomUUID } from 'node:crypto';
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
import {
  hashSessionToken,
  SessionService,
} from '../src/modules/auth/services/session.service';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';

jest.setTimeout(30000);

function requestBarrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    enter,
    release,
    released,
    async wait() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('SESSION_LIMIT_TEST_BARRIER_TIMEOUT')),
              8000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

describe('Users change password (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let sessionService: SessionService;
  let resetTokenModel: Model<PasswordResetToken>;
  let readbackConnection: Connection | undefined;
  const ownedUserIds: Types.ObjectId[] = [];
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

  type FixtureAccount = { id: Types.ObjectId; email: string };
  type FixtureSession = Session & {
    _id: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
  };

  async function createFixtureAccount(password: string) {
    const id = new Types.ObjectId();
    const email = `session-limit.${randomUUID()}@example.invalid`;
    ownedUserIds.push(id);
    await userModel.create({
      _id: id,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      roles: ['teacher'],
      credentialVersion: 0,
    });
    return { id, email };
  }

  async function issue(account: FixtureAccount, password: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .timeout({ response: 10000, deadline: 15000 })
      .send({ email: account.email, password })
      .expect(201);
    const headers: unknown = response.headers['set-cookie'];
    if (!Array.isArray(headers) || typeof headers[0] !== 'string') {
      throw new Error('SESSION_LIMIT_COOKIE_MISSING');
    }
    const cookie = headers[0].split(';')[0];
    const token = cookie.slice(cookie.indexOf('=') + 1);
    return { cookie, tokenHash: hashSessionToken(token) };
  }

  function readback() {
    const db = readbackConnection?.db;
    if (!db) throw new Error('SESSION_LIMIT_READBACK_REQUIRED');
    return db;
  }

  function readSessions(account: FixtureAccount) {
    return readback()
      .collection<FixtureSession>(sessionModel.collection.name)
      .find({ userId: account.id }, { signal: AbortSignal.timeout(5000) })
      .toArray();
  }

  async function effectiveLabels(
    account: FixtureAccount,
    credentialVersion: number,
    labels: Map<string, string>,
  ) {
    const now = Date.now();
    return (await readSessions(account))
      .filter(
        (row) =>
          row.credentialVersion === credentialVersion &&
          row.expiresAt.getTime() > now,
      )
      .map((row) => labels.get(row.tokenHash) ?? 'unregistered')
      .sort();
  }

  beforeAll(async () => {
    await prepareAuthSessionIndexes();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
    await assertAuthTestConnection(
      app.get<Connection>(
        getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
      ),
    );
    readbackConnection = await openAuthTestConnection();
    console.info(
      'Session limit gate: default/named/independent eduforge_test, local writable rs0.',
    );

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    sessionService = app.get(SessionService);
    resetTokenModel = app.get(getModelToken(PasswordResetToken.name));

    const passwordHash = await bcrypt.hash(currentPassword, 10);
    const userId = new Types.ObjectId();
    createdUserId = userId.toString();
    ownedUserIds.push(userId);
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
      if (ownedUserIds.length) {
        const userScope = { $in: ownedUserIds };
        const cleanup = await Promise.allSettled([
          sessionModel.deleteMany({ userId: userScope }).maxTimeMS(5000).exec(),
          resetTokenModel
            .deleteMany({ userId: userScope })
            .maxTimeMS(5000)
            .exec(),
          userModel.deleteMany({ _id: userScope }).maxTimeMS(5000).exec(),
        ]);
        const db = readback();
        const options = { signal: AbortSignal.timeout(5000) };
        const residual = await Promise.all([
          db
            .collection(sessionModel.collection.name)
            .countDocuments({ userId: userScope }, options),
          db
            .collection(resetTokenModel.collection.name)
            .countDocuments({ userId: userScope }, options),
          db
            .collection(userModel.collection.name)
            .countDocuments({ _id: userScope }, options),
        ]);
        expect(residual).toEqual([0, 0, 0]);
        if (cleanup.some(({ status }) => status === 'rejected')) {
          throw new Error('USERS_PASSWORD_AUTH_FIXTURE_CLEANUP_FAILED');
        }
        console.info(
          'Session limit scoped cleanup: independent User/Session/PasswordResetToken residual=0.',
        );
      }
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          await readbackConnection?.close();
        } finally {
          authTestEnvironment.restore();
        }
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

  it('converges overlapping login trims to the same five active sessions', async () => {
    const password = 'SyntheticLimit123!';
    const account = await createFixtureAccount(password);
    const other = await createFixtureAccount(password);
    const now = Date.now();
    const tie = new Date(now - 60000);
    const labels = new Map<string, string>();
    const fixture = (
      label: string,
      userId = account.id,
      credentialVersion = 0,
      expiresAt = new Date(now + 3600000),
    ) => {
      const tokenHash = hashSessionToken(randomUUID());
      labels.set(tokenHash, label);
      return {
        _id: new Types.ObjectId(),
        userId,
        tokenHash,
        credentialVersion,
        expiresAt,
      };
    };
    // These tied IDs are inserted in rank order. Some historical rows only
    // have createdAt, and one has no timestamps at all.
    await sessionModel.collection.insertMany([
      fixture('undated'),
      { ...fixture('tie-low'), createdAt: tie, updatedAt: tie },
      { ...fixture('tie-mid'), createdAt: tie },
      { ...fixture('tie-high'), createdAt: tie, updatedAt: tie },
      {
        ...fixture('past-cutoff', account.id, 0, new Date(now + 300000)),
        updatedAt: new Date(now + 1000),
      },
      { ...fixture('other-version', account.id, 1), updatedAt: tie },
      { ...fixture('other-user', other.id), updatedAt: tie },
    ]);
    expect(
      (await readSessions(account)).some(
        (row) => labels.get(row.tokenHash) === 'past-cutoff',
      ),
    ).toBe(true);

    // Expired for the application clock, but retained by Mongo's real TTL
    // clock until the test ends, so the cutoff filter is exercised reliably.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 600000);
    try {
      expect(await effectiveLabels(account, 0, labels)).toEqual([
        'tie-high',
        'tie-low',
        'tie-mid',
        'undated',
      ]);
      const exactlyFull = await issue(account, password);
      labels.set(exactlyFull.tokenHash, 'login-first');
      expect(await effectiveLabels(account, 0, labels)).toEqual([
        'login-first',
        'tie-high',
        'tie-low',
        'tie-mid',
        'undated',
      ]);

      const gate = requestBarrier();
      const remove = sessionModel.deleteMany.bind(
        sessionModel,
      ) as typeof sessionModel.deleteMany;
      const heldDelete = jest
        .spyOn(sessionModel, 'deleteMany')
        .mockImplementationOnce((...args) => {
          const query = remove(...args);
          const execute = query.exec.bind(query) as typeof query.exec;
          jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
            gate.enter();
            await gate.released;
            return execute();
          });
          return query;
        });
      const pending = issue(account, password);
      void pending.catch(() => undefined);
      let second: Awaited<typeof pending>;
      try {
        await gate.wait();
        second = await issue(account, password);
        labels.set(second.tokenHash, 'login-later');
      } finally {
        gate.release();
        await Promise.allSettled([pending]);
        heldDelete.mockRestore();
      }
      labels.set((await pending).tokenHash, 'login-held');
      const retained = [
        'login-first',
        'login-held',
        'login-later',
        'tie-high',
        'tie-mid',
      ];
      expect(await effectiveLabels(account, 0, labels)).toEqual(retained);
      expect(await effectiveLabels(account, 1, labels)).toEqual([
        'other-version',
      ]);
      expect(await effectiveLabels(other, 0, labels)).toEqual(['other-user']);
      expect(
        (await readSessions(account)).some(
          (row) => labels.get(row.tokenHash) === 'past-cutoff',
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', second.cookie)
        .expect(201);
      expect(await effectiveLabels(account, 0, labels)).toEqual(
        retained.filter((label) => label !== 'login-later'),
      );
      const refill = await issue(account, password);
      labels.set(refill.tokenHash, 'login-refill');
      expect(await effectiveLabels(account, 0, labels)).toEqual([
        'login-first',
        'login-held',
        'login-refill',
        'tie-high',
        'tie-mid',
      ]);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Cookie', second.cookie)
        .expect(401);
      console.info(
        'Session limit login: active 4→5→5→4→5; overlapping trims kept the three logins and the two higher-ranked tied rows; expired and both isolation controls stayed outside the trim.',
      );
    } finally {
      clock.mockRestore();
    }
  });

  it('trims a promoted password-change session together with concurrent new-version logins', async () => {
    const password = 'SyntheticLimit123!';
    const next = 'SyntheticLimit456!';
    const account = await createFixtureAccount(password);
    const current = await issue(account, password);
    const old = await issue(account, password);
    const currentRow = (await readSessions(account)).find(
      (row) => row.tokenHash === current.tokenHash,
    );
    if (!currentRow?.createdAt) {
      throw new Error('SESSION_LIMIT_ORIGINAL_TIMESTAMP_MISSING');
    }
    const admissionTime = new Date(currentRow.createdAt.getTime() + 1);
    const labels = new Map([
      [current.tokenHash, 'promoted'],
      [old.tokenHash, 'old-version'],
    ]);
    const gate = requestBarrier();
    const promote = sessionService.promoteCurrentSession.bind(
      sessionService,
    ) as SessionService['promoteCurrentSession'];
    const heldPromotion = jest
      .spyOn(sessionService, 'promoteCurrentSession')
      .mockImplementationOnce(async (...args) => {
        gate.enter();
        await gate.released;
        return promote(...args);
      });
    const clock = jest
      .spyOn(sessionModel.base, 'now')
      .mockReturnValue(admissionTime);
    const changing = request(app.getHttpServer())
      .post('/api/users/me/change-password')
      .timeout({ response: 10000, deadline: 15000 })
      .set('Cookie', current.cookie)
      .send({ currentPassword: password, newPassword: next })
      .then((response) => response);
    try {
      await gate.wait();
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Cookie', current.cookie)
        .expect(401);
      for (let index = 1; index <= 5; index += 1) {
        const fresh = await issue(account, next);
        labels.set(fresh.tokenHash, `before-${index}`);
      }
      expect(await effectiveLabels(account, 1, labels)).toEqual([
        'before-1',
        'before-2',
        'before-3',
        'before-4',
        'before-5',
      ]);
      const freshRows = (await readSessions(account)).filter(
        (row) => row.credentialVersion === 1,
      );
      expect(
        freshRows.map((row) => ({
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          hasHigherId: row._id.toHexString() > currentRow._id.toHexString(),
        })),
      ).toEqual(
        Array.from({ length: 5 }, () => ({
          createdAt: admissionTime,
          updatedAt: admissionTime,
          hasHigherId: true,
        })),
      );
    } finally {
      gate.release();
      await Promise.allSettled([changing]);
      heldPromotion.mockRestore();
      clock.mockRestore();
    }
    expect((await changing).status).toBe(200);
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Cookie', current.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Cookie', old.cookie)
      .expect(401);
    expect(await effectiveLabels(account, 0, labels)).toEqual([]);
    expect(await effectiveLabels(account, 1, labels)).toEqual([
      'before-2',
      'before-3',
      'before-4',
      'before-5',
      'promoted',
    ]);
    expect(
      (await readSessions(account)).find(
        (row) => row.tokenHash === current.tokenHash,
      )?.updatedAt,
    ).toEqual(admissionTime);

    for (let index = 1; index <= 5; index += 1) {
      const fresh = await issue(account, next);
      labels.set(fresh.tokenHash, `after-${index}`);
    }
    expect(await effectiveLabels(account, 1, labels)).toEqual([
      'after-1',
      'after-2',
      'after-3',
      'after-4',
      'after-5',
    ]);
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Cookie', current.cookie)
      .expect(401);
    console.info(
      'Session limit migration: transition 401, promotion 200 with 5 active (promoted plus four same-millisecond logins), five later logins kept 5 and evicted the promoted session.',
    );
  });
});
