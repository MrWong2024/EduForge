import { Logger } from '@nestjs/common';
import { mongo, type Connection, type Model } from 'mongoose';
import { withMongoOperationDeadline } from './mongo-operation-deadline';

const TRANSACTION_BUDGET_MS = 10_000;
const RETRY_DELAY_MS = 10;
const logger = new Logger('ClassroomTaskTransaction');

export const CLASSROOM_TASK_TRANSACTION_CONNECTION = 'classroomTaskTransaction';

export type ClassroomTaskTransaction = {
  session: mongo.ClientSession;
  model<T>(source: Model<T>): Model<T>;
  remainingMs(): number;
  readOptions(): { maxTimeMS: number; signal: AbortSignal };
};

export function getClassroomTaskTransactionModel<T>(
  connection: Pick<Connection, 'model' | 'models'>,
  source: Model<T>,
): Model<T> {
  if (connection.models[source.modelName]) {
    return connection.model<T>(source.modelName);
  }
  const schema = source.schema.clone();
  schema.set('autoCreate', false);
  schema.set('autoIndex', false);
  schema.set('bufferCommands', false);
  return connection.model<T>(source.modelName, schema, source.collection.name);
}

function isUnknownCommitResult(error: unknown): boolean {
  return (
    error instanceof mongo.MongoNetworkError ||
    error instanceof mongo.MongoWriteConcernError ||
    (error instanceof mongo.MongoError &&
      error.hasErrorLabel('UnknownTransactionCommitResult'))
  );
}

function isTransientTransaction(error: unknown): boolean {
  return (
    error instanceof mongo.MongoError &&
    !error.hasErrorLabel('UnknownTransactionCommitResult') &&
    error.hasErrorLabel('TransientTransactionError')
  );
}

export async function runClassroomTaskTransaction<T>(
  connection: Pick<Connection, 'startSession' | 'model' | 'models'>,
  run: (transaction: ClassroomTaskTransaction) => Promise<T>,
): Promise<T> {
  return withMongoOperationDeadline(TRANSACTION_BUDGET_MS, async (deadline) => {
    const session = await connection.startSession();
    try {
      const transaction: ClassroomTaskTransaction = {
        session,
        model: (source) => getClassroomTaskTransactionModel(connection, source),
        remainingMs: () => deadline.remainingMs(),
        readOptions: () => ({
          maxTimeMS: deadline.remainingMs(),
          signal: deadline.signal,
        }),
      };
      const waitToRetry = async () => {
        const delay = Math.min(RETRY_DELAY_MS, deadline.remainingMs());
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      };

      for (;;) {
        session.startTransaction({
          readPreference: 'primary',
          maxCommitTimeMS: deadline.remainingMs(),
        });

        let value: T;
        try {
          value = await run(transaction);
          deadline.remainingMs();
        } catch (error) {
          if (session.inTransaction()) await session.abortTransaction();
          if (!isTransientTransaction(error)) throw error;
          await waitToRetry();
          continue;
        }

        try {
          await session.commitTransaction();
          return value;
        } catch (error) {
          if (isUnknownCommitResult(error)) {
            // An inconclusive commit may only be confirmed on this transaction.
            try {
              deadline.remainingMs();
              await session.commitTransaction();
              return value;
            } catch {
              throw error;
            }
          }
          if (!isTransientTransaction(error)) throw error;
          await waitToRetry();
        }
      }
    } finally {
      try {
        await session.endSession();
      } catch (error) {
        // Keep the transaction outcome even when local cleanup fails.
        logger.error(
          'Failed to release the transaction session',
          error instanceof Error ? error.name : undefined,
        );
      }
    }
  });
}
