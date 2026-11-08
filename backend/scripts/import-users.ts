import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseEnvironment } from 'dotenv';
import * as bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import type { Connection, Types } from 'mongoose';
import {
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
  DatabaseGateError,
  getExpectedDatabaseName,
  resolveTestDatabasePurpose,
} from '../src/config/database-purpose';
import {
  User,
  UserSchema,
  UserStatus,
} from '../src/modules/users/schemas/user.schema';
import {
  Session,
  SessionSchema,
} from '../src/modules/auth/schemas/session.schema';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from '../src/modules/auth/schemas/password-reset-token.schema';
import {
  USER_ROLES,
  type UserRole,
} from '../src/modules/users/schemas/user-roles.constants';
import { buildHeaderKeys, CsvInputError, parseCsv } from './import-users-csv';
import type { CsvHeader, CsvRecord } from './import-users-csv';

const INITIAL_PASSWORD = 'cqupt@ai';
const PASSWORD_SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONNECTION_OPTIONS = {
  autoCreate: false,
  autoIndex: false,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 10000,
  retryWrites: false,
  retryReads: false,
  maxPoolSize: 1,
} as const;

export type ImportConnectionOptions = typeof CONNECTION_OPTIONS;
export type CliOptions = {
  filePath: string;
  dryRun: boolean;
  resetPassword: boolean;
};
export type ImportStats = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};
export type ExistingImportUser = {
  _id: Types.ObjectId;
  roles?: string[];
  status?: string;
  name?: string;
  studentNo?: string;
  employeeNo?: string;
};
type NormalizedCsvRow = {
  email: string;
  roles: UserRole[];
  status?: UserStatus;
  name?: string;
  studentNo?: string;
  employeeNo?: string;
};
export type CreateUserPayload = NormalizedCsvRow & { passwordHash: string };
export type UpdateUserPayload = Partial<Omit<CreateUserPayload, 'email'>>;
export type WriteResult = {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
};
export type DeleteResult = { acknowledged: boolean; deletedCount: number };
export interface ImportStore {
  findUser(this: void, email: string): Promise<ExistingImportUser | null>;
  createUser(this: void, payload: CreateUserPayload): Promise<void>;
  updateUser(
    this: void,
    id: Types.ObjectId,
    changes: UpdateUserPayload,
  ): Promise<WriteResult>;
  deleteSessions(this: void, id: Types.ObjectId): Promise<DeleteResult>;
  invalidateResetTokens(
    this: void,
    id: Types.ObjectId,
    now: Date,
  ): Promise<WriteResult>;
}
export interface ImportConnection {
  ready(this: void): Promise<void>;
  databaseName(this: void): string | undefined;
  createStore(this: void): ImportStore;
  close(this: void): Promise<void>;
}
export interface ImportDependencies {
  env: NodeJS.ProcessEnv;
  backendDirectory: string;
  cwd: string;
  readFile(this: void, filePath: string): string;
  createConnection(
    this: void,
    uri: string,
    options: ImportConnectionOptions,
  ): ImportConnection;
  hashPassword(this: void): Promise<string>;
  now(this: void): Date;
  log(this: void, message: string): void;
  error(this: void, message: string): void;
}

class ImportUsersError extends Error {
  constructor(
    readonly code: string,
    readonly possiblyPartial = false,
  ) {
    super(code);
    this.name = 'ImportUsersError';
  }
}

export function parseImportArguments(
  argv: readonly string[],
  cwd: string,
): { help: true } | ({ help: false } & CliOptions) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  let filePath: string | undefined;
  let dryRun = false;
  let resetPassword = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--reset-password') resetPassword = true;
    else if (arg === '--file') {
      const next = argv[++index];
      if (!next || next.startsWith('--')) {
        throw new ImportUsersError('CSV_FILE_ARGUMENT_REQUIRED');
      }
      filePath = next;
    } else if (arg.startsWith('--file='))
      filePath = arg.slice('--file='.length);
    else throw new ImportUsersError('CLI_ARGUMENT_INVALID');
  }
  if (!filePath?.trim()) {
    throw new ImportUsersError('CSV_FILE_ARGUMENT_REQUIRED');
  }
  return {
    help: false,
    filePath: resolve(cwd, filePath),
    dryRun,
    resetPassword,
  };
}

