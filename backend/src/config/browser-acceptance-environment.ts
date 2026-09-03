import {
  assertBrowserAcceptancePreImportEnvironment,
  DatabaseGateError,
} from './database-purpose';

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
  if (appUri === adminUri) {
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
    MAIL_FROM: 'browser-acceptance@example.invalid',
    AI_FEEDBACK_PROVIDER: 'stub',
    AI_FEEDBACK_WORKER_ENABLED: 'false',
  };
}
