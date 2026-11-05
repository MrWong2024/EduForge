import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, {
  type Connection,
  type IndexDefinition,
  type IndexOptions,
  type mongo,
} from 'mongoose';
import {
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
} from '../src/config/database-purpose';
import { runRetireTaskStageCli } from './retire-task-stage';
import {
  parseSyncIndexesArguments,
  resolveSyncIndexesConfig,
  SyncIndexesError,
} from './sync-indexes-config';
import { SYNC_INDEX_SCHEMAS } from './sync-indexes-models';

const CONNECTION_OPTIONS = {
  autoCreate: false,
  autoIndex: false,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 70000,
  timeoutMS: 65000,
  retryReads: false,
  retryWrites: false,
  readPreference: 'primary',
} as const;

export type SyncIndexDefinition = [IndexDefinition, IndexOptions];

type IndexDiff = {
  toDrop: string[];
  toCreate: SyncIndexDefinition[];
};

export interface SyncIndexModel {
  name: string;
  collectionName: string;
  listIndexes(this: void): Promise<mongo.IndexDescriptionInfo[]>;
  diffIndexes(
    this: void,
    options: { indexOptionsToCreate: true },
  ): Promise<IndexDiff>;
  createCollection(this: void): Promise<unknown>;
  cleanIndexes(this: void, options: { toDrop: string[] }): Promise<unknown>;
  createIndexes(
    this: void,
    options: { toCreate: SyncIndexDefinition[] },
  ): Promise<unknown>;
}

export interface SyncIndexesConnection {
  ready(this: void): Promise<void>;
  databaseName(this: void): string | undefined;
  models(this: void): readonly SyncIndexModel[];
  collectionExists(this: void, name: string): Promise<boolean>;
  close(this: void): Promise<void>;
}

