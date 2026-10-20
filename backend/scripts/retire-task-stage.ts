import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { mongo } from 'mongoose';
import { readDeclaredDatabaseName } from '../src/config/database-purpose';

export const STAGE_TARGETS = {
  eduforge_browser_test: [
    '.env.browser-acceptance',
    'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
  ],
  eduforge_test: ['.env.test', 'MONGO_ADMIN_URI'],
  eduforge_dev: ['.env.development', 'MONGO_ADMIN_URI'],
  eduforge: ['.env.production', 'MONGO_ADMIN_URI'],
} as const;
export type StageDatabaseName = keyof typeof STAGE_TARGETS;
export type StageOptions = {
  database: StageDatabaseName;
  apply: boolean;
  backupRun?: string;
};
type Index = mongo.IndexDescriptionInfo;
type Key = Record<string, number>;
const TIMEOUT = 15000;
// Preserve BSON types in backup rows; promote only numeric operation metadata.
const TASK_FILTER = { stage: { $exists: true } };
const SNAPSHOT_FILTER = { 'taskSnapshot.stage': { $exists: true } };
const { EJSON } = mongo.BSON;
export const STAGE_INDEX_PAIRS: Array<{ old: Key; next: Key }> = [
  {
    old: { status: 1, knowledgeModule: 1, stage: 1, createdAt: -1 },
    next: { status: 1, knowledgeModule: 1, createdAt: -1 },
  },
  {
    old: {
      createdBy: 1,
      status: 1,
      courseLabel: 1,
      knowledgeModule: 1,
      stage: 1,
      updatedAt: -1,
      createdAt: -1,
    },
    next: {
      createdBy: 1,
      status: 1,
      courseLabel: 1,
      knowledgeModule: 1,
      updatedAt: -1,
      createdAt: -1,
    },
  },
  {
    old: {
      visibility: 1,
      status: 1,
      courseLabel: 1,
      knowledgeModule: 1,
      stage: 1,
      updatedAt: -1,
      createdAt: -1,
    },
    next: {
      visibility: 1,
      status: 1,
      courseLabel: 1,
      knowledgeModule: 1,
      updatedAt: -1,
      createdAt: -1,
    },
  },
];

export class StageRetirementError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new StageRetirementError(code);
}
export function parseStageArguments(args: string[]): StageOptions | 'help' {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--database', '--confirm-db', '--backup-run'].includes(arg)) {
      if (values.has(arg) || !args[i + 1] || args[i + 1].startsWith('--'))
        fail('INVALID_ARGUMENTS');
      values.set(arg, args[++i]);
    } else if (
      ['--retire-task-stage', '--dry-run', '--apply', '--help'].includes(arg)
    ) {
      if (flags.has(arg)) fail('INVALID_ARGUMENTS');
      flags.add(arg);
    } else fail('UNKNOWN_ARGUMENT');
  }
  if (!flags.has('--retire-task-stage')) fail('TARGET_MODE_REQUIRED');
  if (flags.has('--help')) {
    if (args.length !== 2) fail('INVALID_HELP_ARGUMENTS');
    return 'help';
  }
  const database = values.get('--database');
  if (!database || !Object.hasOwn(STAGE_TARGETS, database))
    fail('EXPLICIT_DATABASE_REQUIRED');
  const apply = flags.has('--apply');
  if (
    (apply && flags.has('--dry-run')) ||
    (apply
      ? values.get('--confirm-db') !== database
      : values.has('--confirm-db'))
  )
    fail('APPLY_CONFIRMATION_MISMATCH');
  const backupRun = values.get('--backup-run');
  if (backupRun && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(backupRun))
    fail('INVALID_BACKUP_RUN');
  return { database: database as StageDatabaseName, apply, backupRun };
}

const encode = (value: unknown) => EJSON.stringify(value, { relaxed: false });
const sameKey = (left: Index['key'], right: Key) =>
  JSON.stringify(Object.entries(left)) ===
  JSON.stringify(Object.entries(right));
const indexName = (key: Key) =>
  Object.entries(key)
    .map(([name, direction]) => `${name}_${direction}`)
    .join('_');
