import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import mongoose, { type Schema, type mongo } from 'mongoose';
import {
  createMongooseConnection,
  runSyncIndexesCli,
} from '../scripts/sync-indexes';
import {
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
  TEST_DATABASE_NAMES,
} from '../src/config/database-purpose';
import {
  Session,
  SessionSchema,
} from '../src/modules/auth/schemas/session.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Submission,
  SubmissionSchema,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  cleanupSyncIndexesCollections,
  createSyncIndexesLifecycle,
} from './helpers/sync-indexes-lifecycle';

const { MongoClient, BSON } = mongoose.mongo;
const testDatabase = TEST_DATABASE_NAMES.standard_test;
const testEnvironment = {
  NODE_ENV: 'test',
  EDUFORGE_DATABASE_PURPOSE: 'standard_test',
};
const prefix = `sync_indexes_e2e_${randomUUID().replaceAll('-', '')}_`;
const collections = {
  sessions: `${prefix}sessions`,
  submissions: `${prefix}submissions`,
  jobs: `${prefix}jobs`,
  failingSessions: `${prefix}failing_sessions`,
  untouchedJobs: `${prefix}untouched_jobs`,
  replaced: `${prefix}replaced`,
};
const allowedNames = Object.values(collections);
const apply = ['--apply', '--confirm-db', testDatabase];
const lifecycle = createSyncIndexesLifecycle();
const testDeadlineMs = 60_000;
const cleanupBudgetMs = 80_000;
const cleanupReportReserveMs = 10_000;
const cleanupCloseReserveMs = 10_000;
const drainWaitMs = 10_000;
const fixtureClientOptions = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  timeoutMS: 10000,
  retryReads: false,
  retryWrites: false,
  readPreference: 'primary',
  raw: false,
  promoteBuffers: false,
  monitorCommands: true,
} as const;

function modelFor(name: string, schema: Schema, collection: string) {
  const clone = schema.clone();
  clone.set('collection', collection);
  return { name, schema: clone, collection };
}

const normalModels = [
  modelFor(Session.name, SessionSchema, collections.sessions),
  modelFor(Submission.name, SubmissionSchema, collections.submissions),
  modelFor(AiFeedbackJob.name, AiFeedbackJobSchema, collections.jobs),
];

type Plan = {
  event: 'plan';
  databaseName: string;
  models: {
    collection: string;
    createCollection: boolean;
    toDrop: { name: string }[];
    toCreate: unknown[];
  }[];
};

type Result = {
  event: 'result';
  databaseName: string;
  status: string;
  writesAttempted: boolean;
  error?: { code: string; driverCode?: number | mongo.BSON.Int32 };
  models: {
    collection: string;
    collectionUuid?: string;
    verification?: {
      status: string;
      differences?: {
        missingCollection?: true;
        missingIndexes: { key: Record<string, unknown> }[];
      };
    };
    operations: { kind: string; status: string }[];
  }[];
};

let client: mongo.MongoClient | undefined;
let db: mongo.Db | undefined;
let managementUri: string;
let standaloneAddress: string | undefined;
const owned = new Map<string, string>();
const closeCliConnections = new Set<() => Promise<void>>();

async function assertLocalStandalone(
  connected: mongo.Db,
  connectedClient: mongo.MongoClient,
  timeoutMS?: number,
) {
  assertConnectedDatabaseMatchesPurpose({
    nodeEnv: testEnvironment.NODE_ENV,
    purpose: testEnvironment.EDUFORGE_DATABASE_PURPOSE,
    databaseName: connected.databaseName,
  });

  let address: string | undefined;
  const captureHello = (event: mongo.CommandSucceededEvent) => {
    if (event.commandName === 'hello' && event.databaseName === 'admin') {
      address = event.address;
    }
  };
  connectedClient.on('commandSucceeded', captureHello);
  try {
    const hello: unknown = await connected
      .admin()
      .command({ hello: 1 }, { timeoutMS })
      .catch(() => {
        throw new Error('SYNC_INDEXES_E2E_HELLO_UNAVAILABLE');
      });
    if (
      !hello ||
      typeof hello !== 'object' ||
      !('isWritablePrimary' in hello) ||
      hello.isWritablePrimary !== true ||
      'setName' in hello ||
      ('isreplicaset' in hello && hello.isreplicaset === true) ||
      ('msg' in hello && hello.msg === 'isdbgrid')
    ) {
      throw new Error('SYNC_INDEXES_E2E_WRITABLE_STANDALONE_REQUIRED');
    }
  } finally {
    connectedClient.off('commandSucceeded', captureHello);
  }

  const match = /^(127\.0\.0\.1|\[::1\]|\[::ffff:7f00:1\]):(\d+)$/.exec(
    address ?? '',
  );
  if (
    !address ||
    !match ||
    Number(match[2]) !== connectedClient.options.hosts[0]?.port ||
    (standaloneAddress !== undefined && address !== standaloneAddress)
  ) {
    throw new Error('SYNC_INDEXES_E2E_ACTUAL_NODE_NOT_LOCAL');
  }
  standaloneAddress = address;
}

