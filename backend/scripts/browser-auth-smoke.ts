import 'reflect-metadata';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'dotenv';
import mongoose, { type Connection, mongo, Types } from 'mongoose';
import {
  createBrowserAcceptanceEnvironment,
  isLocalRootBrowserUri,
} from '../src/config/browser-acceptance-environment';
import {
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
} from '../src/config/database-purpose';
import {
  isLocalSingleNodeReplicaSetPrimary,
  readLocalMongoPort,
} from '../src/config/local-mongo-replica-set';
import {
  MongoWriteCommandRejectedError,
  runMongoWriteCommand,
} from '../src/lib/mongo-command';
import { readMongoIndexes } from '../src/lib/mongo-index-cursor';
import { SessionSchema } from '../src/modules/auth/schemas/session.schema';
import {
  comparePassword,
  hashPassword,
} from '../src/modules/users/password.utils';
import { UserStatus } from '../src/modules/users/schemas/user.schema';
import {
  createSmokeDeadline,
  readSmokePrimary,
  SMOKE_TOTAL_MS,
  SmokeDeadlineExpiredError,
  type SmokeDeadline,
} from './browser-smoke-deadline';

// Isolated application fixtures only; never infrastructure or real-person credentials.
export const AUTH_SMOKE_INITIAL_PASSWORD = 'AuthSmoke123!';
export const AUTH_SMOKE_NEW_PASSWORD = 'NextAuthSmoke456!';
const ROLES = ['teacher', 'student'] as const;
type Role = (typeof ROLES)[number];
export type AuthSmokeRecord = {
  namespace: string;
  teacherId: string;
  studentId: string;
};
export type AuthSmokeUser = {
  _id: Types.ObjectId;
  email: string;
  roles: string[];
  status: string;
  passwordHash: string;
  credentialVersion: number;
};
export type SessionIndex = {
  name: string;
  key: Record<string, unknown>;
  [key: string]: unknown;
};
type DesiredIndex = {
  key: Record<string, 1 | -1>;
  options: { name: string; unique?: boolean; expireAfterSeconds?: number };
};
export type AuthSmokeStore = {
  assertIdle: () => Promise<void>;
  assertEmptyAndIdle: () => Promise<void>;
  indexes: () => Promise<SessionIndex[]>;
  dropIndex: (name: string) => Promise<void>;
  createIndex: (index: DesiredIndex) => Promise<void>;
  users: (record: AuthSmokeRecord) => Promise<AuthSmokeUser[]>;
  insertUser: (user: AuthSmokeUser) => Promise<void>;
  resetTokens: (
    record: AuthSmokeRecord,
  ) => Promise<{ userId: Types.ObjectId; email: string }[]>;
  deleteSessions: (ids: Types.ObjectId[]) => Promise<void>;
  deleteResetTokens: (record: AuthSmokeRecord) => Promise<void>;
  deleteUser: (user: AuthSmokeUser) => Promise<void>;
  countSessions: (ids: Types.ObjectId[]) => Promise<number>;
};
type Recovery = { save(record: AuthSmokeRecord): void; remove(): void };
const fail = (code: string): never => {
  throw new DatabaseGateError(code);
};

export function assertAuthSmokeNamespace(namespace: string): void {
  if (!/^auth-batch2-[a-z0-9-]{4,64}$/.test(namespace))
    fail('AUTH_SMOKE_NAMESPACE_INVALID');
}
export function authSmokeEmail(record: AuthSmokeRecord, role: Role): string {
  return `${record.namespace}.${role}@example.invalid`;
}
export function assertAuthSmokeRecord(record: AuthSmokeRecord): void {
  assertAuthSmokeNamespace(record.namespace);
  if (
    !/^[a-f0-9]{24}$/.test(record.teacherId) ||
    !/^[a-f0-9]{24}$/.test(record.studentId) ||
    record.teacherId === record.studentId
  )
    fail('AUTH_SMOKE_RECORD_INVALID');
}
export function assertAuthSmokeConnection(input: {
  mongoUri: string | undefined;
  databaseName: string | undefined;
  connectedAddress: string | undefined;
  seedPort: number | undefined;
  hello: unknown;
  authInfo?: {
    authenticatedUsers?: { user: string; db: string }[];
    authenticatedUserRoles?: { role: string; db: string }[];
  };
}): void {
  assertConnectedDatabaseMatchesPurpose({
    nodeEnv: 'test',
    purpose: 'browser_acceptance',
    databaseName: input.databaseName,
  });
  if (
    !isLocalRootBrowserUri(input.mongoUri) ||
    !input.connectedAddress ||
    readLocalMongoPort(input.connectedAddress) !== input.seedPort ||
    !isLocalSingleNodeReplicaSetPrimary(input.hello, input.connectedAddress)
  )
    fail('AUTH_SMOKE_LOCAL_RS0_PRIMARY_REQUIRED');
  if (
    !isDeepStrictEqual(input.authInfo?.authenticatedUsers, [
      { user: 'root', db: 'admin' },
    ]) ||
    !isDeepStrictEqual(input.authInfo?.authenticatedUserRoles, [
      { role: 'root', db: 'admin' },
    ])
  )
    fail('AUTH_SMOKE_DATABASE_IDENTITY_MISMATCH');
}