function plainIndex(index: Index): boolean {
  const allowed = new Set([
    'v',
    'key',
    'name',
    'ns',
    'background',
    'unique',
    'sparse',
    'hidden',
  ]);
  return (
    Object.keys(index).every((key) => allowed.has(key)) &&
    !index.unique &&
    !index.sparse &&
    !index.hidden
  );
}
export function planStageIndexes(indexes: Index[]) {
  const problems: string[] = [];
  const related: Index[] = [];
  const create: Array<{
    key: Key;
    name: string;
    background?: boolean;
    version?: number;
  }> = [];
  const drop: Index[] = [];
  const reuse: Index[] = [];
  for (const index of indexes) {
    if (
      Object.hasOwn(index.key, 'stage') &&
      !STAGE_INDEX_PAIRS.some((pair) => sameKey(index.key, pair.old))
    )
      problems.push(`UNPLANNED_STAGE_INDEX:${index.name}`);
  }
  for (const pair of STAGE_INDEX_PAIRS) {
    const old = indexes.filter((index) => sameKey(index.key, pair.old));
    const next = indexes.filter((index) => sameKey(index.key, pair.next));
    const name = indexName(pair.next);
    if (
      indexes.some(
        (index) => index.name === name && !sameKey(index.key, pair.next),
      )
    )
      problems.push(`INDEX_NAME_COLLISION:${name}`);
    related.push(...old, ...next);
    if (old.length > 1 || next.length > 1)
      problems.push('DUPLICATE_INDEX_DEFINITION');
    for (const index of [...old, ...next])
      if (!plainIndex(index))
        problems.push(`UNEXPECTED_INDEX_OPTIONS:${index.name}`);
    drop.push(...old);
    if (next.length) reuse.push(...next);
    else {
      create.push({
        key: pair.next,
        name,
        ...(old[0]?.v === undefined ? {} : { version: Number(old[0].v) }),
        ...(old[0]?.background === undefined
          ? {}
          : { background: old[0].background }),
      });
    }
  }
  return { problems, related, create, drop, reuse };
}

export async function writeStageBackup(
  directory: string,
  backup: mongo.Document,
): Promise<void> {
  await mkdir(resolve(directory, '..'), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 }); // Existing material is never overwritten.
  const file = resolve(directory, 'fields-and-indexes.ejson');
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(encode(backup), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  const restored = EJSON.parse(await readFile(file, 'utf8'), {
    relaxed: false,
  }) as mongo.Document;
  if (encode(restored) !== encode(backup)) fail('BACKUP_READBACK_MISMATCH');
  for (const name of ['tasks', 'classroomtasks'] as const) {
    if (
      !Array.isArray(restored[name]) ||
      restored[name].length !== (backup[name] as unknown[]).length
    )
      fail('BACKUP_COUNT_MISMATCH');
  }
}

type Runtime = {
  backendDirectory: string;
  readConfig: (path: string) => Promise<string>;
  client: (uri: string) => mongo.MongoClient;
  backup: typeof writeStageBackup;
};
const runtime: Runtime = {
  backendDirectory: process.cwd(),
  readConfig: (path) => readFile(path, 'utf8'),
  client: (uri) =>
    new mongo.MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      timeoutMS: TIMEOUT,
      promoteValues: false,
      promoteLongs: false,
    }),
  backup: writeStageBackup,
};
function assertConnectedName(actual: string | undefined, expected: string) {
  if (actual !== expected) fail('CONNECTED_DATABASE_MISMATCH');
}
async function digest(
  db: mongo.Db,
  name: string,
  field: string,
): Promise<string> {
  const hash = createHash('sha256');
  const cursor = db.collection(name).find(
    {},
    {
      projection: { [field]: 0 },
      sort: { _id: 1 },
      maxTimeMS: 60000,
      timeoutMS: 65000,
    },
  );
  try {
    for await (const document of cursor) hash.update(encode(document) + '\n');
  } finally {
    await cursor.close();
  }
  return hash.digest('hex');
}
async function readTaskIndexes(db: mongo.Db): Promise<Index[]> {
  return (await db.collection('tasks').listIndexes().toArray()) as Index[];
}

