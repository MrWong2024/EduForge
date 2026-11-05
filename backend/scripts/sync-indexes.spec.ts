import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import mongoose, { type mongo, type Schema } from 'mongoose';
import {
  registerSyncIndexModels,
  runSyncIndexesCli,
  type SyncIndexDefinition,
  type SyncIndexModel,
  type SyncIndexesConnection,
  type SyncIndexesDependencies,
} from './sync-indexes';
import { SYNC_INDEX_SCHEMAS } from './sync-indexes-models';

jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  actual.createConnection = jest.fn(() => {
    throw new Error('UNEXPECTED_REAL_CONNECTION');
  });
  return actual;
});
jest.mock('../src/app.module', () => {
  throw new Error('UNEXPECTED_APPLICATION_LOAD');
});

const database = 'eduforge_test';
const adminUri = 'mongodb://synthetic.invalid/eduforge_test';
const backendDirectory = resolve(__dirname, 'synthetic-backend');
const apply = ['--apply', '--confirm-db', database];
const idIndex: mongo.IndexDescriptionInfo = {
  name: '_id_',
  key: { _id: 1 },
};
const legacy = {
  name: 'account_created',
  key: { accountId: 1, createdAt: -1 },
  unique: true,
  partialFilterExpression: { active: true },
  collation: { locale: 'en', strength: 2 },
} satisfies mongo.IndexDescriptionInfo;
const replacement: SyncIndexDefinition = [
  { accountId: 1, createdAt: -1 },
  { name: 'account_created', sparse: true },
];
const installedReplacement: mongo.IndexDescriptionInfo = {
  name: 'account_created',
  key: { accountId: 1, createdAt: -1 },
  sparse: true,
};
const ttl: SyncIndexDefinition = [
  { expiresAt: 1 },
  { name: 'expiry_ttl', expireAfterSeconds: 300 },
];
const installedTtl: mongo.IndexDescriptionInfo = {
  name: 'expiry_ttl',
  key: { expiresAt: 1 },
  expireAfterSeconds: 300,
};

type Diff = Awaited<ReturnType<SyncIndexModel['diffIndexes']>>;
type ModelFixture = {
  name: string;
  collectionName: string;
  missing?: boolean;
  existing?: mongo.IndexDescriptionInfo[];
  drop?: string[];
  create?: SyncIndexDefinition[];
  installed?: mongo.IndexDescriptionInfo[];
};

function fakeModel(fixture: ModelFixture, events: string[]) {
  const { name, collectionName } = fixture;
  let exists = !fixture.missing;
  let indexes = exists ? [idIndex, ...(fixture.existing ?? [])] : [];
  let diff: Diff = {
    toDrop: fixture.drop ?? [],
    toCreate: fixture.create ?? [],
  };

  const listIndexes = jest.fn(() => {
    events.push('indexes:' + name);
    if (!exists) return Promise.reject(new Error('MISSING_COLLECTION_READ'));
    return Promise.resolve(structuredClone(indexes));
  });
  const diffIndexes = jest.fn<
    Promise<Diff>,
    Parameters<SyncIndexModel['diffIndexes']>
  >(() => {
    events.push('diff:' + name);
    return Promise.resolve(structuredClone(diff));
  });
  const createCollection = jest.fn(() => {
    events.push('write:createCollection:' + name);
    exists = true;
    indexes = [idIndex];
    return Promise.resolve();
  });
  const cleanIndexes = jest.fn(({ toDrop }: { toDrop: string[] }) => {
    events.push('write:cleanIndexes:' + name);
    indexes = indexes.filter((index) => !toDrop.includes(index.name ?? ''));
    diff = {
      ...diff,
      toDrop: diff.toDrop.filter((indexName) => !toDrop.includes(indexName)),
    };
    return Promise.resolve(toDrop);
  });
  const createIndexes = jest.fn<
    Promise<void>,
    Parameters<SyncIndexModel['createIndexes']>
  >(() => {
    events.push('write:createIndexes:' + name);
    indexes.push(...(fixture.installed ?? []));
    diff = { ...diff, toCreate: [] };
    return Promise.resolve();
  });
  const syncIndexes = jest.fn(() => {
    throw new Error('UNEXPECTED_FULL_SYNC');
  });
  const model = {
    name,
    collectionName,
    listIndexes,
    diffIndexes,
    createCollection,
    cleanIndexes,
    createIndexes,
    syncIndexes,
  } satisfies SyncIndexModel & { syncIndexes: typeof syncIndexes };

  return {
    model,
    exists: () => exists,
    indexes: () => structuredClone(indexes),
  };
}

