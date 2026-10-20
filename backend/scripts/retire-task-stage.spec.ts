import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mongo } from 'mongoose';
import {
  parseStageArguments,
  planStageIndexes,
  retireTaskStage,
  runRetireTaskStageCli,
  STAGE_INDEX_PAIRS,
  STAGE_TARGETS,
  writeStageBackup,
} from './retire-task-stage';

const { EJSON, ObjectId, Decimal128, Long } = mongo.BSON;
const nameFor = (key: Record<string, number>) =>
  Object.entries(key)
    .map(([key, value]) => `${key}_${value}`)
    .join('_');
const normalIndexes = (): mongo.IndexDescriptionInfo[] => [
  { v: 2, name: '_id_', key: { _id: 1 } },
  { v: 2, name: 'stage-report-unrelated', key: { title: 1 } },
];
const oldIndexes = (): mongo.IndexDescriptionInfo[] => [
  ...normalIndexes(),
  ...STAGE_INDEX_PAIRS.map((pair, index) => ({
    v: 2,
    name: `actual-legacy-${index}`,
    key: pair.old,
  })),
];
const nextIndexes = (): mongo.IndexDescriptionInfo[] => [
  ...normalIndexes(),
  ...STAGE_INDEX_PAIRS.map((pair) => ({
    v: 2,
    name: nameFor(pair.next),
    key: pair.next,
  })),
];
const options = {
  database: 'eduforge_test' as const,
  apply: true,
  backupRun: 'pure-test-run',
};

