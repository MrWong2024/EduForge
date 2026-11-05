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
import {
  parseSyncIndexesArguments,
  resolveSyncIndexesConfig,
  SyncIndexesError,
} from './sync-indexes-config';
import { SYNC_INDEX_SCHEMAS } from './sync-indexes-models';

const CONNECTION_OPTIONS = {
  autoCreate: false,
  autoIndex: false,
  promoteValues: true,
  promoteLongs: true,
  useBigInt64: false,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 70000,
  timeoutMS: 65000,
  retryReads: false,
  retryWrites: false,
  readPreference: 'primary',
} as const;

export type SyncIndexDefinition = [IndexDefinition, IndexOptions];
export type CollectionMetadata = {
  collation: Record<string, unknown> | undefined;
};

type IndexDiff = {
  toDrop: string[];
  toCreate: SyncIndexDefinition[];
};

export interface SyncIndexModel {
  name: string;
  collectionName: string;
  listIndexes(this: void): Promise<mongo.IndexDescriptionInfo[]>;
  schemaIndexes(this: void): SyncIndexDefinition[];
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
  directConnection(this: void): boolean | undefined;
  writeConcernW(this: void): mongo.WriteConcern['w'] | undefined;
  models(this: void): readonly SyncIndexModel[];
  collectionMetadata(
    this: void,
    name: string,
  ): Promise<CollectionMetadata | null>;
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDocument(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null || Reflect.getPrototypeOf(prototype) === null;
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

function readIndexDescription(index: unknown): mongo.IndexDescriptionInfo {
  if (
    !isRecord(index) ||
    typeof index.name !== 'string' ||
    !isRecord(index.key)
  ) {
    throw new SyncIndexesError('INVALID_INDEX_METADATA');
  }
  return index as mongo.IndexDescriptionInfo;
}

async function listReadyIndexes(
  db: mongo.Db,
  collectionName: string,
): Promise<mongo.IndexDescriptionInfo[]> {
  // A plain listIndexes response can include an in-progress build without marking it.
  const cursor = db.runCursorCommand(
    {
      listIndexes: collectionName,
      cursor: {},
      includeBuildUUIDs: true,
    },
    {
      promoteValues: CONNECTION_OPTIONS.promoteValues,
      promoteLongs: CONNECTION_OPTIONS.promoteLongs,
      useBigInt64: CONNECTION_OPTIONS.useBigInt64,
      timeoutMS: CONNECTION_OPTIONS.timeoutMS,
      timeoutMode: 'cursorLifetime',
    },
  );
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
      return readIndexDescription(index);
    });
  } finally {
    await cursor.close();
  }
}

function assertSupportedIndexDirections(key: Record<string, unknown>) {
  if (
    Object.values(key).some(
      (direction) =>
        direction !== 1 && direction !== -1 && typeof direction !== 'string',
    )
  ) {
    throw new SyncIndexesError('INDEX_KEY_DIRECTION_UNSUPPORTED');
  }
}

function normalizeSubmissionPartialFilter(filter: unknown) {
  if (!isDocument(filter)) return;
  const keys = Reflect.ownKeys(filter);
  if (keys.length !== 1 || keys[0] !== 'classroomTaskId') return;

  const condition = filter.classroomTaskId;
  if (condition === null) return { classroomTaskId: null };
  if (!isDocument(condition)) return;
  const operators = Reflect.ownKeys(condition);
  if (operators.length !== 1) return;

  if (operators[0] === '$eq' && condition.$eq === null) {
    return { classroomTaskId: null };
  }
  if (
    operators[0] === '$type' &&
    (condition.$type === 'objectId' || condition.$type === 7)
  ) {
    return { classroomTaskId: { $type: 'objectId' } };
  }
}

function copyComparisonOptions<
  T extends { sparse?: boolean; partialFilterExpression?: unknown },