const addOnly: ModelFixture = {
  name: 'Session',
  collectionName: 'sessions',
  create: [ttl],
  installed: [installedTtl],
};
const replace: ModelFixture = {
  name: 'Task',
  collectionName: 'tasks',
  existing: [legacy],
  drop: [legacy.name],
  create: [replacement],
  installed: [installedReplacement],
};
const absent: ModelFixture = {
  name: 'PasswordResetToken',
  collectionName: 'passwordresettokens',
  missing: true,
  create: [ttl],
  installed: [installedTtl],
};

function harness(fixtures: ModelFixture[] = [addOnly]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const events: string[] = [];
  const models = fixtures.map((fixture) => fakeModel(fixture, events));
  const connection = {
    ready: jest.fn<Promise<void>, []>(() => {
      events.push('ready');
      return Promise.resolve();
    }),
    databaseName: jest.fn<string | undefined, []>(() => {
      events.push('databaseName');
      return database;
    }),
    models: jest.fn<readonly SyncIndexModel[], []>(() => {
      events.push('register');
      return models.map(({ model }) => model);
    }),
    collectionExists: jest.fn((name: string) => {
      events.push('exists:' + name);
      return Promise.resolve(
        models.find(({ model }) => model.collectionName === name)?.exists() ??
          false,
      );
    }),
    close: jest.fn<Promise<void>, []>(() => {
      events.push('close');
      return Promise.resolve();
    }),
  } satisfies SyncIndexesConnection;
  const createConnection = jest.fn<
    SyncIndexesConnection,
    Parameters<SyncIndexesDependencies['createConnection']>
  >(() => {
    events.push('connect');
    return connection;
  });
  const readFile = jest.fn<string, [string]>(() => '');
  const retire = jest
    .fn<Promise<void>, [string[]]>()
    .mockResolvedValue(undefined);
  const deps: SyncIndexesDependencies = {
    env: { NODE_ENV: 'test', MONGO_ADMIN_URI: adminUri },
    backendDirectory,
    readFile,
    createConnection,
    log: (line) => {
      logs.push(line);
      if (line.includes('"event":"plan"')) events.push('plan-printed');
    },
    error: (line) => errors.push(line),
    retire,
  };

  return {
    deps,
    connection,
    createConnection,
    readFile,
    retire,
    models: models.map(({ model }) => model),
    indexes: models.map(({ indexes }) => indexes),
    logs,
    errors,
    events,
    run: (args: readonly string[] = []) => runSyncIndexesCli(args, deps),
  };
}

type Harness = ReturnType<typeof harness>;

function jsonEvent(h: Harness, name: string): unknown {
  for (const line of [...h.logs, ...h.errors]) {
    if (!line.startsWith('{')) continue;
    const event: unknown = JSON.parse(line);
    if (
      event &&
      typeof event === 'object' &&
      'event' in event &&
      event.event === name
    ) {
      return event;
    }
  }
  throw new Error('Expected event ' + name);
}

function noWrites(h: Harness) {
  for (const model of h.models) {
    expect(model.createCollection).not.toHaveBeenCalled();
    expect(model.cleanIndexes).not.toHaveBeenCalled();
    expect(model.createIndexes).not.toHaveBeenCalled();
    expect(model.syncIndexes).not.toHaveBeenCalled();
  }
}

function output(h: Harness) {
  return [...h.logs, ...h.errors].join('\n');
}

