import { mongo } from 'mongoose';
import {
  MongoWriteCommandRejectedError,
  runMongoWriteCommand,
} from './mongo-command';

const insert = { insert: 'fixtures', documents: [{ _id: 1 }] };

function fixture(writeConcern?: mongo.WriteConcernSettings) {
  // A MongoClient constructor does not connect. All commands use this spy.
  const db = new mongo.MongoClient('mongodb://offline.invalid/fixture', {
    writeConcern,
  }).db();
  const command = jest.spyOn(db, 'command').mockResolvedValue({ ok: 1, n: 1 });
  return { db, command };
}

describe('runMongoWriteCommand', () => {
  it.each([
    [250, 500, 1000, 250],
    [1000, 250, 500, 250],
    [500, 1000, 250, 250],
    [250, 0, 500, 250],
  ])(
    'keeps w and journal while taking the shortest positive confirmation bound from %i, %i and %i',
    async (databaseMs, operationMs, remainingMs, expectedMs) => {
      const { db, command } = fixture({
        w: 2,
        journal: true,
        wtimeoutMS: databaseMs,
      });
      const operation = { ...insert, writeConcern: { wtimeout: operationMs } };

      await expect(
        runMongoWriteCommand(db, operation, remainingMs),
      ).resolves.toEqual({
        ok: 1,
        n: 1,
      });

      expect(command.mock.calls[0]?.[0]).toEqual({
        ...insert,
        writeConcern: { w: 2, j: true, wtimeout: expectedMs },
        maxTimeMS: remainingMs,
      });
      expect(operation.writeConcern).toEqual({ wtimeout: operationMs });
    },
  );

  it('uses explicitly supplied w and journal with the shorter inherited confirmation bound', async () => {
    const { db, command } = fixture({ w: 2, j: true, wtimeout: 125 });

    await runMongoWriteCommand(
      db,
      {
        ...insert,
        writeConcern: { w: 'majority', journal: false, wtimeoutMS: 200 },
      },
      500,
    );

    expect(command.mock.calls[0]?.[0]).toEqual({
      ...insert,
      writeConcern: { w: 'majority', j: false, wtimeout: 125 },
      maxTimeMS: 500,
    });
  });

  it('keeps the server acknowledgement default when w is absent', async () => {
    const { db, command } = fixture();
    await runMongoWriteCommand(db, insert, 500);

    expect(command.mock.calls[0]?.[0]).toEqual({
      ...insert,
      writeConcern: { wtimeout: 500 },
      maxTimeMS: 500,
    });
  });

  it('stops before dispatch when the effective write concern is unacknowledged', async () => {
    const inherited = fixture({ w: 0 });
    await expect(
      runMongoWriteCommand(inherited.db, insert, 500),
    ).rejects.toThrow('MONGO_WRITE_COMMAND_UNACKNOWLEDGED');
    expect(inherited.command).not.toHaveBeenCalled();

    const overridden = fixture({ w: 2 });
    await expect(
      runMongoWriteCommand(
        overridden.db,
        { ...insert, writeConcern: { w: 0 } },
        500,
      ),
    ).rejects.toThrow('MONGO_WRITE_COMMAND_UNACKNOWLEDGED');
    expect(overridden.command).not.toHaveBeenCalled();
  });

  it.each([
    { ok: 1, n: 1, writeConcernError: { code: 64 } },
    { ok: 1, acknowledged: false },
    { ok: 0 },
    {},
  ])('does not accept a reply without confirmed success %#', async (reply) => {
    const { db, command } = fixture();
    command.mockResolvedValueOnce(reply);

    await expect(runMongoWriteCommand(db, insert, 500)).rejects.toThrow(
      'MONGO_WRITE_COMMAND_UNCONFIRMED',
    );
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('retains a definite per-write rejection for fixture recovery', async () => {
    const { db, command } = fixture();
    command.mockResolvedValueOnce({
      ok: 1,
      n: 0,
      writeErrors: [{ code: 11000 }],
    });
    await expect(runMongoWriteCommand(db, insert, 500)).rejects.toEqual(
      new MongoWriteCommandRejectedError(11000),
    );
  });

  it('propagates a lost reply without dispatching a second write', async () => {
    const { db, command } = fixture();
    const lost = new mongo.MongoNetworkError('reply lost');
    command.mockRejectedValueOnce(lost);

    await expect(runMongoWriteCommand(db, insert, 500)).rejects.toBe(lost);
    expect(command).toHaveBeenCalledTimes(1);
  });
});
