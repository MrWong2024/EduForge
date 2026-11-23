import {
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
  TEST_DATABASE_NAMES,
} from '../../src/config/database-purpose';
import { isLocalRootMongoReplicaSetUri } from '../../src/config/local-mongo-replica-set';

type TestDatabaseEnvironment = {
  nodeEnv: string | undefined;
  purpose: string | undefined;
  mongoUri: string | undefined;
};

const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];

export function assertLocalStandardTestEnvironment(
  input: TestDatabaseEnvironment,
): void {
  if (input.nodeEnv !== 'test' || input.purpose !== 'standard_test')
    throw new DatabaseGateError('LOCAL_STANDARD_TEST_ENVIRONMENT_REQUIRED');
  if (
    !isLocalRootMongoReplicaSetUri(
      input.mongoUri,
      TEST_DATABASE_NAMES.standard_test,
    )
  )
    throw new DatabaseGateError('LOCAL_STANDARD_TEST_URI_REQUIRED');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRootIdentity(value: unknown, key: 'user' | 'role'): boolean {
  return isRecord(value) && value[key] === 'root' && value.db === 'admin';
}

export function assertLocalStandardTestAuthentication(
  input: TestDatabaseEnvironment & {
    databaseName: string | undefined;
    connectedHost: string | undefined;
    authInfo: unknown;
  },
): void {
  assertLocalStandardTestEnvironment(input);
  assertConnectedDatabaseMatchesPurpose(input);
  if (!loopbackHosts.includes(input.connectedHost ?? ''))
    throw new DatabaseGateError('LOCAL_STANDARD_TEST_HOST_REQUIRED');
  const info = isRecord(input.authInfo) ? input.authInfo : {};
  const users = info.authenticatedUsers;
  const roles = info.authenticatedUserRoles;
  if (
    !Array.isArray(users) ||
    users.length !== 1 ||
    !isRootIdentity(users[0], 'user') ||
    !Array.isArray(roles) ||
    roles.length !== 1 ||
    !isRootIdentity(roles[0], 'role')
  )
    throw new DatabaseGateError('LOCAL_STANDARD_TEST_AUTHENTICATION_REQUIRED');
}