describe('sync-indexes ordinary plan and apply (offline)', () => {
  it.each<[readonly string[]]>([[[]], [['--dry-run']]])(
    'previews both replacement and missing-collection plans with %j',
    async (args) => {
      const h = harness([replace, absent]);

      expect(await h.run(args)).toBe(0);
      noWrites(h);
      expect(h.createConnection).toHaveBeenCalledWith(
        adminUri,
        expect.objectContaining({ autoCreate: false, autoIndex: false }),
      );
      expect(h.events.slice(0, 4)).toEqual([
        'connect',
        'ready',
        'databaseName',
        'register',
      ]);
      expect(h.models[0].diffIndexes).toHaveBeenCalledWith({
        indexOptionsToCreate: true,
      });
      expect(h.models[1].diffIndexes).toHaveBeenCalledWith({
        indexOptionsToCreate: true,
      });
      expect(h.models[1].listIndexes).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'plan')).toMatchObject({
        mode: 'dry-run',
        databaseName: database,
        models: [
          {
            model: 'Task',
            collection: 'tasks',
            createCollection: false,
            toDrop: [legacy],
            toCreate: [{ key: replacement[0], options: replacement[1] }],
          },
          {
            model: 'PasswordResetToken',
            collection: 'passwordresettokens',
            createCollection: true,
            toDrop: [],
            toCreate: [{ key: ttl[0], options: ttl[1] }],
          },
        ],
      });
      expect(output(h)).toContain('"key":{"accountId":1,"createdAt":-1}');
      expect(jsonEvent(h, 'result')).toMatchObject({
        mode: 'dry-run',
        status: 'preview',
        writesAttempted: false,
      });
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it('applies an add-only plan, explicitly creates just the missing collection, and verifies both models', async () => {
    const h = harness([addOnly, absent]);

    expect(await h.run(apply)).toBe(0);
    const firstWrite = h.events.findIndex((event) =>
      event.startsWith('write:'),
    );
    const beforeWrite = h.events.slice(0, firstWrite);
    expect(firstWrite).toBeGreaterThan(0);
    expect(beforeWrite).toContain('plan-printed');
    for (const fixture of [addOnly, absent]) {
      expect(
        beforeWrite.filter(
          (event) => event === 'exists:' + fixture.collectionName,
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        beforeWrite.filter((event) => event === 'diff:' + fixture.name).length,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(
      beforeWrite.filter((event) => event === 'indexes:Session').length,
    ).toBeGreaterThanOrEqual(2);
    expect(h.models[0].createCollection).not.toHaveBeenCalled();
    expect(h.models[1].createCollection).toHaveBeenCalledTimes(1);
    expect(h.events.filter((event) => event.startsWith('write:'))).toEqual([
      'write:createIndexes:Session',
      'write:createCollection:PasswordResetToken',
      'write:createIndexes:PasswordResetToken',
    ]);
    for (const model of h.models) {
      expect(model.cleanIndexes).not.toHaveBeenCalled();
      expect(model.syncIndexes).not.toHaveBeenCalled();
      expect(model.createIndexes).toHaveBeenCalledTimes(1);
      expect(model.createIndexes).toHaveBeenCalledWith({ toCreate: [ttl] });
    }
    expect(jsonEvent(h, 'result')).toMatchObject({
      mode: 'apply',
      status: 'completed',
      writesAttempted: true,
      models: [
        {
          model: 'Session',
          status: 'succeeded',
          terminalState: 'verified',
          finalIndexes: [idIndex, installedTtl],
        },
        {
          model: 'PasswordResetToken',
          status: 'succeeded',
          terminalState: 'verified',
          finalIndexes: [idIndex, installedTtl],
        },
      ],
    });
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('replaces the authorized index by passing both explicit arrays', async () => {
    const h = harness([replace]);

    expect(await h.run([...apply, '--allow-drop'])).toBe(0);
    expect(h.events.filter((event) => event.startsWith('write:'))).toEqual([
      'write:cleanIndexes:Task',
      'write:createIndexes:Task',
    ]);
    expect(h.models[0].cleanIndexes).toHaveBeenCalledWith({
      toDrop: [legacy.name],
    });
    expect(h.models[0].createIndexes).toHaveBeenCalledWith({
      toCreate: [replacement],
    });
    expect(h.models[0].syncIndexes).not.toHaveBeenCalled();
    expect(h.indexes[0]()).toEqual([idIndex, installedReplacement]);
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'completed',
      models: [
        { model: 'Task', status: 'succeeded', terminalState: 'verified' },
      ],
    });
  });

  it('rejects the whole plan before writes if any model would drop an index without permission', async () => {
    const h = harness([absent, replace]);

    expect(await h.run(apply)).toBe(1);
    noWrites(h);
    expect(output(h)).toContain('DROP_CONFIRMATION_REQUIRED');
    expect(jsonEvent(h, 'plan')).toMatchObject({
      mode: 'apply',
      models: [{ createCollection: true }, { toDrop: [legacy] }],
    });
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('finishes every model preflight before starting any write', async () => {
    const h = harness([absent, replace]);
    h.models[1].listIndexes.mockRejectedValueOnce(
      new Error('unreadable indexes'),
    );

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    noWrites(h);
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: false,
    });
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('rejects changed raw metadata even when the pending drop name is unchanged', async () => {
    const h = harness([absent, replace]);
    h.models[1].listIndexes
      .mockResolvedValueOnce([idIndex, legacy])
      .mockResolvedValue([idIndex, { ...legacy, hidden: true }]);

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    expect(output(h)).toContain('INDEX_PLAN_DRIFT');
    noWrites(h);
  });

  it('rechecks each model after earlier writes and leaves later models unexecuted on drift', async () => {
    const h = harness([addOnly, replace, absent]);
    h.models[1].listIndexes
      .mockResolvedValueOnce([idIndex, legacy])
      .mockResolvedValueOnce([idIndex, legacy])
      .mockResolvedValue([idIndex, { ...legacy, key: { accountId: 1 } }]);

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    expect(output(h)).toContain('INDEX_PLAN_DRIFT');
    expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
    expect(h.models[1].createIndexes).not.toHaveBeenCalled();
    expect(h.models[2].createCollection).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: true,
      partialEffectsPossible: true,
      models: [
        { model: 'Session', status: 'succeeded' },
        { model: 'Task', status: 'failed' },
        { model: 'PasswordResetToken', status: 'not-executed' },
      ],
    });
  });

  it('stops after a failed replacement, observes the dropped index, and sanitizes driver errors', async () => {
    const h = harness([replace, absent]);
    const privateValue = 'synthetic-private@example.test';
    const diagnostic = new mongoose.mongo.MongoServerError({
      message: 'duplicate key ' + privateValue + '\n' + adminUri,
      code: 11000,
    });
    h.models[0].createIndexes.mockRejectedValueOnce(diagnostic);

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    expect(h.models[0].cleanIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[1].createCollection).not.toHaveBeenCalled();
    expect(h.indexes[0]()).toEqual([idIndex]);
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: true,
      partialEffectsPossible: true,
      error: { driverCode: 11000 },
      models: [
        {
          status: 'failed',
          terminalState: 'observed',
          finalIndexes: [idIndex],
        },
        { status: 'not-executed' },
      ],
    });
    expect(output(h)).not.toContain(privateValue);
    expect(output(h)).not.toContain(adminUri);
    expect(output(h)).not.toContain('duplicate key');
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('reports a resolved creation with a remaining diff as a failed readback', async () => {
    const h = harness([addOnly, absent]);
    h.models[0].createIndexes.mockResolvedValueOnce(undefined);

    expect(await h.run(apply)).toBe(1);
    expect(output(h)).toContain('INDEX_READBACK_MISMATCH');
    expect(h.models[1].createCollection).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      partialEffectsPossible: true,
      models: [
        {
          status: 'failed',
          terminalState: 'observed',
          finalIndexes: [idIndex],
        },
        { status: 'not-executed' },
      ],
    });
  });

  it('checks retained raw definitions even when the post-write diff is empty', async () => {
    const h = harness([
      {
        ...addOnly,
        existing: [{ name: 'kept', key: { createdAt: 1 }, hidden: true }],
      },
      absent,
    ]);
    const old = { name: 'kept', key: { createdAt: 1 }, hidden: true };
    const list = h.models[0].listIndexes;
    list
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValue([idIndex, { ...old, hidden: false }, installedTtl]);

    expect(await h.run(apply)).toBe(1);
    expect(output(h)).toContain('INDEX_READBACK_MISMATCH');
    expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[1].createCollection).not.toHaveBeenCalled();
  });

  it('marks the failed model unconfirmed when both readback and its audit fail', async () => {
    const h = harness([addOnly, absent]);
    const list = h.models[0].listIndexes;
    list
      .mockResolvedValueOnce([idIndex])
      .mockResolvedValueOnce([idIndex])
      .mockResolvedValueOnce([idIndex])
      .mockRejectedValue(new Error('metadata unavailable'));

    expect(await h.run(apply)).toBe(1);
    expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[1].createCollection).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      partialEffectsPossible: true,
      models: [
        { status: 'failed', terminalState: 'unconfirmed' },
        { status: 'not-executed' },
      ],
    });
  });
});