function desiredIndexes(): DesiredIndex[] {
  return SessionSchema.indexes().map(([key, options]) => ({
    key: key as Record<string, 1 | -1>,
    options: {
      name: Object.entries(key)
        .map(([field, direction]) => `${field}_${direction}`)
        .join('_'),
      ...(options.unique === undefined
        ? {}
        : { unique: options.unique === true }),
      ...(options.expireAfterSeconds === undefined
        ? {}
        : { expireAfterSeconds: options.expireAfterSeconds }),
    },
  }));
}
function indexDefinition(index: SessionIndex): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(index).filter(([key]) => !['v', 'ns'].includes(key)),
  );
}
export function planAuthSmokeSessionIndexes(indexes: SessionIndex[]): {
  drop: string[];
  create: DesiredIndex[];
} {
  const expected = desiredIndexes();
  const drop: string[] = [];
  const names = new Set<string>();
  for (const index of indexes) {
    if (names.has(index.name)) fail('AUTH_SMOKE_UNKNOWN_SESSION_INDEX');
    names.add(index.name);
    const definition = indexDefinition(index);
    if (
      index.name === '_id_' &&
      isDeepStrictEqual(definition, { name: '_id_', key: { _id: 1 } })
    )
      continue;
    if (
      index.name === 'token_1' &&
      isDeepStrictEqual(definition, {
        name: 'token_1',
        key: { token: 1 },
        unique: true,
      })
    ) {
      drop.push(index.name);
      continue;
    }
    if (
      !expected.some((item) =>
        isDeepStrictEqual(definition, { key: item.key, ...item.options }),
      )
    )
      fail('AUTH_SMOKE_UNKNOWN_SESSION_INDEX');
  }
  return {
    drop,
    create: expected.filter((item) => !names.has(item.options.name)),
  };
}
export function assertAuthSmokeOwnership(
  record: AuthSmokeRecord,
  users: AuthSmokeUser[],
): void {
  assertAuthSmokeRecord(record);
  for (const user of users) {
    const role = ROLES.find(
      (value) => record[`${value}Id`] === user._id.toHexString(),
    );
    if (
      !role ||
      user.email !== authSmokeEmail(record, role) ||
      !isDeepStrictEqual(user.roles, [role])
    )
      fail('AUTH_SMOKE_ACCOUNT_OWNERSHIP_MISMATCH');
  }
}
function ids(record: AuthSmokeRecord): Types.ObjectId[] {
  return ROLES.map((role) => new Types.ObjectId(record[`${role}Id`]));
}

