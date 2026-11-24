import type { mongo } from 'mongoose';
import { runMongoWriteCommand } from '../../src/lib/mongo-command';

export async function deleteFixtureRows(
  db: mongo.Db,
  collection: string,
  filter: mongo.Document,
  limit: 0 | 1 = 1,
  budgetMs = 5000,
): Promise<void> {
  await runMongoWriteCommand(
    db,
    { delete: collection, deletes: [{ q: filter, limit }] },
    budgetMs,
  );
}
