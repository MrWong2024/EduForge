import {
  assertBrowserAcceptancePreImportEnvironment,
  DatabaseGateError,
  TEST_DATABASE_NAMES,
} from './database-purpose';
import { isLocalRootMongoReplicaSetUri } from './local-mongo-replica-set';

export function isLocalRootBrowserUri(mongoUri: string | undefined): boolean {
  return isLocalRootMongoReplicaSetUri(
    mongoUri,
    TEST_DATABASE_NAMES.browser_acceptance,
  );
}

export function createBrowserAcceptanceEnvironment(
  file: Record<string, string | undefined>,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const purpose = file.EDUFORGE_DATABASE_PURPOSE;
  const mongoUri = file.MONGO_URI;
  assertBrowserAcceptancePreImportEnvironment({
    nodeEnv: 'test',
    purpose,
    mongoUri,
  });
  if (!isLocalRootBrowserUri(mongoUri)) {
    throw new DatabaseGateError('BROWSER_DATABASE_LOCAL_ROOT_URI_REQUIRED');
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
  // Only MONGO_URI and purpose from the dedicated file participate. No dotenv
  // overlay, connection, external provider or background worker is inherited.
  return {
    ...environment,
    NODE_ENV: 'test',
    EDUFORGE_DATABASE_PURPOSE: purpose,
    MONGO_URI: mongoUri,
    BACKEND_PORT: inherited.BACKEND_PORT ?? '5000',
    FRONTEND_URL: 'http://localhost:3000',
    MAIL_PROVIDER: 'log',
    AI_FEEDBACK_PROVIDER: 'stub',
    AI_FEEDBACK_WORKER_ENABLED: 'false',
  };
}