export interface SyncIndexesDependencies {
  env: NodeJS.ProcessEnv;
  backendDirectory: string;
  readFile(this: void, path: string): string;
  createConnection(
    this: void,
    uri: string,
    options: typeof CONNECTION_OPTIONS,
  ): SyncIndexesConnection;
  log(this: void, message: string): void;
  error(this: void, message: string): void;
  retire(this: void, args: string[]): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndexDefinition(value: unknown): value is SyncIndexDefinition {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const entries: readonly unknown[] = value;
  const [key, options] = entries;
  return isRecord(key) && Object.keys(key).length > 0 && isRecord(options);
}

function connectedDb(connection: Connection): mongo.Db {
  if (!connection.db) throw new SyncIndexesError('CONNECTED_DATABASE_MISSING');
  return connection.db;
}

async function listReadyIndexes(
  db: mongo.Db,
  collectionName: string,
): Promise<mongo.IndexDescriptionInfo[]> {
  // A plain listIndexes response can include an in-progress build without marking it.
  const cursor = db.runCursorCommand({
    listIndexes: collectionName,
    cursor: {},
    includeBuildUUIDs: true,
  });
  try {
    const indexes: unknown[] = await cursor.toArray();
    return indexes.map((index) => {
      if (!isRecord(index))
        throw new SyncIndexesError('INVALID_INDEX_METADATA');
      if (
        'buildUUID' in index ||
        'indexBuildInfo' in index ||
        index.ready === false
      ) {
        throw new SyncIndexesError('INDEX_BUILD_IN_PROGRESS');
      }
      if (typeof index.name !== 'string' || !isRecord(index.key)) {
        throw new SyncIndexesError('INVALID_INDEX_METADATA');
      }
      return index as mongo.IndexDescriptionInfo;
    });
  } finally {
    await cursor.close();
  }
}

export function registerSyncIndexModels(
  connection: Connection,
): SyncIndexModel[] {
  return SYNC_INDEX_SCHEMAS.map(({ name, schema }) => {
    const isolatedSchema = schema.clone();
    isolatedSchema.set('autoCreate', false);
    isolatedSchema.set('autoIndex', false);
    const model = connection.model(name, isolatedSchema);
    const collectionName = model.collection.name;
    return {
      name,
      collectionName,
      listIndexes: () =>
        listReadyIndexes(connectedDb(connection), collectionName),
      diffIndexes: async (options) => {
        const result = await model.diffIndexes(options);
        const toDrop: unknown[] = result.toDrop;
        const toCreate: unknown[] = result.toCreate;
        if (
          !toDrop.every((name): name is string => typeof name === 'string') ||
          !toCreate.every(isIndexDefinition)
        ) {
          throw new SyncIndexesError('INVALID_INDEX_DIFF');
        }
        return {
          toDrop,
          toCreate: toCreate.map(([key, options]): SyncIndexDefinition => {
            const indexOptions: IndexOptions & { _autoIndex?: boolean } = {
              ...options,
            };
            delete indexOptions._autoIndex;
            return [{ ...key }, indexOptions];
          }),
        };
      },
      // All registered schemas use ordinary collections. Model.createCollection()
      // suppresses NamespaceExists, which can signal drift after our last check.
      createCollection: () =>
        connectedDb(connection).createCollection(collectionName),
      cleanIndexes: (options) => model.cleanIndexes(options),
      createIndexes: (options) => {
        // The locked Mongoose implementation supports toCreate at runtime.
        const mongooseOptions: mongo.CreateIndexesOptions & typeof options =
          options;
        return model.createIndexes(mongooseOptions);
      },
    };
  });
}

function createMongooseConnection(
  uri: string,
  options: typeof CONNECTION_OPTIONS,
): SyncIndexesConnection {
  const connection = mongoose.createConnection(uri, options);
  return {
    ready: async () => {
      await connection.asPromise();
    },
    databaseName: () => connection.db?.databaseName,
    models: () => registerSyncIndexModels(connection),
    collectionExists: async (name) => {
      const cursor = connectedDb(connection).listCollections(
        { name },
        { nameOnly: true },
      );
      try {
        return await cursor.hasNext();
      } finally {
        await cursor.close();
      }
    },
    close: async () => {
      await connection.close();
    },
  };
}

function defaultDependencies(): SyncIndexesDependencies {
  return {
    env: process.env,
    backendDirectory: resolve(__dirname, '..'),
    readFile: (path) => readFileSync(path, 'utf8'),
    createConnection: createMongooseConnection,
    log: (message) => console.log(message),
    error: (message) => console.error(message),
    retire: runRetireTaskStageCli,
  };
}

type ModelPlan = IndexDiff & {
  createCollection: boolean;
  indexes: mongo.IndexDescriptionInfo[];
};

function validateModels(models: readonly SyncIndexModel[]) {
  if (
    !models.length ||
    models.some(
      (model) => !model.name.trim() || !model.collectionName.trim(),
    ) ||
    new Set(models.map((model) => model.name)).size !== models.length ||
    new Set(models.map((model) => model.collectionName)).size !== models.length
  ) {
    throw new SyncIndexesError('INVALID_MODEL_REGISTRY');
  }
}

async function readModelMetadata(
  connection: SyncIndexesConnection,
  model: SyncIndexModel,
) {
  const exists = await connection.collectionExists(model.collectionName);
  const indexes = exists ? await model.listIndexes() : [];
  if (
    indexes.some((index) => !index.name) ||
    new Set(indexes.map((index) => index.name)).size !== indexes.length
  ) {
    throw new SyncIndexesError('INVALID_INDEX_METADATA');
  }
  return {
    createCollection: !exists,
    indexes: [...indexes].sort((left, right) =>
      (left.name ?? '').localeCompare(right.name ?? ''),
    ),
  };
}

async function readModelPlan(
  connection: SyncIndexesConnection,
  model: SyncIndexModel,
): Promise<ModelPlan> {
  const metadata = await readModelMetadata(connection, model);
  // Mongoose treats NamespaceNotFound as an empty index set.
  const diff = await model.diffIndexes({ indexOptionsToCreate: true });
  const names = new Set(metadata.indexes.map((index) => index.name));
  if (
    new Set(diff.toDrop).size !== diff.toDrop.length ||
    diff.toDrop.some((name) => !names.has(name) || name === '_id_')
  ) {
    throw new SyncIndexesError('INDEX_PLAN_DRIFT');
  }
  return {
    ...metadata,
    toDrop: [...diff.toDrop].sort(),
    toCreate: [...diff.toCreate],
  };
}

const snapshot = (value: unknown) =>
  mongoose.mongo.BSON.EJSON.stringify(value, { relaxed: false });

function verifyReadback(before: ModelPlan, after: ModelPlan) {
  const retained = before.indexes.filter(
    (index) => !before.toDrop.includes(index.name ?? ''),
  );
  const actual = new Map(after.indexes.map((index) => [index.name, index]));
  // Creating an ordinary collection also installs its default _id index.
  const expectedCount =
    retained.length +
    before.toCreate.length +
    (before.createCollection ? 1 : 0);
  if (
    after.createCollection ||
    after.toDrop.length ||
    after.toCreate.length ||
    after.indexes.length !== expectedCount ||
    (before.createCollection && !actual.has('_id_')) ||
    retained.some(
      (index) => snapshot(actual.get(index.name) ?? null) !== snapshot(index),
    ) ||
    before.toCreate.some(
      ([, options]) => options.name !== undefined && !actual.has(options.name),
    )
  ) {
    throw new SyncIndexesError('INDEX_READBACK_MISMATCH');
  }
}

type SafeFailure = { code: string; driverCode?: number };
function safeFailure(error: unknown, fallback: string): SafeFailure {
  if (
    (error instanceof SyncIndexesError || error instanceof DatabaseGateError) &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
  ) {
    return { code: error.code };
  }
  if (
    isRecord(error) &&
    typeof error.code === 'number' &&
    Number.isSafeInteger(error.code)
  ) {
    return { code: fallback, driverCode: error.code };
  }
  return { code: fallback };
}

type ModelOutcome = {
  model: string;
  collection: string;
  status: 'preview' | 'succeeded' | 'failed' | 'not-executed';
  terminalState?: 'verified' | 'observed' | 'unconfirmed';
  collectionExists?: boolean;
  finalIndexes?: mongo.IndexDescriptionInfo[];
  auditError?: SafeFailure;
};

const HELP = [
  'Usage: npm run sync-indexes -- [--dry-run | --apply --confirm-db <database> [--allow-drop]]',
  'No arguments previews the index changes. Review the preview before applying.',
  'Apply computes and prints a fresh plan. --allow-drop authorizes only deletions in that apply plan.',
  'Index changes are not transactional. TTL indexes can expire documents.',
  'For Task.stage retirement: npm run sync-indexes -- --retire-task-stage --help',
].join('\n');

export async function runSyncIndexesCli(
  argv: readonly string[] = process.argv.slice(2),
  overrides: Partial<SyncIndexesDependencies> = {},
): Promise<number> {
  const deps = { ...defaultDependencies(), ...overrides };
  if (argv.includes('--retire-task-stage')) {
    await deps.retire([...argv]);
    return Number(process.exitCode ?? 0);
  }

  let connection: SyncIndexesConnection | undefined;
  let databaseName: string | undefined;
  let mode: 'dry-run' | 'apply' | undefined;
  let phase = 'CLI_ARGUMENT_INVALID';
  let failure: SafeFailure | undefined;
  let closeError: SafeFailure | undefined;
  let active: ModelOutcome | undefined;
  const outcomes: ModelOutcome[] = [];
  const touched = new Map<SyncIndexModel, ModelOutcome>();
  try {
    const options = parseSyncIndexesArguments(argv);
    if (options.help) {
      deps.log(HELP);
      return 0;
    }

    mode = options.apply ? 'apply' : 'dry-run';
    phase = 'CONFIGURATION_FAILED';
    const config = resolveSyncIndexesConfig(
      deps.env,
      deps.backendDirectory,
      deps.readFile,
    );
    if (options.apply && options.confirmDb !== config.expectedDatabaseName) {
      throw new SyncIndexesError('CONFIRM_DB_MISMATCH');
    }

    phase = 'CONNECTION_FAILED';
    connection = deps.createConnection(config.uri, CONNECTION_OPTIONS);
    await connection.ready();
    assertConnectedDatabaseMatchesPurpose({
      ...config,
      databaseName: connection.databaseName(),
    });
    databaseName = config.expectedDatabaseName;

    phase = 'INDEX_PREFLIGHT_FAILED';
    const models = connection.models();
    validateModels(models);
    const work = models.map((model) => {
      const outcome: ModelOutcome = {
        model: model.name,
        collection: model.collectionName,
        status: 'not-executed',
      };
      outcomes.push(outcome);
      return { model, outcome };
    });

    const plans: Array<{
      model: SyncIndexModel;
      outcome: ModelOutcome;
      plan: ModelPlan;
      original: string;
    }> = [];
    for (const { model, outcome } of work) {
      active = outcome;
      const plan = await readModelPlan(connection, model);
      plans.push({ model, outcome, plan, original: snapshot(plan) });
    }
    active = undefined;
    deps.log(
      mongoose.mongo.BSON.EJSON.stringify({
        event: 'plan',
        mode,
        databaseName,
        models: plans.map(({ outcome, plan }) => ({
          model: outcome.model,
          collection: outcome.collection,
          createCollection: plan.createCollection,
          toDrop: plan.indexes.filter((index) =>
            plan.toDrop.includes(index.name ?? ''),
          ),
          toCreate: plan.toCreate.map(([key, options]) => ({ key, options })),
        })),
      }),
    );

    if (!options.apply) {
      for (const outcome of outcomes) outcome.status = 'preview';
    } else {
      if (!options.allowDrop && plans.some(({ plan }) => plan.toDrop.length)) {
        throw new SyncIndexesError('DROP_CONFIRMATION_REQUIRED');
      }
      for (const { model, outcome, original } of plans) {
        active = outcome;
        if (snapshot(await readModelPlan(connection, model)) !== original) {
          throw new SyncIndexesError('INDEX_PLAN_DRIFT');
        }
      }
      for (const { model, outcome, plan, original } of plans) {
        active = outcome;
        phase = 'INDEX_PREFLIGHT_FAILED';
        if (snapshot(await readModelPlan(connection, model)) !== original) {
          throw new SyncIndexesError('INDEX_PLAN_DRIFT');
        }
        if (
          plan.createCollection ||
          plan.toDrop.length ||
          plan.toCreate.length
        ) {
          phase = 'INDEX_APPLY_FAILED';
          touched.set(model, outcome);
          if (plan.createCollection) await model.createCollection();
          if (plan.toDrop.length)
            await model.cleanIndexes({ toDrop: [...plan.toDrop] });
          // Mongoose consumes this array while building indexes.
          if (plan.toCreate.length)
            await model.createIndexes({ toCreate: [...plan.toCreate] });
        }
        phase = 'INDEX_READBACK_FAILED';
        const final = await readModelPlan(connection, model);
        verifyReadback(plan, final);
        outcome.status = 'succeeded';
        outcome.terminalState = 'verified';
        outcome.collectionExists = true;
        outcome.finalIndexes = final.indexes;
      }
    }
  } catch (error: unknown) {
    failure = safeFailure(error, phase);
    if (active) active.status = 'failed';
    if (connection) {
      for (const [model, outcome] of touched) {
        try {
          const observed = await readModelMetadata(connection, model);
          outcome.terminalState = 'observed';
          outcome.collectionExists = !observed.createCollection;
          outcome.finalIndexes = observed.indexes;
        } catch (auditError: unknown) {
          outcome.terminalState = 'unconfirmed';
          outcome.auditError = safeFailure(
            auditError,
            'INDEX_FAILURE_AUDIT_FAILED',
          );
          delete outcome.collectionExists;
          delete outcome.finalIndexes;
        }
      }
    }
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error: unknown) {
        closeError = safeFailure(error, 'CONNECTION_CLOSE_FAILED');
      }
    }
  }

  const failed = !!(failure || closeError);
  const result = JSON.stringify({
    event: 'result',
    mode,
    databaseName,
    status: failed ? 'failed' : mode === 'apply' ? 'completed' : 'preview',
    models: outcomes,
    writesAttempted: touched.size > 0,
    partialEffectsPossible: !!failure && touched.size > 0,
    error: failure,
    closeError,
  });
  if (failed) deps.error(result);
  else deps.log(result);
  return failed ? 1 : 0;
}

if (require.main === module) {
  void runSyncIndexesCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        JSON.stringify({
          event: 'result',
          status: 'failed',
          error: { code: 'SYNC_INDEXES_FAILED' },
        }),
      );
      process.exitCode = 1;
    });
}
