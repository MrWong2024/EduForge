import { Logger } from '@nestjs/common';
import { mongo, type Connection, type Model } from 'mongoose';
import { withMongoOperationDeadline } from './mongo-operation-deadline';

const TRANSACTION_BUDGET_MS = 10_000;
const RETRY_DELAY_MS = 10;
const MAX_TIME_MS_EXPIRED = 50;
const UNKNOWN_REPL_WRITE_CONCERN = 79;
const UNSATISFIABLE_WRITE_CONCERN = 100;
const logger = new Logger('ClassroomTaskTransaction');

export const CLASSROOM_TASK_TRANSACTION_CONNECTION = 'classroomTaskTransaction';

export class UnconfirmedClassroomTaskCommitError extends Error {
  constructor(cause: unknown) {
    super('MongoDB transaction commit could not be confirmed', { cause });
    this.name = 'UnconfirmedClassroomTaskCommitError';
  }
}

export type ClassroomTaskTransaction = {
  session: mongo.ClientSession;
  model<T>(source: Model<T>): Model<T>;
  remainingMs(): number;
  readOptions(): { maxTimeMS: number; signal: AbortSignal };
};

type TransactionConnection = Pick<
  Connection,
  'startSession' | 'model' | 'models'
>;

export type ClassroomReadSnapshot = ClassroomTaskTransaction & {
  referenceTime: Date;
};

export function runClassroomReadSnapshot<T>(
  connection: TransactionConnection,
  run: (snapshot: ClassroomReadSnapshot) => Promise<T>,
): Promise<T> {
  const referenceTime = new Date();
  return runClassroomTaskTransaction(
    connection,
    (transaction) => run({ ...transaction, referenceTime }),
    { readOnlySnapshot: true },
  );
}

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

function excludesCommitConfirmation(code: unknown, codeName: unknown): boolean {
  return (
    code === MAX_TIME_MS_EXPIRED ||
    code === UNKNOWN_REPL_WRITE_CONCERN ||
    code === UNSATISFIABLE_WRITE_CONCERN ||
    codeName === 'CannotSatisfyWriteConcern' ||
    codeName === 'UnknownReplWriteConcern' ||
    codeName === 'UnsatisfiableWriteConcern'
  );
}

function canConfirmCommit(error: unknown): boolean {
  if (!(error instanceof mongo.MongoError)) return false;
  if (
    error instanceof mongo.MongoServerError &&
    (excludesCommitConfirmation(error.code, error.codeName) ||
      excludesCommitConfirmation(
        error.writeConcernError?.code,
        error.writeConcernError?.codeName,
      ))
  ) {
    return false;
  }
  // With no adaptive retries, 7.9.1 can throw the first reply before labeling its commit outcome.
  return (
    error instanceof mongo.MongoNetworkError ||
    error instanceof mongo.MongoWriteConcernError ||
    error.hasErrorLabel(mongo.MongoErrorLabel.UnknownTransactionCommitResult) ||
    error.hasErrorLabel(mongo.MongoErrorLabel.RetryableWriteError) ||
    error.hasErrorLabel(mongo.MongoErrorLabel.PoolRequestedRetry)
  );
}

function isTransientTransaction(error: unknown): boolean {
  return (
    error instanceof mongo.MongoError &&
    !error.hasErrorLabel(
      mongo.MongoErrorLabel.UnknownTransactionCommitResult,
    ) &&
    error.hasErrorLabel(mongo.MongoErrorLabel.TransientTransactionError)
  );
}

export async function runClassroomTaskTransaction<T>(
  connection: TransactionConnection,
  run: (transaction: ClassroomTaskTransaction) => Promise<T>,
  options?: {
    distinguishUnconfirmedCommit?: boolean;
    readOnlySnapshot?: boolean;
  },
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
          ...(options?.readOnlySnapshot
            ? {
                readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' },
              }
            : {}),
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
          if (canConfirmCommit(error)) {
            // An inconclusive commit may only be confirmed on this transaction.
            try {
              deadline.remainingMs();
              await session.commitTransaction();
              return value;
            } catch {
              if (options?.distinguishUnconfirmedCommit) {
                throw new UnconfirmedClassroomTaskCommitError(error);
              }
              throw error;
            }
          }
          if (!isTransientTransaction(error)) {
            // Some ambiguous replies do not permit another commit attempt.
            if (
              options?.distinguishUnconfirmedCommit &&
              error instanceof mongo.MongoError &&
              (error.hasErrorLabel(
                mongo.MongoErrorLabel.UnknownTransactionCommitResult,
              ) ||
                error instanceof mongo.MongoOperationTimeoutError ||
                error instanceof mongo.MongoWriteConcernError ||
                (error instanceof mongo.MongoServerError &&
                  (error.code === MAX_TIME_MS_EXPIRED ||
                    error.writeConcernError !== undefined)))
            ) {
              throw new UnconfirmedClassroomTaskCommitError(error);
            }
            throw error;
          }
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