export async function cleanupAuthSmoke(
  store: AuthSmokeStore,
  record: AuthSmokeRecord,
): Promise<void> {
  await store.assertIdle();
  const users = await store.users(record);
  assertAuthSmokeOwnership(record, users);
  const resetTokens = await store.resetTokens(record);
  if (
    resetTokens.some(
      (token) =>
        !ROLES.some(
          (role) =>
            token.userId.toHexString() === record[`${role}Id`] &&
            token.email === authSmokeEmail(record, role),
        ),
    )
  )
    fail('AUTH_SMOKE_RESET_TOKEN_OWNERSHIP_MISMATCH');
  await store.deleteSessions(ids(record));
  await store.deleteResetTokens(record);
  for (const user of users) await store.deleteUser(user);
  if (
    (await store.users(record)).length ||
    (await store.resetTokens(record)).length ||
    (await store.countSessions(ids(record)))
  )
    fail('AUTH_SMOKE_CLEANUP_RESIDUAL');
}
export async function prepareAuthSmoke(
  store: AuthSmokeStore,
  record: AuthSmokeRecord,
  recovery: Recovery,
): Promise<void> {
  assertAuthSmokeRecord(record);
  if ((await store.users(record)).length) fail('AUTH_SMOKE_NAMESPACE_EXISTS');
  await store.assertEmptyAndIdle();
  const before = await store.indexes();
  const plan = planAuthSmokeSessionIndexes(before);
  // Preserve the namespace through an uncertain index or account write.
  recovery.save(record);
  for (const name of plan.drop) {
    await store.assertEmptyAndIdle();
    if (!planAuthSmokeSessionIndexes(await store.indexes()).drop.includes(name))
      fail('AUTH_SMOKE_SESSION_INDEX_DRIFT');
    await store.dropIndex(name);
  }
  for (const index of plan.create) {
    await store.assertEmptyAndIdle();
    if (
      !planAuthSmokeSessionIndexes(await store.indexes()).create.some((item) =>
        isDeepStrictEqual(item, index),
      )
    )
      fail('AUTH_SMOKE_SESSION_INDEX_DRIFT');
    await store.createIndex(index);
  }
  const after = planAuthSmokeSessionIndexes(await store.indexes());
  if (after.drop.length || after.create.length)
    fail('AUTH_SMOKE_SESSION_INDEX_VERIFICATION_FAILED');
  try {
    const passwordHash = await hashPassword(AUTH_SMOKE_INITIAL_PASSWORD);
    for (const role of ROLES)
      await store.insertUser({
        _id: new Types.ObjectId(record[`${role}Id`]),
        email: authSmokeEmail(record, role),
        roles: [role],
        status: UserStatus.Active,
        passwordHash,
        credentialVersion: 0,
      });
  } catch (error: unknown) {
    if (
      error instanceof DatabaseGateError &&
      error.code === 'AUTH_SMOKE_INSERT_RESULT_UNKNOWN'
    )
      throw error;
    // Only a definite insert failure can enter immediate ownership-checked cleanup.
    await cleanupAuthSmoke(store, record);
    recovery.remove();
    throw error;
  }
}