export function resolveImportConfig(
  env: NodeJS.ProcessEnv,
  backendDirectory: string,
  readFile: ImportDependencies['readFile'],
) {
  const nodeEnv = env.NODE_ENV;
  if (!nodeEnv) throw new ImportUsersError('NODE_ENV_REQUIRED');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new ImportUsersError('NODE_ENV_INVALID');
  }
  let file: Record<string, string> = {};
  try {
    file = parseEnvironment(
      readFile(resolve(backendDirectory, '.env.' + nodeEnv)),
    );
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw new ImportUsersError('ENV_FILE_READ_FAILED');
    }
  }
  for (const purpose of [
    env.EDUFORGE_DATABASE_PURPOSE,
    file.EDUFORGE_DATABASE_PURPOSE,
  ]) {
    if (purpose === 'browser_acceptance') {
      throw new ImportUsersError('BROWSER_ACCEPTANCE_NOT_SUPPORTED');
    }
    resolveTestDatabasePurpose(nodeEnv, purpose);
  }
  const purpose = resolveTestDatabasePurpose(
    nodeEnv,
    env.EDUFORGE_DATABASE_PURPOSE ?? file.EDUFORGE_DATABASE_PURPOSE,
  );
  const uri = env.MONGO_URI ?? file.MONGO_URI;
  if (!uri?.trim()) throw new ImportUsersError('MONGO_URI_REQUIRED');
  const databaseEnvironment = { nodeEnv, purpose };
  assertDeclaredDatabaseMatchesPurpose({
    ...databaseEnvironment,
    mongoUri: uri,
  });
  return {
    ...databaseEnvironment,
    uri,
    expectedDatabaseName: getExpectedDatabaseName(databaseEnvironment),
  };
}

function createStore(connection: Connection): ImportStore {
  const userSchema = UserSchema.clone();
  const sessionSchema = SessionSchema.clone();
  const resetTokenSchema = PasswordResetTokenSchema.clone();
  for (const schema of [userSchema, sessionSchema, resetTokenSchema]) {
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
  }
  const users = connection.model(User.name, userSchema);
  const sessions = connection.model(Session.name, sessionSchema);
  const resetTokens = connection.model(
    PasswordResetToken.name,
    resetTokenSchema,
  );
  return {
    findUser: (email) => users.findOne({ email }).maxTimeMS(5000).exec(),
    createUser: async (payload) => {
      await users.create(payload);
    },
    updateUser: (userId, changes) =>
      users
        .updateOne(
          { _id: userId },
          { $set: changes },
          { runValidators: true, maxTimeMS: 5000 },
        )
        .exec(),
    deleteSessions: (userId) =>
      sessions.deleteMany({ userId }, { maxTimeMS: 5000 }).exec(),
    invalidateResetTokens: (userId, now) =>
      resetTokens
        .updateMany(
          { userId, usedAt: null, expiresAt: { $gt: now } },
          { $set: { usedAt: now } },
          { maxTimeMS: 5000 },
        )
        .exec(),
  };
}

function createMongooseConnection(
  uri: string,
  options: ImportConnectionOptions,
): ImportConnection {
  const connection = mongoose.createConnection(uri, options);
  return {
    ready: async () => {
      await connection.asPromise();
    },
    databaseName: () => connection.db?.databaseName,
    createStore: () => createStore(connection),
    close: async () => {
      await connection.close();
    },
  };
}

