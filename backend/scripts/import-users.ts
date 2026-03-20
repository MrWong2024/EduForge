import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import type { INestApplicationContext } from '@nestjs/common';
import type { Connection, Model } from 'mongoose';
import configuration from '../src/config/configuration';
import { AppModule } from '../src/app.module';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';
import {
  USER_ROLES,
  type UserRole,
} from '../src/modules/users/schemas/user-roles.constants';

const expectedDatabaseNames: Record<string, string> = {
  development: 'eduforge_dev',
  test: 'eduforge_test',
  production: 'eduforge',
};

const INITIAL_PASSWORD = 'cqupt@ai';
const PASSWORD_SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CsvHeader =
  | 'email'
  | 'name'
  | 'roles'
  | 'status'
  | 'studentNo'
  | 'employeeNo';
type RawCsvRow = Partial<Record<CsvHeader, string>>;
type NormalizedCsvRow = {
  email: string;
  roles: UserRole[];
  status?: UserStatus;
  name?: string;
  studentNo?: string;
  employeeNo?: string;
};
type CliOptions = {
  filePath: string;
  dryRun: boolean;
  resetPassword: boolean;
};
type ImportStats = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

const nodeEnvRaw = process.env.NODE_ENV;
if (!nodeEnvRaw) {
  throw new Error(
    'NODE_ENV is required for import-users. Refusing to run without explicit environment.',
  );
}
if (!Object.prototype.hasOwnProperty.call(expectedDatabaseNames, nodeEnvRaw)) {
  throw new Error(
    `Invalid NODE_ENV "${nodeEnvRaw}". Expected one of: development | test | production.`,
  );
}
const nodeEnv = nodeEnvRaw;

const envFilePath = resolve(__dirname, '..', `.env.${nodeEnv}`);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
      load: [configuration],
      validate: (raw: Record<string, unknown>) => {
        const adminUri = raw.MONGO_ADMIN_URI;

        if (typeof adminUri !== 'string' || adminUri.trim().length === 0) {
          throw new Error('MONGO_ADMIN_URI is required for import-users.');
        }

        const expectedDb = expectedDatabaseNames[nodeEnv];
        if (!adminUri.includes(`/${expectedDb}`)) {
          throw new Error(
            `MONGO_ADMIN_URI should point to "${expectedDb}" for NODE_ENV=${nodeEnv}.`,
          );
        }

        process.env.MONGO_URI = adminUri;
        return raw;
      },
    }),
    AppModule,
  ],
})
class ImportUsersModule {}

function parseArgs(argv: string[]): CliOptions {
  let filePathArg: string | undefined;
  let dryRun = false;
  let resetPassword = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--reset-password') {
      resetPassword = true;
      continue;
    }
    if (arg === '--file') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value for --file.');
      }
      filePathArg = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file=')) {
      filePathArg = arg.slice('--file='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!filePathArg || filePathArg.trim().length === 0) {
    throw new Error('--file is required.');
  }

  const filePath = resolve(process.cwd(), filePathArg);
  if (!existsSync(filePath)) {
    throw new Error(`CSV file does not exist: ${filePath}`);
  }

  return {
    filePath,
    dryRun,
    resetPassword,
  };
}

function printUsage() {
  console.log('Usage:');
  console.log(
    '  node -r ts-node/register -r tsconfig-paths/register ./scripts/import-users.ts --file=<csv-path> [--dry-run] [--reset-password]',
  );
  console.log('');
  console.log('Required:');
  console.log('  --file=<csv-path>       CSV file path');
  console.log('');
  console.log('Optional:');
  console.log(
    '  --dry-run               Validate and report without writing to DB',
  );
  console.log(
    '  --reset-password        Reset existing users to the initial password',
  );
}

function readCsvFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  if (content.trim().length === 0) {
    throw new Error(`CSV file is empty: ${filePath}`);
  }
  return content;
}

function parseCsv(content: string): string[][] {
  const normalizedContent = content.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < normalizedContent.length; index += 1) {
    const char = normalizedContent[index];

    if (char === '"') {
      const next = normalizedContent[index + 1];
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && normalizedContent[index + 1] === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error('Invalid CSV: unclosed quoted field detected.');
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    throw new Error('CSV file has no rows.');
  }

  return rows;
}

