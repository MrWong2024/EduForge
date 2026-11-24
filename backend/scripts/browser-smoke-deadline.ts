import { performance } from 'node:perf_hooks';
import type { mongo } from 'mongoose';

export const SMOKE_TOTAL_MS = 120_000;

export class SmokeDeadlineExpiredError extends Error {}

export function createSmokeDeadline(now = () => performance.now()) {
  const deadline = now() + SMOKE_TOTAL_MS;
  const remaining = (limit: number): number => {
    const milliseconds = Math.min(limit, Math.floor(deadline - now()));
    if (milliseconds < 1) throw new SmokeDeadlineExpiredError();
    return milliseconds;
  };
  return {
    remaining,
    operation(limit: number) {
      const maxTimeMS = remaining(limit);
      return { maxTimeMS, signal: AbortSignal.timeout(maxTimeMS) };
    },
  };
}

export type SmokeDeadline = ReturnType<typeof createSmokeDeadline>;

export async function readSmokePrimary(
  db: mongo.Db,
  deadline: SmokeDeadline,
): Promise<{
  hello: unknown;
  connectedAddress: string | undefined;
  seedPort: number | undefined;
}> {
  const client = db.client;
  let connectedAddress: string | undefined;
  const captureHello = (event: mongo.CommandSucceededEvent) => {
    if (event.commandName === 'hello' && event.databaseName === 'admin')
      connectedAddress = event.address;
  };
  client.on('commandSucceeded', captureHello);
  try {
    const { maxTimeMS, signal } = deadline.operation(5000);
    const hello: unknown = await client
      .db('admin')
      .command({ hello: 1, maxTimeMS }, { signal, readPreference: 'primary' });
    return { hello, connectedAddress, seedPort: client.options.hosts[0]?.port };
  } finally {
    client.off('commandSucceeded', captureHello);
  }
}