function normalizeOptional(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function normalizeRow(
  cells: string[],
  headerKeys: Array<CsvHeader | null>,
): NormalizedCsvRow {
  if (cells.length > headerKeys.length) {
    throw new ImportUsersError('CSV_TOO_MANY_COLUMNS');
  }
  const raw: Partial<Record<CsvHeader, string>> = {};
  for (let index = 0; index < headerKeys.length; index++) {
    const key = headerKeys[index];
    const value = cells[index]?.trim();
    if (key && value) raw[key] = value;
  }
  const email = raw.email?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new ImportUsersError('CSV_EMAIL_INVALID');
  }
  if (!raw.roles) throw new ImportUsersError('CSV_ROLES_REQUIRED');
  const roles = Array.from(
    new Set(
      raw.roles
        .split(/[|,;]/)
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (
    roles.length === 0 ||
    roles.some((role) => !USER_ROLES.includes(role as UserRole))
  ) {
    throw new ImportUsersError('CSV_ROLE_INVALID');
  }
  const status = raw.status?.trim().toLowerCase() || undefined;
  const allowedStatuses: readonly string[] = [
    UserStatus.Active,
    UserStatus.Suspended,
  ];
  if (status !== undefined && !allowedStatuses.includes(status)) {
    throw new ImportUsersError('CSV_STATUS_INVALID');
  }
  return {
    email,
    roles: roles as UserRole[],
    status: status as UserStatus | undefined,
    name: normalizeOptional(raw.name),
    studentNo: normalizeOptional(raw.studentNo),
    employeeNo: normalizeOptional(raw.employeeNo),
  };
}

function updatePayload(
  user: ExistingImportUser,
  incoming: NormalizedCsvRow,
): UpdateUserPayload {
  const changes: UpdateUserPayload = {};
  const existingRoles = user.roles ?? [];
  if (
    existingRoles.length !== incoming.roles.length ||
    !existingRoles.every((role, index) => role === incoming.roles[index])
  ) {
    changes.roles = incoming.roles;
  }
  if (incoming.status !== undefined && user.status !== incoming.status) {
    changes.status = incoming.status;
  }
  for (const key of ['name', 'studentNo', 'employeeNo'] as const) {
    if (
      incoming[key] !== undefined &&
      normalizeOptional(user[key]) !== incoming[key]
    ) {
      changes[key] = incoming[key];
    }
  }
  return changes;
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof ImportUsersError ||
    error instanceof CsvInputError ||
    error instanceof DatabaseGateError
  ) {
    if (/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)) return error.code;
  }
  return 'IMPORT_USERS_OPERATION_FAILED';
}

async function revokeCredentials(
  store: ImportStore,
  userId: Types.ObjectId,
  now: Date,
): Promise<void> {
  let failed = false;
  try {
    const result = await store.deleteSessions(userId);
    if (result.acknowledged !== true) failed = true;
  } catch {
    failed = true;
  }
  try {
    const result = await store.invalidateResetTokens(userId, now);
    if (result.acknowledged !== true) failed = true;
  } catch {
    failed = true;
  }
  if (failed) {
    throw new ImportUsersError('PASSWORD_RESET_REVOCATION_FAILED', true);
  }
}

export async function importUsers(
  store: ImportStore,
  records: readonly CsvRecord[],
  headerKeys: Array<CsvHeader | null>,
  options: Pick<CliOptions, 'dryRun' | 'resetPassword'>,
  deps: Pick<ImportDependencies, 'hashPassword' | 'now' | 'error'>,
): Promise<ImportStats> {
  const stats: ImportStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const seenEmails = new Set<string>();
  for (const record of records) {
    if (record.cells.every((cell) => !cell.trim())) continue;
    stats.total++;
    let writeAttempted = false;
    try {
      const incoming = normalizeRow(record.cells, headerKeys);
      if (seenEmails.has(incoming.email)) {
        throw new ImportUsersError('CSV_DUPLICATE_EMAIL');
      }
      seenEmails.add(incoming.email);
      const existing = await store.findUser(incoming.email);
      if (!existing) {
        if (!options.dryRun) {
          const payload = {
            ...incoming,
            passwordHash: await deps.hashPassword(),
          };
          writeAttempted = true;
          await store.createUser(payload);
        }
        stats.created++;
        continue;
      }
      const changes = updatePayload(existing, incoming);
      if (!options.resetPassword && Object.keys(changes).length === 0) {
        stats.skipped++;
        continue;
      }
      if (options.dryRun) {
        stats.updated++;
        continue;
      }
      if (options.resetPassword) {
        changes.passwordHash = await deps.hashPassword();
      }
      writeAttempted = true;
      const result = await store.updateUser(existing._id, changes);
      if (result.acknowledged !== true) {
        throw new ImportUsersError('USER_UPDATE_UNCONFIRMED', true);
      }
      if (result.matchedCount !== 1) {
        throw new ImportUsersError('USER_UPDATE_NOT_MATCHED');
      }
      if (result.modifiedCount !== 0 && result.modifiedCount !== 1) {
        throw new ImportUsersError('USER_UPDATE_RESULT_INVALID', true);
      }
      if (options.resetPassword) {
        await revokeCredentials(store, existing._id, deps.now());
      }
      if (result.modifiedCount === 1) stats.updated++;
      else stats.skipped++;
    } catch (error) {
      stats.failed++;
      const partial =
        error instanceof ImportUsersError
          ? error.possiblyPartial
          : writeAttempted;
      deps.error(
        '[import-users] line=' +
          record.line +
          ' failed code=' +
          safeErrorCode(error) +
          (partial ? ' 可能已部分生效；未自动回滚，请核对后再显式重跑。' : ''),
      );
    }
  }
  return stats;
}

