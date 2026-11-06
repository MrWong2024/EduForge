import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
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
  raw: false,
  promoteBuffers: false,
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
  uuid: string;
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
    indexes: readonly mongo.IndexDescriptionInfo[],
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
  assertSupportedTopology(this: void): Promise<void>;
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
  log(this: void, message: string): void | Promise<void>;
  error(this: void, message: string): void | Promise<void>;
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
      promoteBuffers: CONNECTION_OPTIONS.promoteBuffers,
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
  const fields = Object.keys(key);
  // BSON preserves key order, but JS objects move array-index keys to the front.
  if (
    fields.length > 1 &&
    fields.some(
      (field) => /^(0|[1-9]\d*)$/.test(field) && Number(field) < 2 ** 32 - 1,
    )
  ) {
    throw new SyncIndexesError('INDEX_KEY_ORDER_UNSUPPORTED');
  }
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

class UnsupportedIndexError extends SyncIndexesError {
  constructor(
    code: string,
    readonly indexName: string | undefined,
  ) {
    super(code);
  }
}

function assertSupportedPartialFilter(
  filter: unknown,
  indexName: string | undefined,
) {
  if (
    filter !== undefined &&
    normalizeSubmissionPartialFilter(filter) === undefined
  ) {
    throw new UnsupportedIndexError('PARTIAL_FILTER_UNSUPPORTED', indexName);
  }
}

