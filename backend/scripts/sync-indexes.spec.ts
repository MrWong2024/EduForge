import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import mongoose, { type mongo, type Schema } from 'mongoose';
import { SubmissionSchema } from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  cleanupSyncIndexesCollections,
  createSyncIndexesLifecycle,
} from '../test/helpers/sync-indexes-lifecycle';
import {
  createMongooseConnection,
  runSyncIndexesCli,
  writeSyncIndexesLine,
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
const initialUuid = 'a3f1c2d4e5f6471889a0b1c2d3e4f506';
const createdUuid = 'b3f1c2d4e5f6471889a0b1c2d3e4f506';
const changedUuid = 'c3f1c2d4e5f6471889a0b1c2d3e4f506';
const idIndex: mongo.IndexDescriptionInfo = {
  name: '_id_',
  key: { _id: 1 },
};
const legacy = {
  name: 'account_created',
  key: { accountId: 1, createdAt: -1 },
  unique: true,
  partialFilterExpression: { classroomTaskId: null },
  collation: { locale: 'en', strength: 2 },
} satisfies mongo.IndexDescriptionInfo;
const replacement: SyncIndexDefinition = [
  { accountId: 1, createdAt: -1 },
  { sparse: true },
];
const installedReplacement: mongo.IndexDescriptionInfo = {
  name: 'account_created',
  key: { accountId: 1, createdAt: -1 },
  sparse: true,
};
const ttl: SyncIndexDefinition = [
  { expiresAt: 1 },
  { expireAfterSeconds: 300 },
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
  collation?: CollectionMetadata['collation'];
  existing?: mongo.IndexDescriptionInfo[];
  drop?: string[];
  create?: SyncIndexDefinition[];
  expected?: SyncIndexDefinition[];
  installed?: mongo.IndexDescriptionInfo[];
};

function fakeModel(fixture: ModelFixture, events: string[]) {
  const { name, collectionName } = fixture;
  let exists = !fixture.missing;
  let uuid = initialUuid;
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
  const schemaIndexes = jest.fn<SyncIndexDefinition[], []>(
    () => fixture.expected ?? fixture.create ?? [],
  );
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
    uuid = createdUuid;
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
    metadata: () => (exists ? { collation: fixture.collation, uuid } : null),
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
    directConnection: jest.fn<boolean | undefined, []>(),
    writeConcernW: jest.fn<mongo.WriteConcern['w'] | undefined, []>(),
    assertSupportedTopology: jest.fn(() => Promise.resolve()),
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
  const deps: SyncIndexesDependencies = {
    env: { NODE_ENV: 'test', MONGO_ADMIN_URI: adminUri },
    backendDirectory,
    readFile,
    createConnection,
    log: (line) => {
      logs.push(line);
      if (line.includes('"event":"plan"')) events.push('plan-printed');
    },
    error: (line) => {
      errors.push(line);
    },
  };

  return {
    deps,
    connection,
    createConnection,
    readFile,
    models: models.map(({ model }) => model),
    logs,
    errors,
    events,
    run: (args: readonly string[] = []) => runSyncIndexesCli(args, deps),
  };
}

type Harness = ReturnType<typeof harness>;

function jsonEvent(h: Harness, name: string, relaxed = true): unknown {
  for (const line of [...h.logs, ...h.errors]) {
    if (!line.startsWith('{')) continue;
    const event: unknown = mongoose.mongo.BSON.EJSON.parse(line, { relaxed });
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

describe('sync-indexes planning, execution, and verification (offline)', () => {
  it.each<[readonly string[]]>([[[]], [['--dry-run']]])(
    'previews the complete plan without writes with %j',
    async (args) => {
      const h = harness([replace, absent]);
      expect(await h.run(args)).toBe(0);
      expect(jsonEvent(h, 'plan')).toMatchObject({
        mode: 'dry-run',
        databaseName: database,
        models: [
          {
            model: 'Task',
            collectionUuid: initialUuid,
            toDrop: [legacy],
            toCreate: [{ key: replacement[0], options: replacement[1] }],
          },
          { model: 'PasswordResetToken', createCollection: true },
        ],
      });
      expect(h.models[0].diffIndexes).toHaveBeenCalledWith(
        { indexOptionsToCreate: true },
        [idIndex, legacy],
      );
      expect(h.models[1].listIndexes).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'preview',
        writesAttempted: false,
      });
      noWrites(h);
      expect(h.connection.close).toHaveBeenCalledTimes(1);
    },
  );

  it('prints the full plan, performs authorized replacements and collection creation, then verifies all models', async () => {
    const h = harness([replace, absent]);
    expect(await h.run([...apply, '--allow-drop'])).toBe(0);
    const firstWrite = h.events.indexOf('write:cleanIndexes:Task');
    expect(h.events.slice(0, firstWrite)).toContain('plan-printed');
    expect(h.events.slice(0, firstWrite)).toContain('diff:PasswordResetToken');
    expect(h.events.filter((event) => event.startsWith('write:'))).toEqual([
      'write:cleanIndexes:Task',
      'write:createIndexes:Task',
      'write:createCollection:PasswordResetToken',
      'write:createIndexes:PasswordResetToken',
    ]);
    expect(h.models[0].cleanIndexes).toHaveBeenCalledWith({
      toDrop: [legacy.name],
    });
    expect(h.models[0].createIndexes).toHaveBeenCalledWith({
      toCreate: [replacement],
    });
    expect(h.models[1].createIndexes).toHaveBeenCalledWith({ toCreate: [ttl] });
    expect(
      h.models.every(({ syncIndexes }) => syncIndexes.mock.calls.length === 0),
    ).toBe(true);
    expect(h.events.lastIndexOf('indexes:Task')).toBeGreaterThan(
      h.events.indexOf('write:createIndexes:PasswordResetToken'),
    );
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'completed',
      writesAttempted: true,
      models: [
        {
          model: 'Task',
          collectionUuid: initialUuid,
          operations: [
            { kind: 'dropIndex', name: legacy.name, status: 'completed' },
            { kind: 'createIndex', status: 'completed' },
          ],
          verification: { status: 'passed' },
          finalIndexes: [idIndex, installedReplacement],
        },
        {
          model: 'PasswordResetToken',
          collectionUuid: createdUuid,
          operations: [
            { kind: 'createCollection', status: 'completed' },
            { kind: 'createIndex', status: 'completed' },
          ],
          verification: { status: 'passed' },
          finalIndexes: [idIndex, installedTtl],
        },
      ],
    });
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it('makes no writes without authorization and still verifies the full apply plan', async () => {
    const h = harness([absent, replace]);
    expect(await h.run(apply)).toBe(1);
    noWrites(h);
    expect(jsonEvent(h, 'result')).toMatchObject({
      error: { code: 'DROP_CONFIRMATION_REQUIRED' },
      writesAttempted: false,
      models: [
        { verification: { status: 'different' } },
        { verification: { status: 'different' } },
      ],
    });
    expect(h.events.lastIndexOf('indexes:Task')).toBeGreaterThan(
      h.events.indexOf('plan-printed'),
    );
  });

  it('rejects a failed initial plan before writes or terminal verification', async () => {
    const h = harness([addOnly, replace]);
    h.models[1].listIndexes.mockRejectedValueOnce(
      new Error('unreadable indexes'),
    );
    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    noWrites(h);
    expect(h.events).not.toContain('plan-printed');
    expect(
      h.events.filter((event) => event === 'indexes:Session'),
    ).toHaveLength(1);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
  });

  it.each(['definition', 'UUID'] as const)(
    'stops on per-model %s drift after earlier writes and still verifies all models',
    async (changed) => {
      const h = harness([addOnly, replace, absent]);
      if (changed === 'definition') {
        h.models[1].listIndexes.mockImplementation(() =>
          Promise.resolve(
            h.events.includes('plan-printed')
              ? [idIndex, { ...legacy, key: { accountId: 1 } }]
              : [idIndex, legacy],
          ),
        );
      } else {
        const read = h.connection.collectionMetadata.getMockImplementation();
        if (!read) throw new Error('EXPECTED_METADATA_FIXTURE');
        h.connection.collectionMetadata.mockImplementation(async (name) =>
          name === 'tasks' && h.events.includes('plan-printed')
            ? { collation: undefined, uuid: changedUuid }
            : read(name),
        );
      }

      expect(await h.run([...apply, '--allow-drop'])).toBe(1);
      expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
      expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
      expect(h.models[2].createCollection).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        error: { code: 'INDEX_PLAN_DRIFT' },
        models: [
          { verification: { status: 'passed' } },
          {
            operations: [
              { status: 'not-executed' },
              { status: 'not-executed' },
            ],
            verification: {
              status: 'different',
              ...(changed === 'UUID'
                ? {
                    differences: {
                      collectionUuidChanged: {
                        expected: initialUuid,
                        actual: changedUuid,
                      },
                    },
                  }
                : {}),
            },
          },
          { verification: { status: 'different' } },
        ],
      });
    },
  );

  it.each([
    ['read failure', 'INDEX_READBACK_FAILED'],
    ['hidden index', 'HIDDEN_INDEX_UNSUPPORTED'],
  ] as const)(
    'keeps UUID drift when verification also encounters a %s',
    async (issue, code) => {
      const h = harness([addOnly, replace, absent]);
      const read = h.connection.collectionMetadata.getMockImplementation();
      if (!read) throw new Error('EXPECTED_METADATA_FIXTURE');
      h.connection.collectionMetadata.mockImplementation((name) =>
        name === 'tasks' && h.events.includes('plan-printed')
          ? Promise.resolve({ collation: undefined, uuid: changedUuid })
          : read(name),
      );
      h.models[1].listIndexes.mockImplementation(() => {
        if (!h.events.includes('plan-printed')) {
          return Promise.resolve([idIndex, legacy]);
        }
        return issue === 'read failure'
          ? Promise.reject(new Error('private read error'))
          : Promise.resolve([idIndex, { ...legacy, hidden: true }]);
      });

      expect(await h.run([...apply, '--allow-drop'])).toBe(1);
      expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
      expect(h.models[1].cleanIndexes).not.toHaveBeenCalled();
      expect(h.models[2].createCollection).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        models: [
          { verification: { status: 'passed' } },
          {
            collectionUuid: changedUuid,
            verification: {
              status: 'unconfirmed',
              collectionUuidChanged: {
                expected: initialUuid,
                actual: changedUuid,
              },
              error: { code },
            },
          },
          { verification: { status: 'different' } },
        ],
      });
      expect(output(h)).not.toContain('private read error');
    },
  );

  it.each(['drop', 'create'] as const)(
    'stops all later writes after a %s fails and records partial execution',
    async (kind) => {
      const extra = { name: 'z_extra', key: { extra: 1 } };
      const fixture = {
        ...replace,
        existing: [legacy, extra],
        drop: [legacy.name, extra.name],
        create: [replacement, ttl],
        installed: [installedReplacement, installedTtl],
      };
      const h = harness([fixture, absent]);
      const action =
        kind === 'drop' ? h.models[0].cleanIndexes : h.models[0].createIndexes;
      action.mockRejectedValueOnce(
        new mongoose.mongo.MongoServerError({
          message: 'synthetic private duplicate key ' + adminUri,
          code: 11000,
        }),
      );

      expect(await h.run([...apply, '--allow-drop'])).toBe(1);
      expect(h.models[0].cleanIndexes).toHaveBeenCalledTimes(
        kind === 'drop' ? 1 : 2,
      );
      expect(h.models[0].createIndexes).toHaveBeenCalledTimes(
        kind === 'drop' ? 0 : 1,
      );
      expect(h.models[1].createCollection).not.toHaveBeenCalled();
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        partialEffectsPossible: true,
        error: { driverCode: 11000 },
        models: [
          {
            operations:
              kind === 'drop'
                ? [
                    { kind: 'dropIndex', status: 'failed' },
                    { kind: 'dropIndex', status: 'not-executed' },
                    { kind: 'createIndex', status: 'not-executed' },
                    { kind: 'createIndex', status: 'not-executed' },
                  ]
                : [
                    { kind: 'dropIndex', status: 'completed' },
                    { kind: 'dropIndex', status: 'completed' },
                    { kind: 'createIndex', status: 'failed' },
                    { kind: 'createIndex', status: 'not-executed' },
                  ],
            verification: { status: 'different' },
          },
          {
            operations: [
              { status: 'not-executed' },
              { status: 'not-executed' },
            ],
          },
        ],
      });
      expect(output(h)).not.toContain(adminUri);
      expect(output(h)).not.toContain('synthetic private duplicate key');
    },
  );

  it('awaits each operation and records a mid-creation error before the remaining creation', async () => {
    const extra: SyncIndexDefinition = [{ value: 1 }, {}];
    const h = harness([
      {
        ...addOnly,
        create: [ttl, replacement, extra],
        installed: [installedTtl],
      },
      absent,
    ]);
    const create = h.models[0].createIndexes;
    const install = create.getMockImplementation();
    if (!install) throw new Error('EXPECTED_INSTALL_FIXTURE');
    let release!: () => void;
    let started!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstWrite = new Promise<void>((resolve) => {
      started = resolve;
    });
    create
      .mockImplementationOnce(async (options) => {
        started();
        await pause;
        await install(options);
      })
      .mockRejectedValueOnce(new Error('middle creation failed'));
    const running = h.run(apply);
    await Promise.race([firstWrite, running]);
    try {
      expect(create).toHaveBeenCalledTimes(1);
      expect(h.models[1].createCollection).not.toHaveBeenCalled();
    } finally {
      release();
      await running;
    }
    expect(await running).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          operations: [
            { status: 'completed' },
            { status: 'failed' },
            { status: 'not-executed' },
          ],
          verification: { status: 'different' },
        },
        { verification: { status: 'different' } },
      ],
    });
  });

  it('preserves a failed DDL reply even when readback matches the Schema', async () => {
    const h = harness();
    const create = h.models[0].createIndexes;
    const install = create.getMockImplementation();
    if (!install) throw new Error('EXPECTED_INSTALL_FIXTURE');
    create.mockImplementationOnce(async (options) => {
      await install(options);
      throw new Error('reply lost');
    });
    expect(await h.run(apply)).toBe(1);
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      error: { code: 'INDEX_APPLY_FAILED' },
      models: [
        {
          operations: [{ status: 'failed' }],
          verification: { status: 'passed' },
        },
      ],
    });
  });

  it.each(['different', 'unconfirmed'] as const)(
    'verifies later models after a first-model %s result',
    async (status) => {
      const h = harness([addOnly, absent]);
      const create = h.models[0].createIndexes;
      create.mockImplementationOnce(() => {
        if (status === 'unconfirmed') {
          h.models[0].listIndexes.mockRejectedValue(
            new Error('metadata unavailable'),
          );
        }
        return Promise.resolve();
      });
      expect(await h.run(apply)).toBe(1);
      expect(h.models[1].createCollection).toHaveBeenCalledTimes(1);
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        models: [
          { operations: [{ status: 'completed' }], verification: { status } },
          { verification: { status: 'passed' } },
        ],
      });
    },
  );

  it('finds a missing unique constraint and extra hashed _id despite an empty Mongoose plan', async () => {
    const required: SyncIndexDefinition = [
      { submissionId: 1 },
      { unique: true },
    ];
    const nonUnique = { name: 'submissionId_1', key: { submissionId: 1 } };
    const hashed: mongo.IndexDescriptionInfo = {
      name: '_id_hashed',
      key: { _id: 'hashed' },
    };
    const h = harness([
      {
        name: 'AiFeedbackJob',
        collectionName: 'aifeedbackjobs',
        existing: [nonUnique, hashed],
        expected: [required],
      },
    ]);
    expect(await h.run(apply)).toBe(1);
    noWrites(h);
    expect(jsonEvent(h, 'plan')).toMatchObject({
      models: [{ toDrop: [], toCreate: [] }],
    });
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          verification: {
            status: 'different',
            differences: {
              missingIndexes: [
                { key: { submissionId: 1 }, options: { unique: true } },
              ],
              extraIndexes: [hashed, nonUnique],
            },
          },
        },
      ],
    });
  });

  it('records the newly created UUID before checking that same identity at the end', async () => {
    const h = harness([absent]);
    const read = h.connection.collectionMetadata.getMockImplementation();
    if (!read) throw new Error('EXPECTED_METADATA_FIXTURE');
    h.connection.collectionMetadata.mockImplementation(async (name) =>
      h.models[0].createIndexes.mock.calls.length
        ? { collation: undefined, uuid: changedUuid }
        : read(name),
    );
    expect(await h.run(apply)).toBe(1);
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          verification: {
            status: 'different',
            differences: {
              collectionUuidChanged: {
                expected: createdUuid,
                actual: changedUuid,
              },
            },
          },
        },
      ],
    });
  });

  it.each([
    [{ ...installedReplacement, key: { createdAt: -1, accountId: 1 } }],
    [{ ...installedReplacement, collation: { locale: 'en', strength: 2 } }],
  ])('checks order and collation with an empty plan: %j', async (actual) => {
    const h = harness([
      {
        ...replace,
        existing: [actual],
        drop: [],
        create: [],
        expected: [replacement],
      },
    ]);
    expect(await h.run(apply)).toBe(1);
    noWrites(h);
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          verification: {
            status: 'different',
            differences: {
              missingIndexes: [
                { key: replacement[0], options: replacement[1] },
              ],
              extraIndexes: [actual],
            },
          },
        },
      ],
    });
  });

  it('recognizes the default index by both exact name and key', async () => {
    const h = harness([{ name: 'User', collectionName: 'users' }]);
    const notDefault = { name: 'wrong_id_name', key: { _id: 1 } };
    h.models[0].listIndexes.mockResolvedValue([notDefault]);
    expect(await h.run(apply)).toBe(1);
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          verification: {
            status: 'different',
            differences: {
              missingDefaultIndex: true,
              extraIndexes: [notDefault],
            },
          },
        },
      ],
    });
    noWrites(h);
  });

  it('marks the newly created identity unconfirmed when its initial read fails', async () => {
    const h = harness([absent]);
    const model = h.models[0];
    const create = model.createCollection.getMockImplementation();
    if (!create) throw new Error('EXPECTED_CREATION_FIXTURE');
    model.createCollection.mockImplementationOnce(async () => {
      await create();
      h.connection.collectionMetadata.mockRejectedValueOnce(
        new Error('missing initial UUID'),
      );
    });
    expect(await h.run(apply)).toBe(1);
    expect(model.createIndexes).not.toHaveBeenCalled();
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [{ verification: { status: 'unconfirmed' } }],
    });
  });
});

