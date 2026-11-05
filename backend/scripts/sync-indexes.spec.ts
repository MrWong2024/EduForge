import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import mongoose, { type mongo, type Schema } from 'mongoose';
import {
  registerSyncIndexModels,
  runSyncIndexesCli,
  type CollectionMetadata,
  type SyncIndexDefinition,
  type SyncIndexModel,
  type SyncIndexesConnection,
  type SyncIndexesDependencies,
} from './sync-indexes';
import { SYNC_INDEX_SCHEMAS } from './sync-indexes-models';

jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  const denyConnection = () => {
    throw new Error('UNEXPECTED_REAL_CONNECTION');
  };
  actual.createConnection = jest.fn(denyConnection);
  actual.mongo.MongoClient.prototype.connect = denyConnection;
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
const submissionTextIndex: mongo.IndexDescriptionInfo = {
  v: 2,
  name: 'submissionId_text',
  key: { _fts: 'text', _ftsx: 1 },
  weights: { submissionId: 1 },
  default_language: 'english',
  language_override: 'language',
  textIndexVersion: 3,
};

type Diff = Awaited<ReturnType<SyncIndexModel['diffIndexes']>>;
type ModelFixture = {
  name: string;
  collectionName: string;
  missing?: boolean;
  collation?: CollectionMetadata['collation'];
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
  const schemaIndexes = jest.fn<SyncIndexDefinition[], []>(() => []);
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
    schemaIndexes,
    diffIndexes,
    createCollection,
    cleanIndexes,
    createIndexes,
    syncIndexes,
  } satisfies SyncIndexModel & { syncIndexes: typeof syncIndexes };

  return {
    model,
    metadata: () => (exists ? { collation: fixture.collation } : null),
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
    writeConcernW: jest.fn<mongo.WriteConcern['w'] | undefined, []>(),
    models: jest.fn<readonly SyncIndexModel[], []>(() => {
      events.push('register');
      return models.map(({ model }) => model);
    }),
    collectionMetadata: jest.fn<Promise<CollectionMetadata | null>, [string]>(
      (name) => {
        events.push('exists:' + name);
        return Promise.resolve(
          models
            .find(({ model }) => model.collectionName === name)
            ?.metadata() ?? null,
        );
      },
    ),
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

function disconnectedModel(name: string, source = new mongoose.Schema()) {
  const schema = source.clone();
  schema.set('autoCreate', false);
  schema.set('autoIndex', false);
  schema.set('autoSearchIndex', false);
  schema.set('bufferCommands', false);
  return new mongoose.Mongoose().model(name, schema);
}

function useMongooseDiff(
  model: Harness['models'][number],
  native: ReturnType<typeof disconnectedModel>,
  readIndexes: () => mongo.IndexDescriptionInfo[],
) {
  jest
    .spyOn(native, 'listIndexes')
    .mockImplementation(() => Promise.resolve(readIndexes()));
  model.schemaIndexes.mockImplementation(() => native.schema.indexes());
  model.diffIndexes.mockImplementation((options) =>
    native.diffIndexes(options),
  );
}

function aiJobHarness(
  submissionIndex?: mongo.IndexDescriptionInfo,
  preceding: ModelFixture[] = [],
) {
  const name = 'AiFeedbackJob';
  const source = SYNC_INDEX_SCHEMAS.find((entry) => entry.name === name);
  if (!source) throw new Error('EXPECTED_AI_FEEDBACK_JOB_SCHEMA');
  const native = disconnectedModel(name, source.schema);
  const otherIndexes = native.schema
    .indexes()
    .filter(
      ([key]) => !(Object.keys(key).length === 1 && key.submissionId === 1),
    )
    .map(([key], index): mongo.IndexDescriptionInfo => {
      const serverKey: mongo.IndexDescriptionInfo['key'] = {};
      for (const [field, direction] of Object.entries(key)) {
        if (direction !== 1 && direction !== -1) {
          throw new Error('EXPECTED_ORDINARY_AI_JOB_INDEX');
        }
        serverKey[field] = direction;
      }
      return { name: 'existing_' + index, key: serverKey };
    });
  const h = harness([
    ...preceding,
    {
      name,
      collectionName: 'aifeedbackjobs',
      existing: submissionIndex
        ? [...otherIndexes, submissionIndex]
        : otherIndexes,
    },
  ]);
  const job = h.models[preceding.length];
  useMongooseDiff(job, native, h.indexes[preceding.length]);
  return { h, job };
}

function promiseGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
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
      .mockResolvedValue([
        idIndex,
        { ...legacy, partialFilterExpression: { active: false } },
      ]);

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
    const old = { name: 'kept', key: { createdAt: 1 }, v: 1 };
    const h = harness([{ ...addOnly, existing: [old] }, absent]);
    const list = h.models[0].listIndexes;
    list
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValueOnce([idIndex, old])
      .mockResolvedValue([idIndex, { ...old, v: 2 }, installedTtl]);

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

describe('sync-indexes text index guard (offline)', () => {
  it.each<[readonly string[]]>([
    [[]],
    [['--dry-run']],
    [apply],
    [[...apply, '--allow-drop']],
  ])(
    'rejects the submissionId text index before diff or writes with %j',
    async (args) => {
      const { h, job } = aiJobHarness(submissionTextIndex, [absent]);

      expect(await h.run(args)).toBe(1);
      expect(h.models[0].diffIndexes).toHaveBeenCalledTimes(1);
      expect(job.diffIndexes).not.toHaveBeenCalled();
      noWrites(h);
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        writesAttempted: false,
        error: { code: 'TEXT_INDEX_UNSUPPORTED' },
      });
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a text index declared in an isolated schema', async () => {
    const h = harness([absent, addOnly]);
    const schema = new mongoose.Schema({ title: String });
    schema.index({ title: 'text' });
    h.models[1].schemaIndexes.mockImplementation(() => schema.indexes());

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    expect(h.models[1].diffIndexes).not.toHaveBeenCalled();
    noWrites(h);
    expect(jsonEvent(h, 'result')).toMatchObject({
      error: { code: 'TEXT_INDEX_UNSUPPORTED' },
    });
  });

  it.each([
    { ordinaryReads: 1, phase: 'the all-model recheck' },
    { ordinaryReads: 2, phase: 'the per-model recheck' },
    { ordinaryReads: 3, phase: 'readback' },
  ])(
    'stops when text metadata first appears at $phase',
    async ({ ordinaryReads }) => {
      const h = harness([addOnly, absent]);
      const model = h.models[0];
      for (let index = 0; index < ordinaryReads; index += 1) {
        model.listIndexes.mockImplementationOnce(() =>
          Promise.resolve(h.indexes[0]()),
        );
      }
      model.listIndexes.mockImplementation(() =>
        Promise.resolve([
          ...h.indexes[0](),
          structuredClone(submissionTextIndex),
        ]),
      );

      expect(await h.run(apply)).toBe(1);
      const reachedReadback = ordinaryReads === 3;
      expect(model.diffIndexes).toHaveBeenCalledTimes(ordinaryReads);
      expect(model.createIndexes).toHaveBeenCalledTimes(
        reachedReadback ? 1 : 0,
      );
      expect(h.models[1].createCollection).not.toHaveBeenCalled();
      expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
      expect(h.models[1].createIndexes).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        writesAttempted: reachedReadback,
        partialEffectsPossible: reachedReadback,
        error: { code: 'TEXT_INDEX_UNSUPPORTED' },
        models: [{ status: 'failed' }, { status: 'not-executed' }],
      });
      if (reachedReadback) {
        expect(jsonEvent(h, 'result')).toMatchObject({
          models: [
            {
              terminalState: 'observed',
              finalIndexes: [idIndex, installedTtl, submissionTextIndex],
            },
            {},
          ],
        });
      } else {
        noWrites(h);
      }
      expect(output(h)).not.toContain('"terminalState":"verified"');
    },
  );

  it('plans to build the missing submissionId unique index with Mongoose diff', async () => {
    const { h } = aiJobHarness();

    expect(await h.run(['--dry-run'])).toBe(0);
    noWrites(h);
    expect(jsonEvent(h, 'plan')).toMatchObject({
      models: [
        {
          toDrop: [],
          toCreate: [{ key: { submissionId: 1 }, options: { unique: true } }],
        },
      ],
    });
  });

  it('verifies a matching ordinary unique index whose name contains text', async () => {
    const { h } = aiJobHarness({
      name: 'submissionId_unique_text_in_name',
      key: { submissionId: 1 },
      unique: true,
    });

    expect(await h.run(apply)).toBe(0);
    noWrites(h);
    expect(jsonEvent(h, 'plan')).toMatchObject({
      models: [{ toDrop: [], toCreate: [] }],
    });
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'completed',
      models: [{ terminalState: 'verified' }],
    });
  });
});

