import { Mongoose, Schema, mongo } from 'mongoose';
import { createAuthTestModelReadConnection } from '../../test/helpers/auth-test-model-read-deadline';

function fixture() {
  const connection = createAuthTestModelReadConnection();
  const schema = new Schema(
    { name: String },
    { bufferCommands: false, autoCreate: false, autoIndex: false },
  );
  const model = connection.model('DeadlineItem', schema);
  return { connection, model, schema };
}

describe('auth test connection model read deadline', () => {
  it('passes per-model read deadlines to the collection and keeps a shorter server limit', async () => {
    const { connection, model } = fixture();
    try {
      const find = jest
        .spyOn(model.collection, 'findOne')
        .mockResolvedValue({ name: 'row' });
      const count = jest
        .spyOn(model.collection, 'countDocuments')
        .mockResolvedValue(1);
      await expect(
        model.findOne({ name: 'row' }).lean().maxTimeMS(5000).exec(),
      ).resolves.toEqual({ name: 'row' });
      await expect(model.countDocuments().exec()).resolves.toBe(1);

      const first = find.mock.calls[0]?.[1];
      const second = count.mock.calls[0]?.[1];
      expect(first?.maxTimeMS).toBe(5000);
      expect(first?.signal).toBeInstanceOf(AbortSignal);
      expect(second?.maxTimeMS).toBe(10000);
      expect(second?.signal).toBeInstanceOf(AbortSignal);
      expect(second?.signal).not.toBe(first?.signal);
    } finally {
      await connection.close();
    }
  });

  it('preserves an existing cancellation signal at the collection boundary', async () => {
    const { connection, model } = fixture();
    try {
      const controller = new AbortController();
      const aborted = new Error('existing read cancelled');
      const find = jest
        .spyOn(model.collection, 'findOne')
        .mockImplementation((_filter, options) =>
          Promise.resolve().then(() => {
            controller.abort(aborted);
            options?.signal?.throwIfAborted();
            return { name: 'row' };
          }),
        );

      await expect(
        model.findOne({}, null, { signal: controller.signal }).lean().exec(),
      ).rejects.toBe(aborted);
      expect(find).toHaveBeenCalledTimes(1);
    } finally {
      await connection.close();
    }
  });

  it('adds read deadlines to aggregates while leaving write pipelines alone', async () => {
    const { connection, model } = fixture();
    const client = new mongo.MongoClient('mongodb://offline.invalid/deadline');
    try {
      const cursor = client.db().collection('fixtures').aggregate([]);
      jest.spyOn(cursor, 'toArray').mockResolvedValue([]);
      const aggregate = jest
        .spyOn(model.collection, 'aggregate')
        .mockReturnValue(cursor);
      await model.aggregate([{ $match: { name: 'row' } }]).exec();
      await model.aggregate([{ $out: 'other' }]).exec();
      await model.aggregate([{ $merge: { into: 'other' } }]).exec();

      expect(aggregate.mock.calls[0]?.[1]?.maxTimeMS).toBe(10000);
      expect(aggregate.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(aggregate.mock.calls[1]?.[1]).toEqual({});
      expect(aggregate.mock.calls[2]?.[1]).toEqual({});
    } finally {
      await client.close();
      await connection.close();
    }
  });

  it('leaves the source schema and a model on another connection outside the read deadline', async () => {
    const { connection, model, schema } = fixture();
    const otherConnection = new Mongoose().createConnection();
    try {
      expect(model.schema).not.toBe(schema);
      const otherModel = otherConnection.model(
        model.modelName,
        model.schema.clone(),
      );
      const find = jest
        .spyOn(otherModel.collection, 'findOne')
        .mockResolvedValue(null);
      await expect(otherModel.findOne({ name: 'row' }).exec()).resolves.toBe(
        null,
      );
      expect(find.mock.calls[0]?.[1]?.signal).toBeUndefined();
      expect(find.mock.calls[0]?.[1]?.maxTimeMS).toBeUndefined();
    } finally {
      await otherConnection.close();
      await connection.close();
    }
  });
});
