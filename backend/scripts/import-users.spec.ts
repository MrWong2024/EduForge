import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import mongoose, { type Schema, Types } from 'mongoose';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from '../src/modules/auth/schemas/password-reset-token.schema';
import {
  Session,
  SessionSchema,
} from '../src/modules/auth/schemas/session.schema';
import { User, UserSchema } from '../src/modules/users/schemas/user.schema';
import {
  runImportUsersCli,
  type ExistingImportUser,
  type ImportConnection,
  type ImportDependencies,
  type ImportStore,
  type WriteResult,
} from './import-users';

jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  actual.createConnection = jest.fn(() => {
    throw new Error('UNEXPECTED_REAL_CONNECTION');
  });
  return actual;
});
jest.mock('../src/app.module', () => {
  throw new Error('UNEXPECTED_APP_MODULE_IMPORT');
});
jest.mock('../src/config/configuration', () => {
  throw new Error('UNEXPECTED_APPLICATION_CONFIGURATION_IMPORT');
});

const backendDirectory = resolve(__dirname, 'virtual-backend');
const cwd = resolve(__dirname, 'virtual-input');
const csvPath = resolve(cwd, 'users.csv');
const userId = new Types.ObjectId('000000000000000000000001');
const now = new Date('2026-11-04T00:00:00.000Z');
const syntheticHash = 'unit-test-password-hash';
const testUri = 'mongodb://unit-admin:synthetic-secret@127.0.0.1/eduforge_test';
const changedCsv = 'email,roles,name\nexisting@example.test,student,New Name';
const existingUser = (): ExistingImportUser => ({
  _id: userId,
  roles: ['student'],
  status: 'active',
  name: 'Old Name',
});
const written = { acknowledged: true, matchedCount: 1, modifiedCount: 1 };