describe('sync-indexes output boundaries (offline)', () => {
  it('waits for the plan write callback before issuing DDL', async () => {
    const h = harness();
    let signal!: () => void;
    let completeWrite: ((error?: Error | null) => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        completeWrite = callback;
        signal();
      },
    });
    h.deps.log = (line) => {
      if (line.includes('"event":"plan"'))
        return writeSyncIndexesLine(stream, line);
      h.logs.push(line);
    };
    const running = h.run(apply);
    await Promise.race([started, running]);
    try {
      expect(completeWrite).toBeDefined();
      noWrites(h);
    } finally {
      completeWrite?.();
      await running;
      stream.destroy();
    }
    expect(await running).toBe(0);
    expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
  });

  it.each(['asynchronous EPIPE', 'synchronous write error'] as const)(
    'reports %s during the plan as a failure with no DDL',
    async (kind) => {
      const h = harness();
      const error = Object.assign(new Error('private output error'), {
        code: 'EPIPE',
      });
      const stream = new Writable({
        write(_chunk, _encoding, callback) {
          queueMicrotask(() => callback(error));
        },
      });
      if (kind === 'synchronous write error') {
        jest.spyOn(stream, 'write').mockImplementation(() => {
          throw error;
        });
      }
      h.deps.log = (line) => writeSyncIndexesLine(stream, line);
      expect(await h.run(apply)).toBe(1);
      noWrites(h);
      expect(h.connection.close).toHaveBeenCalledTimes(1);
      expect(jsonEvent(h, 'result')).toMatchObject({
        status: 'failed',
        error: { code: 'PLAN_OUTPUT_FAILED' },
        writesAttempted: false,
      });
      expect(output(h)).not.toContain('private output error');
      stream.destroy();
    },
  );

  it.each([true, false])(
    'exits nonzero when the result channel breaks (stderr available %j)',
    async (stderrAvailable) => {
      const h = harness();
      const error = Object.assign(new Error('private output error'), {
        code: 'EPIPE',
      });
      const stream = new Writable({
        write(_chunk, _encoding, callback) {
          queueMicrotask(() => callback(error));
        },
      });
      h.deps.log = (line) => {
        if (line.includes('"event":"result"'))
          return writeSyncIndexesLine(stream, line);
        h.logs.push(line);
      };
      const stderr = jest.fn((line: string) => {
        if (!stderrAvailable) return Promise.reject(error);
        h.errors.push(line);
        return Promise.resolve();
      });
      h.deps.error = stderr;
      expect(await h.run(apply)).toBe(1);
      expect(h.models[0].createIndexes).toHaveBeenCalledTimes(1);
      expect(h.connection.close).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledTimes(1);
      if (stderrAvailable) {
        expect(jsonEvent(h, 'result')).toMatchObject({
          status: 'failed',
          reportError: {
            code: 'RESULT_OUTPUT_FAILED',
            rawMetadataOmitted: true,
          },
          models: [
            {
              operations: [{ status: 'completed' }],
              verification: { status: 'passed' },
            },
          ],
        });
      } else {
        expect(h.errors).toHaveLength(0);
      }
      stream.destroy();
    },
  );

  it('degrades an unserializable result without losing the original execution error or safe states', async () => {
    const h = harness([{ ...replace, create: [replacement, ttl] }, absent]);
    const model = h.models[0];
    model.createIndexes.mockRejectedValueOnce(
      new mongoose.mongo.MongoServerError({
        message: 'private duplicate key',
        code: 11000,
      }),
    );
    const read = model.listIndexes.getMockImplementation();
    if (!read) throw new Error('EXPECTED_READ_FIXTURE');
    model.listIndexes.mockImplementation(() =>
      model.createIndexes.mock.calls.length
        ? Promise.resolve([
            idIndex,
            {
              name: 'unsafe_serialization_fixture',
              key: { evidence: 1 },
              evidence: { _bsontype: 'private_serializer_fixture' },
            },
          ])
        : read(),
    );

    expect(await h.run([...apply, '--allow-drop'])).toBe(1);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expect(jsonEvent(h, 'result')).toMatchObject({
      status: 'failed',
      error: { code: 'INDEX_APPLY_FAILED', driverCode: 11000 },
      reportError: {
        code: 'REPORT_SERIALIZATION_FAILED',
        rawMetadataOmitted: true,
      },
      models: [
        {
          collectionUuid: initialUuid,
          operations: [
            { status: 'completed' },
            { status: 'failed' },
            { status: 'not-executed' },
          ],
          verification: { status: 'different' },
        },
        {
          operations: [{ status: 'not-executed' }, { status: 'not-executed' }],
          verification: { status: 'different' },
        },
      ],
    });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).not.toMatch(
      /private_|unsafe_serialization_fixture|"finalIndexes"|"options"|"key"/,
    );
  });
});

