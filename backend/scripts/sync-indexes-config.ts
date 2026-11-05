import { resolve } from 'node:path';
import { parse as parseEnvironment } from 'dotenv';
import {
  assertDeclaredDatabaseMatchesPurpose,
  getExpectedDatabaseName,
  resolveTestDatabasePurpose,
} from '../src/config/database-purpose';

export class SyncIndexesError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SyncIndexesError';
  }
}

export function parseSyncIndexesArguments(
  argv: readonly string[],
):
  | { help: true }
  | { help: false; apply: boolean; confirmDb?: string; allowDrop: boolean } {
  const seen = new Set<string>();
  let confirmDb: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (seen.has(arg)) throw new SyncIndexesError('CLI_ARGUMENT_DUPLICATE');
    seen.add(arg);
    if (arg === '--confirm-db') {
      const value = argv[++index];
      if (!value?.trim() || value.startsWith('-')) {
        throw new SyncIndexesError('CONFIRM_DB_REQUIRED');
      }
      confirmDb = value;
    } else if (
      !['--help', '--dry-run', '--apply', '--allow-drop'].includes(arg)
    ) {
      throw new SyncIndexesError('CLI_ARGUMENT_INVALID');
    }
  }

  if (seen.has('--help')) {
    if (argv.length !== 1) {
      throw new SyncIndexesError('CLI_ARGUMENT_CONFLICT');
    }
    return { help: true };
  }

  const apply = seen.has('--apply');
  const allowDrop = seen.has('--allow-drop');
  if (apply && seen.has('--dry-run')) {
    throw new SyncIndexesError('CLI_ARGUMENT_CONFLICT');
  }
  if (apply && confirmDb === undefined) {
    throw new SyncIndexesError('CONFIRM_DB_REQUIRED');
  }
  if (!apply && confirmDb !== undefined) {
    throw new SyncIndexesError('CONFIRM_DB_REQUIRES_APPLY');
  }
  if (!apply && allowDrop) {
    throw new SyncIndexesError('ALLOW_DROP_REQUIRES_APPLY');
  }

  return {
    help: false,
    apply,
    allowDrop,
    ...(confirmDb === undefined ? {} : { confirmDb }),
  };
}

export function resolveSyncIndexesConfig(
  env: NodeJS.ProcessEnv,
  backendDirectory: string,
  readFile: (path: string) => string,
) {
  const nodeEnv = env.NODE_ENV;
  if (!nodeEnv) throw new SyncIndexesError('NODE_ENV_REQUIRED');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new SyncIndexesError('NODE_ENV_INVALID');
  }

  let file: Record<string, string> = {};
  try {
    file = parseEnvironment(
      readFile(resolve(backendDirectory, `.env.${nodeEnv}`)),
    );
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw new SyncIndexesError('ENV_FILE_READ_FAILED');
    }
  }

  for (const purpose of [
    env.EDUFORGE_DATABASE_PURPOSE,
    file.EDUFORGE_DATABASE_PURPOSE,
  ]) {
    if (purpose === 'browser_acceptance') {
      throw new SyncIndexesError('BROWSER_ACCEPTANCE_NOT_SUPPORTED');
    }
    resolveTestDatabasePurpose(nodeEnv, purpose);
  }
  const purpose = resolveTestDatabasePurpose(
    nodeEnv,
    env.EDUFORGE_DATABASE_PURPOSE ?? file.EDUFORGE_DATABASE_PURPOSE,
  );

  const uri = env.MONGO_ADMIN_URI ?? file.MONGO_ADMIN_URI;
  if (!uri?.trim()) throw new SyncIndexesError('MONGO_ADMIN_URI_REQUIRED');
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