async function connectLocal(clientToCheck: mongo.MongoClient) {
  lifecycle.assertRunning();
  try {
    await clientToCheck.connect();
  } catch {
    throw new Error('SYNC_INDEXES_E2E_CONNECTION_UNAVAILABLE');
  }
  const connected = clientToCheck.db();
  await assertLocalStandalone(connected, clientToCheck);
  return connected;
}

function database(): mongo.Db {
  if (!db) throw new Error('SYNC_INDEXES_E2E_DATABASE_NOT_READY');
  return db;
}

function runTest(name: string, operation: () => Promise<void>) {
  it(name, () => lifecycle.run(testDeadlineMs, operation));
}

async function collectionInfo(name: string, timeoutMS?: number) {
  const cursor = database().listCollections(
    { name },
    { nameOnly: false, timeoutMS },
  );
  try {
    return await cursor.next();
  } finally {
    await cursor.close();
  }
}

function uuidFromInfo(info: mongo.CollectionInfo | null, name: string) {
  const uuid = info?.info?.uuid;
  if (info?.type !== 'collection' || !uuid) {
    throw new Error(`SYNC_INDEXES_E2E_UUID_MISSING ${name}`);
  }
  return uuid.toUUID().toHexString().replaceAll('-', '');
}

async function collectionUuid(name: string, timeoutMS?: number) {
  return uuidFromInfo(await collectionInfo(name, timeoutMS), name);
}

async function indexes(name: string) {
  const cursor = database().collection(name).listIndexes();
  try {
    const entries: unknown[] = await cursor.toArray();
    return entries as mongo.IndexDescriptionInfo[];
  } finally {
    await cursor.close();
  }
}

async function createOwned(name: string) {
  if (!allowedNames.includes(name) || (await collectionInfo(name))) {
    throw new Error('SYNC_INDEXES_E2E_NAMESPACE_NOT_EMPTY');
  }
  const collection = await lifecycle.write(() =>
    database().createCollection(name),
  );
  owned.set(name, await collectionUuid(name));
  return collection;
}

async function assertOwned(name: string, timeoutMS?: number) {
  const uuid = owned.get(name);
  if (
    !allowedNames.includes(name) ||
    !uuid ||
    uuid !== (await collectionUuid(name, timeoutMS))
  ) {
    throw new Error(`SYNC_INDEXES_E2E_CLEANUP_OWNERSHIP_CHANGED ${name}`);
  }
}

async function dropOwned(name: string) {
  await assertOwned(name);
  await lifecycle.write(() => database().collection(name).drop());
  owned.delete(name);
}

async function readMetadata(names: readonly string[]) {
  return Promise.all(
    names.map(async (name) => {
      const info = await collectionInfo(name);
      return info
        ? { name, uuid: uuidFromInfo(info, name), indexes: await indexes(name) }
        : null;
    }),
  );
}