function buildHeaderKeys(headerRow: string[]): Array<CsvHeader | null> {
  const headerAliasMap: Record<string, CsvHeader> = {
    email: 'email',
    name: 'name',
    roles: 'roles',
    status: 'status',
    studentno: 'studentNo',
    employeeno: 'employeeNo',
  };
  const headerKeys: Array<CsvHeader | null> = [];
  const seenHeaders = new Set<CsvHeader>();

  for (const rawHeader of headerRow) {
    const normalizedHeader = rawHeader.trim().toLowerCase();
    const headerKey = headerAliasMap[normalizedHeader] ?? null;
    if (headerKey && seenHeaders.has(headerKey)) {
      throw new Error(`Duplicate CSV header "${headerKey}" is not allowed.`);
    }
    if (headerKey) {
      seenHeaders.add(headerKey);
    }
    headerKeys.push(headerKey);
  }

  if (!seenHeaders.has('email')) {
    throw new Error('CSV header must include "email".');
  }
  if (!seenHeaders.has('roles')) {
    throw new Error('CSV header must include "roles".');
  }

  return headerKeys;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}

function parseRawRow(
  row: string[],
  headerKeys: Array<CsvHeader | null>,
  lineNumber: number,
): RawCsvRow {
  if (row.length > headerKeys.length) {
    throw new Error(
      `CSV row has ${row.length} columns, but header has ${headerKeys.length}.`,
    );
  }

  const paddedRow: string[] = [...row];
  while (paddedRow.length < headerKeys.length) {
    paddedRow.push('');
  }

  const raw: RawCsvRow = {};
  for (let index = 0; index < headerKeys.length; index += 1) {
    const key = headerKeys[index];
    if (!key) {
      continue;
    }
    const value = paddedRow[index].trim();
    if (value && value.length > 0) {
      raw[key] = value;
    }
  }

  if (!raw.email) {
    throw new Error(`Missing email at line ${lineNumber}.`);
  }
  if (!raw.roles) {
    throw new Error(`Missing roles at line ${lineNumber}.`);
  }

  return raw;
}

function normalizeCsvRow(raw: RawCsvRow): NormalizedCsvRow {
  const email = raw.email?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error('Invalid email format.');
  }

  const roles = parseRoles(raw.roles);
  const status = parseStatus(raw.status);

  return {
    email,
    roles,
    status,
    name: normalizeOptional(raw.name),
    studentNo: normalizeOptional(raw.studentNo),
    employeeNo: normalizeOptional(raw.employeeNo),
  };
}

function parseRoles(rawRoles?: string): UserRole[] {
  if (!rawRoles || rawRoles.trim().length === 0) {
    throw new Error('roles is required.');
  }

  const splitRoles = rawRoles
    .split(/[|,;]/)
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);

  if (splitRoles.length === 0) {
    throw new Error('roles is required.');
  }

  const uniqueRoles = Array.from(new Set(splitRoles));
  for (const role of uniqueRoles) {
    if (!USER_ROLES.includes(role as UserRole)) {
      throw new Error(
        `Invalid role "${role}". Allowed: ${USER_ROLES.join(', ')}`,
      );
    }
  }

  return uniqueRoles as UserRole[];
}

function parseStatus(rawStatus?: string): UserStatus | undefined {
  if (!rawStatus) {
    return undefined;
  }
  const normalizedStatus = rawStatus.trim().toLowerCase();
  if (normalizedStatus.length === 0) {
    return undefined;
  }
  const allowedStatuses: UserStatus[] = [
    UserStatus.Active,
    UserStatus.Suspended,
  ];
  if (!allowedStatuses.includes(normalizedStatus as UserStatus)) {
    throw new Error(
      `Invalid status "${rawStatus}". Allowed: ${UserStatus.Active}, ${UserStatus.Suspended}`,
    );
  }
  return normalizedStatus as UserStatus;
}

function normalizeOptional(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function areRolesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function hashInitialPassword(): Promise<string> {
  return bcrypt.hash(INITIAL_PASSWORD, PASSWORD_SALT_ROUNDS);
}

function ensureExpectedDatabaseName(connection: Connection) {
  const actualDatabaseName = connection.db?.databaseName;
  const expectedDatabaseName = expectedDatabaseNames[nodeEnv];

  console.log(`[import-users] dbName=${actualDatabaseName ?? 'unknown'}`);

  if (!actualDatabaseName) {
    throw new Error('MongoDB connection is missing databaseName.');
  }
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new Error(
      `Database name mismatch: expected "${expectedDatabaseName}", got "${actualDatabaseName}".`,
    );
  }
}