function harness(
  settings: {
    databaseName?: string;
    declared?: string;
    databaseExists?: boolean;
    tasks?: mongo.Document[] | null;
    snapshots?: mongo.Document[] | null;
    indexes?: mongo.IndexDescriptionInfo[];
    roles?: Array<{ db: string; role: string }>;
  } = {},
) {
  const events: string[] = [];
  const rows: Record<string, mongo.Document[] | null> = {
    tasks:
      settings.tasks === undefined
        ? [
            {
              _id: new ObjectId(),
              stage: 4,
              title: 'untouched',
              updatedAt: new Date(0),
            },
          ]
        : settings.tasks,
    classroomtasks:
      settings.snapshots === undefined
        ? [
            {
              _id: new ObjectId(),
              taskSnapshot: { title: 'frozen', stage: 2 },
              updatedAt: new Date(0),
            },
          ]
        : settings.snapshots,
  };
  let indexes = settings.indexes ?? oldIndexes();
  const clone = (value: mongo.Document) =>
    EJSON.parse(EJSON.stringify(value), { relaxed: false }) as mongo.Document;
  const matches = (row: mongo.Document, name: string) =>
    name === 'tasks'
      ? Object.hasOwn(row, 'stage')
      : !!row.taskSnapshot &&
        Object.hasOwn(row.taskSnapshot as object, 'stage');
  const collections = Object.fromEntries(
    Object.keys(rows).map((name) => [
      name,
      {
        find: jest.fn(
          (
            filter: mongo.Document,
            query: { projection: Record<string, number> },
          ) => {
            const found = (rows[name] ?? [])
              .filter(
                (row) => !Object.keys(filter).length || matches(row, name),
              )
              .map((row) => {
                const copy = clone(row);
                if (query.projection._id === 1)
                  return name === 'tasks'
                    ? { _id: copy._id as unknown, stage: copy.stage as unknown }
                    : {
                        _id: copy._id as unknown,
                        taskSnapshot: {
                          stage: (copy.taskSnapshot as mongo.Document)
                            .stage as unknown,
                        },
                      };
                if (name === 'tasks') delete copy.stage;
                else if (copy.taskSnapshot)
                  delete (copy.taskSnapshot as mongo.Document).stage;
                return copy;
              });
            return {
              toArray: jest.fn().mockResolvedValue(found),
              close: jest.fn().mockResolvedValue(undefined),
              async *[Symbol.asyncIterator]() {
                for (const row of found) yield await Promise.resolve(row);
              },
            };
          },
        ),
        countDocuments: jest.fn((filter: mongo.Document) =>
          Promise.resolve(
            (rows[name] ?? []).filter(
              (row) => !Object.keys(filter).length || matches(row, name),
            ).length,
          ),
        ),
        listIndexes: jest.fn(() => ({
          toArray: jest
            .fn()
            .mockImplementation(() => Promise.resolve([...indexes])),
        })),
        createIndex: jest.fn(
          (key: Record<string, number>, config: { name: string }) => {
            events.push('create');
            indexes.push({ v: 2, key, name: config.name });
            return Promise.resolve(config.name);
          },
        ),
        updateMany: jest.fn(
          (filter: mongo.Document, update: { $unset: mongo.Document }) => {
            events.push('unset:' + name);
            const affected = (rows[name] ?? []).filter((row) =>
              matches(row, name),
            );
            for (const row of affected) {
              if (Object.hasOwn(update.$unset, 'stage')) delete row.stage;
              if (Object.hasOwn(update.$unset, 'taskSnapshot.stage'))
                delete (row.taskSnapshot as mongo.Document).stage;
            }
            return Promise.resolve({
              matchedCount: affected.length,
              modifiedCount: affected.length,
            });
          },
        ),
        dropIndex: jest.fn((name: string) => {
          events.push('drop');
          indexes = indexes.filter((index) => index.name !== name);
          return Promise.resolve({});
        }),
      },
    ]),
  );
  const databaseName = settings.databaseName ?? 'eduforge_test';
  const db = {
    databaseName,
    command: jest.fn((command: mongo.Document) =>
      Promise.resolve(
        command.dbStats
          ? { db: databaseName }
          : {
              authInfo: {
                authenticatedUsers: [{ user: 'operations' }],
                authenticatedUserRoles: settings.roles ?? [
                  { db: databaseName, role: 'dbOwner' },
                ],
              },
            },
      ),
    ),
    admin: () => ({
      listDatabases: jest.fn().mockResolvedValue({
        databases:
          settings.databaseExists === false ? [] : [{ name: databaseName }],
      }),
    }),
    listCollections: () => ({
      toArray: jest.fn().mockResolvedValue(
        Object.keys(rows)
          .filter((name) => rows[name] !== null)
          .map((name) => ({ name })),
      ),
    }),
    collection: jest.fn((name: string) => {
      if (!rows[name]) throw new Error('No implicit collection creation');
      return collections[name];
    }),
  };
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    db: () => db,
    options: {
      hosts: [{ host: '127.0.0.1' }],
      credentials: { username: 'operations' },
    },
  };
  const backup = jest
    .fn<Promise<void>, [string, mongo.Document]>()
    .mockImplementation(() => {
      events.push('backup');
      return Promise.resolve();
    });
  const createClient = jest.fn(() => client as unknown as mongo.MongoClient);
  const io = {
    backendDirectory: '/project/backend',
    readConfig: jest
      .fn()
      .mockResolvedValue(
        `MONGO_ADMIN_URI=mongodb://127.0.0.1/${settings.declared ?? 'eduforge_test'}`,
      ),
    client: createClient,
    backup,
  };
  return { io, client, db, collections, backup, rows, events };
}

afterEach(() => jest.restoreAllMocks());