describe('sync-indexes integration lifecycle (offline)', () => {
  it('stops new writes at the deadline and permits cleanup only after confirmed settlement', async () => {
    const lifecycle = createSyncIndexesLifecycle();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = jest.fn(() => pending);
    const nextWrite = jest.fn(() => Promise.resolve());
    const cleanup = jest.fn();
    jest.useFakeTimers();
    try {
      const running = lifecycle.run(100, async () => {
        await lifecycle.write(write);
        await lifecycle.write(nextWrite);
      });
      const expired = expect(running).rejects.toThrow(
        'SYNC_INDEXES_E2E_DEADLINE',
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(100);
      await expired;
      await expect(lifecycle.write(nextWrite)).rejects.toThrow(
        'SYNC_INDEXES_E2E_STOPPED',
      );
      const wait = lifecycle.stopAndWait(10);
      await jest.advanceTimersByTimeAsync(10);
      const beforeSettlement = await wait;
      if (beforeSettlement.cleanupAllowed) cleanup();
      expect(beforeSettlement).toEqual({
        settled: false,
        uncertainWrite: false,
        cleanupAllowed: false,
      });
      expect(cleanup).not.toHaveBeenCalled();

      release();
      const afterSettlement = await lifecycle.stopAndWait(1000);
      if (afterSettlement.cleanupAllowed) cleanup();
      expect(afterSettlement).toEqual({
        settled: true,
        uncertainWrite: false,
        cleanupAllowed: true,
      });
      expect(nextWrite).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      release();
      jest.useRealTimers();
    }
  });

  it('does not permit cleanup after an uncertain write even when its promise settled', async () => {
    const lifecycle = createSyncIndexesLifecycle();
    const error = new Error('write response not received');
    await expect(lifecycle.write(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    expect(await lifecycle.stopAndWait(0)).toEqual({
      settled: true,
      uncertainWrite: true,
      cleanupAllowed: false,
    });
  });
});

describe('sync-indexes integration cleanup deadline (offline)', () => {
  function cleanupFixture() {
    const owned = new Map([
      ['first', initialUuid],
      ['second', changedUuid],
    ]);
    const target = {
      verify: jest.fn<Promise<void>, [number]>(() => Promise.resolve()),
      assertOwned: jest.fn<Promise<void>, [string, number]>(() =>
        Promise.resolve(),
      ),
      drop: jest.fn<Promise<boolean>, [string, number]>(() =>
        Promise.resolve(true),
      ),
      readResidual: jest.fn<Promise<string[]>, [number]>(() =>
        Promise.resolve([...owned.keys()]),
      ),
    };
    const closeConnections = jest.fn<Promise<void>, []>(() =>
      Promise.resolve(),
    );
    return {
      owned,
      target,
      closeConnections,
      run: () =>
        cleanupSyncIndexesCollections({
          lifecycle: createSyncIndexesLifecycle(),
          owned,
          target,
          closeConnections,
          totalBudgetMs: 80_000,
          drainWaitMs: 10_000,
          requestTimeoutMs: 10_000,
          reportReserveMs: 10_000,
          closeReserveMs: 10_000,
        }),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('rechecks the deadline after UUID lookup even if its timer has not fired', async () => {
    const fixture = cleanupFixture();
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    let confirmOwnership!: () => void;
    fixture.target.assertOwned.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        confirmOwnership = resolve;
      }),
    );

    const cleanup = fixture.run();
    await jest.advanceTimersByTimeAsync(0);
    expect(fixture.target.assertOwned).toHaveBeenCalledTimes(1);
    clock = 60_000;
    confirmOwnership();

    expect(await cleanup).toMatchObject({
      cleanupIssue: 'cleanup-deadline',
      observedResidual: ['first', 'second'],
      completed: [],
      registered: ['first', 'second'],
      connectionsClosed: true,
    });
    expect(fixture.target.assertOwned).toHaveBeenCalledTimes(1);
    expect(fixture.target.drop).not.toHaveBeenCalled();
    expect(fixture.target.readResidual).toHaveBeenCalledTimes(1);
    expect(fixture.closeConnections).toHaveBeenCalledTimes(1);
  });

  it.each([
    { remaining: [], cleanupIssue: undefined },
    { remaining: ['second'], cleanupIssue: 'cleanup-deadline' },
  ])(
    'records the in-flight drop confirmed after the write cutoff with remaining=$remaining',
    async ({ remaining, cleanupIssue }) => {
      const fixture = cleanupFixture();
      if (!remaining.length) fixture.owned.delete('second');
      const startedAt = jest.now();
      let elapsedBeforeDrop = 0;
      jest
        .spyOn(performance, 'now')
        .mockImplementation(() => elapsedBeforeDrop + (jest.now() - startedAt));
      fixture.target.assertOwned.mockImplementationOnce(() => {
        elapsedBeforeDrop = 59_000;
        return Promise.resolve();
      });
      fixture.target.drop.mockImplementationOnce(
        (_name, timeoutMS) =>
          new Promise<boolean>((resolve, reject) => {
            const replyDelayMs = 3_000;
            setTimeout(
              () => {
                if (timeoutMS < replyDelayMs) {
                  reject(new Error('simulated drop timeout'));
                } else {
                  resolve(true);
                }
              },
              Math.min(timeoutMS, replyDelayMs),
            );
          }),
      );

      const cleanup = fixture.run();
      await jest.advanceTimersByTimeAsync(0);
      expect(performance.now()).toBe(59_000);
      await jest.advanceTimersByTimeAsync(3_000);
      expect(performance.now()).toBe(62_000);

      expect(fixture.target.drop.mock.calls).toEqual([['first', 6_000]]);
      expect(await cleanup).toMatchObject({
        cleanupIssue,
        observedResidual: remaining,
        completed: ['first'],
        registered: remaining,
        connectionsClosed: true,
      });
      expect([...fixture.owned.keys()]).toEqual(remaining);
    },
  );

  it('keeps the registration and does not claim success when a drop is still unconfirmed', async () => {
    const fixture = cleanupFixture();
    let acknowledgeDrop!: (dropped: boolean) => void;
    fixture.target.drop.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        acknowledgeDrop = resolve;
      }),
    );

    const cleanup = fixture.run();
    await jest.advanceTimersByTimeAsync(0);
    expect(fixture.target.drop).toHaveBeenCalledWith('first', 10_000);
    await jest.advanceTimersByTimeAsync(65_000);

    expect(await cleanup).toMatchObject({
      cleanupIssue: 'drop-unconfirmed:first',
      observedResidual: 'unconfirmed',
      completed: [],
      registered: ['first', 'second'],
      connectionsClosed: false,
    });
    expect(fixture.target.drop).toHaveBeenCalledTimes(1);
    expect(fixture.closeConnections).toHaveBeenCalledTimes(1);
    acknowledgeDrop(true);
  });

  it('bounds residual verification and connection closure separately under the total deadline', async () => {
    const fixture = cleanupFixture();
    let reportResidual!: (names: string[]) => void;
    let close!: () => void;
    fixture.target.readResidual.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        reportResidual = resolve;
      }),
    );
    fixture.closeConnections.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        close = resolve;
      }),
    );

    const cleanup = fixture.run();
    await jest.advanceTimersByTimeAsync(80_000);
    expect(await cleanup).toMatchObject({
      cleanupIssue: 'residual-unconfirmed',
      observedResidual: 'unconfirmed',
      completed: ['first', 'second'],
      registered: [],
      connectionsClosed: false,
    });
    expect(fixture.closeConnections).toHaveBeenCalledTimes(1);
    reportResidual([]);
    close();
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
    expect(h.connection.directConnection).not.toHaveBeenCalled();
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