async function importUsers(
  userModel: Model<User>,
  rows: string[][],
  headerKeys: Array<CsvHeader | null>,
  options: CliOptions,
): Promise<ImportStats> {
  const stats: ImportStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const seenEmails = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const lineNumber = index + 2;
    const row = rows[index];

    if (isBlankRow(row)) {
      continue;
    }

    stats.total += 1;

    let normalizedEmailForLog = 'unknown';
    try {
      const raw = parseRawRow(row, headerKeys, lineNumber);
      const normalized = normalizeCsvRow(raw);
      normalizedEmailForLog = normalized.email;

      if (seenEmails.has(normalized.email)) {
        throw new Error('Duplicate email found in CSV file.');
      }
      seenEmails.add(normalized.email);

      const existingUser = await userModel
        .findOne({ email: normalized.email })
        .exec();
      if (!existingUser) {
        if (!options.dryRun) {
          const createPayload: {
            email: string;
            roles: UserRole[];
            passwordHash: string;
            status?: UserStatus;
            name?: string;
            studentNo?: string;
            employeeNo?: string;
          } = {
            email: normalized.email,
            roles: normalized.roles,
            passwordHash: await hashInitialPassword(),
          };
          if (normalized.status) {
            createPayload.status = normalized.status;
          }
          if (normalized.name !== undefined) {
            createPayload.name = normalized.name;
          }
          if (normalized.studentNo !== undefined) {
            createPayload.studentNo = normalized.studentNo;
          }
          if (normalized.employeeNo !== undefined) {
            createPayload.employeeNo = normalized.employeeNo;
          }
          await userModel.create(createPayload);
        }
        stats.created += 1;
        continue;
      }

      const updatePayload: Partial<{
        roles: UserRole[];
        status: UserStatus;
        name: string;
        studentNo: string;
        employeeNo: string;
        passwordHash: string;
      }> = {};
      let shouldUpdate = false;

      if (!areRolesEqual(existingUser.roles ?? [], normalized.roles)) {
        updatePayload.roles = normalized.roles;
        shouldUpdate = true;
      }
      if (
        normalized.status !== undefined &&
        existingUser.status !== normalized.status
      ) {
        updatePayload.status = normalized.status;
        shouldUpdate = true;
      }
      if (
        normalized.name !== undefined &&
        normalizeOptional(existingUser.name) !== normalized.name
      ) {
        updatePayload.name = normalized.name;
        shouldUpdate = true;
      }
      if (
        normalized.studentNo !== undefined &&
        normalizeOptional(existingUser.studentNo) !== normalized.studentNo
      ) {
        updatePayload.studentNo = normalized.studentNo;
        shouldUpdate = true;
      }
      if (
        normalized.employeeNo !== undefined &&
        normalizeOptional(existingUser.employeeNo) !== normalized.employeeNo
      ) {
        updatePayload.employeeNo = normalized.employeeNo;
        shouldUpdate = true;
      }
      if (options.resetPassword) {
        shouldUpdate = true;
      }

      if (!shouldUpdate) {
        stats.skipped += 1;
        continue;
      }

      if (options.dryRun) {
        stats.updated += 1;
        continue;
      }

      if (options.resetPassword) {
        updatePayload.passwordHash = await hashInitialPassword();
      }

      await userModel
        .updateOne(
          { _id: existingUser._id },
          { $set: updatePayload },
          { runValidators: true },
        )
        .exec();
      stats.updated += 1;
    } catch (error) {
      stats.failed += 1;
      const reason = extractErrorMessage(error);
      console.error(
        `[import-users] line=${lineNumber} email=${normalizedEmailForLog} failed reason=${reason}`,
      );
    }
  }

  return stats;
}

function toMs(durationNs: bigint): number {
  return Number(durationNs) / 1_000_000;
}

async function run() {
  const startedAt = process.hrtime.bigint();
  let app: INestApplicationContext | undefined;
  let exitCode = 0;

  try {
    const options = parseArgs(process.argv.slice(2));
    const csvContent = readCsvFile(options.filePath);
    const csvRows = parseCsv(csvContent);
    const headerKeys = buildHeaderKeys(
      csvRows[0].map((header) => header.trim()),
    );
    const dataRows = csvRows.slice(1);

    console.log(`[import-users] NODE_ENV=${nodeEnv}`);
    console.log(`[import-users] file=${options.filePath}`);
    console.log(
      `[import-users] mode=${options.dryRun ? 'dry-run' : 'apply'} resetPassword=${
        options.resetPassword
      }`,
    );

    app = await NestFactory.createApplicationContext(ImportUsersModule);

    const connection = app.get<Connection>(getConnectionToken());
    ensureExpectedDatabaseName(connection);
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    const stats = await importUsers(userModel, dataRows, headerKeys, options);

    console.log(
      `[import-users] summary total=${stats.total} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failed}`,
    );

    if (stats.failed > 0) {
      exitCode = 1;
    }
  } catch (error) {
    exitCode = 1;
    const message = extractErrorMessage(error);
    console.error(`[import-users] error=${message}`);
  } finally {
    if (app) {
      await app.close();
    }
    const totalMs = toMs(process.hrtime.bigint() - startedAt);
    console.log(`[import-users] done durationMs=${totalMs.toFixed(2)}`);
    process.exitCode = exitCode;
  }
}

void run();