describe('sync-indexes sequential deletion (offline)', () => {
  const middle = { name: 'middle_legacy', key: { legacyFlag: 1 } } as const;
  const last = { name: 'z_legacy', key: { legacyScore: 1 } } as const;

  it.each([
    [legacy.name, 'observed'],
    [middle.name, 'observed'],
    [middle.name, 'unconfirmed'],
  ] as const)(
    'awaits one drop at a time and stops after %s fails (%s)',
    async (failedName, terminalState) => {
      const h = harness([
        {
          ...replace,
          existing: [last, middle, legacy],
          drop: [last.name, middle.name, legacy.name],
        },
        absent,
      ]);
      const model = h.models[0];
      const native = disconnectedModel(model.name);
      const removeFromFixture = model.cleanIndexes.getMockImplementation();
      if (!removeFromFixture) throw new Error('EXPECTED_IN_MEMORY_DROP');
      const started = promiseGate();
      const release = promiseGate();
      const readUnavailable = new Error('synthetic audit error');
      const dropFailure = new mongoose.mongo.MongoServerError({
        message: 'synthetic drop error',
        code: 27,
      });
      const unexpectedDiff = jest
        .spyOn(native, 'diffIndexes')
        .mockRejectedValue(new Error('UNEXPECTED_DROP_PLAN_RECALCULATION'));
      const dropIndex = jest
        .spyOn(native.collection, 'dropIndex')
        .mockImplementation(async (name) => {
          if (name === legacy.name) {
            started.open();
            await release.promise;
          }
          if (name === failedName) {
            if (terminalState === 'unconfirmed') {
              model.listIndexes.mockRejectedValueOnce(readUnavailable);
            }
            throw dropFailure;
          }
          await removeFromFixture({ toDrop: [name] });
          return { ok: 1 };
        });
      model.cleanIndexes.mockImplementation((options) =>
        native.cleanIndexes(options),
      );

      const run = h.run([...apply, '--allow-drop']);
      const firstDropStarted = await Promise.race([
        started.promise.then(() => true),
        run.then(() => false),
      ]);
      const callsBeforeRelease = dropIndex.mock.calls.map(([name]) => name);
      release.open();
      expect(await run).toBe(1);
      expect(firstDropStarted).toBe(true);
      expect(callsBeforeRelease).toEqual([legacy.name]);
      const attempted =
        failedName === legacy.name ? [legacy.name] : [legacy.name, middle.name];
      expect(model.cleanIndexes.mock.calls).toEqual(
        attempted.map((name) => [{ toDrop: [name] }]),
      );
      expect(dropIndex.mock.calls.map(([name]) => name)).toEqual(attempted);
      expect(unexpectedDiff).not.toHaveBeenCalled();
      expect(model.diffIndexes).toHaveBeenCalledTimes(3);
      expect(model.createIndexes).not.toHaveBeenCalled();
      expect(h.models[1].createCollection).not.toHaveBeenCalled();
      expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
      expect(h.models[1].createIndexes).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'plan')).toMatchObject({
        models: [{ toDrop: [legacy, middle, last] }, {}],
      });
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        partialEffectsPossible: true,
        error: { code: 'INDEX_APPLY_FAILED', driverCode: 27 },
        models: [
          terminalState === 'observed'
            ? {
                status: 'failed',
                terminalState,
                finalIndexes:
                  failedName === legacy.name
                    ? [idIndex, legacy, middle, last]
                    : [idIndex, middle, last],
              }
            : {
                status: 'failed',
                terminalState,
                auditError: { code: 'INDEX_FAILURE_AUDIT_FAILED' },
              },
          { status: 'not-executed' },
        ],
      });
      if (terminalState === 'unconfirmed') {
        expect(output(h)).not.toContain('"finalIndexes"');
      }
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );
});