function harness(
  settings: {
    env?: NodeJS.ProcessEnv;
    envFile?: string;
    csv?: string;
    databaseName?: string | null;
    missingEnvFile?: boolean;
  } = {},
) {
  const events: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const store: jest.Mocked<ImportStore> = {
    findUser: jest
      .fn<ReturnType<ImportStore['findUser']>, [string]>()
      .mockImplementation((email) => {
        events.push(`find:${email}`);
        return Promise.resolve(null);
      }),
    createUser: jest
      .fn<
        ReturnType<ImportStore['createUser']>,
        Parameters<ImportStore['createUser']>
      >()
      .mockRejectedValue(new Error('UNEXPECTED_CREATE')),
    updateUser: jest
      .fn<
        ReturnType<ImportStore['updateUser']>,
        Parameters<ImportStore['updateUser']>
      >()
      .mockRejectedValue(new Error('UNEXPECTED_UPDATE')),
    deleteSessions: jest
      .fn<
        ReturnType<ImportStore['deleteSessions']>,
        Parameters<ImportStore['deleteSessions']>
      >()
      .mockRejectedValue(new Error('UNEXPECTED_SESSION_DELETE')),
    invalidateResetTokens: jest
      .fn<
        ReturnType<ImportStore['invalidateResetTokens']>,
        Parameters<ImportStore['invalidateResetTokens']>
      >()
      .mockRejectedValue(new Error('UNEXPECTED_TOKEN_INVALIDATION')),
  };
  const connection: jest.Mocked<ImportConnection> = {
    ready: jest.fn<Promise<void>, []>().mockImplementation(() => {
      events.push('ready');
      return Promise.resolve();
    }),
    databaseName: jest.fn(() => {
      events.push('actual-database');
      return settings.databaseName === null
        ? undefined
        : (settings.databaseName ?? 'eduforge_test');
    }),
    createStore: jest.fn(() => {
      events.push('create-store');
      return store;
    }),
    close: jest.fn<Promise<void>, []>().mockImplementation(() => {
      events.push('close');
      return Promise.resolve();
    }),
  };
  const env = settings.env ?? {
    NODE_ENV: 'test',
    EDUFORGE_DATABASE_PURPOSE: 'standard_test',
    MONGO_URI: testUri,
  };
  const readFile = jest.fn((path: string) => {
    events.push(`read:${path}`);
    if (path === csvPath) return settings.csv ?? changedCsv;
    if (path === resolve(backendDirectory, `.env.${env.NODE_ENV ?? ''}`)) {
      if (settings.missingEnvFile) {
        const error = new Error('synthetic missing file');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return settings.envFile ?? '';
    }
    throw new Error('UNEXPECTED_FILE_READ');
  });
  const createConnection = jest.fn(
    (
      ...args: Parameters<ImportDependencies['createConnection']>
    ): ImportConnection => {
      void args;
      events.push('connect');
      return connection;
    },
  );
  const hashPassword = jest
    .fn<Promise<string>, []>()
    .mockRejectedValue(new Error('UNEXPECTED_PASSWORD_HASH'));
  const dependencies: ImportDependencies = {
    env,
    backendDirectory,
    cwd,
    readFile,
    createConnection,
    hashPassword,
    now: () => now,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
  const run = (args: string[] = ['--dry-run']) =>
    runImportUsersCli(['--file=users.csv', ...args], dependencies);
  return {
    run,
    dependencies,
    store,
    connection,
    readFile,
    createConnection,
    hashPassword,
    events,
    logs,
    errors,
  };
}

type Harness = ReturnType<typeof harness>;

function expectCounts(
  h: Harness,
  expected: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  },
  preview = false,
) {
  const summary = h.logs.find((message) =>
    message.includes(preview ? 'preview' : 'summary'),
  );
  expect(summary).toBeDefined();
  for (const [name, value] of Object.entries(expected)) {
    expect(summary).toContain(`${name}=${value}`);
  }
  expect(
    expected.created + expected.updated + expected.skipped + expected.failed,
  ).toBe(expected.total);
}

function expectNoWrites(h: Harness) {
  expect(h.store.createUser).not.toHaveBeenCalled();
  expect(h.store.updateUser).not.toHaveBeenCalled();
  expect(h.store.deleteSessions).not.toHaveBeenCalled();
  expect(h.store.invalidateResetTokens).not.toHaveBeenCalled();
  expect(h.hashPassword).not.toHaveBeenCalled();
}

function enableReset(h: Harness, modifiedCount = 1) {
  h.store.findUser.mockResolvedValue(existingUser());
  h.store.updateUser.mockResolvedValue({ ...written, modifiedCount });
  h.hashPassword.mockResolvedValue(syntheticHash);
  h.store.deleteSessions.mockResolvedValue({
    acknowledged: true,
    deletedCount: 0,
  });
  h.store.invalidateResetTokens.mockResolvedValue({
    acknowledged: true,
    matchedCount: 0,
    modifiedCount: 0,
  });
}

describe('import-users CLI configuration and connection gates (no database)', () => {
  it('prints help without environment, files, hashing, or a connection', async () => {
    const h = harness({ env: {} });
    expect(await runImportUsersCli(['--help'], h.dependencies)).toBe(0);
    expect(h.logs.join('\n')).toMatch(/Usage:/i);
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.createConnection).not.toHaveBeenCalled();
    expectNoWrites(h);
  });

  it.each([undefined, '', 'staging', 'test ', 'browser_acceptance'])(
    'rejects raw NODE_ENV=%s before a file could supply a default',
    async (nodeEnv) => {
      const h = harness({
        env: nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv },
        envFile: `NODE_ENV=development\nMONGO_URI=${testUri}`,
      });
      expect(await h.run()).toBe(1);
      expect(h.readFile).not.toHaveBeenCalled();
      expect(h.createConnection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['development', 'eduforge_dev'],
    ['test', 'eduforge_test'],
    ['production', 'eduforge'],
  ])('accepts the existing %s database mapping', async (nodeEnv, database) => {
    const h = harness({
      env: {
        NODE_ENV: nodeEnv,
        MONGO_URI: `mongodb://127.0.0.1/${database}`,
      },
      databaseName: database,
    });
    expect(await h.run()).toBe(0);
    expect(h.readFile.mock.calls.map(([path]) => path)).toEqual([
      resolve(backendDirectory, `.env.${nodeEnv}`),
      csvPath,
    ]);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expectNoWrites(h);
  });

  it('uses the explicit process MONGO_URI and keeps the selected environment', async () => {
    const h = harness({
      envFile: 'NODE_ENV=production\nMONGO_URI=mongodb://127.0.0.1/eduforge',
    });
    const before = { ...h.dependencies.env };
    const inheritedAppUri = process.env.MONGO_URI;
    expect(await h.run()).toBe(0);
    expect(h.createConnection.mock.calls[0][0]).toBe(testUri);
    expect(h.dependencies.env).toEqual(before);
    expect(process.env.MONGO_URI).toBe(inheritedAppUri);
  });

  it('can read only the chosen file MONGO_URI without unrelated app settings', async () => {
    const h = harness({
      env: { NODE_ENV: 'test' },
      envFile: `MONGO_URI=${testUri}\nAI_FEEDBACK_WORKER_ENABLED=invalid\nSMTP_PORT=invalid`,
    });
    expect(await h.run()).toBe(0);
    expect(h.createConnection.mock.calls[0][0]).toBe(testUri);
    expectNoWrites(h);
  });

  it('allows a missing chosen file when the process MONGO_URI is explicit', async () => {
    const h = harness({ missingEnvFile: true });
    expect(await h.run()).toBe(0);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { NODE_ENV: 'test' },
    { NODE_ENV: 'test', MONGO_URI: '' },
    {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://127.0.0.1/eduforge_test_extra',
    },
    { NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1/' },
  ])('rejects missing or wrong database without connecting', async (env) => {
    const h = harness({ env });
    expect(await h.run()).toBe(1);
    expect(h.createConnection).not.toHaveBeenCalled();
    expect(h.readFile.mock.calls.map(([path]) => path)).not.toContain(csvPath);
  });

  it.each(['', '   '])(
    'rejects explicit empty process MONGO_URI=%j without fallback',
    async (mongoUri) => {
      const h = harness({
        env: {
          NODE_ENV: 'test',
          MONGO_URI: mongoUri,
          MONGO_ADMIN_URI: testUri,
        },
        envFile: `MONGO_URI=${testUri}`,
      });
      expect(await h.run()).toBe(1);
      expect(h.errors).toEqual([
        '[import-users] error code=MONGO_URI_REQUIRED',
      ]);
      expect(h.createConnection).not.toHaveBeenCalled();
      expectNoWrites(h);
    },
  );

  it.each(['process', 'file'])(
    'does not select a legacy-only MONGO_ADMIN_URI from the %s',
    async (source) => {
      const h = harness({
        env:
          source === 'process'
            ? { NODE_ENV: 'test', MONGO_ADMIN_URI: testUri }
            : { NODE_ENV: 'test' },
        envFile: source === 'file' ? `MONGO_ADMIN_URI=${testUri}` : '',
      });
      expect(await h.run()).toBe(1);
      expect(h.errors).toEqual([
        '[import-users] error code=MONGO_URI_REQUIRED',
      ]);
      expect(h.createConnection).not.toHaveBeenCalled();
      expectNoWrites(h);
    },
  );

  it.each(['process', 'file'])(
    'uses MONGO_URI from the %s while ignoring coexisting legacy values',
    async (source) => {
      const h = harness({
        env: {
          NODE_ENV: 'test',
          MONGO_ADMIN_URI: 'ignored-legacy-process-value',
          ...(source === 'process' ? { MONGO_URI: testUri } : {}),
        },
        envFile:
          'MONGO_ADMIN_URI=ignored-legacy-file-value\n' +
          (source === 'file' ? `MONGO_URI=${testUri}` : ''),
      });
      expect(await h.run()).toBe(0);
      expect(h.createConnection.mock.calls[0][0]).toBe(testUri);
      expectNoWrites(h);
    },
  );

  it.each(['process', 'file'])(
    'refuses browser acceptance purpose from the %s configuration',
    async (source) => {
      const h = harness({
        env:
          source === 'process'
            ? {
                NODE_ENV: 'test',
                MONGO_URI: testUri,
                EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
              }
            : undefined,
        envFile:
          source === 'file'
            ? 'EDUFORGE_DATABASE_PURPOSE=browser_acceptance'
            : '',
      });
      expect(await h.run()).toBe(1);
      expect(h.createConnection).not.toHaveBeenCalled();
    },
  );

  it('rejects a syntax error anywhere in CSV before connecting', async () => {
    const h = harness({
      csv: 'email,roles\nvalid@example.test,student\nfi"rst"@example.test,student',
    });
    expect(await h.run([])).toBe(1);
    expect(h.createConnection).not.toHaveBeenCalled();
    expectNoWrites(h);
  });

  it('disables automatic model initialization and gates store construction on actual identity', async () => {
    const h = harness();
    expect(await h.run()).toBe(0);
    expect(h.createConnection).toHaveBeenCalledWith(
      testUri,
      expect.objectContaining({
        autoCreate: false,
        autoIndex: false,
        retryReads: false,
        retryWrites: false,
      }),
    );
    expect(h.events.slice(-6)).toEqual([
      'connect',
      'ready',
      'actual-database',
      'create-store',
      'find:existing@example.test',
      'close',
    ]);
  });

  it.each(['eduforge', null])(
    'closes on actual databaseName=%s without models or queries',
    async (databaseName) => {
      const h = harness({ databaseName });
      expect(await h.run()).toBe(1);
      expect(h.connection.createStore).not.toHaveBeenCalled();
      expect(h.store.findUser).not.toHaveBeenCalled();
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it('closes a connection whose readiness fails and redacts the raw error', async () => {
    const h = harness();
    h.connection.ready.mockRejectedValue(
      new Error(`connection failed ${testUri}`),
    );
    expect(await h.run()).toBe(1);
    expect(h.connection.createStore).not.toHaveBeenCalled();
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expect(h.errors.join('\n')).not.toContain(testUri);
    expect(h.errors.join('\n')).not.toContain('synthetic-secret');
  });

  it('returns nonzero when connection creation fails without a handle', async () => {
    const h = harness();
    h.createConnection.mockImplementation(() => {
      throw new Error(`unable to connect ${testUri}`);
    });
    expect(await h.run()).toBe(1);
    expect(h.connection.close).not.toHaveBeenCalled();
    expect(h.errors.join('\n')).not.toContain(testUri);
  });

  it('does not turn a close failure into successful completion', async () => {
    const h = harness();
    h.connection.close.mockRejectedValue(new Error(`close failed ${testUri}`));
    expect(await h.run()).toBe(1);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expect(h.errors.join('\n')).not.toContain(testUri);
  });
});

describe('import-users row results and preview (fake store only)', () => {
  it('previews create, update, unchanged and failure without any write or hash', async () => {
    const h = harness({
      csv: [
        'email,roles,name',
        'new@example.test,student,New',
        'changed@example.test,student,New Name',
        'same@example.test,student,Old Name',
        'bad@example.test,invalid-role,Invalid',
      ].join('\n'),
    });
    h.store.findUser.mockImplementation((email) =>
      Promise.resolve(email.startsWith('new@') ? null : existingUser()),
    );
    expect(await h.run()).toBe(1);
    expectCounts(
      h,
      { total: 4, created: 1, updated: 1, skipped: 1, failed: 1 },
      true,
    );
    expectNoWrites(h);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('previews unchanged users as skipped when reset was not requested', async () => {
    const h = harness({
      csv: 'email,roles,name\nexisting@example.test,student,Old Name',
    });
    h.store.findUser.mockResolvedValue(existingUser());
    expect(await h.run()).toBe(0);
    expectCounts(
      h,
      { total: 1, created: 0, updated: 0, skipped: 1, failed: 0 },
      true,
    );
    expectNoWrites(h);
  });

  it('previews explicit password resets without hashing or revoking credentials', async () => {
    const h = harness({
      csv: 'email,roles,name\nexisting@example.test,student,Old Name',
    });
    h.store.findUser.mockResolvedValue(existingUser());
    expect(await h.run(['--dry-run', '--reset-password'])).toBe(0);
    expectCounts(
      h,
      { total: 1, created: 0, updated: 1, skipped: 0, failed: 0 },
      true,
    );
    expectNoWrites(h);
  });

  it.each(['\n', '\r\n'])(
    'reports physical line 4 after a multiline field with %j line endings',
    async (eol) => {
      const h = harness({
        csv:
          `email,roles,name${eol}` +
          `first@example.test,student,"First${eol}Second"${eol}` +
          'next@example.test,invalid-role,Next',
      });
      expect(await h.run()).toBe(1);
      expect(h.errors.join('\n')).toMatch(/line=4\b/);
      expect(h.errors.join('\n')).not.toContain('invalid-role');
      expectCounts(
        h,
        { total: 2, created: 1, updated: 0, skipped: 0, failed: 1 },
        true,
      );
      expectNoWrites(h);
    },
  );

  it('keeps blank records out of counts and rejects duplicate normalized emails', async () => {
    const h = harness({
      csv: 'email,roles\n FIRST@example.test ,student\n,\nfirst@EXAMPLE.test,teacher',
    });
    expect(await h.run()).toBe(1);
    expect(h.store.findUser).toHaveBeenCalledTimes(1);
    expect(h.store.findUser).toHaveBeenCalledWith('first@example.test');
    expectCounts(
      h,
      { total: 2, created: 1, updated: 0, skipped: 0, failed: 1 },
      true,
    );
    expectNoWrites(h);
  });

  it.each<[WriteResult, number, number, number, number]>([
    [{ ...written }, 0, 1, 0, 0],
    [{ ...written, modifiedCount: 0 }, 0, 0, 1, 0],
    [{ ...written, matchedCount: 0, modifiedCount: 0 }, 1, 0, 0, 1],
    [{ ...written, matchedCount: 2 }, 1, 0, 0, 1],
    [{ ...written, acknowledged: false }, 1, 0, 0, 1],
  ])(
    'classifies confirmed update result %j exactly once',
    async (result, exitCode, updated, skipped, failed) => {
      const h = harness();
      h.store.findUser.mockResolvedValue(existingUser());
      h.store.updateUser.mockResolvedValue(result);
      expect(await h.run([])).toBe(exitCode);
      expectCounts(h, { total: 1, created: 0, updated, skipped, failed });
      expect(h.store.deleteSessions).not.toHaveBeenCalled();
      expect(h.store.invalidateResetTokens).not.toHaveBeenCalled();
      expect(h.hashPassword).not.toHaveBeenCalled();
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves optional blanks, replaces roles, and never resets a password implicitly', async () => {
    const h = harness({
      csv: 'email,roles,name\nexisting@example.test,teacher,',
    });
    h.store.findUser.mockResolvedValue(existingUser());
    h.store.updateUser.mockResolvedValue(written);
    expect(await h.run([])).toBe(0);
    expect(h.store.updateUser).toHaveBeenCalledWith(userId, {
      roles: ['teacher'],
    });
    expect(h.hashPassword).not.toHaveBeenCalled();
    expect(h.store.deleteSessions).not.toHaveBeenCalled();
    expect(h.store.invalidateResetTokens).not.toHaveBeenCalled();
  });

  it('uses only a fake hash for new users and retains a successful row before a later failure', async () => {
    const h = harness({
      csv: 'email,roles,name\nnew@example.test,student,New\ninvalid,student,Bad',
    });
    h.hashPassword.mockResolvedValue(syntheticHash);
    h.store.createUser.mockResolvedValue(undefined);
    expect(await h.run([])).toBe(1);
    expect(h.hashPassword).toHaveBeenCalledTimes(1);
    expect(h.store.createUser).toHaveBeenCalledWith({
      email: 'new@example.test',
      roles: ['student'],
      name: 'New',
      passwordHash: syntheticHash,
    });
    expectCounts(h, {
      total: 2,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
    });
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('counts a write exception as failed once and never logs its raw content', async () => {
    const h = harness();
    h.store.findUser.mockResolvedValue(existingUser());
    h.store.updateUser.mockRejectedValue(
      new Error(`${testUri}\nforged-log=synthetic-secret`),
    );
    expect(await h.run([])).toBe(1);
    expectCounts(h, {
      total: 1,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
    });
    const output = [...h.logs, ...h.errors].join('\n');
    expect(output).not.toContain(testUri);
    expect(output).not.toContain('synthetic-secret');
    expect(output).not.toContain('forged-log');
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });
});

describe('import-users explicit password resets (fake credentials only)', () => {
  it('uses isolated schema clones and exact native credential filters in the default adapter', async () => {
    const h = harness();
    h.hashPassword.mockResolvedValue(syntheticHash);
    const sourceSchemas = [UserSchema, SessionSchema, PasswordResetTokenSchema];
    const originalOptions = sourceSchemas.map((schema) => ({
      ...schema.options,
    }));
    const registrations: Array<{ name: string; schema: Schema }> = [];
    const forbiddenInitialization = jest.fn(() => {
      throw new Error('UNEXPECTED_INITIALIZATION_WRITE');
    });
    const initializers = {
      init: forbiddenInitialization,
      ensureIndexes: forbiddenInitialization,
      syncIndexes: forbiddenInitialization,
      createCollection: forbiddenInitialization,
    };
    const findExec = jest
      .fn<Promise<ExistingImportUser>, []>()
      .mockResolvedValue(existingUser());
    const maxTimeMS = jest.fn(() => ({ exec: findExec }));
    const users = {
      ...initializers,
      findOne: jest.fn(() => ({ maxTimeMS })),
      create: forbiddenInitialization,
      updateOne: jest.fn(() => ({
        exec: jest.fn<Promise<WriteResult>, []>().mockResolvedValue(written),
      })),
    };
    const sessions = {
      ...initializers,
      deleteMany: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({
          acknowledged: true,
          deletedCount: 0,
        }),
      })),
    };
    const resetTokens = {
      ...initializers,
      updateMany: jest.fn(() => ({
        exec: jest.fn<Promise<WriteResult>, []>().mockResolvedValue({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
        }),
      })),
    };
    const model = jest.fn();
    model.mockImplementation((name: string, schema: Schema) => {
      registrations.push({ name, schema });
      if (name === User.name) return users;
      if (name === Session.name) return sessions;
      if (name === PasswordResetToken.name) return resetTokens;
      throw new Error('UNEXPECTED_MODEL');
    });
    const nativeConnection = new mongoose.Connection();
    Object.defineProperty(nativeConnection, 'db', {
      value: { databaseName: 'eduforge_test' },
    });
    jest
      .spyOn(nativeConnection, 'openUri')
      .mockRejectedValue(new Error('UNEXPECTED_OPEN_URI'));
    jest
      .spyOn(nativeConnection, 'asPromise')
      .mockResolvedValue(nativeConnection);
    Object.defineProperty(nativeConnection, 'model', { value: model });
    const close = jest
      .spyOn(nativeConnection, 'close')
      .mockResolvedValue(undefined);
    jest
      .mocked(mongoose.createConnection)
      .mockReturnValueOnce(nativeConnection);
    const dependencies: Partial<ImportDependencies> = { ...h.dependencies };
    delete dependencies.createConnection;

    expect(
      await runImportUsersCli(
        ['--file=users.csv', '--reset-password'],
        dependencies,
      ),
    ).toBe(0);
    expect(h.createConnection).not.toHaveBeenCalled();
    expect(mongoose.createConnection).toHaveBeenLastCalledWith(
      testUri,
      expect.objectContaining({ autoCreate: false, autoIndex: false }),
    );
    expect(registrations.map(({ name }) => name)).toEqual([
      User.name,
      Session.name,
      PasswordResetToken.name,
    ]);
    for (const [index, registration] of registrations.entries()) {
      expect(registration.schema).not.toBe(sourceSchemas[index]);
      expect(registration.schema.options.autoCreate).toBe(false);
      expect(registration.schema.options.autoIndex).toBe(false);
      expect(sourceSchemas[index].options).toEqual(originalOptions[index]);
    }
    expect(users.findOne).toHaveBeenCalledWith({
      email: 'existing@example.test',
    });
    expect(maxTimeMS).toHaveBeenCalledWith(5000);
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $set: { name: 'New Name', passwordHash: syntheticHash } },
      { runValidators: true, maxTimeMS: 5000 },
    );
    expect(sessions.deleteMany).toHaveBeenCalledWith(
      { userId },
      { maxTimeMS: 5000 },
    );
    expect(resetTokens.updateMany).toHaveBeenCalledWith(
      { userId, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { maxTimeMS: 5000 },
    );
    expect(forbiddenInitialization).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])(
    'attempts both revocations after a matched password update with modifiedCount=%i',
    async (modifiedCount) => {
      const h = harness();
      enableReset(h, modifiedCount);
      expect(await h.run(['--reset-password'])).toBe(0);
      expect(h.store.updateUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ passwordHash: syntheticHash }),
      );
      expect(h.store.deleteSessions).toHaveBeenCalledWith(userId);
      expect(h.store.invalidateResetTokens).toHaveBeenCalledWith(userId, now);
      expect(h.hashPassword).toHaveBeenCalledTimes(1);
      expectCounts(h, {
        total: 1,
        created: 0,
        updated: modifiedCount,
        skipped: 1 - modifiedCount,
        failed: 0,
      });
    },
  );

  it.each([
    ['sessions', 'throw'],
    ['sessions', 'unacknowledged'],
    ['tokens', 'throw'],
    ['tokens', 'unacknowledged'],
    ['both', 'throw'],
  ])(
    'attempts both revocations and fails once if %s are %s',
    async (target, failure) => {
      const h = harness();
      enableReset(h);
      if (target === 'sessions' || target === 'both') {
        if (failure === 'throw') {
          h.store.deleteSessions.mockRejectedValue(new Error(testUri));
        } else {
          h.store.deleteSessions.mockResolvedValue({
            acknowledged: false,
            deletedCount: 0,
          });
        }
      }
      if (target === 'tokens' || target === 'both') {
        if (failure === 'throw') {
          h.store.invalidateResetTokens.mockRejectedValue(new Error(testUri));
        } else {
          h.store.invalidateResetTokens.mockResolvedValue({
            acknowledged: false,
            matchedCount: 0,
            modifiedCount: 0,
          });
        }
      }
      expect(await h.run(['--reset-password'])).toBe(1);
      expect(h.store.deleteSessions).toHaveBeenCalledTimes(1);
      expect(h.store.invalidateResetTokens).toHaveBeenCalledTimes(1);
      expectCounts(h, {
        total: 1,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      });
      expect(h.errors.join('\n')).toMatch(/partial|部分/i);
      expect(h.errors.join('\n')).not.toContain(testUri);
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['throw', 'unmatched', 'unacknowledged'])(
    'does not revoke credentials when the password update is %s',
    async (failure) => {
      const h = harness();
      enableReset(h);
      if (failure === 'throw') {
        h.store.updateUser.mockRejectedValue(
          new Error('synthetic update error'),
        );
      } else {
        h.store.updateUser.mockResolvedValue({
          acknowledged: failure !== 'unacknowledged',
          matchedCount: failure === 'unmatched' ? 0 : 1,
          modifiedCount: 0,
        });
      }
      expect(await h.run(['--reset-password'])).toBe(1);
      expect(h.store.deleteSessions).not.toHaveBeenCalled();
      expect(h.store.invalidateResetTokens).not.toHaveBeenCalled();
      expectCounts(h, {
        total: 1,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      });
    },
  );

  it('performs the full reset and both revocations on an explicit rerun', async () => {
    const h = harness();
    enableReset(h, 0);
    expect(await h.run(['--reset-password'])).toBe(0);
    expect(await h.run(['--reset-password'])).toBe(0);
    expect(h.hashPassword).toHaveBeenCalledTimes(2);
    expect(h.store.updateUser).toHaveBeenCalledTimes(2);
    expect(h.store.deleteSessions).toHaveBeenCalledTimes(2);
    expect(h.store.invalidateResetTokens).toHaveBeenCalledTimes(2);
    expect(h.connection.close).toHaveBeenCalledTimes(2);
  });
});

const isolatedGuard = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const Module = require('node:module');
const denied = () => { throw new Error('UNEXPECTED_ENV_NETWORK_OR_APP'); };
net.connect = denied;
net.createConnection = denied;
tls.connect = denied;
const originalRead = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (/(^|[\\/])\.env(?:\.|$)/.test(String(path))) return denied();
  return originalRead.call(this, path, ...args);
};
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (/(?:app|auth|learning-tasks)\.module$/.test(request)) return denied();
  const loaded = originalLoad.call(this, request, ...args);
  if (request === 'mongoose') loaded.createConnection = denied;
  return loaded;
};
`;

function isolatedProcess(code: string) {
  return spawnSync(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      '-r',
      'tsconfig-paths/register',
      '-e',
      isolatedGuard + code,
    ],
    {
      cwd: resolve(__dirname, '..'),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
      timeout: 15_000,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}

describe('import-users isolated entry points (no environment or network)', () => {
  it('can be imported without running the CLI or loading application configuration', () => {
    const target = JSON.stringify(resolve(__dirname, 'import-users.ts'));
    const result = isolatedProcess(`
