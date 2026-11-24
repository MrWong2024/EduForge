import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { parse } from 'dotenv';
import mongoose, { type Connection } from 'mongoose';
import { assertConnectedDatabaseMatchesPurpose } from '../../src/config/database-purpose';
import { envValidationSchema } from '../../src/config/env.validation';
import { isLocalSingleNodeReplicaSetPrimary } from '../../src/config/local-mongo-replica-set';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './local-test-database-auth';

const saved = new Map<string, string | undefined>();
const managedEnvironmentPrefix =
  /^(MONGO_|BROWSER_ACCEPTANCE_|EDUFORGE_|MAIL_|SMTP_|AI_FEEDBACK_|BAILIAN_)/;
const keys = new Set([
  ...Object.keys(
    (envValidationSchema.describe() as { keys: Record<string, unknown> }).keys,
  ),
  'NODE_ENV',
  'EDUFORGE_DATABASE_PURPOSE',
  'MONGO_URI',
  'AI_FEEDBACK_PROVIDER',
  'AI_FEEDBACK_WORKER_ENABLED',
  'MAIL_PROVIDER',
]);
for (const key of Object.keys(process.env)) {
  if (managedEnvironmentPrefix.test(key)) keys.add(key);
}
for (const key of keys) {
  saved.set(key, process.env[key]);
  delete process.env[key];
}
const file = parse(readFileSync(resolve(__dirname, '../../.env.test')));
if (file.NODE_ENV !== undefined && file.NODE_ENV !== 'test')
  throw new Error('AUTH_TEST_NODE_ENV_MISMATCH');
const mongoUri = file.MONGO_URI;
if (typeof mongoUri !== 'string') throw new Error('AUTH_TEST_URI_REQUIRED');
assertLocalStandardTestEnvironment({
  nodeEnv: 'test',
  purpose: 'standard_test',
  mongoUri,
});
if (
  file.EDUFORGE_DATABASE_PURPOSE !== undefined &&
  file.EDUFORGE_DATABASE_PURPOSE !== 'standard_test'
)
  throw new Error('AUTH_TEST_PURPOSE_MISMATCH');
process.env.NODE_ENV = 'test';
process.env.EDUFORGE_DATABASE_PURPOSE = 'standard_test';
process.env.MONGO_URI = mongoUri;
process.env.AI_FEEDBACK_PROVIDER = 'stub';
process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
process.env.MAIL_PROVIDER = 'log';

const originalForRoot = ConfigModule.forRoot.bind(
  ConfigModule,
) as typeof ConfigModule.forRoot;
const configSpy = jest
  .spyOn(ConfigModule, 'forRoot')
  .mockImplementation((options) =>
    originalForRoot({ ...options, ignoreEnvFile: true }),
  );

export const authTestEnvironment = {
  mongoUri,
  restore() {
    configSpy.mockRestore();
    for (const key of Object.keys(process.env)) {
      if (managedEnvironmentPrefix.test(key) && !saved.has(key)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  },
};

export async function assertAuthTestConnection(
  connection: Connection,
): Promise<void> {
  if (!connection.db) throw new Error('AUTH_TEST_CONNECTION_REQUIRED');
  const environment = {
    nodeEnv: 'test',
    purpose: 'standard_test',
    databaseName: connection.db.databaseName,
  };
  assertConnectedDatabaseMatchesPurpose(environment);
  const client = connection.getClient();
  const admin = client.db('admin');
  const hello: unknown = await admin.command(
    { hello: 1 },
    { signal: AbortSignal.timeout(5000), readPreference: 'primary' },
  );
  const seedAddress = client.options.hosts[0]?.toString() ?? '';
  if (!isLocalSingleNodeReplicaSetPrimary(hello, seedAddress))
    throw new Error('AUTH_TEST_LOCAL_RS0_PRIMARY_REQUIRED');
  const auth = (await admin.command(
    { connectionStatus: 1, showPrivileges: false },
    { signal: AbortSignal.timeout(5000), readPreference: 'primary' },
  )) as { authInfo?: unknown };
  assertLocalStandardTestAuthentication({
    ...environment,
    mongoUri,
    connectedHost: connection.host,
    authInfo: auth.authInfo,
  });
}

export async function openAuthTestConnection(): Promise<Connection> {
  const connection = mongoose.createConnection(authTestEnvironment.mongoUri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    waitQueueTimeoutMS: 10000,
    retryReads: false,
    retryWrites: false,
  });
  try {
    await connection.asPromise();
    await assertAuthTestConnection(connection);
    return connection;
  } catch {
    await connection.close().catch(() => undefined);
    throw new Error('AUTH_TEST_DATABASE_GATE_FAILED');
  }
}