describe('sync-indexes sequential creation (offline)', () => {
  const definitions: SyncIndexDefinition[] = [
    [{ submissionId: 1 }, { name: 'job_submission', unique: true }],
    [
      { status: 1, createdAt: -1 },
      { name: 'job_status_created', sparse: true },
    ],
    [{ expiresAt: 1 }, { name: 'job_expiry', expireAfterSeconds: 300 }],
  ];
  const entries: mongo.IndexDescriptionInfo[] = [
    { name: 'job_submission', key: { submissionId: 1 }, unique: true },
    {
      name: 'job_status_created',
      key: { status: 1, createdAt: -1 },
      sparse: true,
    },
    { name: 'job_expiry', key: { expiresAt: 1 }, expireAfterSeconds: 300 },
  ];

  it.each(['all succeed', 'first rejects', 'second throws'] as const)(
    'creates frozen definitions one at a time when %s',
    async (outcome) => {
      const h = harness([
        { name: 'AiFeedbackJob', collectionName: 'aifeedbackjobs' },
        absent,
      ]);
      const model = h.models[0];
      const native = disconnectedModel(model.name);
      for (const [key, options] of definitions)
        native.schema.index(key, options);
      const installed = [idIndex];
      useMongooseDiff(model, native, () => structuredClone(installed));
      model.listIndexes.mockImplementation(() =>
        Promise.resolve(structuredClone(installed)),
      );

      const started = promiseGate();
      const release = promiseGate();
      const duplicate = new mongoose.mongo.MongoServerError({
        message: 'synthetic duplicate',
        code: 11000,
      });
      const rejected = new mongoose.mongo.MongoServerError({
        message: 'synthetic create error',
        code: 85,
      });
      const createIndex = jest
        .spyOn(native.collection, 'createIndex')
        .mockImplementation((_key, options) => {
          if (options?.name === 'job_submission') {
            started.open();
            return release.promise.then(() => {
              if (outcome === 'first rejects') throw duplicate;
              installed.push(entries[0]);
              return 'job_submission';
            });
          }
          if (options?.name === 'job_status_created') {
            if (outcome === 'second throws') throw rejected;
            installed.push(entries[1]);
            return Promise.resolve('job_status_created');
          }
          installed.push(entries[2]);
          return Promise.resolve('job_expiry');
        });
      const calls: SyncIndexDefinition[][] = [];
      model.createIndexes.mockImplementation((options) => {
        calls.push(structuredClone(options.toCreate));
        const mongooseOptions: mongo.CreateIndexesOptions & typeof options =
          options;
        return native.createIndexes(mongooseOptions);
      });

      const originalDefinitions = structuredClone(definitions);
      const run = h.run(apply);
      const firstCreateStarted = await Promise.race([
        started.promise.then(() => true),
        run.then(() => false),
      ]);
      const callsBeforeRelease = calls.length;
      const requestsBeforeRelease = createIndex.mock.calls.length;
      release.open();
      const succeeded = outcome === 'all succeed';
      expect(await run).toBe(succeeded ? 0 : 1);
      expect(firstCreateStarted).toBe(true);
      expect(callsBeforeRelease).toBe(1);
      expect(requestsBeforeRelease).toBe(1);
      const attempted = succeeded ? 3 : outcome === 'first rejects' ? 1 : 2;
      expect(calls).toMatchObject(
        originalDefinitions
          .slice(0, attempted)
          .map((definition) => [definition]),
      );
      expect(createIndex.mock.calls).toMatchObject(
        originalDefinitions.slice(0, attempted),
      );
      expect(createIndex.mock.calls.map(([key]) => Object.keys(key))).toEqual(
        originalDefinitions
          .slice(0, attempted)
          .map(([key]) => Object.keys(key)),
      );
      expect(definitions).toEqual(originalDefinitions);
      expect(model.diffIndexes).toHaveBeenCalledTimes(succeeded ? 4 : 3);
      expect(jsonEvent(h, 'plan')).toMatchObject({
        models: [
          {
            toCreate: originalDefinitions.map(([key, options]) => ({
              key,
              options,
            })),
          },
          {},
        ],
      });
      const finalIndexes = succeeded
        ? [idIndex, entries[2], entries[1], entries[0]]
        : outcome === 'first rejects'
          ? [idIndex]
          : [idIndex, entries[0]];
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: succeeded ? 'completed' : 'failed',
        partialEffectsPossible: !succeeded,
        ...(succeeded
          ? {}
          : {
              error: {
                code: 'INDEX_APPLY_FAILED',
                driverCode: outcome === 'first rejects' ? 11000 : 85,
              },
            }),
        models: [
          {
            status: succeeded ? 'succeeded' : 'failed',
            terminalState: succeeded ? 'verified' : 'observed',
            finalIndexes,
          },
          { status: succeeded ? 'succeeded' : 'not-executed' },
        ],
      });
      if (!succeeded)
        expect(h.models[1].createCollection).not.toHaveBeenCalled();
      expect(h.models[1].createIndexes).toHaveBeenCalledTimes(
        succeeded ? 1 : 0,
      );
      expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );
});

