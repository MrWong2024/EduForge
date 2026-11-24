import type { Model, Types, mongo } from 'mongoose';
import type { User } from '../../src/modules/users/schemas/user.schema';
import { runAuthTestWrite } from './auth-test-writes';

export async function createFixtureUser(
  users: Model<User>,
  fixture: User & { _id: Types.ObjectId },
): Promise<void> {
  const db = users.db.db;
  if (!db) throw new Error('AUTH_TEST_DATABASE_REQUIRED');

  // UserSchema has no custom save hooks. Keep its casting, validation, defaults,
  // timestamps and initial version while using a cancellable native command.
  const user = new users(fixture);
  await user.validate();
  const row: mongo.Document = user.toBSON();
  users.applyTimestamps(row);
  const versionKey: unknown = users.schema.get('versionKey');
  if (typeof versionKey === 'string') row[versionKey] = 0;

  const collection = users.collection.name;
  await runAuthTestWrite(
    db,
    { insert: collection, documents: [row] },
    { collection, filter: { _id: fixture._id } },
  );
}
