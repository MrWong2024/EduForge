import { Types } from 'mongoose';
import { createBrowserAcceptanceEnvironment } from '../src/config/browser-acceptance-environment';
import {
  comparePassword,
  hashPassword,
} from '../src/modules/users/password.utils';
import {
  assertAuthSmokeConnection,
  assertAuthSmokeOwnership,
  AUTH_SMOKE_INITIAL_PASSWORD,
  AUTH_SMOKE_NEW_PASSWORD,
  authSmokeEmail,
  cleanupAuthSmoke,
  planAuthSmokeSessionIndexes,
  prepareAuthSmoke,
  type AuthSmokeRecord,
  type AuthSmokeStore,
  type AuthSmokeUser,
  type SessionIndex,
} from './browser-auth-smoke';

const record: AuthSmokeRecord = {
  namespace: 'auth-batch2-offline',
  teacherId: '000000000000000000000001',
  studentId: '000000000000000000000002',
};
const mongoUri =
  'mongodb://root:offline-only@127.0.0.1:27017/eduforge_browser_test?authSource=admin';
const connection = {
  mongoUri,
  databaseName: 'eduforge_browser_test',
  connectedHost: '127.0.0.1',
  hello: { isWritablePrimary: true },
  authInfo: {
    authenticatedUsers: [{ user: 'root', db: 'admin' }],
    authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
  },
};
function harness() {
  let users: AuthSmokeUser[] = [];
  let indexes: SessionIndex[] = [{ name: '_id_', key: { _id: 1 }, v: 2 }];
  let sessions: Types.ObjectId[] = [];
  let tokens: { userId: Types.ObjectId; email: string }[] = [];
  const store: AuthSmokeStore = {
    assertEmptyAndIdle: jest.fn(() => {
      if (users.length || sessions.length || tokens.length)
        return Promise.reject(new Error('AUTH_SMOKE_FOREIGN_AUTH_DATA'));
      return Promise.resolve();
    }),
    indexes: jest.fn(() => Promise.resolve(indexes)),
    dropIndex: jest.fn((name) => {
      indexes = indexes.filter((index) => index.name !== name);
      return Promise.resolve();
    }),
    createIndex: jest.fn((index) => {
      indexes.push({ key: index.key, ...index.options });
      return Promise.resolve();
    }),
    users: jest.fn(() =>
      Promise.resolve(
        users.filter(
          (user) =>
            [record.teacherId, record.studentId].includes(
              user._id.toHexString(),
            ) ||
            [
              authSmokeEmail(record, 'teacher'),
              authSmokeEmail(record, 'student'),
            ].includes(user.email),
        ),
      ),
    ),
    insertUser: jest.fn((user) => {
      users.push(user);
      return Promise.resolve();
    }),
    resetTokens: jest.fn(() =>
      Promise.resolve(
        tokens.filter(
          (token) =>
            [record.teacherId, record.studentId].includes(
              token.userId.toHexString(),
            ) ||
            [
              authSmokeEmail(record, 'teacher'),
              authSmokeEmail(record, 'student'),
            ].includes(token.email),
        ),
      ),
    ),
    deleteSessions: jest.fn((ids) => {
      sessions = sessions.filter(
        (id) => !ids.some((target) => target.equals(id)),
      );
      return Promise.resolve();
    }),
    deleteResetTokens: jest.fn(() => {
      tokens = tokens.filter(
        (token) =>
          ![record.teacherId, record.studentId].includes(
            token.userId.toHexString(),
          ),
      );
      return Promise.resolve();
    }),
    deleteUser: jest.fn((user) => {
      users = users.filter((row) => !row._id.equals(user._id));
      return Promise.resolve();
    }),
    countSessions: jest.fn((ids) =>
      Promise.resolve(
        sessions.filter((id) => ids.some((target) => target.equals(id))).length,
      ),
    ),
  };
  const recovery = { save: jest.fn(), remove: jest.fn() };
  return {
    store,
    recovery,
    users: () => users,
    setUsers: (rows: AuthSmokeUser[]) => {
      users = rows;
    },
    indexes: () => indexes,
    setIndexes: (rows: SessionIndex[]) => {
      indexes = rows;
    },
    sessions: () => sessions,
    setSessions: (rows: Types.ObjectId[]) => {
      sessions = rows;
    },
    tokens: () => tokens,
    setTokens: (rows: typeof tokens) => {
      tokens = rows;
    },
  };
}

