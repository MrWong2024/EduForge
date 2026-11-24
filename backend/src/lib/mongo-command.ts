import type { mongo } from 'mongoose';

export class MongoWriteCommandRejectedError extends Error {
  constructor(readonly code?: number) {
    super('MONGO_WRITE_COMMAND_REJECTED');
  }
}

type WriteReply = mongo.Document & {
  writeErrors?: { code?: number }[];
  writeConcernError?: object;
};

export async function runMongoWriteCommand(
  db: mongo.Db,
  command: mongo.Document,
  remainingMs: number,
  options?: { signal?: AbortSignal },
): Promise<mongo.Document> {
  const milliseconds = Math.floor(remainingMs);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error('MONGO_WRITE_DEADLINE_EXPIRED');
  }
  const deadline = AbortSignal.timeout(milliseconds);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  signal.throwIfAborted();

  // The raw command API supports cancellation and preserves individual write replies.
  const reply = (await db.command(
    { ...command, maxTimeMS: milliseconds },
    { readPreference: 'primary', signal },
  )) as WriteReply;
  if (reply.writeConcernError) {
    throw new Error('MONGO_WRITE_COMMAND_UNCONFIRMED');
  }
  if (reply.writeErrors?.length) {
    throw new MongoWriteCommandRejectedError(reply.writeErrors[0].code);
  }
  return reply;
}
