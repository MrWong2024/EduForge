import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mongo } from 'mongoose';
import {
  MongoWriteCommandRejectedError,
  runMongoWriteCommand,
} from '../../src/lib/mongo-command';
import { withMongoOperationDeadline } from '../../src/lib/mongo-operation-deadline';

type OwnedWriteTarget = {
  collection: string;
  filter: mongo.Document;
};

const unconfirmedWrites = new WeakMap<mongo.Db, Error>();

export function assertAuthTestWritesConfirmed(db: mongo.Db): void {
  const unconfirmed = unconfirmedWrites.get(db);
  if (unconfirmed) throw unconfirmed;
}

function ownedIds(filter: mongo.Document): string[] {
  const selector: unknown = filter._id ?? filter.userId;
  const values: unknown[] =
    typeof selector === 'object' &&
    selector !== null &&
    '$in' in selector &&
    Array.isArray(selector.$in)
      ? selector.$in
      : [selector];
  return values
    .filter((value): value is mongo.ObjectId => value instanceof mongo.ObjectId)
    .map((value) => value.toHexString());
}

async function inspectUnconfirmedWrite(
  db: mongo.Db,
  target: OwnedWriteTarget,
  comment: string,
) {
  return withMongoOperationDeadline(5000, async (deadline) => {
    for (;;) {
      deadline.remainingMs();
      const reply: unknown = await db.client
        .db('admin')
        .command(
          { currentOp: 1, active: true, 'command.comment': comment },
          { readPreference: 'primary', signal: deadline.signal },
        );
      if (
        typeof reply !== 'object' ||
        reply === null ||
        !('inprog' in reply) ||
        !Array.isArray(reply.inprog)
      ) {
        throw new Error('AUTH_TEST_WRITE_ACTIVITY_UNAVAILABLE');
      }
      if (reply.inprog.length === 0) break;
      await delay(50, undefined, { signal: deadline.signal });
    }
    return db.collection(target.collection).countDocuments(target.filter, {
      maxTimeMS: deadline.remainingMs(),
      signal: deadline.signal,
      readPreference: 'primary',
    });
  });
}

export function runAuthTestWrite(
  db: mongo.Db,
  command: mongo.Document,
  target: OwnedWriteTarget,
  budgetMs = 10000,
  serverMaxTimeMS?: number,
): Promise<mongo.Document> {
  return withMongoOperationDeadline(budgetMs, async (deadline) => {
    assertAuthTestWritesConfirmed(db);
    const ids = ownedIds(target.filter);
    if (ids.length === 0)
      throw new Error('AUTH_TEST_WRITE_TARGET_IDS_REQUIRED');
    const comment = `eduforge-e2e-fixture-${randomUUID()}`;
    // Connections without command monitoring cannot prove a failed call was unsent.
    let mayHaveDispatched = !db.client.options.monitorCommands;
    const observe = ({ command: started }: mongo.CommandStartedEvent) => {
      if (started.comment === comment) mayHaveDispatched = true;
    };
    db.client.on('commandStarted', observe);
    try {
      const remaining = deadline.remainingMs();
      const reply = await runMongoWriteCommand(
        db,
        { ...command, comment },
        remaining,
        { signal: deadline.signal, serverMaxTimeMS },
      );
      const count: unknown = reply.n;
      const modified: unknown = reply.nModified;
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        ('update' in command &&
          (typeof modified !== 'number' ||
            !Number.isSafeInteger(modified) ||
            modified < 0))
      ) {
        throw new Error('AUTH_TEST_WRITE_REPLY_INVALID');
      }
      return reply;
    } catch (error) {
      if (
        !mayHaveDispatched ||
        error instanceof MongoWriteCommandRejectedError
      ) {
        throw error;
      }
      const unconfirmed = new Error('AUTH_TEST_WRITE_UNCONFIRMED', {
        cause: error,
      });
      unconfirmedWrites.set(db, unconfirmed);
      const observed = await inspectUnconfirmedWrite(db, target, comment).catch(
        () => 'unavailable' as const,
      );
      console.error(
        'Indeterminate scoped E2E write. Retain IDs for read-only reconciliation.',
        { collection: target.collection, ids, observed },
      );
      throw unconfirmed;
    } finally {
      db.client.off('commandStarted', observe);
    }
  });
}
