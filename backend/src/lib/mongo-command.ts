import { mongo } from 'mongoose';

export class MongoWriteCommandRejectedError extends Error {
  constructor(readonly code?: number) {
    super('MONGO_WRITE_COMMAND_REJECTED');
  }
}

type WriteReply = mongo.Document & {
  acknowledged?: boolean;
  writeErrors?: { code?: number }[];
  writeConcernError?: object;
};

export async function runMongoWriteCommand(
  db: mongo.Db,
  command: mongo.Document & mongo.WriteConcernOptions,
  remainingMs: number,
  options?: { signal?: AbortSignal; serverMaxTimeMS?: number },
): Promise<mongo.Document> {
  const milliseconds = Math.floor(remainingMs);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error('MONGO_WRITE_DEADLINE_EXPIRED');
  }
  const serverLimit = options?.serverMaxTimeMS;
  if (
    serverLimit !== undefined &&
    (!Number.isSafeInteger(serverLimit) || serverLimit <= 0)
  ) {
    throw new Error('MONGO_WRITE_SERVER_DEADLINE_INVALID');
  }
  const deadline = AbortSignal.timeout(milliseconds);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  signal.throwIfAborted();

  // The raw command API does not inherit database write concern.
  const databaseConcern = db.writeConcern;
  const operationConcern = mongo.WriteConcern.fromOptions(command);
  const w = operationConcern?.w ?? databaseConcern?.w;
  if (w === 0) throw new Error('MONGO_WRITE_COMMAND_UNACKNOWLEDGED');
  const confirmationMs = Math.min(
    milliseconds,
    ...[databaseConcern?.wtimeoutMS, operationConcern?.wtimeoutMS].filter(
      (timeout): timeout is number =>
        timeout !== undefined && timeout > 0 && Number.isFinite(timeout),
    ),
  );
  const concern = new mongo.WriteConcern(
    w,
    confirmationMs,
    operationConcern?.journal ?? databaseConcern?.journal,
  );
  const maxTimeMS = Math.min(milliseconds, serverLimit ?? milliseconds);
  const reply: WriteReply = await db.command(
    mongo.WriteConcern.apply({ ...command, maxTimeMS }, concern),
    { readPreference: 'primary', signal },
  );
  if (
    reply.ok !== 1 ||
    reply.acknowledged === false ||
    'writeConcernError' in reply
  ) {
    throw new Error('MONGO_WRITE_COMMAND_UNCONFIRMED');
  }
  if (reply.writeErrors?.length) {
    throw new MongoWriteCommandRejectedError(reply.writeErrors[0].code);
  }
  return reply;
}