describe('sync-indexes ordinary configuration and cleanup (offline)', () => {
  it.each([undefined, '', 'staging', 'production '])(
    'rejects original NODE_ENV=%j before any environment read',
    async (nodeEnv) => {
      const h = harness();
      h.deps.env = { NODE_ENV: nodeEnv };
      h.readFile.mockReturnValue('NODE_ENV=test\nMONGO_ADMIN_URI=' + adminUri);

      expect(await h.run()).toBe(1);
      expect(h.readFile).not.toHaveBeenCalled();
      expect(h.createConnection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['development', 'eduforge_dev'],
    ['test', 'eduforge_test'],
    ['production', 'eduforge'],
  ])(
    'keeps the original %s selection and uses only its file',
    async (env, db) => {
      const h = harness();
      const fileUri = 'mongodb://file.invalid/' + db;
      h.deps.env = { NODE_ENV: env };
      h.readFile.mockReturnValue(
        'NODE_ENV=staging\nMONGO_ADMIN_URI=' + fileUri,
      );
      h.connection.databaseName.mockReturnValue(db);

      expect(await h.run()).toBe(0);
      expect(h.readFile).toHaveBeenCalledTimes(1);
      expect(h.readFile).toHaveBeenCalledWith(
        resolve(backendDirectory, '.env.' + env),
      );
      expect(h.createConnection).toHaveBeenCalledWith(
        fileUri,
        expect.objectContaining({ autoCreate: false, autoIndex: false }),
      );
      expect(h.deps.env).toEqual({ NODE_ENV: env });
      noWrites(h);
    },
  );

  it('uses a valid process admin URI ahead of the selected file URI', async () => {
    const h = harness();
    h.readFile.mockReturnValue(
      'MONGO_ADMIN_URI=mongodb://file.invalid/eduforge_dev',
    );

    expect(await h.run()).toBe(0);
    expect(h.createConnection).toHaveBeenCalledWith(
      adminUri,
      expect.any(Object),
    );
    expect(h.deps.env.MONGO_URI).toBeUndefined();
  });

  it.each(['', ' \t '])(
    'rejects an explicit blank admin URI %j',
    async (uri) => {
      const h = harness();
      h.deps.env.MONGO_ADMIN_URI = uri;
      h.readFile.mockReturnValue('MONGO_ADMIN_URI=' + adminUri);

      expect(await h.run()).toBe(1);
      expect(h.createConnection).not.toHaveBeenCalled();
    },
  );

  it('does not fall back to MONGO_URI in either source', async () => {
    const h = harness();
    h.deps.env = { NODE_ENV: 'test', MONGO_URI: adminUri };
    h.readFile.mockReturnValue('MONGO_URI=' + adminUri);

    expect(await h.run()).toBe(1);
    expect(h.createConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['browser_acceptance', 'standard_test'],
    ['standard_test', 'browser_acceptance'],
    ['unknown', 'standard_test'],
    ['standard_test', 'unknown'],
  ])(
    'validates both purpose sources (%s, %s)',
    async (processPurpose, filePurpose) => {
      const h = harness();
      h.deps.env.EDUFORGE_DATABASE_PURPOSE = processPurpose;
      h.readFile.mockReturnValue('EDUFORGE_DATABASE_PURPOSE=' + filePurpose);

      expect(await h.run()).toBe(1);
      expect(h.createConnection).not.toHaveBeenCalled();
    },
  );

  it.each<[string, number]>([
    ['ENOENT', 0],
    ['EACCES', 1],
  ])(
    'handles selected configuration read error %s with exit %i',
    async (code, exitCode) => {
      const h = harness();
      h.readFile.mockImplementation(() => {
        throw Object.assign(new Error('synthetic config error'), { code });
      });

      expect(await h.run()).toBe(exitCode);
      expect(h.createConnection).toHaveBeenCalledTimes(exitCode === 0 ? 1 : 0);
    },
  );

  it('requires the exact declared name and rejects the wrong apply confirmation before connection', async () => {
    const h = harness();
    h.deps.env.MONGO_ADMIN_URI = adminUri + '_extra';

    expect(await h.run()).toBe(1);
    expect(output(h)).toContain('DATABASE_DECLARED_NAME_MISMATCH');
    expect(h.createConnection).not.toHaveBeenCalled();

    const h2 = harness();
    expect(await h2.run(['--apply', '--confirm-db', database + '_extra'])).toBe(
      1,
    );
    expect(output(h2)).toContain('CONFIRM_DB_MISMATCH');
    expect(h2.createConnection).not.toHaveBeenCalled();
  });

  it('closes a connected handle with the wrong actual database before model registration', async () => {
    const h = harness();
    h.connection.databaseName.mockReturnValue(database + '_extra');

    expect(await h.run()).toBe(1);
    expect(output(h)).toContain('DATABASE_CONNECTED_NAME_MISMATCH');
    expect(h.connection.models).not.toHaveBeenCalled();
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    noWrites(h);
  });

  it.each<[ModelFixture[]]>([
    [[]],
    [[addOnly, addOnly]],
    [[addOnly, { ...addOnly, name: 'AnotherSession' }]],
  ])('rejects an empty or duplicate registry %j', async (fixtures) => {
    const h = harness(fixtures);

    expect(await h.run()).toBe(1);
    expect(output(h)).toContain('INVALID_MODEL_REGISTRY');
    noWrites(h);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('preserves the original connection failure when close also fails', async () => {
    const h = harness();
    h.connection.ready.mockRejectedValueOnce(
      new mongoose.mongo.MongoServerError({
        message: 'synthetic authentication failure ' + adminUri,
        code: 18,
      }),
    );
    h.connection.close.mockRejectedValueOnce(
      new Error('synthetic close secret'),
    );

    expect(await h.run()).toBe(1);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expect(h.connection.models).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: false,
      error: { driverCode: 18 },
      closeError: { code: 'CONNECTION_CLOSE_FAILED' },
    });
    expect(output(h)).not.toContain(adminUri);
    expect(output(h)).not.toContain('synthetic close secret');
  });

  it('reports a close failure as nonzero even when the preview succeeded', async () => {
    const h = harness();
    h.connection.close.mockRejectedValueOnce(new Error('unavailable'));

    expect(await h.run()).toBe(1);
    expect(jsonEvent(h, 'plan')).toMatchObject({ mode: 'dry-run' });
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      closeError: { code: 'CONNECTION_CLOSE_FAILED' },
    });
    noWrites(h);
  });
});