describe('Task.stage targeted operations (pure, no database)', () => {
  it('maps exactly four explicit targets to exactly one file and management URI', () => {
    expect(STAGE_TARGETS).toEqual({
      eduforge_browser_test: [
        '.env.browser-acceptance',
        'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
      ],
      eduforge_test: ['.env.test', 'MONGO_ADMIN_URI'],
      eduforge_dev: ['.env.development', 'MONGO_ADMIN_URI'],
      eduforge: ['.env.production', 'MONGO_ADMIN_URI'],
    });
    for (const database of Object.keys(STAGE_TARGETS))
      expect(
        parseStageArguments(['--retire-task-stage', '--database', database]),
      ).toEqual({ database, apply: false, backupRun: undefined });
  });
  it.each([
    ['--retire-task-stage'],
    ['--retire-task-stage', '--database', 'other'],
    ['--retire-task-stage', '--database', 'eduforge_test', '--apply'],
    [
      '--retire-task-stage',
      '--database',
      'eduforge_test',
      '--apply',
      '--confirm-db',
      'eduforge_dev',
    ],
    [
      '--retire-task-stage',
      '--database',
      'eduforge_test',
      '--apply',
      '--dry-run',
      '--confirm-db',
      'eduforge_test',
    ],
    ['--retire-task-stage', '--database', 'eduforge_test', '--unknown'],
    [
      '--retire-task-stage',
      '--database',
      'eduforge_test',
      '--backup-run',
      '../escape',
    ],
  ])('rejects unsafe invocation %#', (...args: string[]) => {
    expect(() => parseStageArguments(args)).toThrow();
  });
  it('accepts apply only with an exact confirmation', () => {
    expect(
      parseStageArguments([
        '--retire-task-stage',
        '--database',
        'eduforge_test',
        '--apply',
        '--confirm-db',
        'eduforge_test',
      ]),
    ).toMatchObject({ database: 'eduforge_test', apply: true });
  });
  it('help does not read configuration or load a business application', async () => {
    const read = jest
      .spyOn(fs, 'readFile')
      .mockRejectedValue(new Error('must not read configuration'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await runRetireTaskStageCli(['--retire-task-stage', '--help']);
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects a declared database mismatch before constructing a client', async () => {
    const h = harness({ declared: 'eduforge_dev' });
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'DECLARED_DATABASE_MISMATCH',
    );
    expect(h.io.client).not.toHaveBeenCalled();
  });
  it('rejects an actual database mismatch without writes and closes the connection', async () => {
    const h = harness({ databaseName: 'eduforge_dev' });
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'CONNECTED_DATABASE_MISMATCH',
    );
    expect(h.events).toEqual([]);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('dry-run inventories fields and actual ordered indexes without writing', async () => {
    const h = harness();
    const result = await retireTaskStage({ ...options, apply: false }, h.io);
    expect(result).toMatchObject({
      status: 'inventoried',
      pending: 8,
      collections: {
        tasks: { total: 1, stage: 1 },
        classroomtasks: { total: 1, stage: 1 },
      },
    });
    expect(h.events).toEqual([]);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('recognizes the production management account with both global data and index roles', async () => {
    const h = harness({
      databaseName: 'eduforge',
      declared: 'eduforge',
      roles: [
        { db: 'admin', role: 'dbAdminAnyDatabase' },
        { db: 'admin', role: 'readWriteAnyDatabase' },
      ],
    });
    expect(
      await retireTaskStage({ database: 'eduforge', apply: false }, h.io),
    ).toMatchObject({
      databaseName: 'eduforge',
      accountVerified: true,
      status: 'inventoried',
    });
    expect(h.events).toEqual([]);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it.each(['dbAdminAnyDatabase', 'readWriteAnyDatabase'])(
    'rejects an incomplete production management role combination: %s',
    async (role) => {
      const h = harness({
        databaseName: 'eduforge',
        declared: 'eduforge',
        roles: [{ db: 'admin', role }],
      });
      await expect(
        retireTaskStage({ database: 'eduforge', apply: false }, h.io),
      ).rejects.toThrow('OPERATIONS_ROLE_MISMATCH');
      expect(h.events).toEqual([]);
      expect(h.client.close).toHaveBeenCalledTimes(1);
    },
  );
  it('backs up before writes, confirms all replacements, unsets only the two fields, and drops actual names last', async () => {
    const h = harness();
    const result = await retireTaskStage(options, h.io);
    expect(result).toMatchObject({
      status: 'completed',
      pending: 0,
      changes: {
        tasksMatched: 1,
        tasksModified: 1,
        snapshotsMatched: 1,
        snapshotsModified: 1,
        indexesCreated: 3,
        indexesReused: 0,
        indexesDropped: 3,
      },
      otherIndexesUnchanged: true,
      protectedDocumentsUnchanged: true,
    });
    expect(h.events).toEqual([
      'backup',
      'create',
      'create',
      'create',
      'unset:tasks',
      'unset:classroomtasks',
      'drop',
      'drop',
      'drop',
    ]);
    expect(h.collections.tasks.updateMany).toHaveBeenCalledWith(
      { stage: { $exists: true } },
      { $unset: { stage: '' } },
      { maxTimeMS: 15000, promoteValues: true },
    );
    expect(h.collections.classroomtasks.updateMany).toHaveBeenCalledWith(
      { 'taskSnapshot.stage': { $exists: true } },
      { $unset: { 'taskSnapshot.stage': '' } },
      { maxTimeMS: 15000, promoteValues: true },
    );
    for (const collection of Object.values(h.collections))
      expect(collection.countDocuments).toHaveBeenCalledWith(
        expect.any(Object),
        { maxTimeMS: 15000, promoteValues: true },
      );
    expect(
      h.collections.tasks.dropIndex.mock.calls.map(([name]) => name),
    ).toEqual(['actual-legacy-0', 'actual-legacy-1', 'actual-legacy-2']);
    expect(h.rows.tasks?.[0]).toMatchObject({
      title: 'untouched',
      updatedAt: new Date(0),
    });
    expect(h.rows.classroomtasks?.[0].taskSnapshot).toEqual({
      title: 'frozen',
    });
    const saved = h.backup.mock.calls[0]?.[1];
    expect(saved.tasks).toHaveLength(1);
    expect(saved.classroomtasks).toHaveLength(1);
    expect((saved.tasks as mongo.Document[])[0]).not.toHaveProperty('title');
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('reuses three equivalent new indexes and preserves unrelated indexes', async () => {
    const h = harness({
      indexes: [...oldIndexes(), ...nextIndexes().slice(2)],
    });
    expect(await retireTaskStage(options, h.io)).toMatchObject({
      changes: { indexesCreated: 0, indexesReused: 3, indexesDropped: 3 },
    });
    expect(h.collections.tasks.createIndex).not.toHaveBeenCalled();
    expect(h.collections.tasks.dropIndex).not.toHaveBeenCalledWith(
      'stage-report-unrelated',
      expect.anything(),
    );
  });
  it('checks indexes even for empty collections without creating documents', async () => {
    const h = harness({ tasks: [], snapshots: [], indexes: normalIndexes() });
    expect(await retireTaskStage(options, h.io)).toMatchObject({
      status: 'completed',
      changes: { indexesCreated: 3, tasksModified: 0, snapshotsModified: 0 },
    });
    expect(h.collections.tasks.updateMany).not.toHaveBeenCalled();
    expect(h.rows.tasks).toEqual([]);
  });
  it('does not create an absent database or collections', async () => {
    for (const settings of [
      { databaseExists: false },
      { tasks: null, snapshots: null },
    ]) {
      const h = harness(settings);
      expect(await retireTaskStage(options, h.io)).toMatchObject({
        status: 'skipped',
      });
      expect(h.events).toEqual([]);
      expect(h.db.collection).not.toHaveBeenCalled();
    }
  });
  it('already-clean apply has no extra writes or backups', async () => {
    const h = harness({ tasks: [], snapshots: [], indexes: nextIndexes() });
    expect(await retireTaskStage(options, h.io)).toMatchObject({
      status: 'already-clean',
      pending: 0,
    });
    expect(h.events).toEqual([]);
  });
  it('matches ordered keys rather than names and refuses unplanned stage keys', () => {
    const plan = planStageIndexes([
      ...normalIndexes(),
      {
        v: 2,
        name: 'unexpected',
        key: { stage: 1, status: 1, knowledgeModule: 1, createdAt: -1 },
      },
    ]);
    expect(plan.problems).toContain('UNPLANNED_STAGE_INDEX:unexpected');
    expect(plan.drop).toEqual([]);
  });
  it.each([
    { unique: true },
    { sparse: true },
    { partialFilterExpression: { status: 'PUBLISHED' } },
    { expireAfterSeconds: 60 },
    { collation: { locale: 'en' } },
    { hidden: true },
  ])('blocks anomalous index options %j', (option) => {
    expect(
      planStageIndexes([{ ...oldIndexes()[2], ...option }]).problems,
    ).toContain('UNEXPECTED_INDEX_OPTIONS:actual-legacy-0');
  });
  it.each([false, true])(
    'blocks a same-name different-key replacement collision even when an equivalent index is reusable: %s',
    (reusable) => {
      const plan = planStageIndexes([
        { v: 2, name: nameFor(STAGE_INDEX_PAIRS[0].next), key: { title: 1 } },
        ...(reusable
          ? [
              {
                v: 2,
                name: 'equivalent-replacement',
                key: STAGE_INDEX_PAIRS[0].next,
              },
            ]
          : []),
      ]);
      expect(plan.problems).toContain(
        'INDEX_NAME_COLLISION:' + nameFor(STAGE_INDEX_PAIRS[0].next),
      );
    },
  );
  it('does not write when index metadata is anomalous', async () => {
    const h = harness({ indexes: [{ ...oldIndexes()[2], unique: true }] });
    expect(await retireTaskStage(options, h.io)).toMatchObject({
      status: 'blocked',
    });
    expect(h.events).toEqual([]);
  });
  it('backup failure stops every database mutation and closes the client', async () => {
    const h = harness();
    h.backup.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'disk unavailable',
    );
    expect(h.events).toEqual([]);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed snapshots without repairing them or writing', async () => {
    const h = harness();
    const malformed = { _id: new ObjectId(), taskSnapshot: [{ stage: 2 }] };
    h.collections.classroomtasks.find.mockReturnValueOnce({
      toArray: jest.fn().mockResolvedValue([malformed]),
      close: jest.fn().mockResolvedValue(undefined),
      async *[Symbol.asyncIterator]() {
        yield await Promise.resolve(malformed);
      },
    });
    const result = await retireTaskStage(options, h.io);
    expect(result.status).toBe('blocked');
    expect(
      'problems' in result &&
        result.problems?.some((problem) =>
          problem.startsWith('ABNORMAL_SNAPSHOT:'),
        ),
    ).toBe(true);
    expect(h.events).toEqual([]);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('requires backup counts to still match the database before the first database write', async () => {
    const h = harness();
    h.collections.tasks.countDocuments.mockImplementation((filter) =>
      Promise.resolve(Object.hasOwn(filter, 'stage') ? 2 : 1),
    );
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'BACKUP_DATABASE_COUNT_MISMATCH',
    );
    expect(h.events).toEqual(['backup']);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('preserves valid index version and background options for a replacement', () => {
    const plan = planStageIndexes([
      { ...oldIndexes()[2], v: 1, background: true },
    ]);
    expect(plan.problems).toEqual([]);
    expect(plan.create[0]).toMatchObject({
      key: { status: 1, knowledgeModule: 1, createdAt: -1 },
      version: 1,
      background: true,
    });
  });
  it('never unsets or drops before all new indexes are confirmed', async () => {
    const h = harness();
    h.collections.tasks.createIndex.mockResolvedValue('not-installed');
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'NEW_INDEX_READBACK_FAILED',
    );
    expect(h.collections.tasks.updateMany).not.toHaveBeenCalled();
    expect(h.collections.tasks.dropIndex).not.toHaveBeenCalled();
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('a field operation failure stops subsequent destructive steps and closes the client', async () => {
    const h = harness();
    h.collections.tasks.updateMany.mockRejectedValueOnce(
      new Error('write failed'),
    );
    await expect(retireTaskStage(options, h.io)).rejects.toThrow(
      'write failed',
    );
    expect(h.collections.classroomtasks.updateMany).not.toHaveBeenCalled();
    expect(h.collections.tasks.dropIndex).not.toHaveBeenCalled();
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('writes lossless field-only EJSON and verifies durable readback before returning', async () => {
    const backup = {
      tasks: [{ _id: new ObjectId(), stage: Decimal128.fromString('1.25') }],
      classroomtasks: [
        {
          _id: new ObjectId(),
          taskSnapshot: { stage: Long.fromString('9007199254740993') },
        },
      ],
    };
    let contents = '';
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const handle = {
      writeFile: jest.fn((value: string) => {
        contents = value;
        return Promise.resolve();
      }),
      sync: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(fs, 'open').mockResolvedValue(handle as unknown as FileHandle);
    jest
      .spyOn(fs, 'readFile')
      .mockImplementation(() => Promise.resolve(contents));
    await writeStageBackup('/ignored/run/db', backup);
    expect(EJSON.parse(contents, { relaxed: false })).toEqual(backup);
    expect(fs.open).toHaveBeenCalledWith(
      resolve('/ignored/run/db/fields-and-indexes.ejson'),
      'wx',
      0o600,
    );
    expect(handle.sync).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
  it('rejects unreadable or inconsistent backup readback', async () => {
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fs, 'open').mockResolvedValue({
      writeFile: jest.fn().mockResolvedValue(undefined),
      sync: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileHandle);
    jest
      .spyOn(fs, 'readFile')
      .mockResolvedValue('{"tasks":[],"classroomtasks":[]}');
    await expect(
      writeStageBackup('/ignored/run/db', {
        tasks: [{ _id: new ObjectId(), stage: 1 }],
        classroomtasks: [],
      }),
    ).rejects.toThrow('BACKUP_READBACK_MISMATCH');
  });
});
