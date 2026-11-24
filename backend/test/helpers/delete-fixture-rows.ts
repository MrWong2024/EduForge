import type { mongo } from 'mongoose';
import { runAuthTestWrite } from './auth-test-writes';

export async function deleteFixtureRows(
  db: mongo.Db,
  collection: string,
  filter: mongo.Document,
  limit: 0 | 1 = 1,
  budgetMs = 5000,
  serverMaxTimeMS?: number,
): Promise<void> {
  await runAuthTestWrite(
    db,
    { delete: collection, deletes: [{ q: filter, limit }] },
    { collection, filter },
    budgetMs,
    serverMaxTimeMS,
  );
}