type ComparisonIndex = Omit<mongo.IndexDescriptionInfo, 'key'> & {
  key: Record<string, unknown>;
};

const sessionUserIndex = { name: 'userId_1', key: { userId: 1 } };
const matchingSessionIndexes: ComparisonIndex[] = [
  idIndex,
  { name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  { name: 'token_1', key: { token: 1 }, unique: true },
  sessionUserIndex,
];

function sessionUserDeclaration(schema: Schema): SyncIndexDefinition {
  const index = schema.indexes().find(([key]) => Object.hasOwn(key, 'userId'));
  if (!index) throw new Error('EXPECTED_SESSION_USER_INDEX');
  return index;
}

function comparisonIndexesFor(schema: Schema): ComparisonIndex[] {
  return [
    idIndex,
    ...schema.indexes().map(([key, options], index) => {
      const {
        _autoIndex,
        ...serverOptions
      }: mongoose.IndexOptions & {
        _autoIndex?: boolean;
      } = options;
      void _autoIndex;
      return {
        ...serverOptions,
        key,
        name: options.name ?? 'fixture_' + index,
      };
    }),
  ];
}

function realComparisonHarness(
  fixture: {
    modelName?: 'Session' | 'Submission';
    suffix?: string;
    indexes?: readonly unknown[];
    recheckedIndexes?: readonly unknown[];
    configureSchema?: (schema: Schema) => void;
    metadata?: (name: string) => unknown;
    hello?: () => Promise<mongo.Document>;
    schemas?: typeof SYNC_INDEX_SCHEMAS;
    dropFixtures?: ReadonlyMap<
      string,
      { name: string; key: mongo.IndexDescriptionInfo['key'] }
    >;
  } = {},
) {
  const h = harness();
  const uri = adminUri + (fixture.suffix ?? '');
  const deps: Partial<SyncIndexesDependencies> = {
    ...h.deps,
    env: { NODE_ENV: 'test', MONGO_ADMIN_URI: uri },
  };
  delete deps.createConnection;
  const schemas = fixture.schemas;
  if (schemas) {
    deps.createConnection = (uri, options) =>
      createMongooseConnection(uri, options, schemas);
  }

  const { BSON } = mongoose.mongo;
  const native = new mongoose.Connection();
  const fixtureBytes = new Map<string, Uint8Array>();
  const recheckedBytes =
    fixture.recheckedIndexes &&
    BSON.serialize({ indexes: fixture.recheckedIndexes });
  const rawReads: mongo.IndexDescriptionInfo[][] = [];
  const registrations: Array<[string, Schema, string]> = [];
  const indexClosures: jest.SpyInstance[] = [];
  const closeCollectionCursor = jest.fn<void, []>();
  const closeConnection = jest.fn((client: mongo.MongoClient) =>
    client.close(),
  );
  const hello = jest.fn<Promise<mongo.Document>, [mongo.Document]>(
    fixture.hello ??
      (() => Promise.resolve({ ok: 1, isWritablePrimary: true })),
  );
  const forbidden = jest.fn(() => {
    throw new Error('UNEXPECTED_WRITE_OR_SECOND_METADATA_READ');
  });
  const dropped: Array<{ model: string; index: string }> = [];
  const metadata = jest.fn((name: string) =>
    fixture.metadata
      ? fixture.metadata(name)
      : {
          name,
          type: 'collection',
          options: {},
          info: { uuid: new BSON.UUID(initialUuid) },
        },
  );
  let trackedCollection: string | undefined;
  let client: mongo.MongoClient | undefined;
  const rawOptions: (mongo.RunCursorCommandOptions | undefined)[] = [];
  const collectionOptions: (mongo.ListCollectionsOptions | undefined)[] = [];

  function run(args: readonly string[]) {
    jest
      .mocked(mongoose.createConnection)
      .mockImplementationOnce(
        (receivedUri?: string, receivedOptions?: mongoose.ConnectOptions) => {
          if (!receivedUri || !receivedOptions)
            throw new Error('EXPECTED_CONNECTION_ARGUMENTS');
          const { autoCreate, autoIndex, ...driverOptions } = receivedOptions;
          expect([autoCreate, autoIndex]).toEqual([false, false]);
          const driverClient = new mongoose.mongo.MongoClient(
            receivedUri,
            driverOptions,
          );
          client = driverClient;
          const driverDb = driverClient.db();
          Object.defineProperty(native, 'model', {
            value: (name: string, schema: Schema) => {
              const model = disconnectedModel(name, schema);
              registrations.push([name, schema, model.collection.name]);
              const tracked = name === (fixture.modelName ?? 'Session');
              if (tracked) trackedCollection = model.collection.name;
              const initialIndexes =
                (tracked && fixture.indexes) ||
                (name === 'Session'
                  ? matchingSessionIndexes
                  : comparisonIndexesFor(schema));
              const dropFixture = fixture.dropFixtures?.get(name);
              const indexes = dropFixture
                ? [...initialIndexes, dropFixture]
                : initialIndexes;
              fixtureBytes.set(
                model.collection.name,
                BSON.serialize({ indexes }),
              );
              if (tracked) fixture.configureSchema?.(model.schema);
              jest.spyOn(model, 'listIndexes').mockImplementation(forbidden);
              jest
                .spyOn(model, 'cleanIndexes')
                .mockImplementation((options) => {
                  const indexName = dropFixture?.name;
                  if (
                    !indexName ||
                    options?.toDrop?.length !== 1 ||
                    options.toDrop[0] !== indexName
                  ) {
                    return forbidden();
                  }
                  dropped.push({ model: name, index: indexName });
                  fixtureBytes.set(
                    model.collection.name,
                    BSON.serialize({ indexes: initialIndexes }),
                  );
                  return Promise.resolve([indexName]);
                });
              jest.spyOn(model, 'createIndexes').mockImplementation(forbidden);
              return model;
            },
          });
          Object.defineProperty(native, 'db', {
            value: {
              databaseName: driverDb.databaseName,
              command: hello,
              listCollections: (
                { name }: { name: string },
                options?: mongo.ListCollectionsOptions,
              ) => {
                collectionOptions.push(options);
                const cursor = driverDb.listCollections({ name }, options);
                jest.spyOn(cursor, 'next').mockImplementation(() => {
                  const decoderOptions: unknown = Reflect.get(
                    cursor,
                    'deserializationOptions',
                  );
                  if (!decoderOptions || typeof decoderOptions !== 'object') {
                    throw new Error('EXPECTED_COLLECTION_CURSOR_OPTIONS');
                  }
                  const decoded: unknown = BSON.deserialize(
                    BSON.serialize({ entry: metadata(name) }),
                    decoderOptions,
                  ).entry;
                  return Promise.resolve(
                    decoded as mongo.CollectionInfo | null,
                  );
                });
                const close = cursor.close.bind(cursor) as typeof cursor.close;
                jest.spyOn(cursor, 'close').mockImplementation((options) => {
                  closeCollectionCursor();
                  return close(options);
                });
                return cursor;
              },
              runCursorCommand: (
                command: mongo.Document,
                options?: mongo.RunCursorCommandOptions,
              ) => {
                const name: unknown = command.listIndexes;
                if (typeof name !== 'string')
                  throw new Error('EXPECTED_LIST_INDEXES');
                expect(command).toMatchObject({ includeBuildUUIDs: true });
                rawOptions.push(options);
                const cursor = driverDb.runCursorCommand(command, options);
                jest.spyOn(cursor, 'toArray').mockImplementation(() => {
                  const bytes =
                    name === trackedCollection &&
                    recheckedBytes &&
                    rawReads.length
                      ? recheckedBytes
                      : fixtureBytes.get(name);
                  const decoderOptions: unknown = Reflect.get(
                    cursor,
                    'deserializationOptions',
                  );
                  if (
                    !bytes ||
                    !decoderOptions ||
                    typeof decoderOptions !== 'object'
                  )
                    throw new Error('EXPECTED_BSON_FIXTURE_AND_CURSOR_OPTIONS');
                  const decoded: unknown = BSON.deserialize(
                    bytes,
                    decoderOptions,
                  ).indexes;
                  if (!Array.isArray(decoded))
                    throw new Error('EXPECTED_INDEX_METADATA');
                  const indexes = decoded as mongo.IndexDescriptionInfo[];
                  if (name === trackedCollection) rawReads.push(indexes);
                  return Promise.resolve(indexes);
                });
                indexClosures.push(jest.spyOn(cursor, 'close'));
                return cursor;
              },
              createCollection: forbidden,
            },
          });
          jest.spyOn(native, 'asPromise').mockResolvedValue(native);
          jest.spyOn(native, 'getClient').mockReturnValue(driverClient);
          jest
            .spyOn(native, 'close')
            .mockImplementation(() => closeConnection(driverClient));
          return native;
        },
      );
    return runSyncIndexesCli(args, deps);
  }

  return {
    h,
    run,
    rawReads,
    rawOptions,
    registrations,
    metadata,
    hello,
    collectionOptions,
    forbidden,
    dropped,
    indexClosures,
    closeCollectionCursor,
    closeConnection,
    clientOptions: () => client?.options,
  };
}

function expectEmptyComparison(
  a: ReturnType<typeof realComparisonHarness>,
  status: string,
) {
  expect(jsonEvent(a.h, 'plan')).toMatchObject({
    models: SYNC_INDEX_SCHEMAS.map(({ name }) => ({
      model: name,
      createCollection: false,
      toDrop: [],
      toCreate: [],
    })),
  });
  expect(jsonEvent(a.h, 'result')).toMatchObject({
    status,
    writesAttempted: false,
  });
  expect(a.forbidden).not.toHaveBeenCalled();
}

function withSessionSchemaCollation(collation: unknown) {
  return SYNC_INDEX_SCHEMAS.map(({ name, schema }) => {
    if (name !== 'Session') return { name, schema };
    const clone = schema.clone();
    Reflect.set(clone.options, 'collation', collation);
    expect(
      clone.indexes().every(([, options]) => options.collation === undefined),
    ).toBe(true);
    return { name, schema: clone };
  });
}

function expectComparisonResourcesClosed(
  a: ReturnType<typeof realComparisonHarness>,
) {
  expect(a.closeCollectionCursor).toHaveBeenCalledTimes(
    a.metadata.mock.calls.length,
  );
  for (const close of a.indexClosures) expect(close).toHaveBeenCalledTimes(1);
  expect(a.closeConnection).toHaveBeenCalledTimes(1);
}

const clusteredOptions = {
  clusteredIndex: { key: { _id: 1 }, unique: true, name: '_id_' },
};

const cappedOptions = { capped: true };
const unsupportedCollectionOptions = [
  ['clustered', clusteredOptions, 'CLUSTERED_COLLECTION_UNSUPPORTED'],
  ['capped', cappedOptions, 'CAPPED_COLLECTION_UNSUPPORTED'],
] as const;

describe('sync-indexes driver and Schema adapter (offline)', () => {
  it('clones the exact formal registry without mutating shared Schema declarations', async () => {
    const source = SYNC_INDEX_SCHEMAS.map(({ schema }) => ({
      autoCreate: schema.options.autoCreate,
      autoIndex: schema.options.autoIndex,
      indexes: structuredClone(schema.indexes()),
    }));
    const a = realComparisonHarness();
    expect(await a.run(['--dry-run'])).toBe(0);
    expect(
      a.registrations.map(([name, , collection]) => [name, collection]),
    ).toEqual([
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
    ]);
    for (const [index, [, schema]] of a.registrations.entries()) {
      expect(schema).not.toBe(SYNC_INDEX_SCHEMAS[index].schema);
      expect(schema.options.autoCreate).toBe(false);
      expect(schema.options.autoIndex).toBe(false);
    }
    expect(
      SYNC_INDEX_SCHEMAS.map(({ schema }) => ({
        autoCreate: schema.options.autoCreate,
        autoIndex: schema.options.autoIndex,
        indexes: schema.indexes(),
      })),
    ).toEqual(source);
    expect(a.indexClosures[0]).toHaveBeenCalled();
    expect(a.closeCollectionCursor).toHaveBeenCalled();
  });

  it.each([
    ['?directConnection=true', [], 'DIRECT_CONNECTION_UNSUPPORTED'],
    ['?directConnection=true', apply, 'DIRECT_CONNECTION_UNSUPPORTED'],
    ['?w=0', apply, 'UNACKNOWLEDGED_WRITE_CONCERN'],
  ] as const)(
    'blocks %s %j before reading any collection',
    async (suffix, args, error) => {
      const a = realComparisonHarness({ suffix });
      expect(await a.run(args)).toBe(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: error },
      });
      expect(a.registrations).toHaveLength(0);
      expect(a.metadata).not.toHaveBeenCalled();
      expect(a.forbidden).not.toHaveBeenCalled();
    },
  );

  it('allows preview with the driver-parsed w=0', async () => {
    const a = realComparisonHarness({ suffix: '?w=0' });
    expect(await a.run(['--dry-run'])).toBe(0);
    expectEmptyComparison(a, 'preview');
  });

  it.each([
    ['mongos', 'SHARDED_TOPOLOGY_UNSUPPORTED'],
    ['failed handshake', 'CONNECTION_FAILED'],
  ] as const)('rejects %s before model registration', async (kind, code) => {
    const a = realComparisonHarness({
      hello: () =>
        kind === 'mongos'
          ? Promise.resolve({ ok: 1, msg: 'isdbgrid' })
          : Promise.reject(new Error('private handshake error')),
    });
    expect(await a.run(apply)).toBe(1);
    expect(a.hello.mock.calls[0]?.[0]).toEqual({ hello: 1 });
    expect(a.registrations).toHaveLength(0);
    expect(a.metadata).not.toHaveBeenCalled();
    expect(a.forbidden).not.toHaveBeenCalled();
    expect(jsonEvent(a.h, 'result')).toMatchObject({
      error: { code },
      writesAttempted: false,
    });
    expect(output(a.h)).not.toContain('private handshake error');
  });

  it.each([
    ['missing UUID', undefined],
    ['malformed UUID string', initialUuid],
    [
      'wrong BSON binary subtype',
      new mongoose.mongo.BSON.Binary(Buffer.alloc(16), 0),
    ],
    ['wrong UUID length', new mongoose.mongo.BSON.Binary(Buffer.alloc(15), 4)],
  ] as const)('rejects a real metadata entry with %s', async (_label, uuid) => {
    const a = realComparisonHarness({
      metadata: (name) => ({
        name,
        type: 'collection',
        options: {},
        info: { uuid },
      }),
    });
    expect(await a.run(apply)).toBe(1);
    expect(a.rawOptions).toHaveLength(0);
    expect(a.forbidden).not.toHaveBeenCalled();
    expect(a.closeCollectionCursor).toHaveBeenCalled();
    expect(jsonEvent(a.h, 'result')).toMatchObject({ writesAttempted: false });
  });

  it.each([
    ['view', 'view', {}],
    ['time series', 'timeseries', {}],
    [
      'non-simple default collation',
      'collection',
      { collation: { locale: 'en' } },
    ],
  ] as const)(
    'rejects %s before index planning',
    async (_label, type, options) => {
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type,
          options,
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
      });
      expect(await a.run(apply)).toBe(1);
      expect(a.rawOptions).toHaveLength(0);
      expect(a.forbidden).not.toHaveBeenCalled();
    },
  );

  it.each(['initial plan', 'write recheck'] as const)(
    'refuses encrypted collection metadata at %s',
    async (phase) => {
      let taskReads = 0;
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options:
            name === 'tasks' &&
            ++taskReads >= (phase === 'initial plan' ? 1 : 2)
              ? {
                  encryptedFields: {
                    escCollection: 'private_encryption_fixture',
                  },
                }
              : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'ENCRYPTED_COLLECTION_UNSUPPORTED' },
        writesAttempted: false,
      });
      expect(output(a.h)).not.toContain('private_encryption_fixture');
    },
  );

  it.each(
    [false, true].flatMap((withTtl) =>
      [['--dry-run'], [...apply, '--allow-drop']].map((args) => ({
        withTtl,
        args,
      })),
    ),
  )(
    'rejects clustered metadata before planning with TTL=$withTtl and $args',
    async ({ withTtl, args }) => {
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options:
            name === 'sessions'
              ? {
                  ...clusteredOptions,
                  ...(withTtl && { expireAfterSeconds: 300 }),
                }
              : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
        dropFixtures: new Map([
          ['User', { name: 'earlier_extra', key: { legacy: 1 } }],
        ]),
      });
      expect(await a.run(args)).toBe(1);
      expect(a.dropped).toEqual([]);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(a.closeCollectionCursor).toHaveBeenCalled();
      expect(output(a.h)).not.toContain('"event":"plan"');
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'CLUSTERED_COLLECTION_UNSUPPORTED' },
        writesAttempted: false,
      });
    },
  );

  it('rejects a capped collection with matching indexes in apply', async () => {
    const a = realComparisonHarness({
      indexes: matchingSessionIndexes,
      metadata: (name) => ({
        name,
        type: 'collection',
        options: name === 'sessions' ? cappedOptions : {},
        info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
      }),
    });
    expect(await a.run(apply)).toBe(1);
    expect(jsonEvent(a.h, 'result')).toMatchObject({
      status: 'failed',
      error: { code: 'CAPPED_COLLECTION_UNSUPPORTED' },
      writesAttempted: false,
    });
    expect(a.dropped).toEqual([]);
    expect(a.forbidden).not.toHaveBeenCalled();
    expectComparisonResourcesClosed(a);
  });

  it.each(
    [['--dry-run'], [...apply, '--allow-drop']].map((args) => ({ args })),
  )(
    'rejects capped metadata before any DDL with $args even when an earlier model has a plan',
    async ({ args }) => {
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options: name === 'sessions' ? cappedOptions : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
        dropFixtures: new Map([
          ['User', { name: 'earlier_extra', key: { legacy: 1 } }],
        ]),
      });
      expect(await a.run(args)).toBe(1);
      const result = jsonEvent(a.h, 'result');
      expect(result).toMatchObject({
        status: 'failed',
        error: { code: 'CAPPED_COLLECTION_UNSUPPORTED' },
        writesAttempted: false,
      });
      expect(result).toHaveProperty(
        'models.0',
        expect.objectContaining({
          model: 'User',
          operations: [
            {
              kind: 'dropIndex',
              name: 'earlier_extra',
              status: 'not-executed',
            },
          ],
        }),
      );
      expect(output(a.h)).not.toContain('"event":"plan"');
      expect(a.dropped).toEqual([]);
      expect(a.forbidden).not.toHaveBeenCalled();
      expectComparisonResourcesClosed(a);
    },
  );

  it.each([{}, { capped: false }])(
    'accepts collection options %j without changing the matching index plan',
    async (options) => {
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options: name === 'sessions' ? options : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
      });
      expect(await a.run(apply)).toBe(0);
      expectEmptyComparison(a, 'completed');
      expect(jsonEvent(a.h, 'result')).toHaveProperty(
        'models.1.verification.status',
        'passed',
      );
      expect(a.dropped).toEqual([]);
      expectComparisonResourcesClosed(a);
    },
  );

  it.each(unsupportedCollectionOptions)(
    'keeps earlier DDL but stops current and later writes when the recheck finds %s metadata',
    async (_label, options, code) => {
      let sessionReads = 0;
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options: name === 'sessions' && ++sessionReads >= 2 ? options : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
        dropFixtures: new Map([
          ['User', { name: 'earlier_extra', key: { legacy: 1 } }],
          ['Session', { name: 'current_extra', key: { legacy: 1 } }],
          ['PasswordResetToken', { name: 'later_extra', key: { legacy: 1 } }],
        ]),
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.dropped).toEqual([{ model: 'User', index: 'earlier_extra' }]);
      expect(a.forbidden).not.toHaveBeenCalled();
      const models: unknown = expect.arrayContaining([
        expect.objectContaining({
          model: 'User',
          operations: [
            { kind: 'dropIndex', name: 'earlier_extra', status: 'completed' },
          ],
        }),
        expect.objectContaining({
          model: 'Session',
          operations: [
            {
              kind: 'dropIndex',
              name: 'current_extra',
              status: 'not-executed',
            },
          ],
        }),
        expect.objectContaining({
          model: 'PasswordResetToken',
          operations: [
            { kind: 'dropIndex', name: 'later_extra', status: 'not-executed' },
          ],
        }),
      ]);
      expect(jsonEvent(a.h, 'result')).toHaveProperty('models', models);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code },
        writesAttempted: true,
      });
      expectComparisonResourcesClosed(a);
    },
  );

  it.each(unsupportedCollectionOptions)(
    'marks final readback unconfirmed if the collection becomes %s',
    async (_label, options, code) => {
      let sessionReads = 0;
      const a = realComparisonHarness({
        metadata: (name) => ({
          name,
          type: 'collection',
          options: name === 'sessions' && ++sessionReads === 3 ? options : {},
          info: { uuid: new mongoose.mongo.BSON.UUID(initialUuid) },
        }),
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.forbidden).not.toHaveBeenCalled();
      const models: unknown = expect.arrayContaining([
        expect.objectContaining({
          model: 'Session',
          terminalState: 'unconfirmed',
          verification: {
            status: 'unconfirmed',
            error: { code },
          },
        }),
      ]);
      expect(jsonEvent(a.h, 'result')).toHaveProperty('models', models);
      expect(jsonEvent(a.h, 'result')).toMatchObject({ status: 'failed' });
      expect(a.dropped).toEqual([]);
      expectComparisonResourcesClosed(a);
    },
  );

  it.each([
    { collation: { locale: 'en', strength: 2 }, args: ['--dry-run'] },
    {
      collation: { locale: 'en', strength: 2 },
      args: [...apply, '--allow-drop'],
    },
    { collation: null, args: apply },
    { collation: { locale: 'simple', strength: 2 }, args: apply },
  ])(
    'rejects Schema-level collation $collation before registering any model',
    async ({ collation, args }) => {
      const a = realComparisonHarness({
        schemas: withSessionSchemaCollation(collation),
      });
      expect(await a.run(args)).toBe(1);
      expect(a.registrations).toEqual([]);
      expect(a.metadata).not.toHaveBeenCalled();
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(output(a.h)).not.toContain('"event":"plan"');
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'SCHEMA_COLLATION_UNSUPPORTED' },
        writesAttempted: false,
      });
    },
  );

  it.each([undefined, { locale: 'simple' }])(
    'accepts Schema-level collation %j',
    async (collation) => {
      const a = realComparisonHarness({
        schemas: withSessionSchemaCollation(collation),
      });
      expect(await a.run(apply)).toBe(0);
      expectEmptyComparison(a, 'completed');
    },
  );

  it.each([
    [
      'in-progress build',
      { spec: idIndex, buildUUID: new mongoose.mongo.BSON.UUID(initialUuid) },
      'INDEX_BUILD_IN_PROGRESS',
    ],
    [
      'hidden index',
      { ...sessionUserIndex, name: 'hidden_extra', hidden: true },
      'HIDDEN_INDEX_UNSUPPORTED',
    ],
    [
      'prepared unique index',
      { ...sessionUserIndex, name: 'prepare_extra', prepareUnique: true },
      'PREPARE_UNIQUE_UNSUPPORTED',
    ],
    [
      'text index',
      {
        name: 'field_text',
        key: { _fts: 'text', _ftsx: 1 },
        weights: { field: 1 },
      },
      'TEXT_INDEX_UNSUPPORTED',
    ],
    [
      'unsupported direction',
      {
        name: 'decimal_extra',
        key: { userId: mongoose.mongo.BSON.Decimal128.fromString('1') },
      },
      'INDEX_KEY_DIRECTION_UNSUPPORTED',
    ],
    [
      'unreliable compound order',
      { name: 'numeric_field_extra', key: { other: 1, 123: 1 } },
      'INDEX_KEY_ORDER_UNSUPPORTED',
    ],
  ] as const)(
    'rejects %s in the raw metadata path',
    async (_label, index, code) => {
      const a = realComparisonHarness({
        indexes: [...matchingSessionIndexes, index],
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code },
        writesAttempted: false,
      });
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(a.indexClosures[0]).toHaveBeenCalled();
    },
  );

  it.each([
    [{ name: 'explicit_user_idx' }, 'SCHEMA_INDEX_NAME_UNSUPPORTED'],
    [{ collation: { locale: 'en' } }, 'SCHEMA_INDEX_COLLATION_UNSUPPORTED'],
  ] as const)(
    'refuses unsupported Schema index options %j before DDL',
    async (options, code) => {
      const a = realComparisonHarness({
        configureSchema: (schema) => {
          Object.assign(sessionUserDeclaration(schema)[1], options);
        },
      });
      expect(await a.run(apply)).toBe(1);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code },
        writesAttempted: false,
      });
    },
  );

  it('can still plan replacement of an actual non-simple index on a simple collection', async () => {
    const actual = { ...sessionUserIndex, collation: { locale: 'en' } };
    const a = realComparisonHarness({
      indexes: [...matchingSessionIndexes.slice(0, -1), actual],
    });
    expect(await a.run(['--dry-run'])).toBe(0);
    const plan: unknown = expect.arrayContaining([
      expect.objectContaining({
        model: 'Session',
        toDrop: [actual],
        toCreate: [{ key: { userId: 1 }, options: {} }],
      }),
    ]);
    expect(jsonEvent(a.h, 'plan')).toHaveProperty('models', plan);
    expect(a.forbidden).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', 'HIDDEN_INDEX_UNSUPPORTED'],
    ['prepareUnique', 'PREPARE_UNIQUE_UNSUPPORTED'],
  ] as const)(
    'rejects an isolated Schema declaring %s',
    async (option, code) => {
      const a = realComparisonHarness({
        configureSchema: (schema) => {
          sessionUserDeclaration(schema)[1][option] = true;
        },
      });
      expect(await a.run(apply)).toBe(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({ error: { code } });
      expect(a.forbidden).not.toHaveBeenCalled();
    },
  );

  it('pins BSON numeric and UUID decoding in real driver cursors despite URI options', async () => {
    const indexes = [
      ...matchingSessionIndexes.slice(0, -1),
      {
        ...sessionUserIndex,
        key: { userId: mongoose.mongo.BSON.Long.fromNumber(1) },
      },
    ];
    const a = realComparisonHarness({
      indexes,
      suffix:
        '?promoteValues=false&promoteLongs=false&raw=true&promoteBuffers=true',
    });
    expect(await a.run([...apply, '--allow-drop'])).toBe(0);
    expectEmptyComparison(a, 'completed');
    expect(a.clientOptions()).toMatchObject({
      promoteValues: true,
      promoteLongs: true,
      useBigInt64: false,
      raw: false,
      promoteBuffers: false,
    });
    expect(a.rawOptions[0]).toMatchObject({
      promoteValues: true,
      promoteLongs: true,
      useBigInt64: false,
      promoteBuffers: false,
      timeoutMode: 'cursorLifetime',
    });
    expect(a.collectionOptions[0]).toMatchObject({ promoteBuffers: false });
    expect(a.rawReads[0]).toEqual(matchingSessionIndexes);
    expect(jsonEvent(a.h, 'result')).toHaveProperty(
      'models',
      expect.arrayContaining([
        expect.objectContaining({
          model: 'Session',
          verification: { status: 'passed' },
        }),
      ]),
    );
  });

  it.each([
    [false, undefined],
    [undefined, false],
    [false, false],
  ])(
    'treats sparse=%j and Schema sparse=%j as equal',
    async (dbSparse, schemaSparse) => {
      const original =
        dbSparse === undefined
          ? sessionUserIndex
          : { ...sessionUserIndex, sparse: dbSparse };
      const a = realComparisonHarness({
        indexes: [...matchingSessionIndexes.slice(0, -1), original],
        configureSchema: (schema) => {
          if (schemaSparse !== undefined)
            sessionUserDeclaration(schema)[1].sparse = schemaSparse;
        },
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(0);
      expectEmptyComparison(a, 'completed');
      expect(a.rawReads[0]).toContainEqual(original);
      expect(a.rawReads.at(-1)).toContainEqual(original);
    },
  );

  it('keeps real sparse differences', async () => {
    const extra = { ...sessionUserIndex, sparse: true };
    const a = realComparisonHarness({
      indexes: [...matchingSessionIndexes.slice(0, -1), extra],
    });
    expect(await a.run(['--dry-run'])).toBe(0);
    expect(jsonEvent(a.h, 'plan')).toHaveProperty(
      'models',
      expect.arrayContaining([
        expect.objectContaining({ model: 'Session', toDrop: [extra] }),
      ]),
    );
    expect(a.forbidden).not.toHaveBeenCalled();
  });

  it('rejects a generated create name already held by a retained index before any DDL', async () => {
    const a = realComparisonHarness({
      indexes: [
        idIndex,
        { name: 'expiresAt_1', key: { token: 1 }, unique: true },
        sessionUserIndex,
        { name: 'legacy_1', key: { legacy: 1 } },
      ],
    });
    expect(await a.run([...apply, '--allow-drop'])).toBe(1);
    expect(a.forbidden).not.toHaveBeenCalled();
    expect(jsonEvent(a.h, 'result')).toMatchObject({
      error: { code: 'INDEX_NAME_CONFLICT' },
      writesAttempted: false,
    });
  });

  it.each([
    ['preview', ['--dry-run'], 0],
    ['apply', [...apply, '--allow-drop'], 1],
  ] as const)(
    'reports custom-named hashed _id during %s without planning a deletion',
    async (mode, args, exit) => {
      const hashed = { name: 'private_id_hash', key: { _id: 'hashed' } };
      const a = realComparisonHarness({
        indexes: [...matchingSessionIndexes, hashed],
      });
      expect(await a.run(args)).toBe(exit);
      const manualReview: unknown = expect.arrayContaining([
        expect.objectContaining(hashed),
      ]);
      expect(jsonEvent(a.h, 'plan')).toHaveProperty(
        'models',
        expect.arrayContaining([
          expect.objectContaining({
            model: 'Session',
            toDrop: [],
            toCreate: [],
            manualReview,
          }),
        ]),
      );
      expect(a.forbidden).not.toHaveBeenCalled();
      if (mode === 'preview') return;
      const differences: unknown = expect.objectContaining({
        extraIndexes: [hashed],
      });
      const verification: unknown = expect.objectContaining({
        status: 'different',
        differences,
      });
      expect(jsonEvent(a.h, 'result')).toHaveProperty(
        'models',
        expect.arrayContaining([
          expect.objectContaining({
            model: 'Session',
            verification,
          }),
        ]),
      );
    },
  );

  it('emits the exact BSON Long in both the drop plan and final observed metadata', async () => {
    const { BSON } = mongoose.mongo;
    const threshold = BSON.Long.fromString('9007199254740993');
    const extra = {
      name: 'review_cutoff',
      key: { cutoff: 1 },
      evidence: threshold,
    };
    const a = realComparisonHarness({
      indexes: [...matchingSessionIndexes, extra],
    });
    expect(await a.run(apply)).toBe(1);
    expect(a.forbidden).not.toHaveBeenCalled();
    expect(threshold.toString()).toBe('9007199254740993');
    for (const event of ['plan', 'result']) {
      expect(output(a.h)).toContain('"$numberLong":"9007199254740993"');
      const parsed = jsonEvent(a.h, event, false);
      const indexes: unknown = expect.arrayContaining([
        expect.objectContaining({
          evidence: threshold,
        }),
      ]);
      const match: unknown = expect.arrayContaining([
        expect.objectContaining({
          model: 'Session',
          [event === 'plan' ? 'toDrop' : 'finalIndexes']: indexes,
        }),
      ]);
      expect(parsed).toHaveProperty('models', match);
    }
  });
});

const comparisonModes = [
  { args: ['--dry-run'], status: 'preview' },
  { args: [...apply, '--allow-drop'], status: 'completed' },
];

type SubmissionIndexField = 'taskId' | 'classroomTaskId';

const nullFilter = { classroomTaskId: null };
const explicitNullFilter = { classroomTaskId: { $eq: null } };
const objectIdFilter = { classroomTaskId: { $type: 'objectId' } };
const numericObjectIdFilter = { classroomTaskId: { $type: 7 } };

function isSubmissionAttemptIndex(
  key: Record<string, unknown>,
  field: SubmissionIndexField,
) {
  return Object.hasOwn(key, field) && key.attemptNo === 1;
}

function submissionIndexFixture(
  field: SubmissionIndexField,
  filter: mongo.Document,
) {
  const indexes = comparisonIndexesFor(SubmissionSchema);
  const index = indexes.find(({ key }) => isSubmissionAttemptIndex(key, field));
  if (!index) throw new Error('EXPECTED_SUBMISSION_ATTEMPT_INDEX');
  index.partialFilterExpression = filter;
  return { indexes, index };
}

describe('sync-indexes Submission partial filter comparison (offline)', () => {
  const equivalents = [
    {
      label: 'null equality',
      field: 'taskId',
      canonical: nullFilter,
      alternate: explicitNullFilter,
    },
    {
      label: 'ObjectId type',
      field: 'classroomTaskId',
      canonical: objectIdFilter,
      alternate: numericObjectIdFilter,
    },
  ] as const;

  it.each(
    equivalents.flatMap(({ label, field, canonical, alternate }) =>
      [
        { side: 'database', dbFilter: alternate, schemaFilter: canonical },
        { side: 'Schema', dbFilter: canonical, schemaFilter: alternate },
      ].flatMap((variant) =>
        comparisonModes.map((mode) => ({ label, field, ...variant, ...mode })),
      ),
    ),
  )(
    'treats $label as equivalent with the alternate form in $side during $status',
    async ({ field, dbFilter, schemaFilter, args, status }) => {
      const sharedDeclarations = structuredClone(SubmissionSchema.indexes());
      const { indexes, index } = submissionIndexFixture(field, dbFilter);
      const original = structuredClone(indexes);
      const originalSchemaFilter = structuredClone(schemaFilter);
      let declaration: SyncIndexDefinition | undefined;
      const a = realComparisonHarness({
        modelName: 'Submission',
        indexes,
        configureSchema: (schema) => {
          declaration = schema
            .indexes()
            .find(([key]) => isSubmissionAttemptIndex(key, field));
          if (!declaration) throw new Error('EXPECTED_SUBMISSION_DECLARATION');
          declaration[1].partialFilterExpression = schemaFilter;
        },
      });

      expect(await a.run(args)).toBe(0);
      expectEmptyComparison(a, status);
      expect(indexes).toEqual(original);
      expect(SubmissionSchema.indexes()).toEqual(sharedDeclarations);
      expect(declaration?.[1].partialFilterExpression).toBe(schemaFilter);
      expect(declaration?.[1].partialFilterExpression).toEqual(
        originalSchemaFilter,
      );
      for (const snapshot of a.rawReads) expect(snapshot).toEqual(original);
      if (status === 'completed') {
        const finalIndexes: unknown = expect.arrayContaining([index]);
        expect(jsonEvent(a.h, 'result')).toHaveProperty(
          'models',
          expect.arrayContaining([
            expect.objectContaining({
              model: 'Submission',
              verification: { status: 'passed' },
              finalIndexes,
            }),
          ]),
        );
      }
    },
  );

  it.each([
    {
      label: 'an additional top-level predicate',
      field: 'taskId',
      filter: { ...explicitNullFilter, attemptNo: { $gt: 1 } },
    },
    {
      label: 'an additional nested operator',
      field: 'taskId',
      filter: { classroomTaskId: { $eq: null, $exists: true } },
    },
    {
      label: 'a different BSON type',
      field: 'classroomTaskId',
      filter: { classroomTaskId: { $type: 'string' } },
    },
  ] as const)(
    'rejects an index filter with $label before it can enter the plan',
    async ({ field, filter }) => {
      const { indexes } = submissionIndexFixture(field, filter);
      const a = realComparisonHarness({ modelName: 'Submission', indexes });

      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'PARTIAL_FILTER_UNSUPPORTED' },
        writesAttempted: false,
      });
      expect(output(a.h)).not.toContain('"event":"plan"');
      expect(a.forbidden).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['null', null],
    ['array', [null]],
    ['additional operator', { classroomTaskId: { $eq: null, $exists: true } }],
  ] as const)(
    'applies the same partial filter guard to a Schema %s',
    async (_kind, partialFilterExpression) => {
      const a = realComparisonHarness({
        configureSchema: (schema) => {
          Reflect.set(
            sessionUserDeclaration(schema)[1],
            'partialFilterExpression',
            partialFilterExpression,
          );
        },
      });
      expect(await a.run(apply)).toBe(1);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'PARTIAL_FILTER_UNSUPPORTED' },
        writesAttempted: false,
      });
      expect(output(a.h)).not.toContain('"event":"plan"');
    },
  );

  it('refuses both sides of real BSON snapshot collisions, including serializer markers', async () => {
    const { BSON } = mongoose.mongo;
    const filters = [
      { audit: { $eq: 1 } },
      { audit: { $eq: { $numberInt: '1' } } },
      {
        audit: {
          $eq: new Map([
            ['normal', 1],
            ['123', 2],
          ]),
        },
      },
      {
        audit: {
          $eq: new Map([
            ['123', 2],
            ['normal', 1],
          ]),
        },
      },
      { audit: { $eq: new Map([['_bsontype', 'private_serializer_marker']]) } },
    ];
    const buffers = filters.map((filter) => BSON.serialize(filter));
    const decoded = buffers.map((buffer) => BSON.deserialize(buffer));
    expect(buffers[0]).not.toEqual(buffers[1]);
    expect(buffers[2]).not.toEqual(buffers[3]);
    expect(BSON.EJSON.stringify(decoded[0], { relaxed: false })).toBe(
      BSON.EJSON.stringify(decoded[1], { relaxed: false }),
    );
    expect(decoded[2]).toEqual(decoded[3]);
    expect(() =>
      BSON.EJSON.stringify(decoded[4], { relaxed: false }),
    ).toThrow();

    for (const partialFilterExpression of filters) {
      const name = 'extra_partial_fixture';
      const a = realComparisonHarness({
        indexes: [
          ...matchingSessionIndexes,
          { name, key: { audit: 1 }, partialFilterExpression },
        ],
      });
      expect(await a.run([...apply, '--allow-drop'])).toBe(1);
      expect(a.forbidden).not.toHaveBeenCalled();
      expect(jsonEvent(a.h, 'result')).toMatchObject({
        error: { code: 'PARTIAL_FILTER_UNSUPPORTED', indexName: name },
        writesAttempted: false,
      });
      expect(output(a.h)).not.toContain('"event":"plan"');
      expect(output(a.h)).not.toContain('"partialFilterExpression"');
      expect(output(a.h)).not.toContain('private_serializer_marker');
    }
  });

  it('keeps unsupported partial filters out of the report during final readback', async () => {
    const h = harness();
    const read = h.models[0].listIndexes.getMockImplementation();
    if (!read) throw new Error('EXPECTED_READ_FIXTURE');
    h.models[0].listIndexes.mockImplementation(() =>
      h.models[0].createIndexes.mock.calls.length
        ? Promise.resolve([
            idIndex,
            installedTtl,
            {
              name: 'unsafe_readback',
              key: { other: 1 },
              partialFilterExpression: { other: 'private_unsupported_filter' },
            },
          ])
        : read(),
    );
    expect(await h.run(apply)).toBe(1);
    expect(jsonEvent(h, 'result')).toMatchObject({
      models: [
        {
          operations: [{ status: 'completed' }],
          verification: {
            status: 'unconfirmed',
            error: {
              code: 'PARTIAL_FILTER_UNSUPPORTED',
              indexName: 'unsafe_readback',
            },
          },
        },
      ],
    });
    expect(output(h)).not.toContain('private_unsupported_filter');
    expect(output(h)).not.toContain('"finalIndexes"');
  });

  it('rejects raw filter drift even when the two filters compare as equivalent', async () => {
    const original = submissionIndexFixture('taskId', explicitNullFilter);
    const rechecked = submissionIndexFixture('taskId', nullFilter);
    const a = realComparisonHarness({
      modelName: 'Submission',
      indexes: original.indexes,
      recheckedIndexes: rechecked.indexes,
    });

    expect(await a.run([...apply, '--allow-drop'])).toBe(1);
    expect(jsonEvent(a.h, 'plan')).toHaveProperty(
      'models',
      expect.arrayContaining([
        expect.objectContaining({
          model: 'Submission',
          toDrop: [],
          toCreate: [],
        }),
      ]),
    );
    expect(jsonEvent(a.h, 'result')).toMatchObject({
      status: 'failed',
      writesAttempted: false,
      error: { code: 'INDEX_PLAN_DRIFT' },
    });
    expect(a.rawReads[0]).toEqual(original.indexes);
    expect(a.rawReads.at(-1)).toEqual(rechecked.indexes);
    expect(a.forbidden).not.toHaveBeenCalled();
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
const isEnvFile = path => /(^|[\\/])\.env(?:\.|$)/.test(String(path));
const readSync = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (isEnvFile(path)) return denied();
  return readSync.call(this, path, ...args);
};
const read = fsPromises.readFile;
fsPromises.readFile = function(path, ...args) {
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

function isolatedMain(args: string[]) {
  return isolated(
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
    expect(result.stdout).not.toContain('--retire-task-stage');
    expect(result.stderr).toBe('');
  });

  it.each<[string[]]>([
    [['--unrecognized']],
    [['--retire-task-stage', '--help']],
  ])(
    'exits nonzero on unknown arguments %j before configuration or network',
    (args) => {
      const result = isolatedMain(args);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('CLI_ARGUMENT_INVALID');
      expect(result.stderr).not.toContain('UNEXPECTED_ENV_NETWORK_OR_APP');
    },
  );
});
