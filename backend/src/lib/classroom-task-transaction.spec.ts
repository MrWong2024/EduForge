import { mongo, Mongoose, Schema } from 'mongoose';
import {
  getClassroomTaskTransactionModel,
  runClassroomTaskTransaction,
  type ClassroomTaskTransaction,
} from './classroom-task-transaction';

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function mongoError(
  label: 'TransientTransactionError' | 'UnknownTransactionCommitResult',
): mongo.MongoServerError {
  const error = new mongo.MongoServerError({ errmsg: label });
  error.addErrorLabel(label);
  return error;
}

function setup() {
  const session = {
    startTransaction: jest.fn<void, [mongo.TransactionOptions]>(),
    inTransaction: jest.fn().mockReturnValue(true),
    commitTransaction: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
    abortTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    endSession: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
    models: {},
    model: jest.fn(),
  };
  return { session, connection };
}

describe('classroom task transaction deadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('preserves the model and forwards read deadlines on a separate transport', async () => {
    const mongoose = new Mongoose();
    const schema = new Schema(
      { name: { type: String, required: true } },
      { timestamps: true },
    );
    const source = mongoose.model('ClassroomTaskProbe', schema, 'custom_tasks');
    const transport = mongoose.createConnection();
    const model = getClassroomTaskTransactionModel(transport, source);

    expect(model.db).toBe(transport);
    expect(model.collection.name).toBe(source.collection.name);
    expect(model.schema.options.timestamps).toBe(true);
    expect(model.schema.options.autoCreate).toBe(false);
    expect(model.schema.options.autoIndex).toBe(false);
    expect(model.schema.options.bufferCommands).toBe(false);
    expect(getClassroomTaskTransactionModel(transport, source)).toBe(model);
    expect(source.db).toBe(mongoose.connection);

    const read = jest
      .spyOn(model.collection, 'findOne')
      .mockResolvedValue(null);
    const signal = new AbortController().signal;
    await model
      .findOne({ name: 'example' })
      .setOptions({
        maxTimeMS: 150,
        signal,
      })
      .exec();
    expect(read).toHaveBeenCalledWith(
      { name: 'example' },
      expect.objectContaining({ maxTimeMS: 150, signal }),
    );
    expect(read.mock.calls[0][1]?.signal).toBe(signal);
  });

  it('retries a transitory body failure only after abort and spends the same deadline', async () => {
    const { connection, session } = setup();
    const run = jest
      .fn<Promise<number>, [ClassroomTaskTransaction]>((transaction) =>
        Promise.resolve(transaction.remainingMs()),
      )
      .mockImplementationOnce(async () => {
        await delay(4_000);
        throw mongoError('TransientTransactionError');
      });
    const transaction = runClassroomTaskTransaction(connection, run);
    await jest.advanceTimersByTimeAsync(4_010);
    await expect(transaction).resolves.toBe(5_990);
    expect(session.startTransaction.mock.calls).toEqual([
      [{ readPreference: 'primary', maxCommitTimeMS: 10_000 }],
      [{ readPreference: 'primary', maxCommitTimeMS: 5_990 }],
    ]);
    expect(session.abortTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      session.startTransaction.mock.invocationCallOrder[1],
    );
    expect(run.mock.calls[0][0]).toBe(run.mock.calls[1][0]);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('holds the session until the in-flight operation finishes and fences a following write', async () => {
    const { connection, session } = setup();
    const write = jest.fn();
    const run = jest.fn(async (transaction: ClassroomTaskTransaction) => {
      await delay(11_000);
      transaction.remainingMs();
      write();
    });
    session.abortTransaction.mockImplementation(() => delay(2_000));
    const transaction = runClassroomTaskTransaction(connection, run);
    const rejection = expect(transaction).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    await rejection;
    expect(write).not.toHaveBeenCalled();
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('passes a signal that actually aborts an in-flight read at the deadline', async () => {
    const { connection, session } = setup();
    const read = jest.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('Read aborted', { cause: signal.reason })),
            { once: true },
          );
        }),
    );
    const transaction = runClassroomTaskTransaction(connection, (transaction) =>
      read(transaction.readOptions().signal),
    );
    const rejection = expect(transaction).rejects.toMatchObject({
      cause: { name: 'TimeoutError' },
    });
    await jest.advanceTimersByTimeAsync(9_999);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(read).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not start a new transaction when the deadline expires while aborting', async () => {
    const { connection, session } = setup();
    const run = jest
      .fn()
      .mockRejectedValue(mongoError('TransientTransactionError'));
    session.abortTransaction.mockImplementation(() => delay(10_000));
    const transaction = runClassroomTaskTransaction(connection, run);
    const rejection = expect(transaction).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await jest.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(run).toHaveBeenCalledTimes(1);
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });

  it('retries a definitively aborted commit with the remaining budget', async () => {
    const { connection, session } = setup();
    const run = jest.fn().mockResolvedValue('saved');
    session.commitTransaction.mockImplementationOnce(async () => {
      await delay(2_000);
      throw mongoError('TransientTransactionError');
    });
    const transaction = runClassroomTaskTransaction(connection, run);
    await jest.advanceTimersByTimeAsync(2_010);
    await expect(transaction).resolves.toBe('saved');
    expect(run).toHaveBeenCalledTimes(2);
    expect(session.startTransaction).toHaveBeenLastCalledWith({
      readPreference: 'primary',
      maxCommitTimeMS: 7_990,
    });
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it('confirms an unknown commit on the same session and honors late success', async () => {
    const { connection, session } = setup();
    const run = jest.fn().mockResolvedValue('saved');
    session.commitTransaction
      .mockRejectedValueOnce(mongoError('UnknownTransactionCommitResult'))
      .mockImplementationOnce(() => delay(11_000));
    const transaction = runClassroomTaskTransaction(connection, run);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(session.commitTransaction).toHaveBeenCalledTimes(2);
    expect(session.endSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(transaction).resolves.toBe('saved');
    expect(connection.startSession).toHaveBeenCalledTimes(1);
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not confirm an unknown commit after the admission deadline', async () => {
    const { connection, session } = setup();
    const unknown = mongoError('UnknownTransactionCommitResult');
    session.commitTransaction.mockImplementationOnce(async () => {
      await delay(10_000);
      throw unknown;
    });
    const transaction = runClassroomTaskTransaction(connection, () =>
      Promise.resolve('saved'),
    );
    const rejection = expect(transaction).rejects.toBe(unknown);
    await jest.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('never replays a transaction after an inconclusive initial commit', async () => {
    const { connection, session } = setup();
    const unknown = mongoError('UnknownTransactionCommitResult');
    session.commitTransaction
      .mockRejectedValueOnce(unknown)
      .mockRejectedValueOnce(mongoError('TransientTransactionError'));
    const run = jest.fn().mockResolvedValue('saved');
    await expect(runClassroomTaskTransaction(connection, run)).rejects.toBe(
      unknown,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(2);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('treats an unlabeled network error as inconclusive when the driver has no retry left', async () => {
    const { connection, session } = setup();
    const unknown = new mongo.MongoNetworkError('commit reply lost');
    session.commitTransaction
      .mockRejectedValueOnce(unknown)
      .mockRejectedValueOnce(mongoError('TransientTransactionError'));
    const run = jest.fn().mockResolvedValue('saved');

    await expect(runClassroomTaskTransaction(connection, run)).rejects.toBe(
      unknown,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(2);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
