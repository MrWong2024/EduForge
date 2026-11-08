import { mongo } from 'mongoose';
import {
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
  readDeclaredDatabaseName,
  TEST_DATABASE_NAMES,
} from '../../src/config/database-purpose';

type TestDatabaseEnvironment = {
  nodeEnv: string | undefined;
  purpose: string | undefined;
  mongoUri: string | undefined;
};

const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];

function isLocalRootTestUri(mongoUri: string | undefined): boolean {
  if (
    !mongoUri?.startsWith('mongodb://') ||
    readDeclaredDatabaseName(mongoUri) !== TEST_DATABASE_NAMES.standard_test
  )
    return false;
  try {
    const keys = [...new URL(mongoUri).searchParams.keys()].map((key) =>
      key.toLowerCase(),
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) =>
        /^(proxy|replicaset$|loadbalanced$|srv|dbname$)/.test(key),
      )
    )
      return false;
    // URI parsing only: the helper never connects or authenticates a client.
    const options = new mongo.MongoClient(mongoUri).options;
    const { credentials, hosts } = options;
    return (
      hosts.length === 1 &&
      loopbackHosts.includes(hosts[0].host ?? '') &&
      !hosts[0].socketPath &&
      options.dbName === TEST_DATABASE_NAMES.standard_test &&
      credentials?.username === 'root' &&
      credentials.source === 'admin' &&
      credentials.password.length > 0 &&
      ['DEFAULT', 'SCRAM-SHA-1', 'SCRAM-SHA-256'].includes(
        credentials.mechanism,
      ) &&
      Object.keys(credentials.mechanismProperties).length === 0
    );
  } catch {
    return false;
  }
}

export function assertLocalStandardTestEnvironment(
  input: TestDatabaseEnvironment,
): void {
  if (input.nodeEnv !== 'test' || input.purpose !== 'standard_test')
    throw new DatabaseGateError('LOCAL_STANDARD_TEST_ENVIRONMENT_REQUIRED');
  if (!isLocalRootTestUri(input.mongoUri))
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