async function runCli(argv: string[], models = normalModels) {
  lifecycle.assertRunning();
  const events: (Plan | Result)[] = [];
  const capture = (line: string) => {
    events.push(BSON.EJSON.parse(line, { relaxed: false }) as Plan | Result);
  };
  let opened = 0;
  let closed = 0;
  const exitCode = await runSyncIndexesCli(argv, {
    env: testEnvironment,
    createConnection: (uri, options) => {
      lifecycle.assertRunning();
      if (uri !== managementUri) {
        throw new Error('SYNC_INDEXES_E2E_MANAGEMENT_URI_CHANGED');
      }
      const monitoredOptions = { ...options, monitorCommands: true };
      const connection = createMongooseConnection(
        uri,
        monitoredOptions,
        models,
        assertLocalStandalone,
      );
      let closing: Promise<void> | undefined;
      const close = () =>
        (closing ??= connection.close().then(() => {
          closeCliConnections.delete(close);
          closed++;
        }));
      closeCliConnections.add(close);
      opened++;
      return {
        ...connection,
        models: () => {
          const registered = connection.models();
          if (
            registered.length !== models.length ||
            registered.some(
              ({ name, collectionName }, index) =>
                !allowedNames.includes(collectionName) ||
                name !== models[index].name ||
                collectionName !== models[index].collection,
            )
          ) {
            throw new Error('SYNC_INDEXES_E2E_UNOWNED_COLLECTION');
          }
          return registered.map((model) => ({
            ...model,
            createCollection: async () => {
              if (await collectionInfo(model.collectionName)) {
                throw new Error('SYNC_INDEXES_E2E_NAMESPACE_NOT_EMPTY');
              }
              const created = await lifecycle.write(model.createCollection);
              const uuid = await collectionUuid(model.collectionName);
              owned.set(model.collectionName, uuid);
              return created;
            },
            cleanIndexes: async (indexes) => {
              await assertOwned(model.collectionName);
              return lifecycle.write(() => model.cleanIndexes(indexes));
            },
            createIndexes: async (indexes) => {
              await assertOwned(model.collectionName);
              return lifecycle.write(
                () => model.createIndexes(indexes),
                (error) =>
                  error instanceof mongoose.mongo.MongoServerError &&
                  error.code === 11000,
              );
            },
          }));
        },
        close,
      };
    },
    log: capture,
    error: capture,
  });
  expect(opened).toBe(1);
  expect(closed).toBe(opened);
  const plan = events.find((event) => event.event === 'plan');
  const result = events.find((event) => event.event === 'result');
  if (!plan || !result) {
    throw new Error(
      `SYNC_INDEXES_E2E_CLI_PLAN_MISSING ${result?.error?.code ?? 'UNKNOWN'}`,
    );
  }
  expect(plan.databaseName).toBe(testDatabase);
  expect(result.databaseName).toBe(testDatabase);
  return { exitCode, plan, result };
}

