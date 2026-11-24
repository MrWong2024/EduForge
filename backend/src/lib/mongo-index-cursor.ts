import mongoose, { type mongo } from 'mongoose';
import { withMongoOperationDeadline } from './mongo-operation-deadline';

const indexBsonOptions = {
  raw: false,
  promoteBuffers: false,
  promoteValues: true,
  promoteLongs: true,
  useBigInt64: false,
} as const;

export class IndexCursorCloseUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super('INDEX_CURSOR_CLOSE_UNCONFIRMED', { cause });
  }
}

export async function readMongoIndexes(
  db: mongo.Db,
  collection: string,
  budgetMs: number,
  includeBuildUUIDs = false,
): Promise<unknown[]> {
  return withMongoOperationDeadline(budgetMs, async (deadline) => {
    // The driver cursor keeps the original server and session for getMore and close.
    const cursor = db.runCursorCommand(
      {
        listIndexes: collection,
        cursor: {},
        ...(includeBuildUUIDs && { includeBuildUUIDs: true }),
        maxTimeMS: deadline.remainingMs(),
      },
      { ...indexBsonOptions, readPreference: 'primary' },
    );
    let mayHaveOpenCursor = false;
    let failure: { error: unknown } | undefined;
    const indexes: unknown[] = [];
    try {
      for (;;) {
        deadline.remainingMs();
        mayHaveOpenCursor = true;
        // This API has no signal. Await the fetch before checking time or closing.
        const first: unknown = await cursor.tryNext();
        const id = cursor.id;
        mayHaveOpenCursor = id?.isZero() !== true;
        deadline.remainingMs();
        if (!id) throw new Error('INVALID_INDEX_CURSOR_ID');
        if (
          cursor.namespace.toString() !== `${db.databaseName}.${collection}`
        ) {
          throw new Error('INVALID_INDEX_CURSOR_NAMESPACE');
        }
        if (first !== null) indexes.push(first);
        const buffered: unknown[] = cursor.readBufferedDocuments();
        indexes.push(...buffered);
        if (id.isZero()) break;
      }
    } catch (error: unknown) {
      const collectionMissing =
        cursor.id === undefined &&
        error instanceof mongoose.mongo.MongoServerError &&
        error.code === 26;
      // Driver close can finish locally even if the server never confirms the kill.
      failure = {
        error:
          mayHaveOpenCursor && !collectionMissing
            ? new IndexCursorCloseUnconfirmedError(error)
            : error,
      };
    }
    try {
      await cursor.close();
    } catch (error: unknown) {
      failure ??= { error: new IndexCursorCloseUnconfirmedError(error) };
    }
    if (failure) throw failure.error;
    return indexes;
  });
}