describe('sync-indexes collection default collation (offline)', () => {
  const nonSimple = { locale: 'en', strength: 2 };
  const courseIndex: mongo.IndexDescriptionInfo = {
    name: 'createdBy_1_code_1',
    key: { createdBy: 1, code: 1 },
    unique: true,
  };

  it.each([
    { label: 'non-simple', collation: nonSimple, permitted: false },
    {
      label: 'explicit simple',
      collation: { locale: 'simple' },
      permitted: true,
    },
    { label: 'unspecified', collation: undefined, permitted: true },
  ])(
    'handles a $label collection default separately from an individual index',
    async ({ collation, permitted }) => {
      const source = SYNC_INDEX_SCHEMAS.find(({ name }) => name === 'Course');
      if (!source) throw new Error('EXPECTED_COURSE_SCHEMA');
      const native = disconnectedModel(source.name, source.schema);
      const oldIndex = { ...courseIndex, collation: nonSimple };
      const h = harness([
        absent,
        {
          name: 'Course',
          collectionName: 'courses',
          collation,
          existing: [oldIndex],
          installed: [courseIndex],
        },
      ]);
      useMongooseDiff(h.models[1], native, h.indexes[1]);

      expect(await h.run([...apply, '--allow-drop'])).toBe(permitted ? 0 : 1);
      if (permitted) {
        expect(jsonEvent(h, 'plan')).toMatchObject({
          models: [
            {},
            {
              toDrop: [oldIndex],
              toCreate: [{ key: courseIndex.key, options: { unique: true } }],
            },
          ],
        });
        expect(h.models[1].cleanIndexes).toHaveBeenCalledWith({
          toDrop: [courseIndex.name],
        });
        expect(h.models[1].createIndexes).toHaveBeenCalledTimes(1);
        expect(h.indexes[1]()).toEqual([idIndex, courseIndex]);
        expect(jsonEvent(h, 'result')).toMatchObject({
          status: 'completed',
          models: [{}, { terminalState: 'verified' }],
        });
      } else {
        noWrites(h);
        expect(h.models[1].diffIndexes).not.toHaveBeenCalled();
        expect(jsonEvent(h, 'result')).toMatchObject({
          writesAttempted: false,
          error: { code: 'COLLECTION_COLLATION_UNSUPPORTED' },
        });
      }
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([2, 3, 4])(
    'stops when collection default collation changes at read %i',
    async (changeAt) => {
      const h = harness([addOnly, absent]);
      const metadata = h.connection.collectionMetadata.getMockImplementation();
      if (!metadata) throw new Error('EXPECTED_COLLECTION_METADATA');
      let reads = 0;
      h.connection.collectionMetadata.mockImplementation((name) => {
        if (name === 'sessions' && ++reads >= changeAt) {
          return Promise.resolve({ collation: nonSimple });
        }
        return metadata(name);
      });

      expect(await h.run(apply)).toBe(1);
      const readback = changeAt === 4;
      expect(h.models[0].diffIndexes).toHaveBeenCalledTimes(changeAt - 1);
      expect(h.models[0].createIndexes).toHaveBeenCalledTimes(readback ? 1 : 0);
      expect(h.models[1].createCollection).not.toHaveBeenCalled();
      expect(h.models[1].createIndexes).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        writesAttempted: readback,
        partialEffectsPossible: readback,
        error: { code: 'COLLECTION_COLLATION_UNSUPPORTED' },
        models: [
          {
            status: 'failed',
            ...(readback
              ? {
                  terminalState: 'observed',
                  finalIndexes: [idIndex, installedTtl],
                }
              : {}),
          },
          { status: 'not-executed' },
        ],
      });
      expect(output(h)).not.toContain('"terminalState":"verified"');
    },
  );

  it('validates the collection default immediately after creation before creating indexes', async () => {
    const h = harness([absent]);
    const model = h.models[0];
    const metadata = h.connection.collectionMetadata.getMockImplementation();
    if (!metadata) throw new Error('EXPECTED_COLLECTION_METADATA');
    h.connection.collectionMetadata.mockImplementation((name) =>
      model.createCollection.mock.calls.length > 0
        ? Promise.resolve({ collation: nonSimple })
        : metadata(name),
    );

    expect(await h.run(apply)).toBe(1);
    expect(model.createCollection).toHaveBeenCalledTimes(1);
    expect(model.createIndexes).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      writesAttempted: true,
      partialEffectsPossible: true,
      error: { code: 'COLLECTION_COLLATION_UNSUPPORTED' },
      models: [
        {
          status: 'failed',
          terminalState: 'observed',
          finalIndexes: [idIndex],
        },
      ],
    });
  });
});

