import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import {
  createMongooseConnection,
  runSyncIndexesCli,
} from '../../scripts/sync-indexes';
import { readMongoIndexes } from '../../src/lib/mongo-index-cursor';
import {
  Session,
  SessionSchema,
} from '../../src/modules/auth/schemas/session.schema';
import {
  openAuthTestConnection,
  authTestEnvironment,
} from './auth-test-environment';

export async function prepareAuthSessionIndexes(): Promise<void> {
  const connection = await openAuthTestConnection();
  try {
    const db = connection.db;
    if (!db) throw new Error('AUTH_TEST_DATABASE_REQUIRED');
    const operations = (await connection
      .getClient()
      .db('admin')
      .command(
        { currentOp: 1, active: true },
        { signal: AbortSignal.timeout(5000), readPreference: 'primary' },
      )) as {
      inprog?: { ns?: string }[];
    };
    if (
      operations.inprog?.some((operation) =>
        [
          'eduforge_test.users',
          'eduforge_test.sessions',
          'eduforge_test.passwordresettokens',
        ].includes(operation.ns ?? ''),
      )
    )
      throw new Error('AUTH_TEST_CONCURRENT_AUTH_OPERATIONS');
    for (const name of ['users', 'sessions', 'passwordresettokens']) {
      if (
        (await db.collection(name).countDocuments(
          {},
          {
            limit: 1,
            maxTimeMS: 5000,
            signal: AbortSignal.timeout(5000),
          },
        )) !== 0
      )
        throw new Error('AUTH_TEST_FOREIGN_AUTH_DATA');
    }
    let hasChanges = false;
    let sawPlan = false;
    const inspect = (line: string) => {
      const value = mongoose.mongo.BSON.EJSON.parse(line, {
        relaxed: true,
      }) as {
        event?: string;
        models?: {
          collection: string;
          createCollection: boolean;
          toDrop: {
            name: string;
            key: Record<string, unknown>;
            unique?: boolean;
            [key: string]: unknown;
          }[];
          toCreate: {
            key: Record<string, unknown>;
            options: Record<string, unknown>;
          }[];
        }[];
      };
      if (value.event !== 'plan') return;
      sawPlan = true;
      if (
        value.models?.length !== 1 ||
        value.models[0].collection !== 'sessions'
      )
        throw new Error('AUTH_TEST_INDEX_SCOPE');
      const model = value.models[0];
      for (const index of model.toDrop) {
        if (
          index.name !== 'token_1' ||
          !isDeepStrictEqual(index.key, { token: 1 }) ||
          index.unique !== true ||
          Object.keys(index).some(
            (key) => !['v', 'key', 'name', 'unique', 'ns'].includes(key),
          )
        )
          throw new Error('AUTH_TEST_INDEX_DROP_REJECTED');
      }
      for (const index of model.toCreate) {
        const expected = SessionSchema.indexes().find(([key]) =>
          isDeepStrictEqual(key, index.key),
        );
        if (!expected || !isDeepStrictEqual(expected[1], index.options))
          throw new Error('AUTH_TEST_INDEX_CREATE_REJECTED');
      }
      hasChanges =
        model.createCollection ||
        model.toDrop.length > 0 ||
        model.toCreate.length > 0;
    };
    const overrides = {
      env: {
        NODE_ENV: 'test',
        EDUFORGE_DATABASE_PURPOSE: 'standard_test',
        MONGO_URI: authTestEnvironment.mongoUri,
      },
      readFile: () => '',
      createConnection: (
        uri: string,
        options: Parameters<typeof createMongooseConnection>[1],
      ) =>
        createMongooseConnection(uri, options, [
          { name: Session.name, schema: SessionSchema },
        ]),
      log: inspect,
      error: () => undefined,
    };
    if ((await runSyncIndexesCli([], overrides)) !== 0 || !sawPlan)
      throw new Error('AUTH_TEST_INDEX_PREVIEW_FAILED');
    console.info(
      `Auth test Session index preparation: ${hasChanges ? 'applying authorized Session plan' : 'no index changes required'}.`,
    );
    if (
      hasChanges &&
      (await runSyncIndexesCli(
        ['--apply', '--confirm-db', 'eduforge_test', '--allow-drop'],
        overrides,
      )) !== 0
    )
      throw new Error('AUTH_TEST_INDEX_APPLY_FAILED');
    const indexes = (await readMongoIndexes(
      db,
      'sessions',
      10000,
    )) as mongoose.mongo.IndexDescriptionInfo[];
    if (
      indexes.some((index) => index.name === 'token_1') ||
      !indexes.some(
        (index) => index.name === 'tokenHash_1' && index.unique === true,
      )
    )
      throw new Error('AUTH_TEST_INDEX_VERIFICATION_FAILED');
    console.info(
      'Auth test gate: standard_test / eduforge_test / loopback rs0 PRIMARY / root@admin; Session indexes verified.',
    );
  } finally {
    await connection.close();
  }
}
