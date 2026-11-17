import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model, Types, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { SessionService } from '../src/modules/auth/services/session.service';
import { MailService } from '../src/modules/mail/mail.service';
import {
  hashPassword,
  comparePassword,
} from '../src/modules/users/password.utils';
import { createMongooseStore, importUsers } from '../scripts/import-users';
import { buildHeaderKeys, parseCsv } from '../scripts/import-users-csv';

jest.setTimeout(60000);
const password = 'SyntheticPass123!';
const nextPassword = 'SyntheticNext456!';
const namespace = `auth-security-${randomUUID()}`;
type TestUser = { id: Types.ObjectId; email: string };

function publicResponse(response: request.Response): Record<string, unknown> {
  const body: unknown = response.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('AUTH_TEST_JSON_OBJECT_REQUIRED');
  }
  return body as Record<string, unknown>;
}

function barrier() {
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
              () => reject(new Error('AUTH_TEST_BARRIER_TIMEOUT')),
              10000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

describe('Authentication security (real HTTP and Mongo)', () => {
  let app: INestApplication<App> | undefined;
  let users: Model<User>;
  let sessions: Model<Session>;
  let resets: Model<PasswordResetToken>;
  let sessionService: SessionService;
  let importConnection: Connection | undefined;
  let importStore: ReturnType<typeof createMongooseStore> | undefined;
  const ids: Types.ObjectId[] = [];
  const mail = new Map<string, string[]>();
  const sender = jest.fn((options: { to: string; resetUrl: string }) => {
    const token = new URL(options.resetUrl).searchParams.get('token');
    if (!token) return Promise.reject(new Error('AUTH_TEST_CAPTURE_MISSING'));
    mail.set(options.to, [...(mail.get(options.to) ?? []), token]);
    return Promise.resolve();
  });
  const server = () => {
    if (!app) throw new Error('AUTH_TEST_APP_REQUIRED');
    return app.getHttpServer();
  };
  const post = (path: string) =>
    request(server()).post(path).timeout({ response: 10000, deadline: 15000 });
  const probe = (cookie: string) =>
    request(server())
      .get('/api/users/me')
      .set('Cookie', cookie)
      .timeout({ response: 10000, deadline: 15000 });
  const login = (user: TestUser, value = password) =>
    post('/api/auth/login').send({ email: user.email, password: value });
  function cookieFrom(response: request.Response): string {
    const value: unknown = response.headers['set-cookie'];
    if (!Array.isArray(value) || typeof value[0] !== 'string')
      throw new Error('AUTH_TEST_COOKIE_MISSING');
    return value[0].split(';')[0];
  }
  async function makeUser(
    status: UserStatus = UserStatus.Active,
  ): Promise<TestUser> {
    const id = new Types.ObjectId();
    ids.push(id);
    const email = `${namespace}-${ids.length}@example.invalid`;
    await users.create({
      _id: id,
      email,
      passwordHash: await hashPassword(password),
      roles: ['teacher'],
      status,
    });
    return { id, email };
  }
  const change = (
    cookie: string,
    currentPassword = password,
    newPassword = nextPassword,
  ) =>
    post('/api/users/me/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword, newPassword });
  const forgot = (user: TestUser) =>
    post('/api/auth/forgot-password').send({ email: user.email });
  const reset = (token: string, newPassword = nextPassword) =>
    post('/api/auth/reset-password').send({ token, newPassword });
  function latestToken(user: TestUser) {
    const token = mail.get(user.email)?.at(-1);
    if (!token) throw new Error('AUTH_TEST_MAIL_MISSING');
    return token;
  }
  async function imported(
    user: TestUser,
    status?: string,
    resetPassword = false,
  ) {
    if (!importStore) throw new Error('AUTH_TEST_IMPORT_CONNECTION_REQUIRED');
    const records = parseCsv(
      `email,roles,status\n${user.email},teacher,${status ?? ''}`,
    );
    return importUsers(
      importStore,
      records.slice(1),
      buildHeaderKeys(records[0].cells),
      { dryRun: false, resetPassword },
      {
        hashPassword: () => hashPassword(nextPassword),
        now: () => new Date(),
        error: () => undefined,
      },
    );
  }

  beforeAll(async () => {
    await prepareAuthSessionIndexes();
    mongoose.set('maxTimeMS', 10000);
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendPasswordResetEmail: sender })
      .compile();
    app = fixture.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
    resets = app.get(getModelToken(PasswordResetToken.name));
    sessionService = app.get(SessionService);
    importConnection = await openAuthTestConnection();
    importStore = createMongooseStore(importConnection);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      if (users && ids.length) {
        const filter = { userId: { $in: ids } };
        await sessions.deleteMany(filter).exec();
        await resets.deleteMany(filter).exec();
        await users.deleteMany({ _id: { $in: ids } }).exec();
        const residual = await Promise.all([
          sessions.countDocuments(filter),
          resets.countDocuments(filter),
          users.countDocuments({ _id: { $in: ids } }),
        ]);
        if (residual.some((count) => count !== 0))
          throw new Error('AUTH_TEST_CLEANUP_RESIDUAL');
        console.info(
          'Auth security scoped cleanup: User/Session/PasswordResetToken zero residual.',
        );
      }
    } finally {
      try {
        await importConnection?.close();
      } finally {
        try {
          await app?.close();
        } finally {
          authTestEnvironment.restore();
          mail.clear();
        }
      }
    }
  });

  it('uses only the session hash and exposes only public user fields, then logs out', async () => {
    const user = await makeUser();
    const response = await login(user).expect(201);
    const cookie = cookieFrom(response);
    const raw = cookie.slice('ef_session='.length);
    const session = await sessions.collection.findOne({ userId: user.id });
    expect(
      session !== null &&
        !Object.hasOwn(session, 'token') &&
        session.tokenHash === createHash('sha256').update(raw).digest('hex') &&
        session.credentialVersion === 0,
    ).toBe(true);
    for (const key of [
      'passwordHash',
      'tokenHash',
      'sessionId',
      'credentialVersion',
      'passwordResetRequestedAt',
    ]) {
      expect(Object.hasOwn(publicResponse(response), key)).toBe(false);
    }
    const result = await probe(cookie).expect(200);
    expect(Object.hasOwn(publicResponse(result), 'credentialVersion')).toBe(
      false,
    );
    await post('/api/auth/logout').set('Cookie', cookie).expect(201);
    await probe(cookie).expect(401);
  });

  it('rejects real JSON Cookies, malformed tokens and expired sessions', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    for (const value of [
      { $ne: null },
      ['any'],
      null,
      '',
      'f'.repeat(63),
      'A'.repeat(64),
    ]) {
      await probe(
        'ef_session=' +
          encodeURIComponent(
            typeof value === 'string' ? value : 'j:' + JSON.stringify(value),
          ),
      ).expect(401);
    }
    await sessions.updateMany(
      { userId: user.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await probe(cookie).expect(401);
  });

  it('rejects suspended logins and existing sessions, and import reactivation cannot revive credentials', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    await forgot(user).expect(200);
    const token = latestToken(user);
    await imported(user, 'suspended');
    await probe(cookie).expect(401);
    await login(user).expect(401);
    await imported(user, 'active');
    await probe(cookie).expect(401);
    const result = await reset(token).expect(400);
    expect(publicResponse(result).code).toBe('RESET_TOKEN_INVALID');
    await login(user).expect(201);
  });

  it('keeps the current Cookie on change and invalidates other old sessions and reset links', async () => {
    const user = await makeUser();
    const primary = cookieFrom(await login(user).expect(201));
    const other = cookieFrom(await login(user).expect(201));
    await forgot(user).expect(200);
    const token = latestToken(user);
    await change(primary).expect(200);
    await probe(primary).expect(200);
    await probe(other).expect(401);
    expect(publicResponse(await reset(token).expect(400)).code).toBe(
      'RESET_TOKEN_INVALID',
    );
    await login(user).expect(401);
    await login(user, nextPassword).expect(201);
  });

  it('resets once without logging in and invalidates every earlier session', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    await forgot(user).expect(200);
    const token = latestToken(user);
    const response = await reset(token).expect(200);
    expect(response.headers['set-cookie'] === undefined).toBe(true);
    await probe(cookie).expect(401);
    expect(publicResponse(await reset(token).expect(400)).code).toBe(
      'RESET_TOKEN_INVALID',
    );
    await login(user, nextPassword).expect(201);
  });

  it('rejects a delayed login that verified the previous password', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    const gate = barrier();
    const original = sessionService.createUserSession.bind(
      sessionService,
    ) as SessionService['createUserSession'];
    jest
      .spyOn(sessionService, 'createUserSession')
      .mockImplementationOnce(async (...args) => {
        gate.enter();
        await gate.released;
        return original(...args);
      });
    const pending = login(user).then((response) => response);
    try {
      await gate.wait();
      await change(cookie).expect(200);
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(401);
    await probe(cookie).expect(200);
  });

  it('version-scoped delayed cleanup cannot delete a newly issued session', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    const gate = barrier();
    const original = sessionService.clearUserSessionsBeforeVersion.bind(
      sessionService,
    ) as SessionService['clearUserSessionsBeforeVersion'];
    jest
      .spyOn(sessionService, 'clearUserSessionsBeforeVersion')
      .mockImplementationOnce(async (...args) => {
        gate.enter();
        await gate.released;
        return original(...args);
      });
    const pending = change(cookie).then((response) => response);
    let fresh: string;
    try {
      await gate.wait();
      fresh = cookieFrom(await login(user, nextPassword).expect(201));
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(200);
    await probe(fresh).expect(200);
  });

  it('a claimed reset cannot overwrite a password changed before its final User CAS', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    await forgot(user).expect(200);
    const token = latestToken(user);
    const gate = barrier();
    const original = users.updateOne.bind(users) as typeof users.updateOne;
    jest
      .spyOn(users, 'updateOne')
      .mockImplementationOnce((...args: Parameters<typeof original>) => {
        const query = original(...args);
        const execute = query.exec.bind(query) as typeof query.exec;
        jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
          gate.enter();
          await gate.released;
          return execute();
        });
        return query;
      });
    const pending = reset(token, 'ResetDifferent789!').then(
      (response) => response,
    );
    try {
      await gate.wait();
      await change(cookie).expect(200);
    } finally {
      gate.release();
    }
    const response = await pending;
    expect(response.status).toBe(400);
    expect(publicResponse(response).code).toBe('RESET_TOKEN_INVALID');
    await login(user, nextPassword).expect(201);
  });

  it('allows only one competing change and cannot revive a logged-out current session', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    const results = await Promise.all([
      change(cookie).then((result) => result.status),
      change(cookie, password, 'CompetingPass789!').then(
        (result) => result.status,
      ),
    ]);
    expect(results.sort()).toEqual([200, 401]);
    const second = await makeUser();
    const current = cookieFrom(await login(second).expect(201));
    const gate = barrier();
    const original = sessionService.promoteCurrentSession.bind(
      sessionService,
    ) as SessionService['promoteCurrentSession'];
    jest
      .spyOn(sessionService, 'promoteCurrentSession')
      .mockImplementationOnce(async (...args) => {
        gate.enter();
        await gate.released;
        return original(...args);
      });
    const pending = change(current).then((response) => response);
    try {
      await gate.wait();
      await sessions.deleteMany({ userId: second.id });
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(401);
    expect(await sessions.countDocuments({ userId: second.id })).toBe(0);
    await login(second, nextPassword).expect(201);
  });

  it('allows only one consumer of the same reset token', async () => {
    const user = await makeUser();
    await forgot(user).expect(200);
    const token = latestToken(user);
    const results = await Promise.all([
      reset(token).then((result) => result.status),
      reset(token, 'OtherReset789!').then((result) => result.status),
    ]);
    expect(results.sort()).toEqual([200, 400]);
  });

  it('issues one token/email for concurrent forgot requests and a newer request supersedes a delayed older insert', async () => {
    const user = await makeUser();
    const before = sender.mock.calls.length;
    await Promise.all([forgot(user).expect(200), forgot(user).expect(200)]);
    expect(sender.mock.calls.length - before).toBe(1);
    expect(await resets.countDocuments({ userId: user.id })).toBe(1);
    const second = await makeUser();
    const gate = barrier();
    const original = resets.collection.insertOne.bind(
      resets.collection,
    ) as typeof resets.collection.insertOne;
    jest
      .spyOn(resets.collection, 'insertOne')
      .mockImplementationOnce(async (document, options) => {
        gate.enter();
        await gate.released;
        return original(document, options);
      });
    const pending = forgot(second).then((response) => response);
    let newer: string;
    try {
      await gate.wait();
      await users.updateOne(
        { _id: second.id },
        { $set: { passwordResetRequestedAt: new Date(Date.now() - 61000) } },
      );
      await forgot(second).expect(200);
      newer = latestToken(second);
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(200);
    const older = latestToken(second);
    expect(publicResponse(await reset(older).expect(400)).code).toBe(
      'RESET_TOKEN_INVALID',
    );
    await reset(newer).expect(200);
  });

  it('uses the formal import Store for reset/CAS, preserves omitted status, and rejects invalid emails', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    await forgot(user).expect(200);
    const token = latestToken(user);
    const result = await imported(user, undefined, true);
    expect(result.updated).toBe(1);
    const updated = await users
      .findById(user.id)
      .select('+passwordHash')
      .exec();
    expect(updated?.credentialVersion).toBe(1);
    expect(updated?.status).toBe('active');
    expect(
      updated !== null &&
        (await comparePassword(nextPassword, updated.passwordHash)),
    ).toBe(true);
    await probe(cookie).expect(401);
    expect(publicResponse(await reset(token).expect(400)).code).toBe(
      'RESET_TOKEN_INVALID',
    );
    if (!importStore) throw new Error('AUTH_TEST_IMPORT_CONNECTION_REQUIRED');
    const records = parseCsv('email,roles\ninvalid@localhost,teacher');
    const invalid = await importUsers(
      importStore,
      records.slice(1),
      buildHeaderKeys(records[0].cells),
      { dryRun: false, resetPassword: false },
      {
        hashPassword: () => hashPassword(password),
        now: () => new Date(),
        error: () => undefined,
      },
    );
    expect(invalid.failed).toBe(1);
    expect(await users.countDocuments({ email: 'invalid@localhost' })).toBe(0);
  });

  it('enforces password policy and rejects internal fields through formal HTTP validation', async () => {
    const user = await makeUser();
    const cookie = cookieFrom(await login(user).expect(201));
    for (const operation of [
      () => login(user, 'a'.repeat(73)),
      () => change(cookie, 'a'.repeat(73)),
      () => change(cookie, password, '汉'.repeat(25)),
    ]) {
      const response = await operation().expect(400);
      expect(publicResponse(response).code).toBe('PASSWORD_POLICY_VIOLATION');
    }
    await post('/api/users/me/change-password')
      .set('Cookie', cookie)
      .send({
        currentPassword: password,
        newPassword: nextPassword,
        credentialVersion: 50,
      })
      .expect(400);
    await request(server())
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ credentialVersion: 50, passwordResetRequestedAt: null })
      .timeout({ deadline: 15000 })
      .expect(400);
    await login(user).expect(201);
    expect((await users.findById(user.id).exec())?.credentialVersion).toBe(0);
  });
});