describe('sync-indexes special index states (offline)', () => {
  const states = [
    ['hidden', 'HIDDEN_INDEX_UNSUPPORTED'],
    ['prepareUnique', 'PREPARE_UNIQUE_UNSUPPORTED'],
  ] as const;

  it.each(states)(
    'rejects actual or Schema %s:true before diff or writes',
    async (state, code) => {
      const key = { createdAt: -1 } as const;
      const options = { name: 'ordinary_created', [state]: true };
      const existing = { key, ...options };
      const live = harness([absent, { ...addOnly, existing: [existing] }]);
      const declared = harness([absent, addOnly]);
      const schema = new mongoose.Schema();
      schema.index(key, options);
      declared.models[1].schemaIndexes.mockImplementation(() =>
        schema.indexes(),
      );

      for (const [h, args] of [
        [live, [...apply, '--allow-drop']],
        [declared, ['--dry-run']],
      ] as const) {
        expect(await h.run(args)).toBe(1);
        noWrites(h);
        expect(h.models[1].diffIndexes).not.toHaveBeenCalled();
        expect(jsonEvent(h, 'result')).toMatchObject({
          writesAttempted: false,
          error: { code },
        });
        expect(h.connection.close).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('allows omitted and explicit false flags in live metadata and Schema declarations', async () => {
    const key = { createdAt: -1 } as const;
    const options = {
      name: 'ordinary_created',
      hidden: false,
      prepareUnique: false,
    };
    const h = harness([{ ...addOnly, existing: [{ key, ...options }] }]);
    const schema = new mongoose.Schema();
    schema.index(key, options);
    h.models[0].schemaIndexes.mockImplementation(() => schema.indexes());

    expect(await h.run(apply)).toBe(0);
    expect(h.models[0].createIndexes).toHaveBeenCalledWith({ toCreate: [ttl] });
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [{ status: 'succeeded', terminalState: 'verified' }],
    });
  });

  it('rejects hidden:true at readback while preserving the observed metadata', async () => {
    const h = harness([addOnly, absent]);
    const model = h.models[0];
    const hidden = { ...installedTtl, hidden: true };
    for (let i = 0; i < 3; i += 1)
      model.listIndexes.mockResolvedValueOnce([idIndex]);
    model.listIndexes.mockResolvedValue([idIndex, hidden]);

    expect(await h.run(apply)).toBe(1);
    expect(model.diffIndexes).toHaveBeenCalledTimes(3);
    expect(model.createIndexes).toHaveBeenCalledTimes(1);
    expect(h.models[1].createCollection).not.toHaveBeenCalled();
    expect(h.models[1].createIndexes).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      partialEffectsPossible: true,
      error: { code: 'HIDDEN_INDEX_UNSUPPORTED' },
      models: [
        {
          status: 'failed',
          terminalState: 'observed',
          finalIndexes: [idIndex, hidden],
        },
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

    expect(await h.run(apply)).toBe(1);
    expect(output(h)).toContain('DATABASE_CONNECTED_NAME_MISMATCH');
    expect(h.connection.writeConcernW).not.toHaveBeenCalled();
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

function nativeAdapterHarness(suffix = '') {
  const h = harness();
  const uri = adminUri + suffix;
  const client = new mongoose.mongo.MongoClient(uri);
  const native = new mongoose.Connection();
  const closeIndexCursor = jest.fn(() => Promise.resolve());
  const closeCollectionCursor = jest.fn(() => Promise.resolve());
  const readCollection = jest.fn<Promise<unknown>, [string]>((name) =>
    Promise.resolve({ name, type: 'collection', options: {} }),
  );
  const listCollections = jest.fn(({ name }: { name: string }) => ({
    next: () => readCollection(name),
    close: closeCollectionCursor,
  }));
  const toArray = jest.fn<Promise<unknown[]>, []>(() =>
    Promise.resolve([structuredClone(idIndex)]),
  );
  const runCursorCommand = jest.fn(() => ({
    toArray,
    close: closeIndexCursor,
  }));
  const forbidden = jest.fn(() => {
    throw new Error('UNEXPECTED_WRITE');
  });
  const diffIndexes = jest.fn<Promise<Diff>, [string]>(() =>
    Promise.resolve({ toDrop: [], toCreate: [] }),
  );
  const createCollection = jest.fn<Promise<void>, [string]>(() => forbidden());
  const register = jest.fn((name: string, schema: Schema) => ({
    schema,
    collection: { name: mongoose.pluralize()?.(name) },
    diffIndexes: () => diffIndexes(name),
    cleanIndexes: forbidden,
    createIndexes: forbidden,
  }));
  Object.defineProperty(native, 'db', {
    value: {
      databaseName: database,
      listCollections,
      runCursorCommand,
      createCollection,
    },
  });
  Object.defineProperty(native, 'model', { value: register });
  const ready = jest.spyOn(native, 'asPromise').mockResolvedValue(native);
  const getClient = jest.spyOn(native, 'getClient').mockReturnValue(client);
  const close = jest
    .spyOn(native, 'close')
    .mockImplementation(() => client.close());
  const deps: Partial<SyncIndexesDependencies> = {
    ...h.deps,
    env: { NODE_ENV: 'test', MONGO_ADMIN_URI: uri },
  };
  delete deps.createConnection;
  const run = (args: readonly string[]) => {
    jest.mocked(mongoose.createConnection).mockReturnValueOnce(native);
    return runSyncIndexesCli(args, deps);
  };
  return {
    h,
    uri,
    client,
    ready,
    getClient,
    register,
    close,
    readCollection,
    listCollections,
    toArray,
    runCursorCommand,
    closeIndexCursor,
    closeCollectionCursor,
    forbidden,
    diffIndexes,
    createCollection,
    run,
  };
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
      schema,
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
      expect(clone.options.writeConcern).toBeUndefined();
      expect(
        clone.indexes().some(([, options]) => 'writeConcern' in options),
      ).toBe(false);
      expect(effectiveIndexes(clone)).toEqual(
        source && effectiveIndexes(source.schema),
      );
      const adapter = models.find((model) => model.name === name);
      expect(adapter?.schemaIndexes()).toEqual(clone.indexes());
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

  it.each([
    {
      label: 'w=0 apply',
      suffix: '?w=0',
      expectedW: 0,
      args: apply,
      denied: true,
    },
    {
      label: 'w=0 preview',
      suffix: '?w=0',
      expectedW: 0,
      args: ['--dry-run'],
      denied: false,
    },
    {
      label: 'w=1 apply',
      suffix: '?w=1',
      expectedW: 1,
      args: apply,
      denied: false,
    },
    {
      label: 'majority apply',
      suffix: '?w=majority',
      expectedW: 'majority',
      args: apply,
      denied: false,
    },
    {
      label: 'default apply',
      suffix: '',
      expectedW: undefined,
      args: apply,
      denied: false,
    },
  ])(
    'uses the driver-parsed write concern for $label',
    async ({ suffix, expectedW, args, denied }) => {
      const {
        h,
        uri,
        client,
        ready,
        getClient,
        register,
        close,
        listCollections,
        forbidden,
        run,
      } = nativeAdapterHarness(suffix);

      expect(client.writeConcern?.w).toBe(expectedW);
      expect(await run(args)).toBe(denied ? 1 : 0);
      expect(mongoose.createConnection).toHaveBeenLastCalledWith(
        uri,
        expect.objectContaining({ autoCreate: false, autoIndex: false }),
      );
      const connectionCall: readonly unknown[] | undefined = jest.mocked(
        mongoose.createConnection,
      ).mock.lastCall;
      const connectionOptions = connectionCall?.[1];
      expect(connectionOptions).not.toHaveProperty('writeConcern');
      expect(connectionOptions).not.toHaveProperty('w');
      expect(client.writeConcern?.w).toBe(expectedW);
      if (args.includes('--apply')) {
        expect(getClient).toHaveBeenCalledTimes(1);
        expect(ready.mock.invocationCallOrder[0]).toBeLessThan(
          getClient.mock.invocationCallOrder[0],
        );
      }
      if (denied) {
        expect(register).not.toHaveBeenCalled();
        expect(listCollections).not.toHaveBeenCalled();
        expect(jsonEvent(h, 'result')).toMatchObject({
          status: 'failed',
          writesAttempted: false,
          error: { code: 'UNACKNOWLEDGED_WRITE_CONCERN' },
        });
      } else {
        expect(register).toHaveBeenCalledTimes(SYNC_INDEX_SCHEMAS.length);
        expect(listCollections).toHaveBeenCalled();
        expect(jsonEvent(h, 'result')).toMatchObject({
          status: args.includes('--apply') ? 'completed' : 'preview',
          writesAttempted: false,
        });
      }
      expect(forbidden).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'denied read',
    'missing options',
    'non-document options',
    'non-simple default',
  ] as const)(
    'fails closed with no collection creation on %s',
    async (outcome) => {
      const {
        h,
        readCollection,
        listCollections,
        closeCollectionCursor,
        runCursorCommand,
        diffIndexes,
        forbidden,
        close,
        run,
      } = nativeAdapterHarness();
      if (outcome === 'denied read') {
        readCollection.mockRejectedValueOnce(
          new mongoose.mongo.MongoServerError({
            message: 'synthetic unauthorized',
            code: 13,
          }),
        );
      } else if (outcome === 'missing options') {
        readCollection.mockResolvedValueOnce({
          name: 'users',
          type: 'collection',
        });
      } else if (outcome === 'non-document options') {
        readCollection.mockResolvedValueOnce({
          name: 'users',
          type: 'collection',
          options: new Date(0),
        });
      } else {
        readCollection.mockResolvedValueOnce({
          name: 'users',
          type: 'collection',
          options: { collation: { locale: 'en' } },
        });
      }

      expect(await run([...apply, '--allow-drop'])).toBe(1);
      expect(listCollections).toHaveBeenCalledTimes(1);
      expect(listCollections).toHaveBeenCalledWith({ name: 'users' });
      expect(closeCollectionCursor).toHaveBeenCalledTimes(1);
      expect(runCursorCommand).not.toHaveBeenCalled();
      expect(diffIndexes).not.toHaveBeenCalled();
      expect(forbidden).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      const error =
        outcome === 'denied read'
          ? { code: 'INDEX_PREFLIGHT_FAILED', driverCode: 13 }
          : outcome === 'non-simple default'
            ? { code: 'COLLECTION_COLLATION_UNSUPPORTED' }
            : { code: 'COLLECTION_METADATA_INVALID' };
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        writesAttempted: false,
        error,
      });
    },
  );

  it.each(['success', 'in-progress', 'read-failure'] as const)(
    'sets the metadata cursor lifetime and closes cursors and the connection on %s',
    async (outcome) => {
      const {
        h,
        toArray,
        runCursorCommand,
        listCollections,
        closeIndexCursor,
        closeCollectionCursor,
        close,
        forbidden,
        diffIndexes,
        run,
      } = nativeAdapterHarness();
      if (outcome === 'in-progress') {
        toArray.mockResolvedValueOnce([
          idIndex,
          {
            spec: { name: 'email_1', key: { email: 1 }, unique: true },
            buildUUID: 'synthetic-build-id',
          },
        ]);
      } else if (outcome === 'read-failure') {
        toArray.mockRejectedValueOnce(
          new Error('synthetic cursor read failure'),
        );
      }
      const succeeded = outcome === 'success';
      expect(await run(['--dry-run'])).toBe(succeeded ? 0 : 1);
      expect(h.createConnection).not.toHaveBeenCalled();
      expect(mongoose.createConnection).toHaveBeenLastCalledWith(
        adminUri,
        expect.objectContaining({ autoCreate: false, autoIndex: false }),
      );
      const cursorCount = succeeded ? SYNC_INDEX_SCHEMAS.length : 1;
      expect(listCollections).toHaveBeenCalledTimes(cursorCount);
      expect(listCollections).toHaveBeenNthCalledWith(1, { name: 'users' });
      expect(runCursorCommand).toHaveBeenCalledTimes(cursorCount);
      expect(runCursorCommand).toHaveBeenNthCalledWith(
        1,
        { listIndexes: 'users', cursor: {}, includeBuildUUIDs: true },
        {
          timeoutMS: 65000,
          timeoutMode: 'cursorLifetime',
          promoteValues: true,
        },
      );
      expect(closeIndexCursor).toHaveBeenCalledTimes(cursorCount);
      expect(closeCollectionCursor).toHaveBeenCalledTimes(cursorCount);
      expect(close).toHaveBeenCalledTimes(1);
      expect(diffIndexes).toHaveBeenCalledTimes(succeeded ? cursorCount : 0);
      expect(forbidden).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: succeeded ? 'preview' : 'failed',
        writesAttempted: false,
        ...(succeeded
          ? {}
          : {
              error: {
                code:
                  outcome === 'in-progress'
                    ? 'INDEX_BUILD_IN_PROGRESS'
                    : 'INDEX_PREFLIGHT_FAILED',
              },
            }),
      });
    },
  );

  it.each([
    {
      label: 'time series',
      type: 'timeseries',
      options: { timeseries: { timeField: 'createdAt', metaField: 'tenant' } },
      code: 'COLLECTION_TYPE_UNSUPPORTED',
    },
    { label: 'view', type: 'view', code: 'COLLECTION_TYPE_UNSUPPORTED' },
    {
      label: 'unknown type',
      type: 'other',
      code: 'COLLECTION_TYPE_UNSUPPORTED',
    },
    { label: 'missing type', code: 'COLLECTION_METADATA_INVALID' },
    { label: 'empty type', type: '', code: 'COLLECTION_METADATA_INVALID' },
    { label: 'numeric type', type: 1, code: 'COLLECTION_METADATA_INVALID' },
  ])(
    'rejects $label before writing any collection',
    async ({ code, ...entry }) => {
      const a = nativeAdapterHarness();
      a.readCollection.mockImplementation((name) =>
        Promise.resolve(
          name === 'users'
            ? null
            : name === 'courses'
              ? { name, options: {}, ...entry }
              : { name, type: 'collection', options: {} },
        ),
      );

      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.listCollections).toHaveBeenNthCalledWith(1, { name: 'users' });
      expect(a.listCollections).toHaveBeenLastCalledWith({ name: 'courses' });
      expect(a.diffIndexes).toHaveBeenCalledWith('User');
      expect(a.diffIndexes).not.toHaveBeenCalledWith('Course');
      expect(a.createCollection).not.toHaveBeenCalled();
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(a.closeCollectionCursor).toHaveBeenCalledTimes(
        a.listCollections.mock.calls.length,
      );
      expect(a.close).toHaveBeenCalledTimes(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        status: 'failed',
        writesAttempted: false,
        partialEffectsPossible: false,
        error: { code },
      });
    },
  );

  it('creates a truly missing collection and verifies its ordinary type', async () => {
    const a = nativeAdapterHarness();
    let created = false;
    a.readCollection.mockImplementation((name) =>
      Promise.resolve(
        name === 'users' && !created
          ? null
          : { name, type: 'collection', options: {} },
      ),
    );
    a.createCollection.mockImplementation(() => {
      created = true;
      return Promise.resolve();
    });

    expect(await a.run(apply)).toBe(0);
    expect(a.createCollection.mock.calls).toEqual([['users']]);
    expect(
      a.listCollections.mock.calls.filter(([{ name }]) => name === 'users'),
    ).toEqual(Array.from({ length: 5 }, () => [{ name: 'users' }]));
    expect(a.forbidden).not.toHaveBeenCalled();
    expect(a.closeCollectionCursor).toHaveBeenCalledTimes(
      a.listCollections.mock.calls.length,
    );
    expect(a.close).toHaveBeenCalledTimes(1);
    const result = jsonEvent(a.h, 'result');
    expect(result).toMatchObject({
      status: 'completed',
      writesAttempted: true,
    });
    expect(result).toHaveProperty(
      'models',
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'users',
          terminalState: 'verified',
          finalIndexes: [idIndex],
        }),
      ]),
    );
  });

  it.each([2, 3])(
    'stops when collection type changes at recheck %i',
    async (changeAt) => {
      const a = nativeAdapterHarness();
      let reads = 0;
      a.readCollection.mockImplementation((name) => {
        const type =
          name === 'users' && ++reads === changeAt ? 'view' : 'collection';
        return Promise.resolve({ name, type, options: {} });
      });

      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.listCollections).toHaveBeenLastCalledWith({ name: 'users' });
      expect(
        a.diffIndexes.mock.calls.filter(([name]) => name === 'User'),
      ).toHaveLength(changeAt - 1);
      expect(a.createCollection).not.toHaveBeenCalled();
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(a.closeCollectionCursor).toHaveBeenCalledTimes(
        a.listCollections.mock.calls.length,
      );
      expect(a.close).toHaveBeenCalledTimes(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        status: 'failed',
        writesAttempted: false,
        error: { code: 'COLLECTION_TYPE_UNSUPPORTED' },
      });
    },
  );

  it.each([
    { stage: 'post-create check', changeAt: 1 },
    { stage: 'readback', changeAt: 2 },
  ])(
    'reports unconfirmed after type drift during $stage',
    async ({ changeAt }) => {
      const a = nativeAdapterHarness();
      const missing = new Set(['users', 'sessions', 'passwordresettokens']);
      let sessionReadsAfterCreation = 0;
      let drifted = false;
      a.readCollection.mockImplementation((name) => {
        if (missing.has(name)) return Promise.resolve(null);
        if (name === 'sessions' && ++sessionReadsAfterCreation === changeAt) {
          drifted = true;
        }
        const type = drifted ? 'view' : 'collection';
        return Promise.resolve({ name, type, options: {} });
      });
      a.createCollection.mockImplementation((name) => {
        missing.delete(name);
        return Promise.resolve();
      });
      if (changeAt === 1) {
        a.diffIndexes.mockImplementation((name) =>
          Promise.resolve({
            toDrop: [],
            toCreate: name === 'Session' ? [ttl] : [],
          }),
        );
      }

      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.createCollection.mock.calls).toEqual([['users'], ['sessions']]);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(a.runCursorCommand).toHaveBeenCalledWith(
        { listIndexes: 'users', cursor: {}, includeBuildUUIDs: true },
        expect.anything(),
      );
      expect(a.listCollections.mock.calls.slice(-2)).toEqual([
        [{ name: 'users' }],
        [{ name: 'sessions' }],
      ]);
      expect(a.closeCollectionCursor).toHaveBeenCalledTimes(
        a.listCollections.mock.calls.length,
      );
      expect(a.close).toHaveBeenCalledTimes(1);
      const auditError = { code: 'COLLECTION_TYPE_UNSUPPORTED' };
      const result = jsonEvent(a.h, 'result');
      expect(result).toMatchObject({
        status: 'failed',
        writesAttempted: true,
        partialEffectsPossible: true,
        error: auditError,
      });
      expect(result).toHaveProperty(
        'models',
        expect.arrayContaining([
          expect.objectContaining({
            collection: 'users',
            status: 'succeeded',
            terminalState: 'unconfirmed',
            auditError,
          }),
          expect.objectContaining({
            collection: 'sessions',
            status: 'failed',
            terminalState: 'unconfirmed',
            auditError,
          }),
          expect.objectContaining({
            collection: 'passwordresettokens',
            status: 'not-executed',
          }),
        ]),
      );
      expect(output(a.h)).not.toContain('"terminalState":"verified"');
      expect(output(a.h)).not.toContain('"collectionExists"');
      expect(output(a.h)).not.toContain('"finalIndexes"');
    },
  );

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