async function inspectStage(db: mongo.Db) {
  const collections = await db
    .listCollections(
      { name: { $in: ['tasks', 'classroomtasks'] } },
      { nameOnly: true },
    )
    .toArray();
  const names = new Set(collections.map((collection) => collection.name));
  const tasks = names.has('tasks')
    ? await db
        .collection('tasks')
        .find(TASK_FILTER, {
          projection: { _id: 1, stage: 1 },
          maxTimeMS: TIMEOUT,
        })
        .toArray()
    : [];
  const snapshots = names.has('classroomtasks')
    ? await db
        .collection('classroomtasks')
        .find(SNAPSHOT_FILTER, {
          projection: { _id: 1, 'taskSnapshot.stage': 1 },
          maxTimeMS: TIMEOUT,
        })
        .toArray()
    : [];
  const problems: string[] = [];
  for (const row of snapshots) {
    const snapshot: unknown = row.taskSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Object.hasOwn(snapshot, 'stage')
    )
      problems.push(`ABNORMAL_SNAPSHOT:${encode(row._id)}`);
  }
  const indexes = names.has('tasks') ? await readTaskIndexes(db) : [];
  const plan = names.has('tasks')
    ? planStageIndexes(indexes)
    : { problems: [], related: [], create: [], drop: [], reuse: [] };
  const counts = {
    tasks: {
      exists: names.has('tasks'),
      total: names.has('tasks')
        ? await db
            .collection('tasks')
            .countDocuments({}, { maxTimeMS: TIMEOUT, promoteValues: true })
        : 0,
      stage: tasks.length,
    },
    classroomtasks: {
      exists: names.has('classroomtasks'),
      total: names.has('classroomtasks')
        ? await db
            .collection('classroomtasks')
            .countDocuments({}, { maxTimeMS: TIMEOUT, promoteValues: true })
        : 0,
      stage: snapshots.length,
    },
  };
  return {
    tasks,
    snapshots,
    indexes,
    plan,
    counts,
    problems: [...problems, ...plan.problems],
  };
}