describe('narrow Browser auth smoke support (offline, purpose none)', () => {
  it('rejects wrong purposes and declared databases or remote URIs before a store is reached', () => {
    const write = jest.fn();
    for (const file of [
      { EDUFORGE_DATABASE_PURPOSE: 'standard_test', MONGO_URI: mongoUri },
      {
        EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
        MONGO_URI: mongoUri.replace('eduforge_browser_test', 'eduforge_test'),
      },
      {
        EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
        MONGO_URI: mongoUri.replace('127.0.0.1', 'remote.invalid'),
      },
    ]) {
      expect(() => {
        createBrowserAcceptanceEnvironment(file, {});
        write();
      }).toThrow();
    }
    expect(write).not.toHaveBeenCalled();
    const environment = createBrowserAcceptanceEnvironment(
      { EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance', MONGO_URI: mongoUri },
      {
        MONGO_ADMIN_URI: 'foreign',
        SMTP_PASSWORD: 'foreign',
        BAILIAN_API_KEY: 'foreign',
      },
    );
    expect(environment.MONGO_ADMIN_URI).toBeUndefined();
    expect(environment.SMTP_PASSWORD).toBeUndefined();
    expect(environment.BAILIAN_API_KEY).toBeUndefined();
  });
  it('rejects actual database, server, topology and identity mismatches', () => {
    expect(() => assertAuthSmokeConnection(connection)).not.toThrow();
    for (const input of [
      { ...connection, databaseName: 'eduforge_test' },
      { ...connection, connectedHost: 'remote.invalid' },
      { ...connection, hello: { isWritablePrimary: true, setName: 'foreign' } },
      { ...connection, hello: { isWritablePrimary: true, msg: 'isdbgrid' } },
      {
        ...connection,
        authInfo: {
          ...connection.authInfo,
          authenticatedUsers: [{ user: 'someone', db: 'admin' }],
        },
      },
      {
        ...connection,
        authInfo: {
          ...connection.authInfo,
          authenticatedUserRoles: [
            { role: 'readWrite', db: 'eduforge_browser_test' },
          ],
        },
      },
      {
        ...connection,
        authInfo: {
          ...connection.authInfo,
          authenticatedUsers: [
            ...connection.authInfo.authenticatedUsers,
            { user: 'other', db: 'admin' },
          ],
        },
      },
    ])
      expect(() => assertAuthSmokeConnection(input)).toThrow();
  });
  it('plans only the verified legacy token index and current required Session definitions', () => {
    const plan = planAuthSmokeSessionIndexes([
      { name: '_id_', key: { _id: 1 } },
      { name: 'token_1', key: { token: 1 }, unique: true, v: 2 },
    ]);
    expect(plan.drop).toEqual(['token_1']);
    expect(plan.create).toEqual([
      {
        key: { expiresAt: 1 },
        options: { name: 'expiresAt_1', expireAfterSeconds: 0 },
      },
      { key: { tokenHash: 1 }, options: { name: 'tokenHash_1', unique: true } },
      { key: { userId: 1 }, options: { name: 'userId_1' } },
    ]);
    expect(
      planAuthSmokeSessionIndexes(
        plan.create.map((index) => ({ key: index.key, ...index.options })),
      ),
    ).toEqual({ drop: [], create: [] });
    for (const index of [
      { name: 'token_1', key: { token: 1 } },
      { name: 'token_1', key: { token: 1 }, unique: true, sparse: true },
      { name: 'foreign_1', key: { foreign: 1 } },
      { name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 1 },
    ])
      expect(() => planAuthSmokeSessionIndexes([index])).toThrow(
        'AUTH_SMOKE_UNKNOWN_SESSION_INDEX',
      );
  });
  it('creates exactly the two namespace accounts and never overwrites a conflict', async () => {
    const h = harness();
    await prepareAuthSmoke(h.store, record, h.recovery);
    expect(
      h.users().map(({ email, roles, status, credentialVersion }) => ({
        email,
        roles,
        status,
        credentialVersion,
      })),
    ).toEqual([
      {
        email: 'auth-batch2-offline.teacher@example.invalid',
        roles: ['teacher'],
        status: 'active',
        credentialVersion: 0,
      },
      {
        email: 'auth-batch2-offline.student@example.invalid',
        roles: ['student'],
        status: 'active',
        credentialVersion: 0,
      },
    ]);
    expect(
      await comparePassword(
        AUTH_SMOKE_INITIAL_PASSWORD,
        h.users()[0].passwordHash,
      ),
    ).toBe(true);
    await expect(prepareAuthSmoke(h.store, record, h.recovery)).rejects.toThrow(
      'AUTH_SMOKE_NAMESPACE_EXISTS',
    );
    expect(h.store.insertUser).toHaveBeenCalledTimes(2);
    expect(h.recovery.save).toHaveBeenCalledTimes(1);
  });
  it('does not delete foreign data or unknown indexes during preparation', async () => {
    const h = harness();
    h.setIndexes([{ name: 'foreign_1', key: { foreign: 1 } }]);
    await expect(prepareAuthSmoke(h.store, record, h.recovery)).rejects.toThrow(
      'AUTH_SMOKE_UNKNOWN_SESSION_INDEX',
    );
    expect(h.store.dropIndex).not.toHaveBeenCalled();
    expect(h.store.insertUser).not.toHaveBeenCalled();
    jest
      .mocked(h.store.assertEmptyAndIdle)
      .mockRejectedValueOnce(new Error('AUTH_SMOKE_FOREIGN_AUTH_DATA'));
    await expect(prepareAuthSmoke(h.store, record, h.recovery)).rejects.toThrow(
      'AUTH_SMOKE_FOREIGN_AUTH_DATA',
    );
    expect(h.store.deleteUser).not.toHaveBeenCalled();
  });
  it('stops if an index drifts before the authorized deletion', async () => {
    const h = harness();
    h.setIndexes([{ name: 'token_1', key: { token: 1 }, unique: true }]);
    jest
      .mocked(h.store.indexes)
      .mockResolvedValueOnce(h.indexes())
      .mockResolvedValueOnce([
        { name: 'token_1', key: { token: 1 }, unique: true, sparse: true },
      ]);
    await expect(prepareAuthSmoke(h.store, record, h.recovery)).rejects.toThrow(
      'AUTH_SMOKE_UNKNOWN_SESSION_INDEX',
    );
    expect(h.store.dropIndex).not.toHaveBeenCalled();
  });
  it('cleans only registered accounts after a valid password change without initial-password/version conditions', async () => {
    const h = harness();
    await prepareAuthSmoke(h.store, record, h.recovery);
    h.users()[0].passwordHash = await hashPassword(AUTH_SMOKE_NEW_PASSWORD);
    h.users()[0].credentialVersion = 3;
    const foreignId = new Types.ObjectId('000000000000000000000099');
    const foreign = {
      ...h.users()[1],
      _id: foreignId,
      email: 'foreign@example.invalid',
    };
    h.setUsers([...h.users(), foreign]);
    h.setSessions([new Types.ObjectId(record.teacherId), foreignId]);
    h.setTokens([
      {
        userId: new Types.ObjectId(record.studentId),
        email: authSmokeEmail(record, 'student'),
      },
      { userId: foreignId, email: foreign.email },
    ]);
    await cleanupAuthSmoke(h.store, record);
    expect(h.users()).toEqual([foreign]);
    expect(h.sessions()).toEqual([foreignId]);
    expect(h.tokens()).toEqual([{ userId: foreignId, email: foreign.email }]);
    await cleanupAuthSmoke(h.store, record);
    expect(h.users()).toEqual([foreign]);
  });
  it('rejects mismatched ownership before any cleanup write', async () => {
    const h = harness();
    await prepareAuthSmoke(h.store, record, h.recovery);
    h.users()[0].email = 'foreign@example.invalid';
    expect(() => assertAuthSmokeOwnership(record, h.users())).toThrow(
      'AUTH_SMOKE_ACCOUNT_OWNERSHIP_MISMATCH',
    );
    await expect(cleanupAuthSmoke(h.store, record)).rejects.toThrow(
      'AUTH_SMOKE_ACCOUNT_OWNERSHIP_MISMATCH',
    );
    expect(h.store.deleteSessions).not.toHaveBeenCalled();
    expect(h.store.deleteUser).not.toHaveBeenCalled();
  });
  it('rejects reset token ownership drift and cleans confirmed partial preparation', async () => {
    const h = harness();
    jest
      .mocked(h.store.insertUser)
      .mockImplementationOnce((user) => {
        h.setUsers([user]);
        return Promise.resolve();
      })
      .mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(prepareAuthSmoke(h.store, record, h.recovery)).rejects.toThrow(
      'synthetic failure',
    );
    expect(h.users()).toEqual([]);
    expect(h.recovery.remove).toHaveBeenCalledTimes(1);
    h.setTokens([
      {
        userId: new Types.ObjectId(record.studentId),
        email: 'foreign@example.invalid',
      },
    ]);
    jest.mocked(h.store.deleteSessions).mockClear();
    await expect(cleanupAuthSmoke(h.store, record)).rejects.toThrow(
      'AUTH_SMOKE_RESET_TOKEN_OWNERSHIP_MISMATCH',
    );
    expect(h.store.deleteSessions).not.toHaveBeenCalled();
  });
});
