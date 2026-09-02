import { resolveTestDatabasePurpose } from './database-purpose';

export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: Number.parseInt(
      process.env.BACKEND_PORT ?? process.env.PORT ?? '5000',
      10,
    ),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  },
  mail: {
    provider: process.env.MAIL_PROVIDER ?? 'log',
    from: process.env.MAIL_FROM ?? '',
    fromName: process.env.MAIL_FROM_NAME ?? 'EduForge',
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number.parseInt(process.env.SMTP_PORT ?? '465', 10),
      secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  },
  mongo: {
    purpose: resolveTestDatabasePurpose(
      process.env.NODE_ENV ?? 'development',
      process.env.EDUFORGE_DATABASE_PURPOSE,
    ),
    uri: process.env.MONGO_URI,
    serverSelectionTimeoutMS: Number.parseInt(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? '5000',
      10,
    ),
  },
});
