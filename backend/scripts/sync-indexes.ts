import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import configuration from '../src/config/configuration';
import { AppModule } from '../src/app.module';
import type { INestApplicationContext } from '@nestjs/common';

const expectedDatabaseNames: Record<string, string> = {
  development: 'eduforge_dev',
  test: 'eduforge_test',
  production: 'eduforge',
};

const nodeEnv = process.env.NODE_ENV ?? 'development';
process.env.NODE_ENV = nodeEnv;
const envFilePath = resolve(__dirname, '..', `.env.${nodeEnv}`);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
      load: [configuration],
      validate: (raw: Record<string, unknown>) => {
        const adminUri = raw.MONGO_ADMIN_URI;

        if (typeof adminUri !== 'string' || adminUri.trim().length === 0) {
          throw new Error('MONGO_ADMIN_URI is required for sync-indexes.');
        }

        // 可选：轻量护栏（最终仍以 connection.db.databaseName 校验为准）
        const expectedDb =
          expectedDatabaseNames[nodeEnv] ?? expectedDatabaseNames.development;
        if (!adminUri.includes(`/${expectedDb}`)) {
          throw new Error(
            `MONGO_ADMIN_URI should point to "${expectedDb}" for NODE_ENV=${nodeEnv}.`,
          );
        }

        // 关键：让 configuration() 读取到的 mongo.uri 走 admin 连接
        process.env.MONGO_URI = adminUri;

        return raw;
      },
    }),
    AppModule,
  ],
})
class SyncIndexesModule {}

const toMs = (durationNs: bigint) => Number(durationNs) / 1_000_000;

async function syncIndexes() {
  const startedAt = process.hrtime.bigint();
  console.log(`[sync-indexes] NODE_ENV=${nodeEnv}`);

  let app: INestApplicationContext | undefined;
  let exitCode = 0;

  try {
    app = await NestFactory.createApplicationContext(SyncIndexesModule);
    const connection = app.get<Connection>(getConnectionToken());
    const actualDatabaseName = connection.db?.databaseName;
    const expectedDatabaseName =
      expectedDatabaseNames[nodeEnv] ?? expectedDatabaseNames.development;

    console.log(`[sync-indexes] dbName=${actualDatabaseName ?? 'unknown'}`);

    if (!actualDatabaseName) {
      throw new Error('MongoDB connection is missing databaseName.');
    }
    if (actualDatabaseName !== expectedDatabaseName) {
      throw new Error(
        `Database name mismatch: expected "${expectedDatabaseName}", got "${actualDatabaseName}".`,
      );
    }

    const modelNames = connection.modelNames();
    let successCount = 0;
    let failureCount = 0;

    for (const modelName of modelNames) {
      console.log(`[sync-indexes] model=${modelName} start`);
      const modelStart = process.hrtime.bigint();
      try {
        const model = connection.model(modelName);
        const result = await model.syncIndexes();
        const modelMs = toMs(process.hrtime.bigint() - modelStart);
        successCount += 1;
        console.log(
          `[sync-indexes] model=${modelName} done durationMs=${modelMs.toFixed(
            2,
          )} result=${JSON.stringify(result)}`,
        );
      } catch (error) {
        failureCount += 1;
        const modelMs = toMs(process.hrtime.bigint() - modelStart);
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[sync-indexes] model=${modelName} failed durationMs=${modelMs.toFixed(
            2,
          )} error=${message}`,
        );
      }
    }

    console.log(
      `[sync-indexes] summary success=${successCount} failed=${failureCount} total=${
        successCount + failureCount
      }`,
    );

    if (failureCount > 0) {
      exitCode = 1;
    }
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-indexes] error=${message}`);
  } finally {
    if (app) {
      await app.close();
    }
    const totalMs = toMs(process.hrtime.bigint() - startedAt);
    console.log(`[sync-indexes] done durationMs=${totalMs.toFixed(2)}`);
    process.exit(exitCode);
  }
}

void syncIndexes();
