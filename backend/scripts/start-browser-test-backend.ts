import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';
import type { INestApplication, Type } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { createBrowserAcceptanceEnvironment } from '../src/config/browser-acceptance-environment';
import {
  assertBrowserAcceptancePreImportEnvironment,
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
} from '../src/config/database-purpose';

async function bootstrap(): Promise<void> {
  const file = parse(
    readFileSync(resolve(__dirname, '..', '.env.browser-acceptance')),
  );
  process.env = createBrowserAcceptanceEnvironment(file, process.env);
  assertBrowserAcceptancePreImportEnvironment({
    nodeEnv: process.env.NODE_ENV,
    purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
    mongoUri: process.env.MONGO_URI,
  });

  // Application imports must follow both Browser URI declaration gates.
  const loadApplication = createRequire(__filename);
  const { NestFactory } = await import('@nestjs/core');
  const { ConfigService } = await import('@nestjs/config');
  const { getConnectionToken } = await import('@nestjs/mongoose');
  const { AppModule } = loadApplication('../src/app.module') as {
    AppModule: Type<unknown>;
  };
  const { configureApp } = loadApplication(
    '../src/app.setup',
  ) as typeof import('../src/app.setup');
  let app: INestApplication | undefined;
  try {
    // Report safe codes below; never print raw driver/config startup errors.
    app = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    configureApp(app);
    const connection = app.get<Connection>(getConnectionToken());
    assertConnectedDatabaseMatchesPurpose({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      databaseName: connection.db?.databaseName,
    });
    app.enableShutdownHooks();
    const port = app.get(ConfigService).get<number>('app.port') ?? 5000;
    await app.listen(port, '127.0.0.1');
    console.log(
      JSON.stringify({
        ok: true,
        nodeEnv: 'test',
        purpose: 'browser_acceptance',
        databaseName: connection.db?.databaseName,
        envFile: '.env.browser-acceptance',
        applicationUriSource: 'BROWSER_ACCEPTANCE_APP_MONGO_URI',
        adminUriUsed: false,
        host: '127.0.0.1',
        port,
      }),
    );
  } catch (error: unknown) {
    if (app) await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      code:
        error instanceof DatabaseGateError
          ? error.code
          : 'BROWSER_BACKEND_START_FAILED',
    }),
  );
  process.exit(1);
});
