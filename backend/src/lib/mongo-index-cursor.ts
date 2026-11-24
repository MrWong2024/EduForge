import mongoose, { type mongo } from 'mongoose';
import { withMongoOperationDeadline } from './mongo-operation-deadline';

const cursorCloseBudgetMs = 5_000;
const indexBsonOptions = {
  raw: false,
  promoteBuffers: false,
  promoteValues: true,
  promoteLongs: true,
  useBigInt64: false,
} as const;

function asDocument(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_INDEX_CURSOR_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function readCursorId(value: unknown) {
  const { Long } = mongoose.mongo.BSON;
  if (Long.isLong(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return Long.fromNumber(value);
  }
  throw new Error('INVALID_INDEX_CURSOR_ID');
}

async function closeIndexCursor(
  db: mongo.Db,
  collection: string,
  session: mongo.ClientSession,
  id: mongo.BSON.Long,
) {
  const result: unknown = await db.command(
    { killCursors: collection, cursors: [id] },
    {
      readPreference: 'primary',
      session,
      signal: AbortSignal.timeout(cursorCloseBudgetMs),
    },
  );
  const reply = asDocument(result);
  if (
    (!Array.isArray(reply.cursorsKilled) || !reply.cursorsKilled.length) &&
    (!Array.isArray(reply.cursorsNotFound) || !reply.cursorsNotFound.length)
  ) {
    throw new Error('INDEX_CURSOR_CLOSE_UNCONFIRMED');
  }
}

export async function readMongoIndexes(
  db: mongo.Db,
  collection: string,
  budgetMs: number,
  includeBuildUUIDs = false,
): Promise<unknown[]> {
  const session = db.client.startSession();
  let id: mongo.BSON.Long | undefined;
  try {
    return await withMongoOperationDeadline(budgetMs, async (deadline) => {
      // The typed listIndexes and runCursorCommand APIs do not expose a signal.
      const options: mongo.RunCommandOptions = {
        ...indexBsonOptions,
        readPreference: 'primary',
        session,
        signal: deadline.signal,
      };
      let command: mongo.Document = {
        listIndexes: collection,
        cursor: {},
        ...(includeBuildUUIDs && { includeBuildUUIDs: true }),
        maxTimeMS: deadline.remainingMs(),
      };
      let batchKey = 'firstBatch';
      const indexes: unknown[] = [];
      for (;;) {
        deadline.remainingMs();
        const response = asDocument(await db.command(command, options));
        const cursor = asDocument(response.cursor);
        if (cursor.ns !== `${db.databaseName}.${collection}`) {
          throw new Error('INVALID_INDEX_CURSOR_NAMESPACE');
        }
        id = readCursorId(cursor.id);
        const batch = cursor[batchKey];
        if (!Array.isArray(batch))
          throw new Error('INVALID_INDEX_CURSOR_BATCH');
        indexes.push(...(batch as unknown[]));
        deadline.remainingMs();
        if (id.isZero()) return indexes;
        command = { getMore: id, collection };
        batchKey = 'nextBatch';
      }
    });
  } finally {
    try {
      if (id && !id.isZero()) {
        await closeIndexCursor(db, collection, session, id);
      }
    } finally {
      await session.endSession();
    }
  }
}