function effectiveIndexes(schema: Schema) {
  return schema.indexes().map(([key, options]) => {
    const effectiveOptions: Record<string, unknown> = { ...options };
    // Mongoose uses this marker for automatic initialization and strips it before index creation.
    delete effectiveOptions._autoIndex;
    return [key, effectiveOptions];
  });
}

describe('sync-indexes registry and argument isolation', () => {
  it('registers exactly the real model names with unchanged schema and collection settings', () => {
    const expected = [
      ['User', 'users'],
      ['Session', 'sessions'],
      ['PasswordResetToken', 'passwordresettokens'],
      ['Course', 'courses'],
      ['Classroom', 'classrooms'],
      ['Enrollment', 'enrollments'],
      ['ClassroomTask', 'classroomtasks'],
      ['Task', 'tasks'],
      ['Submission', 'submissions'],
      ['Feedback', 'feedbacks'],
      ['AiFeedbackJob', 'aifeedbackjobs'],
    ];
    const originalOptions = SYNC_INDEX_SCHEMAS.map(({ schema }) => ({
      autoCreate: schema.options.autoCreate,
      autoIndex: schema.options.autoIndex,
    }));
    const originalIndexes = SYNC_INDEX_SCHEMAS.map(({ schema }) =>
      structuredClone(schema.indexes()),
    );
    const mongooseDefaults = {
      autoCreate: mongoose.get('autoCreate'),
      autoIndex: mongoose.get('autoIndex'),
    };
    const actual = new mongoose.Connection();
    const register = jest.fn((name: string, schema: Schema) => ({
      collection: {
        name: schema.options.collection ?? mongoose.pluralize()?.(name),
      },
    }));
    Object.defineProperty(actual, 'model', { value: register });

    const models = registerSyncIndexModels(actual);

    const mappings = models.map((model) => [model.name, model.collectionName]);
    expect(mappings).toHaveLength(expected.length);
    expect(mappings).toEqual(expect.arrayContaining(expected));
    expect(register).toHaveBeenCalledTimes(expected.length);
    for (const [name, clone] of register.mock.calls) {
      const source = SYNC_INDEX_SCHEMAS.find((entry) => entry.name === name);
      expect(source).toBeDefined();
      expect(clone).not.toBe(source?.schema);
      expect(clone.options.autoCreate).toBe(false);
      expect(clone.options.autoIndex).toBe(false);
      expect(clone.options.collection).toBe(source?.schema.options.collection);
      expect(effectiveIndexes(clone)).toEqual(
        source && effectiveIndexes(source.schema),
      );
    }
    expect(
      SYNC_INDEX_SCHEMAS.map(({ schema }) => ({
        autoCreate: schema.options.autoCreate,
        autoIndex: schema.options.autoIndex,
      })),
    ).toEqual(originalOptions);
    expect(SYNC_INDEX_SCHEMAS.map(({ schema }) => schema.indexes())).toEqual(
      originalIndexes,
    );
    expect({
      autoCreate: mongoose.get('autoCreate'),
      autoIndex: mongoose.get('autoIndex'),
    }).toEqual(mongooseDefaults);
  });

  it('propagates a collection creation race without falling back to Mongoose collection creation', async () => {
    const native = new mongoose.Connection();
    const namespaceExists = new mongoose.mongo.MongoServerError({
      message: 'synthetic namespace collision',
      code: 48,
    });
    const nativeCreate = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValueOnce(namespaceExists);
    const modelCreate = jest.fn(() => {
      throw new Error('UNEXPECTED_MODEL_CREATE_COLLECTION');
    });
    Object.defineProperty(native, 'db', {
      value: { createCollection: nativeCreate },
    });
    Object.defineProperty(native, 'model', {
      value: (name: string) => ({
        collection: { name: mongoose.pluralize()?.(name) },
        createCollection: modelCreate,
      }),
    });
    const user = registerSyncIndexModels(native).find(
      (model) => model.name === 'User',
    );
    if (!user) throw new Error('EXPECTED_USER_MODEL');

    await expect(user.createCollection()).rejects.toBe(namespaceExists);
    expect(nativeCreate).toHaveBeenCalledTimes(1);
    expect(nativeCreate.mock.calls[0]?.[0]).toBe('users');
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('requests build metadata and closes the metadata cursor and connection when an index is in progress', async () => {
    const h = harness();
    const native = new mongoose.Connection();
    const closeIndexCursor = jest.fn(() => Promise.resolve());
    const closeCollectionCursor = jest.fn(() => Promise.resolve());
    const runCursorCommand = jest.fn(() => ({
      toArray: () =>
        Promise.resolve([
          idIndex,
          {
            spec: { name: 'email_1', key: { email: 1 }, unique: true },
            buildUUID: 'synthetic-build-id',
          },
        ]),
      close: closeIndexCursor,
    }));
    Object.defineProperty(native, 'db', {
      value: {
        databaseName: database,
        listCollections: () => ({
          hasNext: () => Promise.resolve(true),
          close: closeCollectionCursor,
        }),
        runCursorCommand,
      },
    });
    const forbidden = jest.fn(() => {
      throw new Error('UNEXPECTED_DIFF_OR_WRITE');
    });
    Object.defineProperty(native, 'model', {
      value: (name: string) => ({
        collection: { name: mongoose.pluralize()?.(name) },
        diffIndexes: forbidden,
        createCollection: forbidden,
        cleanIndexes: forbidden,
        createIndexes: forbidden,
      }),
    });
    jest.spyOn(native, 'asPromise').mockResolvedValue(native);
    const close = jest.spyOn(native, 'close').mockResolvedValue(undefined);
    jest.mocked(mongoose.createConnection).mockReturnValueOnce(native);
    const deps: Partial<SyncIndexesDependencies> = { ...h.deps };
    delete deps.createConnection;

    expect(await runSyncIndexesCli(['--dry-run'], deps)).toBe(1);
    expect(h.createConnection).not.toHaveBeenCalled();
    expect(mongoose.createConnection).toHaveBeenLastCalledWith(
      adminUri,
      expect.objectContaining({ autoCreate: false, autoIndex: false }),
    );
    expect(runCursorCommand).toHaveBeenCalledTimes(1);
    expect(runCursorCommand).toHaveBeenCalledWith({
      listIndexes: 'users',
      cursor: {},
      includeBuildUUIDs: true,
    });
    expect(closeIndexCursor).toHaveBeenCalledTimes(1);
    expect(closeCollectionCursor).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: false,
      error: { code: 'INDEX_BUILD_IN_PROGRESS' },
    });
  });

  it.each<[readonly string[]]>([
    [['--bogus']],
    [['--dry-run', '--dry-run']],
    [['--apply']],
    [['--apply', '--confirm-db']],
    [['--apply', '--confirm-db', database, '--confirm-db', database]],
    [['--dry-run', ...apply]],
    [['--confirm-db', database]],
    [['--allow-drop']],
  ])(
    'rejects illegal arguments %j before reading configuration',
    async (args) => {
      const h = harness();

      expect(await h.run(args)).toBe(1);
      expect(h.readFile).not.toHaveBeenCalled();
      expect(h.createConnection).not.toHaveBeenCalled();
      expect(h.retire).not.toHaveBeenCalled();
    },
  );

  it('forwards an intact targeted apply command without ordinary config', async () => {
    const h = harness();
    h.deps.env = {};
    const args = [
      '--retire-task-stage',
      '--database',
      'eduforge',
      '--apply',
      '--confirm-db',
      'eduforge',
      '--backup-run',
      'synthetic-run',
    ];

    expect(await h.run(args)).toBe(0);
    expect(h.retire).toHaveBeenCalledTimes(1);
    expect(h.retire).toHaveBeenCalledWith(args);
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.createConnection).not.toHaveBeenCalled();
  });
});