describe('sync-indexes against an isolated MongoDB namespace', () => {
  jest.setTimeout(90_000);

  beforeAll(() =>
    lifecycle.run(testDeadlineMs, async () => {
      const nodeEnv = process.env.NODE_ENV;
      const purpose = process.env.EDUFORGE_DATABASE_PURPOSE;
      if (nodeEnv !== 'test' || purpose !== 'standard_test') {
        throw new Error('SYNC_INDEXES_E2E_ENVIRONMENT_REQUIRED');
      }
      const inheritedConnections = [
        'MONGO_URI',
        'MONGO_ADMIN_URI',
        'BROWSER_ACCEPTANCE_APP_MONGO_URI',
        'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
      ];
      if (
        inheritedConnections.some((name) => process.env[name] !== undefined)
      ) {
        throw new Error('SYNC_INDEXES_E2E_INHERITED_ENVIRONMENT');
      }

      let file: string;
      try {
        file = readFileSync(resolve(__dirname, '../.env.test'), 'utf8');
      } catch {
        throw new Error('SYNC_INDEXES_E2E_ENV_FILE_UNAVAILABLE');
      }
      const mongoUri = parse(file).MONGO_URI;
      if (!mongoUri)
        throw new Error('SYNC_INDEXES_E2E_MANAGEMENT_URI_REQUIRED');
      assertDeclaredDatabaseMatchesPurpose({ nodeEnv, purpose, mongoUri });
      managementUri = mongoUri;

      try {
        client = new MongoClient(managementUri, fixtureClientOptions);
      } catch {
        throw new Error('SYNC_INDEXES_E2E_MANAGEMENT_URI_INVALID');
      }
      const {
        hosts,
        srvHost,
        replicaSet,
        loadBalanced,
        proxyHost,
        directConnection,
      } = client.options;
      if (
        srvHost ||
        replicaSet !== undefined ||
        loadBalanced ||
        proxyHost !== undefined ||
        hosts.length !== 1 ||
        !['127.0.0.1', 'localhost', '::1'].includes(hosts[0].host ?? '')
      ) {
        throw new Error('SYNC_INDEXES_E2E_LOCAL_STANDALONE_URI_REQUIRED');
      }
      if (directConnection || client.writeConcern?.w === 0) {
        throw new Error('SYNC_INDEXES_E2E_CLI_CONNECTION_GATE');
      }
      // Check the seed itself before any client can discover other replica members.
      const probe = new MongoClient(managementUri, {
        ...fixtureClientOptions,
        directConnection: true,
      });
      try {
        await connectLocal(probe);
      } finally {
        await probe.close();
      }
      db = await connectLocal(client);
      for (const name of allowedNames) {
        if (await collectionInfo(name)) {
          throw new Error('SYNC_INDEXES_E2E_NAMESPACE_NOT_EMPTY');
        }
      }
      console.info(
        `sync-indexes e2e database=${testDatabase} node=${standaloneAddress ?? 'unconfirmed'} topology=standalone prefix=${prefix}`,
      );
    }),
  );

  afterAll(async () => {
    const fixtureDb = db;
    const fixtureClient = client;
    const cleanup = await cleanupSyncIndexesCollections({
      lifecycle,
      owned,
      totalBudgetMs: cleanupBudgetMs,
      drainWaitMs,
      requestTimeoutMs: fixtureClientOptions.timeoutMS,
      reportReserveMs: cleanupReportReserveMs,
      closeReserveMs: cleanupCloseReserveMs,
      target:
        fixtureDb && fixtureClient
          ? {
              verify: (timeoutMS) =>
                assertLocalStandalone(fixtureDb, fixtureClient, timeoutMS),
              assertOwned,
              drop: (name, timeoutMS) =>
                fixtureDb.collection(name).drop({ timeoutMS }),
              readResidual: async (timeoutMS) => {
                const observed = await Promise.all(
                  allowedNames.map(async (name) =>
                    (await collectionInfo(name, timeoutMS)) ? [name] : [],
                  ),
                );
                return observed.flat();
              },
            }
          : undefined,
      closeConnections: async () => {
        const closed = await Promise.allSettled([
          ...[...closeCliConnections].map((close) => close()),
          client?.close(),
        ]);
        if (closed.some(({ status }) => status === 'rejected')) {
          throw new Error('SYNC_INDEXES_E2E_CLOSE_UNCONFIRMED');
        }
      },
    });
    if (!fixtureDb && cleanup.settled && cleanup.connectionsClosed) {
      console.info(
        `sync-indexes e2e prefix=${prefix} fixture=not_started client=closed`,
      );
      return;
    }
    if (
      !cleanup.cleanupIssue &&
      Array.isArray(cleanup.observedResidual) &&
      cleanup.observedResidual.length === 0 &&
      cleanup.connectionsClosed
    ) {
      console.info(
        `sync-indexes e2e prefix=${prefix} residual=0 client=closed`,
      );
      return;
    }
    throw new Error(
      `SYNC_INDEXES_E2E_CLEANUP_INCOMPLETE ${JSON.stringify({
        prefix,
        ...cleanup,
        cleanupIssue: cleanup.cleanupIssue ?? 'remaining-or-close-unconfirmed',
      })}`,
    );
  });

  runTest(
    'builds missing collections and indexes and then produces an empty plan',
    async () => {
      await createOwned(collections.jobs);
      const synced = await runCli(apply);
      expect(synced.exitCode).toBe(0);
      expect(synced.result.status).toBe('completed');
      expect(synced.result.models).toHaveLength(3);
      for (const model of synced.result.models) {
        expect(model.verification?.status).toBe('passed');
        expect(model.collectionUuid).toBe(
          await collectionUuid(model.collection),
        );
      }

      const sessionIndexes = await indexes(collections.sessions);
      expect(
        sessionIndexes.find(({ name }) => name === 'expiresAt_1'),
      ).toMatchObject({
        key: { expiresAt: 1 },
        expireAfterSeconds: 0,
      });
      expect(
        sessionIndexes.find(({ name }) => name === 'token_1'),
      ).toMatchObject({
        key: { token: 1 },
        unique: true,
      });
      expect(
        (await indexes(collections.jobs)).find(
          ({ name }) => name === 'submissionId_1',
        ),
      ).toMatchObject({ key: { submissionId: 1 }, unique: true });

      const submissionIndexes = await indexes(collections.submissions);
      const classroom = submissionIndexes.find(
        ({ name }) => name === 'classroomTaskId_1_studentId_1_attemptNo_1',
      );
      expect(classroom?.unique).toBe(true);
      expect(Object.entries(classroom?.key ?? {})).toEqual([
        ['classroomTaskId', 1],
        ['studentId', 1],
        ['attemptNo', 1],
      ]);
      expect([
        { classroomTaskId: { $type: 'objectId' } },
        { classroomTaskId: { $type: 7 } },
      ]).toContainEqual(classroom?.partialFilterExpression);

      const personal = submissionIndexes.find(
        ({ name }) => name === 'taskId_1_studentId_1_attemptNo_1',
      );
      expect(personal?.unique).toBe(true);
      expect(Object.entries(personal?.key ?? {})).toEqual([
        ['taskId', 1],
        ['studentId', 1],
        ['attemptNo', 1],
      ]);
      expect([
        { classroomTaskId: null },
        { classroomTaskId: { $eq: null } },
      ]).toContainEqual(personal?.partialFilterExpression);

      const repeated = await runCli(apply);
      expect(repeated.exitCode).toBe(0);
      expect(repeated.result.writesAttempted).toBe(false);
      for (const model of repeated.plan.models) {
        expect(model).toMatchObject({
          createCollection: false,
          toDrop: [],
          toCreate: [],
        });
      }
    },
  );

  runTest(
    'keeps preview and denied apply read-only and deletes an authorized extra index',
    async () => {
      const name = collections.sessions;
      expect(owned.get(name)).toBe(await collectionUuid(name));
      await lifecycle.write(() =>
        database().collection(name).createIndex({ legacyOnly: 1 }),
      );
      const targets = [name, collections.submissions, collections.jobs];
      const before = await readMetadata(targets);
      const preview = await runCli(['--dry-run']);
      expect(preview.exitCode).toBe(0);
      expect(preview.result.writesAttempted).toBe(false);
      expect(
        preview.plan.models.find(({ collection }) => collection === name)
          ?.toDrop,
      ).toMatchObject([{ name: 'legacyOnly_1' }]);
      expect(await readMetadata(targets)).toEqual(before);

      const denied = await runCli(apply);
      expect(denied.exitCode).toBe(1);
      expect(denied.result.error?.code).toBe('DROP_CONFIRMATION_REQUIRED');
      expect(denied.result.writesAttempted).toBe(false);
      expect(await readMetadata(targets)).toEqual(before);

      const allowed = await runCli([...apply, '--allow-drop']);
      expect(allowed.exitCode).toBe(0);
      expect(
        allowed.result.models.find(({ collection }) => collection === name),
      ).toMatchObject({
        verification: { status: 'passed' },
        operations: [{ kind: 'dropIndex', status: 'completed' }],
      });
      expect((await indexes(name)).map((index) => index.name).sort()).toEqual([
        '_id_',
        'expiresAt_1',
        'token_1',
        'userId_1',
      ]);
    },
  );

  runTest(
    'stops at a real duplicate-key failure and verifies the partial result',
    async () => {
      const collection = await createOwned(collections.failingSessions);
      await lifecycle.write(() =>
        collection.insertMany([{ token: 'same' }, { token: 'same' }]),
      );
      await lifecycle.write(() => collection.createIndex({ legacyOnly: 1 }));
      const models = [
        modelFor(Session.name, SessionSchema, collections.failingSessions),
        modelFor(
          AiFeedbackJob.name,
          AiFeedbackJobSchema,
          collections.untouchedJobs,
        ),
      ];

      const failed = await runCli([...apply, '--allow-drop'], models);
      expect(failed.exitCode).toBe(1);
      expect(failed.result.error?.code).toBe('INDEX_APPLY_FAILED');
      expect(failed.result.error?.driverCode?.valueOf()).toBe(11000);
      const [session, jobs] = failed.result.models;
      expect(session.verification?.status).toBe('different');
      expect(
        session.verification?.differences?.missingIndexes.map(({ key }) =>
          Object.keys(key),
        ),
      ).toEqual([['token'], ['userId']]);
      expect(session.operations.map(({ status }) => status)).toEqual([
        'completed',
        'completed',
        'failed',
        'not-executed',
      ]);
      expect(jobs.verification?.status).toBe('different');
      expect(jobs.verification?.differences?.missingCollection).toBe(true);
      expect(jobs.operations.length).toBeGreaterThan(0);
      expect(
        jobs.operations.every(({ status }) => status === 'not-executed'),
      ).toBe(true);
      expect(
        (await indexes(collections.failingSessions))
          .map((index) => index.name)
          .sort(),
      ).toEqual(['_id_', 'expiresAt_1']);
      expect(await collectionInfo(collections.untouchedJobs)).toBeNull();
    },
  );

  runTest(
    'observes a new collection UUID after dropping and rebuilding an owned collection',
    async () => {
      const name = collections.replaced;
      await createOwned(name);
      const original = await collectionUuid(name);
      expect(original).toMatch(/^[a-f\d]{32}$/);
      await dropOwned(name);
      await createOwned(name);
      const replacement = await collectionUuid(name);
      expect(replacement).toMatch(/^[a-f\d]{32}$/);
      expect(replacement).not.toBe(original);
    },
  );
});
