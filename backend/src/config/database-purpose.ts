export type TestDatabasePurpose = 'standard_test' | 'browser_acceptance';

export const TEST_DATABASE_NAMES = {
  standard_test: 'eduforge_test',
  browser_acceptance: 'eduforge_browser_test',
} as const;

type DatabaseEnvironment = {
  nodeEnv: string | undefined;
  purpose: string | undefined;
};

export class DatabaseGateError extends Error {
  constructor(public readonly code: string) {
    // Input values may contain credentials; errors contain only fixed safe codes.
    super(code);
    this.name = 'DatabaseGateError';
  }
}

export function resolveTestDatabasePurpose(
  nodeEnv: string | undefined,
  purpose: string | undefined,
): TestDatabasePurpose | undefined {
  if (!['development', 'test', 'production'].includes(nodeEnv ?? '')) {
    throw new DatabaseGateError('DATABASE_NODE_ENV_INVALID');
  }
  if (nodeEnv !== 'test') {
    if (purpose !== undefined) {
      throw new DatabaseGateError('DATABASE_PURPOSE_REQUIRES_TEST');
    }
    return undefined;
  }
  if (purpose === undefined) return 'standard_test';
  if (purpose === 'standard_test' || purpose === 'browser_acceptance') {
    return purpose;
  }
  throw new DatabaseGateError('DATABASE_PURPOSE_INVALID');
}

export function getExpectedDatabaseName(input: DatabaseEnvironment): string {
  const purpose = resolveTestDatabasePurpose(input.nodeEnv, input.purpose);
  if (purpose) return TEST_DATABASE_NAMES[purpose];
  return input.nodeEnv === 'development' ? 'eduforge_dev' : 'eduforge';
}

export function readDeclaredDatabaseName(
  mongoUri: string | undefined,
): string | undefined {
  if (!mongoUri) return undefined;
  // Support Mongo seed lists and SRV, but require an explicit database path.
  const match =
    /^mongodb(?:\+srv)?:\/\/[^\s/?#]+\/([^\s/?#]+)(?:\?[^\s#]*)?$/i.exec(
      mongoUri,
    );
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function assertDeclaredDatabaseMatchesPurpose(
  input: DatabaseEnvironment & { mongoUri: string | undefined },
): void {
  if (
    readDeclaredDatabaseName(input.mongoUri) !== getExpectedDatabaseName(input)
  ) {
    throw new DatabaseGateError('DATABASE_DECLARED_NAME_MISMATCH');
  }
}

export function assertConnectedDatabaseMatchesPurpose(
  input: DatabaseEnvironment & { databaseName: string | undefined },
): void {
  if (input.databaseName !== getExpectedDatabaseName(input)) {
    throw new DatabaseGateError('DATABASE_CONNECTED_NAME_MISMATCH');
  }
}

export function assertBrowserAcceptancePreImportEnvironment(
  input: DatabaseEnvironment & { mongoUri: string | undefined },
): void {
  if (input.nodeEnv !== 'test' || input.purpose !== 'browser_acceptance') {
    throw new DatabaseGateError('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
  }
  assertDeclaredDatabaseMatchesPurpose(input);
}