const entry = JSON.stringify(resolve(__dirname, 'sync-indexes.ts'));
const isolatedGuard = String.raw`
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const Module = require('node:module');
const denied = () => { throw new Error('UNEXPECTED_ENV_NETWORK_OR_APP'); };
net.connect = denied;
net.createConnection = denied;
net.Socket.prototype.connect = denied;
tls.connect = denied;
dns.lookup = denied;
dns.resolveSrv = denied;
dns.promises.resolveSrv = denied;
let stageFixture;
const isEnvFile = path => /(^|[\\/])\.env(?:\.|$)/.test(String(path));
const readSync = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (isEnvFile(path)) return denied();
  return readSync.call(this, path, ...args);
};
const read = fsPromises.readFile;
fsPromises.readFile = function(path, ...args) {
  if (stageFixture !== undefined && /[\\/]\.env\.production$/.test(String(path))) {
    console.log('SYNTHETIC_STAGE_CONFIG_SELECTED');
    return Promise.resolve(stageFixture);
  }
  if (isEnvFile(path)) return denied();
  return read.call(this, path, ...args);
};
const load = Module._load;
Module._load = function(request, ...args) {
  if (/(?:app|auth|learning-tasks)\.module(?:\.[jt]s)?$/.test(request) ||
      /(?:session|password-reset|ai-feedback-worker|ai-feedback-processor)\.service(?:\.[jt]s)?$/.test(request) ||
      /ai-feedback.*provider(?:\.[jt]s)?$/.test(request)) return denied();
  const result = load.call(this, request, ...args);
  if (request === 'mongoose') result.createConnection = denied;
  if (request === '@nestjs/core') {
    result.NestFactory.create = denied;
    result.NestFactory.createApplicationContext = denied;
  }
  return result;
};
if (process.env.NODE_ENV !== undefined) throw new Error('ENV_NOT_ISOLATED');
`;