function createStore(
  connection: Connection,
  deadline: SmokeDeadline,
): AuthSmokeStore {
  const db = connection.db;
  if (!db) return fail('AUTH_SMOKE_DATABASE_NOT_CONNECTED');
  const users = db.collection<AuthSmokeUser>('users');
  const sessions = db.collection<{ userId: Types.ObjectId }>('sessions');
  const resetTokens = db.collection<{ userId: Types.ObjectId; email: string }>(
    'passwordresettokens',
  );
  const userFilter = (record: AuthSmokeRecord) => ({
    $or: [
      { _id: { $in: ids(record) } },
      { email: { $in: ROLES.map((role) => authSmokeEmail(record, role)) } },
    ],
  });
  const resetFilter = (record: AuthSmokeRecord) => ({
    $or: [
      { userId: { $in: ids(record) } },
      { email: { $in: ROLES.map((role) => authSmokeEmail(record, role)) } },
    ],
  });
  const authCollections = ['users', 'sessions', 'passwordresettokens'];
  const assertIdle = async () => {
    const { maxTimeMS, signal } = deadline.operation(5000);
    const active = (await db.client
      .db('admin')
      .command(
        { currentOp: 1, active: true, maxTimeMS },
        { signal, readPreference: 'primary' },
      )) as {
      inprog?: { ns?: string; command?: Record<string, unknown> }[];
    };
    if (
      active.inprog?.some((operation) =>
        authCollections.some(
          (name) =>
            operation.ns === `${db.databaseName}.${name}` ||
            (operation.command?.$db === db.databaseName &&
              [
                'insert',
                'update',
                'delete',
                'createIndexes',
                'dropIndexes',
              ].some((key) => operation.command?.[key] === name)),
        ),
      )
    )
      fail('AUTH_SMOKE_CONCURRENT_AUTH_OPERATIONS');
  };
  const write = (command: mongo.Document) =>
    runMongoWriteCommand(db, command, deadline.remaining(5000));
  return {
    assertIdle,
    async assertEmptyAndIdle() {
      await assertIdle();
      for (const collection of [users, sessions, resetTokens])
        if (
          await collection.countDocuments(
            {},
            { limit: 1, ...deadline.operation(5000) },
          )
        )
          fail('AUTH_SMOKE_FOREIGN_AUTH_DATA');
    },
    async indexes() {
      try {
        return (await readMongoIndexes(
          db,
          sessions.collectionName,
          deadline.remaining(5000),
        )) as SessionIndex[];
      } catch (error: unknown) {
        if (error instanceof mongo.MongoServerError && error.code === 26)
          return [];
        throw error;
      }
    },
    async dropIndex(name) {
      await write({ dropIndexes: sessions.collectionName, index: name });
    },
    async createIndex(index) {
      await write({
        createIndexes: sessions.collectionName,
        indexes: [{ key: index.key, ...index.options }],
      });
    },
    async users(record) {
      return users
        .find(userFilter(record), deadline.operation(5000))
        .project<AuthSmokeUser>({
          _id: 1,
          email: 1,
          roles: 1,
          status: 1,
          passwordHash: 1,
          credentialVersion: 1,
        })
        .toArray();
    },
    async insertUser(user) {
      const now = new Date();
      const row = {
        ...user,
        passwordResetRequestedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const remaining = deadline.remaining(5000);
      try {
        await runMongoWriteCommand(
          db,
          { insert: users.collectionName, documents: [row] },
          remaining,
        );
      } catch (error: unknown) {
        if (error instanceof MongoWriteCommandRejectedError) throw error;
        fail('AUTH_SMOKE_INSERT_RESULT_UNKNOWN');
      }
    },
    async resetTokens(record) {
      return resetTokens
        .find(resetFilter(record), deadline.operation(5000))
        .project<{ userId: Types.ObjectId; email: string }>({
          userId: 1,
          email: 1,
        })
        .toArray();
    },
    async deleteSessions(userIds) {
      await write({
        delete: sessions.collectionName,
        deletes: [{ q: { userId: { $in: userIds } }, limit: 0 }],
      });
    },
    async deleteResetTokens(record) {
      await write({
        delete: resetTokens.collectionName,
        deletes: [
          {
            q: {
              $or: ROLES.map((role) => ({
                userId: new Types.ObjectId(record[`${role}Id`]),
                email: authSmokeEmail(record, role),
              })),
            },
            limit: 0,
          },
        ],
      });
    },
    async deleteUser(user) {
      await write({
        delete: users.collectionName,
        deletes: [
          {
            q: { _id: user._id, email: user.email, roles: user.roles },
            limit: 1,
          },
        ],
      });
    },
    async countSessions(userIds) {
      return sessions.countDocuments(
        { userId: { $in: userIds } },
        deadline.operation(5000),
      );
    },
  };
}
export async function verifyAuthSmokeConnection(
  connection: Connection,
  mongoUri: string | undefined,
  deadline: SmokeDeadline,
): Promise<void> {
  const db = connection.db;
  if (!db) return fail('AUTH_SMOKE_DATABASE_NOT_CONNECTED');
  assertConnectedDatabaseMatchesPurpose({
    nodeEnv: 'test',
    purpose: 'browser_acceptance',
    databaseName: db.databaseName,
  });
  const primary = await readSmokePrimary(db, deadline);
  const { maxTimeMS, signal } = deadline.operation(5000);
  const status = (await db.client
    .db('admin')
    .command(
      { connectionStatus: 1, showPrivileges: false, maxTimeMS },
      { signal, readPreference: 'primary' },
    )) as {
    authInfo: Parameters<typeof assertAuthSmokeConnection>[0]['authInfo'];
  };
  assertAuthSmokeConnection({
    mongoUri,
    databaseName: db.databaseName,
    ...primary,
    authInfo: status.authInfo,
  });
}
function statePath(namespace: string): string {
  assertAuthSmokeNamespace(namespace);
  return resolve(
    __dirname,
    '../../.local/deliverables/browser-auth-smoke',
    `${namespace}.json`,
  );
}

export async function runAuthSmokeCli(
  args: string[],
  deadline = createSmokeDeadline(),
): Promise<void> {
  if (
    args.length !== 3 ||
    !['prepare', 'inspect', 'cleanup'].includes(args[0]) ||
    args[1] !== '--namespace'
  )
    fail('AUTH_SMOKE_ARGUMENTS_INVALID');
  const [command, , namespace] = args;
  assertAuthSmokeNamespace(namespace);
  const path = statePath(namespace);
  if (command === 'prepare' && existsSync(path))
    fail('AUTH_SMOKE_NAMESPACE_EXISTS');
  const record: AuthSmokeRecord =
    command === 'prepare'
      ? {
          namespace,
          teacherId: new Types.ObjectId().toHexString(),
          studentId: new Types.ObjectId().toHexString(),
        }
      : (JSON.parse(readFileSync(path, 'utf8')) as AuthSmokeRecord);
  assertAuthSmokeRecord(record);
  if (record.namespace !== namespace) fail('AUTH_SMOKE_RECORD_INVALID');
  const file = parse(
    readFileSync(resolve(__dirname, '../.env.browser-acceptance')),
  );
  const environment = createBrowserAcceptanceEnvironment(file, process.env);
  process.env = environment;
  let connection: Connection | undefined;
  try {
    const connectTimeoutMS = deadline.remaining(5000);
    connection = mongoose.createConnection(environment.MONGO_URI!, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: connectTimeoutMS,
      connectTimeoutMS,
      waitQueueTimeoutMS: connectTimeoutMS,
      socketTimeoutMS: deadline.remaining(10000),
      monitorCommands: true,
      retryReads: false,
      retryWrites: false,
    });
    await connection.asPromise();
    await verifyAuthSmokeConnection(
      connection,
      environment.MONGO_URI,
      deadline,
    );
    const store = createStore(connection, deadline);
    const recovery = {
      save(value: AuthSmokeRecord) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      },
      remove() {
        unlinkSync(path);
      },
    };
    if (command === 'prepare') await prepareAuthSmoke(store, record, recovery);
    else if (command === 'cleanup') {
      await cleanupAuthSmoke(store, record);
      recovery.remove();
    }
    const rows = command === 'cleanup' ? [] : await store.users(record);
    assertAuthSmokeOwnership(record, rows);
    if (command !== 'cleanup' && rows.length !== 2)
      fail('AUTH_SMOKE_ACCOUNT_MISSING');
    const accounts: {
      id: string;
      email: string;
      status: string;
      credentialState: string;
    }[] = [];
    for (const user of rows)
      accounts.push({
        id: user._id.toHexString(),
        email: user.email,
        status: user.status,
        credentialState: (await comparePassword(
          AUTH_SMOKE_INITIAL_PASSWORD,
          user.passwordHash,
        ))
          ? 'initial'
          : (await comparePassword(AUTH_SMOKE_NEW_PASSWORD, user.passwordHash))
            ? 'changed'
            : 'other',
      });
    console.log(
      JSON.stringify({
        ok: true,
        command,
        namespace,
        databaseName: connection.db?.databaseName,
        identity: 'root@admin',
        topology: 'loopback rs0 PRIMARY',
        accounts,
        ...(command === 'cleanup'
          ? { residual: { users: 0, sessions: 0, resetTokens: 0 } }
          : {}),
      }),
    );
  } finally {
    if (connection) await connection.close();
  }
}
if (require.main === module) {
  const deadline = createSmokeDeadline();
  const watchdog = setTimeout(() => {
    console.error(
      JSON.stringify({
        ok: false,
        code: 'AUTH_SMOKE_TIMED_OUT_AUDIT_BEFORE_RETRY',
        sideEffects: 'unknown',
      }),
    );
    process.exit(124);
  }, SMOKE_TOTAL_MS);
  void runAuthSmokeCli(process.argv.slice(2), deadline)
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          ok: false,
          code:
            error instanceof SmokeDeadlineExpiredError
              ? 'AUTH_SMOKE_TIMED_OUT_AUDIT_BEFORE_RETRY'
              : error instanceof DatabaseGateError
                ? error.code
                : 'AUTH_SMOKE_FAILED_AUDIT_BEFORE_RETRY',
        }),
      );
      process.exitCode = error instanceof SmokeDeadlineExpiredError ? 124 : 1;
    })
    .finally(() => clearTimeout(watchdog));
}
