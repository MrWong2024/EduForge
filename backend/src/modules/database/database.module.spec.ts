import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { type ConnectOptions, mongo, Mongoose } from 'mongoose';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../../lib/classroom-task-transaction';
import { DatabaseModule } from './database.module';

function simulateStartup({
  env,
  purpose,
  databaseName,
}: {
  env: 'test' | 'production';
  purpose?: 'browser_acceptance';
  databaseName: string;
}) {
  const uri = `mongodb://127.0.0.1/${databaseName}`;
  const config = new ConfigService({
    app: { env },
    mongo: { uri, purpose, serverSelectionTimeoutMS: 200 },
  });
  const failure = new Error('Injected first startup failure');
  const connections = new Mongoose();
  const db = new mongo.MongoClient(uri).db();
  const attempts = { default: 0, transaction: 0 };
  const createConnection = jest.spyOn(mongoose, 'createConnection');
  createConnection.mockImplementation(
    (_?: unknown, options?: ConnectOptions) => {
      const pool =
        options?.maxAdaptiveRetries === 0 ? 'transaction' : 'default';
      const connection = connections.createConnection();
      Object.defineProperty(connection, 'db', { value: db });
      const ready = jest.spyOn(connection, 'asPromise');
      attempts[pool]++;
      if (attempts[pool] === 1) ready.mockRejectedValue(failure);
      else ready.mockResolvedValue(connection);
      return connection;
    },
  );
  const startup = Test.createTestingModule({ imports: [DatabaseModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  return { createConnection, startup, attempts, failure };
}

describe('DatabaseModule startup retry policy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('allows both production connections to recover from a failed first attempt', async () => {
    const { createConnection, startup, attempts } = simulateStartup({
      env: 'production',
      databaseName: 'eduforge',
    });
    // Capture a rejection at once so a premature startup failure is observable.
    const outcome = startup.then(
      (module) => ({ module }),
      (error: unknown) => ({ error }),
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual({ default: 1, transaction: 1 });
    await jest.advanceTimersByTimeAsync(3_000);
    const result = await outcome;
    if ('error' in result) throw result.error;
    try {
      expect(attempts).toEqual({ default: 2, transaction: 2 });
      expect(result.module.get(getConnectionToken())).toBeDefined();
      expect(
        result.module.get(
          getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
        ),
      ).toBeDefined();
      expect(createConnection).toHaveBeenCalledWith(
        'mongodb://127.0.0.1/eduforge',
        expect.objectContaining({
          maxAdaptiveRetries: 0,
          connectTimeoutMS: 10_000,
          waitQueueTimeoutMS: 10_000,
          socketTimeoutMS: 10_000,
        }),
      );
    } finally {
      await result.module.close();
    }
  });

  it('fails browser acceptance at the first attempt in both pools', async () => {
    const { startup, attempts, failure } = simulateStartup({
      env: 'test',
      purpose: 'browser_acceptance',
      databaseName: 'eduforge_browser_test',
    });
    const rejected = expect(startup).rejects.toBe(failure);

    await jest.advanceTimersByTimeAsync(3_000);
    await rejected;
    expect(attempts).toEqual({ default: 1, transaction: 1 });
  });
});