function isolated(code: string) {
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

function isolatedMain(args: string[], setup = '') {
  return isolated(
    setup +
      '\nprocess.argv = [process.execPath, ' +
      entry +
      ', ...' +
      JSON.stringify(args) +
      '];\n' +
      'require("node:module")._load(' +
      entry +
      ', null, true);\n',
  );
}

describe('sync-indexes isolated direct entry (no environment files or network)', () => {
  it('imports the real module without starting the CLI', () => {
    const result = isolated(
      '\nconst api = require(' +
        entry +
        ');\nif (typeof api.runSyncIndexesCli !== "function") throw Error("EXPORT_MISSING");\n' +
        'console.log("IMPORT_ONLY_OK");\n',
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('IMPORT_ONLY_OK');
    expect(result.stderr).toBe('');
  });

  it('prints ordinary help successfully with an empty environment', () => {
    const result = isolatedMain(['--help']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--dry-run');
    expect(result.stdout).toContain('--confirm-db');
    expect(result.stdout).toContain('--allow-drop');
    expect(result.stderr).toBe('');
  });

  it('exits nonzero on unknown arguments without starting configuration or network', () => {
    const result = isolatedMain(['--unrecognized']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CLI_ARGUMENT_INVALID');
    expect(result.stderr).not.toContain('UNEXPECTED_ENV_NETWORK_OR_APP');
  });

  it('routes targeted help to the existing retirement implementation', () => {
    const result = isolatedMain(['--retire-task-stage', '--help']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--backup-run');
    expect(result.stdout).toContain('--retire-task-stage');
    expect(result.stderr).toBe('');
  });

  it('lets a legal targeted command reach its own configuration gate', () => {
    const result = isolatedMain(
      ['--retire-task-stage', '--database', 'eduforge', '--dry-run'],
      'stageFixture = "MONGO_ADMIN_URI=mongodb://synthetic.invalid/eduforge_dev";',
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('SYNTHETIC_STAGE_CONFIG_SELECTED');
    expect(result.stderr).toContain('DECLARED_DATABASE_MISMATCH');
    expect(result.stderr).not.toContain('NODE_ENV_REQUIRED');
  });

  it('keeps --allow-drop invalid in the targeted parser', () => {
    const result = isolatedMain([
      '--retire-task-stage',
      '--database',
      'eduforge',
      '--apply',
      '--confirm-db',
      'eduforge',
      '--allow-drop',
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('UNKNOWN_ARGUMENT');
  });
});