export function registerSyncIndexModels(
  connection: Connection,
  schemas = SYNC_INDEX_SCHEMAS,
): SyncIndexModel[] {
  for (const { schema } of schemas) {
    const collation: unknown = schema.options.collation;
    if (
      collation !== undefined &&
      (!isDocument(collation) ||
        Reflect.ownKeys(collation).length !== 1 ||
        !Object.hasOwn(collation, 'locale') ||
        collation.locale !== 'simple')
    ) {
      throw new SyncIndexesError('SCHEMA_COLLATION_UNSUPPORTED');
    }
  }
  return schemas.map(({ name, schema }) => {
    const isolatedSchema = schema.clone();
    isolatedSchema.set('autoCreate', false);
    isolatedSchema.set('autoIndex', false);
    const model = connection.model(name, isolatedSchema);
    const collectionName = model.collection.name;
    const modelSchema = model.schema;
    const readSchemaIndexes = modelSchema.indexes.bind(
      modelSchema,
    ) as typeof modelSchema.indexes;
    // The isolated model compares copies; the snapshot remains evidence of what was read.
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
      diffIndexes: async (options, indexes) => {
        const originalListIndexes = model.listIndexes.bind(
          model,
        ) as typeof model.listIndexes;
        let result: Awaited<ReturnType<typeof model.diffIndexes>>;
        model.listIndexes = () =>
          Promise.resolve(
            indexes.map((index) => ({
              ...copyComparisonOptions(index),
              key: { ...index.key },
            })),
          );
        try {
          result = await model.diffIndexes(options);
        } finally {
          model.listIndexes = originalListIndexes;
        }
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

export function createMongooseConnection(
  uri: string,
  options: typeof CONNECTION_OPTIONS,
  schemas = SYNC_INDEX_SCHEMAS,
  checkServer?: (db: mongo.Db, client: mongo.MongoClient) => Promise<void>,
): SyncIndexesConnection {
  const connection = mongoose.createConnection(uri, options);
  return {
    ready: async () => {
      await connection.asPromise();
    },
    databaseName: () => connection.db?.databaseName,
    directConnection: () => connection.getClient().options.directConnection,
    writeConcernW: () => connection.getClient().writeConcern?.w,
    assertSupportedTopology: async () => {
      const db = connectedDb(connection);
      const hello: unknown = await db.command({ hello: 1 });
      if (!isRecord(hello) || hello.ok !== 1) {
        throw new SyncIndexesError('TOPOLOGY_CHECK_FAILED');
      }
      if (hello.msg === 'isdbgrid') {
        throw new SyncIndexesError('SHARDED_TOPOLOGY_UNSUPPORTED');
      }
      await checkServer?.(db, connection.getClient());
    },
    models: () => registerSyncIndexModels(connection, schemas),
    collectionMetadata: async (name) => {
      const cursor = connectedDb(connection).listCollections(
        { name },
        { promoteBuffers: CONNECTION_OPTIONS.promoteBuffers },
      );
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
        if ('encryptedFields' in entry.options) {
          throw new SyncIndexesError('ENCRYPTED_COLLECTION_UNSUPPORTED');
        }
        if ('clusteredIndex' in entry.options) {
          throw new SyncIndexesError('CLUSTERED_COLLECTION_UNSUPPORTED');
        }
        const uuid = isDocument(entry.info) ? entry.info.uuid : undefined;
        if (
          !(uuid instanceof mongoose.mongo.BSON.Binary) ||
          uuid.sub_type !== mongoose.mongo.BSON.Binary.SUBTYPE_UUID ||
          uuid.length() !== 16
        ) {
          throw new SyncIndexesError('COLLECTION_UUID_INVALID');
        }
        const uuidHex = uuid.toUUID().toHexString(false);
        if (!('collation' in entry.options))
          return { uuid: uuidHex, collation: undefined };
        const { collation } = entry.options;
        if (
          !isDocument(collation) ||
          typeof collation.locale !== 'string' ||
          !collation.locale.trim()
        ) {
          throw new SyncIndexesError('COLLECTION_METADATA_INVALID');
        }
        return { uuid: uuidHex, collation };
      } finally {
        await cursor.close();
      }
    },
    close: async () => {
      await connection.close();
    },
  };
}

export function writeSyncIndexesLine(stream: Writable, message: string) {
  return new Promise<void>((resolveWrite, reject) => {
    const onError = (error: Error) => reject(error);
    stream.once('error', onError);
    try {
      stream.write(`${message}\n`, (error) => {
        if (error) {
          // Writable can emit the paired error after calling the callback.
          setImmediate(() => stream.off('error', onError));
          reject(error);
        } else {
          stream.off('error', onError);
          resolveWrite();
        }
      });
    } catch (error: unknown) {
      stream.off('error', onError);
      reject(error instanceof Error ? error : new Error('STREAM_WRITE_FAILED'));
    }
  });
}

function defaultDependencies(): SyncIndexesDependencies {
  return {
    env: process.env,
    backendDirectory: resolve(__dirname, '..'),
    readFile: (path) => readFileSync(path, 'utf8'),
    createConnection: createMongooseConnection,
    log: (message) => writeSyncIndexesLine(process.stdout, message),
    error: (message) => writeSyncIndexesLine(process.stderr, message),
  };
}

type ModelState = {
  collection: CollectionMetadata | null;
  indexes: mongo.IndexDescriptionInfo[];
};

type ModelPlan = ModelState & IndexDiff & { expected: SyncIndexDefinition[] };

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

async function readModelState(
  connection: SyncIndexesConnection,
  model: SyncIndexModel,
): Promise<ModelState> {
  const collection = await connection.collectionMetadata(model.collectionName);
  const indexes = await readCollectionIndexes(model, collection);
  return { collection, indexes };
}

function readCollectionIndexes(
  model: SyncIndexModel,
  collection: CollectionMetadata | null,
) {
  assertSupportedCollectionCollation(collection?.collation);
  return readIndexMetadata(model, collection !== null);
}

function defaultIndexName(key: IndexDefinition) {
  return Object.entries(key).flat().join('_');
}

function assertSupportedIndexes(
  indexes: mongo.IndexDescriptionInfo[],
  schemaIndexes: SyncIndexDefinition[],
) {
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
  for (const index of indexes) {
    assertSupportedIndexDirections(index.key);
    assertSupportedPartialFilter(index.partialFilterExpression, index.name);
  }
  for (const [key, options] of schemaIndexes) {
    assertSupportedIndexDirections(key);
    if (options.name !== undefined) {
      throw new UnsupportedIndexError(
        'SCHEMA_INDEX_NAME_UNSUPPORTED',
        options.name,
      );
    }
    const name = defaultIndexName(key);
    if (
      options.collation !== undefined &&
      (!isDocument(options.collation) || options.collation.locale !== 'simple')
    ) {
      throw new UnsupportedIndexError(
        'SCHEMA_INDEX_COLLATION_UNSUPPORTED',
        name,
      );
    }
    assertSupportedPartialFilter(options.partialFilterExpression, name);
  }
}

function isHashedIdIndex(index: mongo.IndexDescriptionInfo) {
  return isDeepStrictEqual(Object.entries(index.key), [['_id', 'hashed']]);
}

async function readModelPlan(
  connection: SyncIndexesConnection,
  model: SyncIndexModel,
): Promise<ModelPlan> {
  const state = await readModelState(connection, model);
  const { indexes } = state;
  const expected = model.schemaIndexes();
  assertSupportedIndexes(indexes, expected);
  const diff = await model.diffIndexes({ indexOptionsToCreate: true }, indexes);
  const manualNames = new Set(
    indexes.filter(isHashedIdIndex).map(({ name }) => name),
  );
  const toDrop = diff.toDrop.filter((name) => !manualNames.has(name));
  const names = new Set(indexes.map((index) => index.name));
  if (
    new Set(diff.toDrop).size !== diff.toDrop.length ||
    diff.toDrop.some(
      (name) => !names.has(name) || name === '_id_' || name === '*',
    )
  ) {
    throw new SyncIndexesError('INDEX_PLAN_DRIFT');
  }
  const dropping = new Set(toDrop);
  const retainedNames = new Set(
    indexes.map(({ name }) => name ?? '').filter((name) => !dropping.has(name)),
  );
  retainedNames.add('_id_');
  for (const [key, options] of diff.toCreate) {
    const name = options.name ?? defaultIndexName(key);
    if (name === '*' || retainedNames.has(name)) {
      throw new SyncIndexesError('INDEX_NAME_CONFLICT');
    }
    retainedNames.add(name);
  }
  return {
    ...state,
    expected,
    toDrop: toDrop.sort(),
    toCreate: [...diff.toCreate],
  };
}

const snapshot = (value: unknown) =>
  mongoose.mongo.BSON.EJSON.stringify(value, { relaxed: false });

function isDefaultIdIndex(index: mongo.IndexDescriptionInfo) {
  return (
    index.name === '_id_' &&
    isDeepStrictEqual(Object.entries(index.key), [['_id', 1]])
  );
}

function matchesIndex(
  [key, options]: SyncIndexDefinition,
  index: mongo.IndexDescriptionInfo,
) {
  const expected = copyComparisonOptions(options);
  const actual = copyComparisonOptions(index);
  return (
    (expected.name === undefined || expected.name === actual.name) &&
    isDeepStrictEqual(Object.entries(key), Object.entries(index.key)) &&
    (expected.unique === true) === (actual.unique === true) &&
    expected.expireAfterSeconds === actual.expireAfterSeconds &&
    expected.sparse === actual.sparse &&
    snapshot(expected.partialFilterExpression ?? null) ===
      snapshot(actual.partialFilterExpression ?? null) &&
    isDeepStrictEqual(
      expected.collation ?? { locale: 'simple' },
      actual.collation ?? { locale: 'simple' },
    )
  );
}

type SafeFailure = { code: string; driverCode?: number; indexName?: string };
function safeFailure(error: unknown, fallback: string): SafeFailure {
  if (
    (error instanceof SyncIndexesError || error instanceof DatabaseGateError) &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
  ) {
    return error instanceof UnsupportedIndexError &&
      error.indexName !== undefined
      ? { code: error.code, indexName: error.indexName }
      : { code: error.code };
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

type IndexDefinitionReport = { key: IndexDefinition; options: IndexOptions };
type Operation = (
  | { kind: 'createCollection' }
  | { kind: 'dropIndex'; name: string }
  | ({ kind: 'createIndex' } & IndexDefinitionReport)
) & { status: 'completed' | 'failed' | 'not-executed'; error?: SafeFailure };

type IndexDifferences = {
  missingCollection?: true;
  collectionUuidChanged?: { expected: string; actual: string };
  missingDefaultIndex?: true;
  missingIndexes: IndexDefinitionReport[];
  extraIndexes: mongo.IndexDescriptionInfo[];
};

type ModelOutcome = {
  model: string;
  collection: string;
  status: 'preview' | 'succeeded' | 'failed' | 'not-executed';
  operations: Operation[];
  terminalState?: 'verified' | 'observed' | 'unconfirmed';
  collectionExists?: boolean;
  collectionUuid?: string;
  finalIndexes?: mongo.IndexDescriptionInfo[];
  verification?:
    | { status: 'passed' }
    | { status: 'different'; differences: IndexDifferences }
    | {
        status: 'unconfirmed';
        error: SafeFailure;
        collectionUuidChanged?: IndexDifferences['collectionUuidChanged'];
      };
};

type PlannedModel = {
  model: SyncIndexModel;
  outcome: ModelOutcome;
  plan: ModelPlan;
  original: string;
  expectedUuid: string | undefined;
};

function planOperations(plan: ModelPlan) {
  const operations: Operation[] = [];
  if (!plan.collection) {
    operations.push({ kind: 'createCollection', status: 'not-executed' });
  }
  for (const name of plan.toDrop) {
    operations.push({ kind: 'dropIndex', name, status: 'not-executed' });
  }
  for (const [key, options] of plan.toCreate) {
    operations.push({
      kind: 'createIndex',
      key,
      options,
      status: 'not-executed',
    });
  }
  return operations;
}

async function executeModelPlan(
  connection: SyncIndexesConnection,
  entry: PlannedModel,
) {
  const { model, outcome, original } = entry;
  try {
    if (snapshot(await readModelPlan(connection, model)) !== original) {
      throw new SyncIndexesError('INDEX_PLAN_DRIFT');
    }
  } catch (error: unknown) {
    outcome.status = 'failed';
    return safeFailure(error, 'INDEX_PREFLIGHT_FAILED');
  }

  for (const operation of outcome.operations) {
    try {
      switch (operation.kind) {
        case 'createCollection':
          await model.createCollection();
          break;
        case 'dropIndex':
          await model.cleanIndexes({ toDrop: [operation.name] });
          break;
        case 'createIndex':
          // Mongoose may continue after item errors when it receives multiple definitions.
          await model.createIndexes({
            toCreate: [[operation.key, operation.options]],
          });
          break;
      }
      operation.status = 'completed';
      if (operation.kind === 'createCollection') {
        const created = await connection.collectionMetadata(
          model.collectionName,
        );
        if (!created) throw new SyncIndexesError('CREATED_COLLECTION_MISSING');
        entry.expectedUuid = created.uuid;
        assertSupportedCollectionCollation(created.collation);
      }
    } catch (error: unknown) {
      const failure = safeFailure(error, 'INDEX_APPLY_FAILED');
      outcome.status = 'failed';
      if (operation.status !== 'completed') {
        operation.status = 'failed';
        operation.error = failure;
      }
      return failure;
    }
  }
  outcome.status = 'succeeded';
}

async function verifyModel(
  connection: SyncIndexesConnection,
  entry: PlannedModel,
) {
  const { model, outcome, plan, expectedUuid } = entry;
  let collectionUuidChanged: IndexDifferences['collectionUuidChanged'];
  try {
    const collection = await connection.collectionMetadata(
      model.collectionName,
    );
    outcome.collectionExists = collection !== null;
    outcome.collectionUuid = collection?.uuid;
    if (
      collection &&
      expectedUuid !== undefined &&
      collection.uuid !== expectedUuid
    ) {
      collectionUuidChanged = {
        expected: expectedUuid,
        actual: collection.uuid,
      };
    }
    const indexes = await readCollectionIndexes(model, collection);
    assertSupportedIndexes(indexes, plan.expected);
    outcome.finalIndexes = indexes;
    if (collection && expectedUuid === undefined) {
      throw new SyncIndexesError('COLLECTION_IDENTITY_UNCONFIRMED');
    }

    const extras = indexes.filter((index) => !isDefaultIdIndex(index));
    const missingIndexes = plan.expected.flatMap((definition) => {
      const match = extras.findIndex((index) =>
        matchesIndex(definition, index),
      );
      if (match === -1) {
        const [key, options] = definition;
        return [{ key, options }];
      }
      extras.splice(match, 1);
      return [];
    });
    const differences: IndexDifferences = {
      missingIndexes,
      extraIndexes: extras,
    };
    if (!collection) differences.missingCollection = true;
    if (collectionUuidChanged)
      differences.collectionUuidChanged = collectionUuidChanged;
    if (collection && !indexes.some(isDefaultIdIndex))
      differences.missingDefaultIndex = true;

    if (
      differences.missingCollection ||
      differences.collectionUuidChanged ||
      differences.missingDefaultIndex ||
      missingIndexes.length ||
      extras.length
    ) {
      outcome.terminalState = 'observed';
      outcome.verification = { status: 'different', differences };
    } else {
      outcome.terminalState = 'verified';
      outcome.verification = { status: 'passed' };
    }
  } catch (error: unknown) {
    outcome.terminalState = 'unconfirmed';
    outcome.verification = {
      status: 'unconfirmed',
      error: safeFailure(error, 'INDEX_READBACK_FAILED'),
      ...(collectionUuidChanged && { collectionUuidChanged }),
    };
  }
}

function summarizeOutcome(outcome: ModelOutcome) {
  const {
    model,
    collection,
    status,
    operations,
    terminalState,
    collectionExists,
    collectionUuid,
    verification,
  } = outcome;
  return {
    model,
    collection,
    status,
    terminalState,
    collectionExists,
    collectionUuid,
    operations: operations.map((operation) => ({
      kind: operation.kind,
      status: operation.status,
      error: operation.error,
      ...(operation.kind === 'dropIndex' && { name: operation.name }),
    })),
    verification: verification && {
      status: verification.status,
      ...(verification.status === 'unconfirmed' && {
        error: verification.error,
        collectionUuidChanged: verification.collectionUuidChanged,
      }),
      ...(verification.status === 'different' && {
        collectionUuidChanged: verification.differences.collectionUuidChanged,
      }),
    },
  };
}

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
  const outcomes: ModelOutcome[] = [];
  try {
    const options = parseSyncIndexesArguments(argv);
    if (options.help) {
      phase = 'HELP_OUTPUT_FAILED';
      await deps.log(HELP);
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
    await connection.assertSupportedTopology();

    phase = 'INDEX_PREFLIGHT_FAILED';
    const models = connection.models();
    validateModels(models);
    const work = models.map((model) => {
      const outcome: ModelOutcome = {
        model: model.name,
        collection: model.collectionName,
        status: 'not-executed',
        operations: [],
      };
      outcomes.push(outcome);
      return { model, outcome };
    });

    const plans: PlannedModel[] = [];
    for (const { model, outcome } of work) {
      try {
        const plan = await readModelPlan(connection, model);
        outcome.operations = planOperations(plan);
        plans.push({
          model,
          outcome,
          plan,
          original: snapshot(plan),
          expectedUuid: plan.collection?.uuid,
        });
      } catch (error: unknown) {
        outcome.status = 'failed';
        throw error;
      }
    }
    const planMessage = snapshot({
      event: 'plan',
      mode,
      databaseName,
      models: plans.map(({ outcome, plan }) => ({
        model: outcome.model,
        collection: outcome.collection,
        createCollection: plan.collection === null,
        collectionUuid: plan.collection?.uuid,
        toDrop: plan.indexes.filter((index) =>
          plan.toDrop.includes(index.name ?? ''),
        ),
        toCreate: plan.toCreate.map(([key, options]) => ({ key, options })),
        manualReview: plan.indexes
          .filter(isHashedIdIndex)
          .map(({ name, key }) => ({ name, key })),
      })),
    });
    phase = 'PLAN_OUTPUT_FAILED';
    await deps.log(planMessage);
    phase = 'INDEX_APPLY_FAILED';

    if (!options.apply) {
      for (const outcome of outcomes) outcome.status = 'preview';
    } else {
      if (!options.allowDrop && plans.some(({ plan }) => plan.toDrop.length)) {
        failure = { code: 'DROP_CONFIRMATION_REQUIRED' };
      } else {
        for (const entry of plans) {
          failure = await executeModelPlan(connection, entry);
          if (failure) break;
        }
      }
      for (const entry of plans) await verifyModel(connection, entry);
    }
  } catch (error: unknown) {
    failure = safeFailure(error, phase);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error: unknown) {
        closeError = safeFailure(error, 'CONNECTION_CLOSE_FAILED');
      }
    }
  }

  const verificationFailed = outcomes.some(
    ({ verification }) => verification && verification.status !== 'passed',
  );
  const failed = !!(failure || closeError || verificationFailed);
  const writesAttempted = outcomes.some(({ operations }) =>
    operations.some(({ status }) => status !== 'not-executed'),
  );
  const resultFields = {
    event: 'result' as const,
    mode,
    databaseName,
    writesAttempted,
    partialEffectsPossible:
      !!(failure || verificationFailed) && writesAttempted,
    error: failure,
    closeError,
  };
  const result = {
    ...resultFields,
    status: failed ? 'failed' : mode === 'apply' ? 'completed' : 'preview',
    models: outcomes,
  };
  const summary = (
    code: 'REPORT_SERIALIZATION_FAILED' | 'RESULT_OUTPUT_FAILED',
  ) =>
    JSON.stringify({
      ...resultFields,
      status: 'failed',
      models: outcomes.map(summarizeOutcome),
      reportError: { code, rawMetadataOmitted: true },
    });
  let message: string;
  let serializationFailed = false;
  try {
    message = snapshot(result);
  } catch {
    message = summary('REPORT_SERIALIZATION_FAILED');
    serializationFailed = true;
  }
  const useErrorStream = failed || serializationFailed;
  try {
    await (useErrorStream ? deps.error(message) : deps.log(message));
  } catch {
    const fallback = serializationFailed
      ? message
      : summary('RESULT_OUTPUT_FAILED');
    try {
      await (useErrorStream ? deps.log(fallback) : deps.error(fallback));
    } catch {
      // Neither output stream can deliver the result.
    }
    return 1;
  }
  return useErrorStream ? 1 : 0;
}

if (require.main === module) {
  void runSyncIndexesCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(async () => {
      process.exitCode = 1;
      try {
        await writeSyncIndexesLine(
          process.stderr,
          JSON.stringify({
            event: 'result',
            status: 'failed',
            error: { code: 'SYNC_INDEXES_FAILED' },
          }),
        );
      } catch {
        // A broken stderr cannot deliver the last-resort result.
      }
    });
}
