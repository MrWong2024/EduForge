import { Types, type Connection, type mongo } from 'mongoose';
import { PasswordResetToken } from '../../src/modules/auth/schemas/password-reset-token.schema';
import { Session } from '../../src/modules/auth/schemas/session.schema';
import { User } from '../../src/modules/users/schemas/user.schema';
import { runAuthTestWrite } from './auth-test-writes';

function writeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('AUTH_TEST_IMPORT_WRITE_COUNT_UNCONFIRMED');
  }
  return value;
}

export function budgetImportStoreWrites(
  connection: Connection,
  ownedIds: readonly Types.ObjectId[],
): void {
  const db = connection.db;
  if (!db) throw new Error('AUTH_TEST_IMPORT_CONNECTION_REQUIRED');

  const users = connection.model<User>(User.name).collection;
  const sessions = connection.model<Session>(Session.name).collection;
  const tokens = connection.model<PasswordResetToken>(
    PasswordResetToken.name,
  ).collection;

  function targetFor(
    collection: string,
    filter: mongo.Document,
    key: '_id' | 'userId',
  ) {
    const id: unknown = filter[key];
    if (
      !(id instanceof Types.ObjectId) ||
      !ownedIds.some((owned) => owned.equals(id))
    ) {
      throw new Error('AUTH_TEST_IMPORT_FIXTURE_TARGET_REQUIRED');
    }
    return { collection, filter: { [key]: id } };
  }

  // These are the collections of the independent Store connection. The
  // real models still cast and validate their updates before dispatch here.
  const update =
    (collection: string, key: '_id' | 'userId', multi: boolean) =>
    async (
      q: mongo.Document,
      u: mongo.Document | mongo.Document[],
      options?: mongo.UpdateOptions,
    ): Promise<mongo.UpdateResult> => {
      const reply = await runAuthTestWrite(
        db,
        {
          update: collection,
          updates: [{ q, u, multi }],
          writeConcern: options?.writeConcern,
        },
        targetFor(collection, q, key),
        undefined,
        options?.maxTimeMS,
      );
      return {
        acknowledged: true,
        matchedCount: writeCount(reply.n),
        modifiedCount: writeCount(reply.nModified),
        upsertedCount: 0,
        upsertedId: null,
      };
    };

  users.updateOne = update(users.collectionName, '_id', false);
  tokens.updateMany = update(tokens.collectionName, 'userId', true);
  sessions.deleteMany = async (q, options) => {
    if (!q) throw new Error('AUTH_TEST_IMPORT_FIXTURE_TARGET_REQUIRED');
    const collection = sessions.collectionName;
    const reply = await runAuthTestWrite(
      db,
      {
        delete: collection,
        deletes: [{ q, limit: 0 }],
        writeConcern: options?.writeConcern,
      },
      targetFor(collection, q, 'userId'),
      undefined,
      options?.maxTimeMS,
    );
    return { acknowledged: true, deletedCount: writeCount(reply.n) };
  };
}