>(options: T): T {
  const copy = { ...options };
  if (copy.sparse === false) delete copy.sparse;
  const filter = normalizeSubmissionPartialFilter(copy.partialFilterExpression);
  if (filter !== undefined) copy.partialFilterExpression = filter;
  return copy;
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
    const modelSchema = model.schema;
    const readDatabaseIndexes = model.listIndexes.bind(
      model,
    ) as typeof model.listIndexes;
    const readSchemaIndexes = modelSchema.indexes.bind(
      modelSchema,
    ) as typeof modelSchema.indexes;
    // Mongoose compares these copies. The raw metadata still drives drift checks and reports.
    model.listIndexes = async (...args) => {
      const indexes: unknown[] = await readDatabaseIndexes(...args);
      return indexes.map((entry) => {
        const index = readIndexDescription(entry);
        assertSupportedIndexDirections(index.key);
        const copy = copyComparisonOptions(index);
        copy.key = { ...index.key };
        return copy;
      });
    };
    modelSchema.indexes = (...args) =>
      readSchemaIndexes(...args).map(([key, options]): SyncIndexDefinition => {
        assertSupportedIndexDirections(key);
        return [{ ...key }, copyComparisonOptions(options)];
      });
    return {
      name,
      collectionName,
      listIndexes: () =>
        listReadyIndexes(connectedDb(connection), collectionName),
      schemaIndexes: () => readSchemaIndexes(),
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
    directConnection: () => connection.getClient().options.directConnection,
    writeConcernW: () => connection.getClient().writeConcern?.w,
    models: () => registerSyncIndexModels(connection),
    collectionMetadata: async (name) => {
      const cursor = connectedDb(connection).listCollections({ name });
      try {
        const entry: unknown = await cursor.next();
        if (entry === null) return null;
        if (
          !isDocument(entry) ||
          entry.name !== name ||
          typeof entry.type !== 'string' ||
          entry.type.length === 0
        ) {
          throw new SyncIndexesError('COLLECTION_METADATA_INVALID');
        }
        if (entry.type !== 'collection') {
          throw new SyncIndexesError('COLLECTION_TYPE_UNSUPPORTED');
        }
        if (!isDocument(entry.options)) {
          throw new SyncIndexesError('COLLECTION_METADATA_INVALID');
        }
        if (!('collation' in entry.options)) return { collation: undefined };
        const { collation } = entry.options;
        if (
          !isDocument(collation) ||
          typeof collation.locale !== 'string' ||
          !collation.locale.trim()
        ) {
          throw new SyncIndexesError('COLLECTION_METADATA_INVALID');
        }
        return { collation };
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
  };
}

type ModelPlan = IndexDiff & {
  createCollection: boolean;
  collectionCollation: 'simple' | null;
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

async function readIndexMetadata(
  model: SyncIndexModel,
  collectionExists: boolean,
) {
  const indexes = collectionExists ? await model.listIndexes() : [];
  if (
    indexes.some((index) => !index.name) ||
    new Set(indexes.map((index) => index.name)).size !== indexes.length
  ) {
    throw new SyncIndexesError('INVALID_INDEX_METADATA');
  }
  return [...indexes].sort((left, right) =>
    (left.name ?? '').localeCompare(right.name ?? ''),
  );
}

function assertSupportedCollectionCollation(
  collation: CollectionMetadata['collation'],
) {
  if (collation && collation.locale !== 'simple') {
    throw new SyncIndexesError('COLLECTION_COLLATION_UNSUPPORTED');
  }
}

async function readModelPlan(
  connection: SyncIndexesConnection,
  model: SyncIndexModel,
): Promise<ModelPlan> {
  const collection = await connection.collectionMetadata(model.collectionName);
  assertSupportedCollectionCollation(collection?.collation);
  const indexes = await readIndexMetadata(model, collection !== null);
  const schemaIndexes = model.schemaIndexes();
  // Mongoose's text-index comparison can match a non-text Schema index.
  if (
    indexes.some(
      (index) =>
        'textIndexVersion' in index ||
        'weights' in index ||
        Object.values(index.key).includes('text'),
    ) ||
    schemaIndexes.some(([key]) => Object.values(key).includes('text'))
  ) {
    throw new SyncIndexesError('TEXT_INDEX_UNSUPPORTED');
  }
  if (
    indexes.some((index) => index.hidden === true) ||
    schemaIndexes.some(([, options]) => options.hidden === true)
  ) {
    throw new SyncIndexesError('HIDDEN_INDEX_UNSUPPORTED');
  }
  if (
    indexes.some(
      (index) => 'prepareUnique' in index && index.prepareUnique === true,
    ) ||
    schemaIndexes.some(
      ([, options]) =>
        'prepareUnique' in options && options.prepareUnique === true,
    )
  ) {
    throw new SyncIndexesError('PREPARE_UNIQUE_UNSUPPORTED');
  }
  for (const { key } of indexes) assertSupportedIndexDirections(key);
  for (const [key] of schemaIndexes) assertSupportedIndexDirections(key);
  // Mongoose treats NamespaceNotFound as an empty index set.
  const diff = await model.diffIndexes({ indexOptionsToCreate: true });
  const names = new Set(indexes.map((index) => index.name));
  if (
    new Set(diff.toDrop).size !== diff.toDrop.length ||
    diff.toDrop.some((name) => !names.has(name) || name === '_id_')
  ) {
    throw new SyncIndexesError('INDEX_PLAN_DRIFT');
  }
  return {
    createCollection: collection === null,
    collectionCollation: collection === null ? null : 'simple',
    indexes,
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
].join('\n');

export async function runSyncIndexesCli(
  argv: readonly string[] = process.argv.slice(2),
  overrides: Partial<SyncIndexesDependencies> = {},
): Promise<number> {
  const deps = { ...defaultDependencies(), ...overrides };
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
    if (connection.directConnection() === true) {
      throw new SyncIndexesError('DIRECT_CONNECTION_UNSUPPORTED');
    }
    if (options.apply && connection.writeConcernW() === 0) {
      throw new SyncIndexesError('UNACKNOWLEDGED_WRITE_CONCERN');
    }

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
          if (plan.createCollection) {
            await model.createCollection();
            const created = await connection.collectionMetadata(
              model.collectionName,
            );
            if (created === null)
              throw new SyncIndexesError('INDEX_READBACK_MISMATCH');
            assertSupportedCollectionCollation(created.collation);
          }
          for (const name of plan.toDrop) {
            await model.cleanIndexes({ toDrop: [name] });
          }
          // Mongoose consumes the supplied array and continues after item errors.
          for (const definition of plan.toCreate) {
            await model.createIndexes({ toCreate: [definition] });
          }
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
          const collection = await connection.collectionMetadata(
            model.collectionName,
          );
          const observed = await readIndexMetadata(model, collection !== null);
          outcome.terminalState = 'observed';
          outcome.collectionExists = collection !== null;
          outcome.finalIndexes = observed;
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