function defaultDependencies(): ImportDependencies {
  return {
    env: process.env,
    backendDirectory: resolve(__dirname, '..'),
    cwd: process.cwd(),
    readFile: (filePath) =>
      new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath)),
    createConnection: createMongooseConnection,
    hashPassword: () => bcrypt.hash(INITIAL_PASSWORD, PASSWORD_SALT_ROUNDS),
    now: () => new Date(),
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  };
}

export async function runImportUsersCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: Partial<ImportDependencies> = {},
): Promise<number> {
  const deps = { ...defaultDependencies(), ...dependencies };
  let connection: ImportConnection | undefined;
  let exitCode = 0;
  let fatal = false;
  let stats: ImportStats | undefined;
  let dryRun = false;
  try {
    const options = parseImportArguments(argv, deps.cwd);
    if (options.help) {
      deps.log(
        'Usage: npm run import-users -- --file=<csv-path> [--dry-run] [--reset-password]',
      );
      deps.log(
        '--dry-run: read-only preview; --reset-password: reset existing passwords and revoke credentials',
      );
      return 0;
    }
    const config = resolveImportConfig(
      deps.env,
      deps.backendDirectory,
      deps.readFile,
    );
    let content: string;
    try {
      content = deps.readFile(options.filePath);
    } catch {
      throw new ImportUsersError('CSV_FILE_READ_FAILED');
    }
    if (!content.trim()) throw new ImportUsersError('CSV_EMPTY');
    const records = parseCsv(content);
    const headerKeys = buildHeaderKeys(records[0].cells);
    dryRun = options.dryRun;
    deps.log('[import-users] NODE_ENV=' + config.nodeEnv);
    deps.log(
      '[import-users] mode=' +
        (dryRun ? 'dry-run' : 'apply') +
        ' resetPassword=' +
        options.resetPassword,
    );
    connection = deps.createConnection(config.uri, CONNECTION_OPTIONS);
    await connection.ready();
    assertConnectedDatabaseMatchesPurpose({
      nodeEnv: config.nodeEnv,
      purpose: config.purpose,
      databaseName: connection.databaseName(),
    });
    deps.log('[import-users] dbName=' + config.expectedDatabaseName);
    stats = await importUsers(
      connection.createStore(),
      records.slice(1),
      headerKeys,
      options,
      deps,
    );
    if (stats.failed > 0) exitCode = 1;
  } catch (error) {
    fatal = true;
    exitCode = 1;
    const line =
      error instanceof CsvInputError && error.line !== undefined
        ? ' line=' + error.line
        : '';
    deps.error('[import-users] error code=' + safeErrorCode(error) + line);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        fatal = true;
        exitCode = 1;
        deps.error('[import-users] error code=IMPORT_CONNECTION_CLOSE_FAILED');
      }
    }
  }
  if (stats && !fatal) {
    deps.log(
      '[import-users] ' +
        (dryRun ? 'preview' : 'summary') +
        ' total=' +
        stats.total +
        ' created=' +
        stats.created +
        ' updated=' +
        stats.updated +
        ' skipped=' +
        stats.skipped +
        ' failed=' +
        stats.failed,
    );
  }
  return exitCode;
}

if (require.main === module) {
  void runImportUsersCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('[import-users] error code=IMPORT_USERS_OPERATION_FAILED');
      process.exitCode = 1;
    });
}