describe('sync-indexes BSON numeric decoding (offline)', () => {
  const sessionIndexes: mongo.IndexDescriptionInfo[] = [
    idIndex,
    { name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { name: 'token_1', key: { token: 1 }, unique: true },
    { name: 'userId_1', key: { userId: 1 } },
  ];

  it.each([
    { args: ['--dry-run'], status: 'preview' },
    { args: [...apply, '--allow-drop'], status: 'completed' },
  ])(
    'keeps matching indexes out of the $status plan',
    async ({ args, status }) => {
      const h = harness();
      const uri = adminUri + '?promoteValues=false';
      const deps: Partial<SyncIndexesDependencies> = {
        ...h.deps,
        env: { NODE_ENV: 'test', MONGO_ADMIN_URI: uri },
      };
      delete deps.createConnection;

      const fixtureBytes = new Map<string, Uint8Array>();
      const sessionReads = {
        raw: [] as mongo.IndexDescriptionInfo[][],
        mongoose: [] as mongo.IndexDescriptionInfo[][],
      };
      const rawOptions: (mongo.RunCursorCommandOptions | undefined)[] = [];
      const forbidden = jest.fn(() => {
        throw new Error('UNEXPECTED_WRITE');
      });
      let client: mongo.MongoClient | undefined;

      function decode(
        name: string,
        cursor: mongo.AbstractCursor,
        path: keyof typeof sessionReads,
      ) {
        const bytes = fixtureBytes.get(name);
        // Use the real cursor's resolved decoder settings without iterating the network cursor.
        const options: unknown = Reflect.get(cursor, 'deserializationOptions');
        if (!bytes || !options || typeof options !== 'object') {
          throw new Error('EXPECTED_BSON_FIXTURE_AND_CURSOR_OPTIONS');
        }
        const decoded: unknown = mongoose.mongo.BSON.deserialize(
          bytes,
          options,
        ).indexes;
        if (!Array.isArray(decoded)) throw new Error('EXPECTED_INDEX_METADATA');
        const indexes = decoded as mongo.IndexDescriptionInfo[];
        if (name === 'sessions') sessionReads[path].push(indexes);
        return indexes;
      }

      jest
        .mocked(mongoose.createConnection)
        .mockImplementationOnce(
          (receivedUri?: string, receivedOptions?: mongoose.ConnectOptions) => {
            if (!receivedUri || !receivedOptions) {
              throw new Error('EXPECTED_CONNECTION_ARGUMENTS');
            }
            const { autoCreate, autoIndex, ...driverOptions } = receivedOptions;
            expect([autoCreate, autoIndex]).toEqual([false, false]);
            const driverClient = new mongoose.mongo.MongoClient(
              receivedUri,
              driverOptions,
            );
            client = driverClient;
            const driverDb = driverClient.db();
            const native = new mongoose.Connection();
            Object.defineProperty(native, 'model', {
              value: (name: string, schema: Schema) => {
                const model = disconnectedModel(name, schema);
                const collection = driverDb.collection(model.collection.name);
                const indexes =
                  name === 'Session'
                    ? sessionIndexes
                    : [
                        idIndex,
                        ...schema.indexes().map(([key, options], index) => ({
                          ...options,
                          key,
                          name: options.name ?? 'fixture_' + index,
                        })),
                      ];
                fixtureBytes.set(
                  collection.collectionName,
                  mongoose.mongo.BSON.serialize({ indexes }),
                );
                jest
                  .spyOn(model, 'listIndexes')
                  .mockImplementation(async () => {
                    const cursor = collection.listIndexes();
                    try {
                      return decode(
                        collection.collectionName,
                        cursor,
                        'mongoose',
                      );
                    } finally {
                      await cursor.close();
                    }
                  });
                jest.spyOn(model, 'cleanIndexes').mockImplementation(forbidden);
                jest
                  .spyOn(model, 'createIndexes')
                  .mockImplementation(forbidden);
                return model;
              },
            });
            Object.defineProperty(native, 'db', {
              value: {
                databaseName: driverDb.databaseName,
                listCollections: ({ name }: { name: string }) => ({
                  next: () =>
                    Promise.resolve({ name, type: 'collection', options: {} }),
                  close: () => Promise.resolve(),
                }),
                runCursorCommand: (
                  command: mongo.Document,
                  options?: mongo.RunCursorCommandOptions,
                ) => {
                  const name: unknown = command.listIndexes;
                  if (typeof name !== 'string')
                    throw new Error('EXPECTED_LIST_INDEXES');
                  rawOptions.push(options);
                  const cursor = driverDb.runCursorCommand(command, options);
                  jest
                    .spyOn(cursor, 'toArray')
                    .mockImplementation(() =>
                      Promise.resolve(decode(name, cursor, 'raw')),
                    );
                  return cursor;
                },
                createCollection: forbidden,
              },
            });
            jest.spyOn(native, 'asPromise').mockResolvedValue(native);
            jest.spyOn(native, 'getClient').mockReturnValue(driverClient);
            jest
              .spyOn(native, 'close')
              .mockImplementation(() => driverClient.close());
            return native;
          },
        );

      expect(await runSyncIndexesCli(args, deps)).toBe(0);
      expect(mongoose.createConnection).toHaveBeenLastCalledWith(
        uri,
        expect.objectContaining({ promoteValues: true }),
      );
      expect(client?.options).toHaveProperty('promoteValues', true);
      expect(rawOptions.length).toBeGreaterThan(0);
      for (const options of rawOptions) {
        expect(options).toMatchObject({
          promoteValues: true,
          timeoutMS: 65000,
          timeoutMode: 'cursorLifetime',
        });
      }
      for (const reads of Object.values(sessionReads)) {
        expect(reads.length).toBeGreaterThan(0);
        for (const indexes of reads) {
          expect(indexes).toEqual(sessionIndexes);
          const ttlIndex = indexes.find(({ name }) => name === 'expiresAt_1');
          expect(ttlIndex?.key.expiresAt).toBe(1);
          expect(ttlIndex?.expireAfterSeconds).toBe(0);
        }
      }
      expect(jsonEvent(h, 'plan')).toMatchObject({
        models: SYNC_INDEX_SCHEMAS.map(({ name }) => ({
          model: name,
          createCollection: false,
          toDrop: [],
          toCreate: [],
        })),
      });
      expect(jsonEvent(h, 'result')).toMatchObject({
        status,
        writesAttempted: false,
      });
      expect(forbidden).not.toHaveBeenCalled();
    },
  );
});

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