export async function retireTaskStage(
  options: StageOptions,
  overrides: Partial<Runtime> = {},
) {
  const io = { ...runtime, ...overrides };
  if (!Object.hasOwn(STAGE_TARGETS, options.database))
    fail('EXPLICIT_DATABASE_REQUIRED');
  const [config, key] = STAGE_TARGETS[options.database];
  const file = parse(await io.readConfig(resolve(io.backendDirectory, config)));
  const uri = file[key];
  if (readDeclaredDatabaseName(uri) !== options.database)
    fail('DECLARED_DATABASE_MISMATCH');
  const client = io.client(uri);
  try {
    await client.connect();
    const db = client.db();
    assertConnectedName(db.databaseName, options.database);
    const hostNames = client.options.hosts.map((host) => host.host);
    if (
      options.database !== 'eduforge' &&
      (!hostNames.length ||
        hostNames.some(
          (host) =>
            host === undefined ||
            !['127.0.0.1', 'localhost', '::1'].includes(host),
        ))
    )
      fail('LOCAL_SERVER_IDENTITY_MISMATCH');
    const auth = await db.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: TIMEOUT },
    );
    const roles = auth.authInfo as {
      authenticatedUserRoles: Array<{ db: string; role: string }>;
      authenticatedUsers: Array<{ user: string }>;
    };
    const declaredUser = client.options.credentials?.username;
    if (
      !declaredUser ||
      !roles.authenticatedUsers.some((user) => user.user === declaredUser)
    )
      fail('OPERATIONS_ACCOUNT_MISMATCH');
    const ownedRoles = roles.authenticatedUserRoles
      .filter((role) => role.db === options.database)
      .map((role) => role.role);
    const adminRoles = roles.authenticatedUserRoles
      .filter((role) => role.db === 'admin')
      .map((role) => role.role);
    const productionAdmin =
      options.database === 'eduforge' &&
      (adminRoles.includes('root') ||
        (adminRoles.includes('dbAdminAnyDatabase') &&
          adminRoles.includes('readWriteAnyDatabase')));
    if (
      !productionAdmin &&
      !ownedRoles.includes('dbOwner') &&
      !(ownedRoles.includes('dbAdmin') && ownedRoles.includes('readWrite'))
    )
      fail('OPERATIONS_ROLE_MISMATCH');
    const databases = await db.admin().listDatabases({
      nameOnly: true,
      authorizedDatabases: true,
      filter: { name: options.database },
    });
    if (
      !databases.databases.some(
        (database) => database.name === options.database,
      )
    )
      return {
        status: 'skipped',
        databaseName: db.databaseName,
        reason: 'DATABASE_ABSENT',
      };
    const stats = await db.command({ dbStats: 1 }, { timeoutMS: TIMEOUT });
    assertConnectedName(stats.db as string, options.database);
    const before = await inspectStage(db);
    const summary = {
      purpose: 'production_or_operations',
      databaseName: db.databaseName,
      accountVerified: true,
      mode: options.apply ? 'apply' : 'dry-run',
      collections: before.counts,
      indexes: {
        old: before.plan.drop.map((index) => ({
          name: index.name,
          key: index.key,
        })),
        reuse: before.plan.reuse.map((index) => ({
          name: index.name,
          key: index.key,
        })),
        create: before.plan.create,
      },
      problems: before.problems,
    };
    if (!before.counts.tasks.exists && !before.counts.classroomtasks.exists)
      return {
        ...summary,
        status: 'skipped',
        reason: 'COLLECTIONS_ABSENT',
        pending: 0,
      };
    if (before.problems.length || !options.apply)
      return {
        ...summary,
        status: before.problems.length ? 'blocked' : 'inventoried',
        pending:
          before.tasks.length +
          before.snapshots.length +
          before.plan.create.length +
          before.plan.drop.length,
      };
    if (
      !(
        before.tasks.length +
        before.snapshots.length +
        before.plan.create.length +
        before.plan.drop.length
      )
    )
      return { ...summary, status: 'already-clean', pending: 0 };
    const protectedBefore: Record<string, string> = {};
    for (const [name, field] of [
      ['tasks', 'stage'],
      ['classroomtasks', 'taskSnapshot.stage'],
    ] as const)
      if (before.counts[name].exists)
        protectedBefore[name] = await digest(db, name, field);
    const run =
      options.backupRun ??
      `task-stage-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().slice(0, 8)}`;
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(run)) fail('INVALID_BACKUP_RUN');
    const backupPath = resolve(
      io.backendDirectory,
      '..',
      '.local/deliverables/task-stage-retirement-backups',
      run,
      options.database,
    );
    await io.backup(backupPath, {
      databaseName: options.database,
      createdAt: new Date(),
      counts: before.counts,
      tasks: before.tasks,
      classroomtasks: before.snapshots,
      indexes: before.plan.related,
      protectedDigests: protectedBefore,
    });
    for (const [name, filter, expected] of [
      ['tasks', TASK_FILTER, before.tasks.length],
      ['classroomtasks', SNAPSHOT_FILTER, before.snapshots.length],
    ] as const) {
      if (
        before.counts[name].exists &&
        (await db.collection(name).countDocuments(filter, {
          maxTimeMS: TIMEOUT,
          promoteValues: true,
        })) !== expected
      )
        fail('BACKUP_DATABASE_COUNT_MISMATCH');
    }
    let created = 0;
    for (const index of before.plan.create) {
      await db.collection('tasks').createIndex(index.key, {
        name: index.name,
        ...(index.version === undefined ? {} : { version: index.version }),
        ...(index.background === undefined
          ? {}
          : { background: index.background }),
        maxTimeMS: 60000,
        timeoutMS: 65000,
      });
      created++;
    }
    if (before.counts.tasks.exists) {
      const installed = planStageIndexes(await readTaskIndexes(db));
      if (
        installed.problems.length ||
        installed.create.length ||
        installed.reuse.length !== 3
      )
        fail('NEW_INDEX_READBACK_FAILED');
    }
    const changes = {
      tasksMatched: 0,
      tasksModified: 0,
      snapshotsMatched: 0,
      snapshotsModified: 0,
      indexesCreated: created,
      indexesReused: before.plan.reuse.length,
      indexesDropped: 0,
    };
    for (const [name, filter, unset, prefix, expected] of [
      ['tasks', TASK_FILTER, { stage: '' }, 'tasks', before.tasks.length],
      [
        'classroomtasks',
        SNAPSHOT_FILTER,
        { 'taskSnapshot.stage': '' },
        'snapshots',
        before.snapshots.length,
      ],
    ] as const) {
      if (!expected) continue;
      if (
        (await db.collection(name).countDocuments(filter, {
          maxTimeMS: TIMEOUT,
          promoteValues: true,
        })) !== expected
      )
        fail('FIELD_COUNTS_CHANGED_AUDIT_REQUIRED');
      const result = await db
        .collection(name)
        .updateMany(
          filter,
          { $unset: unset },
          { maxTimeMS: TIMEOUT, promoteValues: true },
        );
      changes[`${prefix}Matched`] = result.matchedCount;
      changes[`${prefix}Modified`] = result.modifiedCount;
      if (result.matchedCount !== expected || result.modifiedCount !== expected)
        fail('FIELD_WRITE_COUNTS_CHANGED_AUDIT_REQUIRED');
    }
    const afterFields = await inspectStage(db);
    if (
      afterFields.tasks.length ||
      afterFields.snapshots.length ||
      afterFields.problems.length
    )
      fail('FIELD_RESIDUAL_AUDIT_REQUIRED');
    for (const [name, field] of [
      ['tasks', 'stage'],
      ['classroomtasks', 'taskSnapshot.stage'],
    ] as const) {
      if (
        before.counts[name].exists &&
        (await digest(db, name, field)) !== protectedBefore[name]
      )
        fail('PROTECTED_DOCUMENTS_CHANGED_OR_CONCURRENT_WRITES');
    }
    const unrelated = (indexes: Index[]) =>
      indexes.filter(
        (index) =>
          !STAGE_INDEX_PAIRS.some(
            (pair) =>
              sameKey(index.key, pair.old) || sameKey(index.key, pair.next),
          ),
      );
    for (const index of before.plan.drop) {
      const actual = (await readTaskIndexes(db)).find(
        (candidate) => candidate.name === index.name,
      );
      if (!actual?.name || encode(actual) !== encode(index))
        fail('OLD_INDEX_CHANGED_AUDIT_REQUIRED');
      await db
        .collection('tasks')
        .dropIndex(actual.name, { maxTimeMS: TIMEOUT });
      changes.indexesDropped++;
    }
    const after = await inspectStage(db);
    if (
      after.tasks.length ||
      after.snapshots.length ||
      after.plan.create.length ||
      after.plan.drop.length ||
      after.problems.length ||
      encode(unrelated(before.indexes)) !== encode(unrelated(after.indexes))
    )
      fail('FINAL_READBACK_FAILED_AUDIT_REQUIRED');
    return {
      ...summary,
      status: 'completed',
      backupPath,
      changes,
      final: after.counts,
      otherIndexesUnchanged: true,
      protectedDocumentsUnchanged: true,
      pending: 0,
    };
  } finally {
    await client.close();
  }
}

export async function runRetireTaskStageCli(args: string[]): Promise<void> {
  try {
    const options = parseStageArguments(args);
    if (options === 'help') {
      console.log(
        'sync-indexes --retire-task-stage --database <eduforge_browser_test|eduforge_test|eduforge_dev|eduforge> [--dry-run | --apply --confirm-db <same-database>] [--backup-run <unique-id>]',
      );
      return;
    }
    const result = await retireTaskStage(options);
    console.log(JSON.stringify(result));
    if (result.status === 'blocked') process.exitCode = 1;
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        ok: false,
        code:
          error instanceof StageRetirementError
            ? error.code
            : 'TASK_STAGE_OPERATION_FAILED_AUDIT_BEFORE_RETRY',
        sideEffects: 'audit-required',
      }),
    );
    process.exitCode = 1;
  }
}