if (process.env.NODE_ENV !== undefined) throw new Error('ENV_NOT_ISOLATED');
const target = require(${target});
if (typeof target.runImportUsersCli !== 'function') throw new Error('EXPORT_MISSING');
if (process.exitCode) throw new Error('CLI_STARTED_ON_IMPORT');
console.log('IMPORT_ONLY_OK');
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('IMPORT_ONLY_OK');
    expect(result.stderr).toBe('');
  });

  it('executes --help as the main module with no NODE_ENV or file access', () => {
    const target = JSON.stringify(resolve(__dirname, 'import-users.ts'));
    const result = isolatedProcess(`
if (process.env.NODE_ENV !== undefined) throw new Error('ENV_NOT_ISOLATED');
process.argv = [process.execPath, ${target}, '--help'];
require('node:module')._load(${target}, null, true);
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage:/i);
    expect(result.stderr).toBe('');
  });

  it('rejects missing NODE_ENV at the actual main entry before configuration or network access', () => {
    const target = JSON.stringify(resolve(__dirname, 'import-users.ts'));
    const result = isolatedProcess(`
if (process.env.NODE_ENV !== undefined) throw new Error('ENV_NOT_ISOLATED');
process.argv = [process.execPath, ${target}, '--file=synthetic-missing.csv', '--dry-run'];
require('node:module')._load(${target}, null, true);
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV_REQUIRED');
    expect(result.stderr).not.toContain('UNEXPECTED_ENV_NETWORK_OR_APP');
    expect(result.stdout).toBe('');
  });
});
