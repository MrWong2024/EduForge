import { mongo } from 'mongoose';
import {
  assertBrowserAcceptancePreImportEnvironment,
  DatabaseGateError,
  readDeclaredDatabaseName,
  TEST_DATABASE_NAMES,
} from './database-purpose';

export function isLocalRootBrowserUri(mongoUri: string | undefined): boolean {
  if (
    !mongoUri?.startsWith('mongodb://') ||
    readDeclaredDatabaseName(mongoUri) !==
      TEST_DATABASE_NAMES.browser_acceptance
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
    // The constructor parses the URI; no connection or authentication is started.
    const options = new mongo.MongoClient(mongoUri).options;
    const { credentials, hosts } = options;
    return (
      hosts.length === 1 &&
      ['127.0.0.1', 'localhost', '::1'].includes(hosts[0].host ?? '') &&
      !hosts[0].socketPath &&
      options.directConnection === true &&
      options.dbName === TEST_DATABASE_NAMES.browser_acceptance &&
      credentials?.username === 'root' &&
      credentials.source === 'admin' &&
      credentials.password.length > 0 &&
      ['DEFAULT', 'SCRAM-SHA-1', 'SCRAM-SHA-256'].includes(
        credentials.mechanism,
      ) &&
      Object.keys(credentials.mechanismProperties).length === 0
    );
  } catch {
    // Driver parse errors can contain credentials; expose only a boolean gate.
    return false;
  }
}

export function createBrowserAcceptanceEnvironment(
  file: Record<string, string | undefined>,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const purpose = file.EDUFORGE_DATABASE_PURPOSE;
  const appUri = file.BROWSER_ACCEPTANCE_APP_MONGO_URI;
  const adminUri = file.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI;
  for (const mongoUri of [appUri, adminUri]) {
    assertBrowserAcceptancePreImportEnvironment({
      nodeEnv: 'test',
      purpose,
      mongoUri,
    });
  }
  if (appUri === adminUri && !isLocalRootBrowserUri(appUri)) {
    throw new DatabaseGateError(
      'BROWSER_APPLICATION_URI_MUST_DIFFER_FROM_ADMIN',
    );
  }

  const environment = { ...inherited };
  for (const key of Object.keys(environment)) {
    if (
      /^(MONGO_|BROWSER_ACCEPTANCE_|EDUFORGE_|MAIL_|SMTP_|AI_FEEDBACK_|BAILIAN_|AUTHZ_|LEARNING_TASK_)/i.test(
        key,
      ) ||
      /^(NODE_ENV|PORT|BACKEND_PORT|FRONTEND_URL)$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  // Only the three declared file keys participate. No dotenv overlay, admin
  // connection, external provider or background business worker is inherited.
  return {
    ...environment,
    NODE_ENV: 'test',
    EDUFORGE_DATABASE_PURPOSE: purpose,
    MONGO_URI: appUri,
    BACKEND_PORT: inherited.BACKEND_PORT ?? '5000',
    FRONTEND_URL: 'http://localhost:3000',
    MAIL_PROVIDER: 'log',
    AI_FEEDBACK_PROVIDER: 'stub',
    AI_FEEDBACK_WORKER_ENABLED: 'false',
  };
}
