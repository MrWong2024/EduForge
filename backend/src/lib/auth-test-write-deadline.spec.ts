import { mongo } from 'mongoose';
import {
  assertAuthTestWritesConfirmed,
  runAuthTestWrite,
} from '../../test/helpers/auth-test-writes';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException(
              'Controlled database operation expired',
              'TimeoutError',
            ),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function fixture() {
  // Construction alone opens no socket. Stub every database boundary below.
  const client = new mongo.MongoClient('mongodb://offline.invalid/test', {
    monitorCommands: true,
  });
  const db = client.db();
  const admin = client.db('admin');
  const collection = db.collection('users');
  const write = jest.spyOn(db, 'command');
  const currentOp = jest
    .spyOn(admin, 'command')
    .mockResolvedValue({ inprog: [] });
  const count = jest.spyOn(collection, 'countDocuments').mockResolvedValue(1);
  jest.spyOn(client, 'db').mockReturnValue(admin);
  jest.spyOn(db, 'collection').mockReturnValue(collection);
  const _id = new mongo.ObjectId();
  const dispatch = jest.fn((command: mongo.Document) => {
    client.emit('commandStarted', {
      requestId: 1,
      databaseName: db.databaseName,
      commandName: 'insert',
      command,
      address: 'offline.invalid:27017',
      serverConnectionId: null,
      hasServiceId: false,
    });
  });
  const run = () =>
    runAuthTestWrite(
      db,
      { insert: 'users', documents: [{ _id }] },
      { collection: 'users', filter: { _id } },
      10000,
      5000,
    );
  return { db, write, currentOp, count, dispatch, _id, run };
}

describe('a scoped E2E fixture write deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('includes seven seconds of checkout and still accepts an acknowledged reply before expiry', async () => {
    const f = fixture();
    f.write.mockImplementation(async (command, options) => {
      if (!options?.signal) throw new Error('Signal did not reach Db.command');
      await wait(7000, options.signal);
      f.dispatch(command);
      await wait(2900, options.signal);
      return { ok: 1, n: 1 };
    });

    const result = f.run();
    await jest.advanceTimersByTimeAsync(9900);
    await expect(result).resolves.toMatchObject({ n: 1 });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ maxTimeMS: 5000 }),
    );
    expect(f.currentOp).not.toHaveBeenCalled();
  });

  it('does not dispatch or mark a write indeterminate if checkout runs out of time', async () => {
    const f = fixture();
    f.write.mockImplementation(async (command, options) => {
      if (!options?.signal) throw new Error('Signal did not reach Db.command');
      await wait(11000, options.signal);
      f.dispatch(command);
      return { ok: 1, n: 1 };
    });

    const result = expect(f.run()).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.currentOp).not.toHaveBeenCalled();
    expect(() => assertAuthTestWritesConfirmed(f.db)).not.toThrow();
  });

  it('gives an in-flight write only the last three seconds, waits for settlement, then reconciles without replay', async () => {
    const f = fixture();
    let release: () => void = () => undefined;
    const drain = new Promise<void>((resolve) => {
      release = resolve;
    });
    const afterDispatchAbort = jest.fn<void, [number]>();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    f.write.mockImplementation(async (command, options) => {
      if (!options?.signal) throw new Error('Signal did not reach Db.command');
      await wait(7000, options.signal);
      f.dispatch(command);
      const dispatchedAt = performance.now();
      try {
        await wait(5000, options.signal);
        return { ok: 1, n: 1 };
      } catch (error) {
        afterDispatchAbort(performance.now() - dispatchedAt);
        await drain;
        throw error;
      }
    });

    const result = expect(f.run()).rejects.toThrow(
      'AUTH_TEST_WRITE_UNCONFIRMED',
    );
    await jest.advanceTimersByTimeAsync(9999);
    expect(afterDispatchAbort).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(afterDispatchAbort).toHaveBeenCalledTimes(1);
    expect(afterDispatchAbort).toHaveBeenCalledWith(3000);
    expect(f.currentOp).not.toHaveBeenCalled();
    release();
    await result;

    expect(f.currentOp).toHaveBeenCalledTimes(1);
    const [filter, options] = f.count.mock.calls[0] ?? [];
    expect(filter).toEqual({ _id: f._id });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    await expect(f.run()).rejects.toThrow('AUTH_TEST_WRITE_UNCONFIRMED');
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});
