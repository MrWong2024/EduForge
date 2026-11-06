export function createSyncIndexesLifecycle() {
  const pending = new Set<Promise<unknown>>();
  let stopped = false;
  let uncertainWrite = false;
  let deadlineAt: number | undefined;

  function assertRunning() {
    if (deadlineAt !== undefined && performance.now() >= deadlineAt) {
      stopped = true;
    }
    if (stopped) throw new Error('SYNC_INDEXES_E2E_STOPPED');
  }

  function track<T>(operation: () => Promise<T>) {
    const call = Promise.resolve().then(operation);
    pending.add(call);
    const remove = () => {
      pending.delete(call);
    };
    void call.then(remove, remove);
    return call;
  }

  return {
    assertRunning,

    async run<T>(deadlineMs: number, operation: () => Promise<T>) {
      assertRunning();
      const expiresAt = performance.now() + deadlineMs;
      deadlineAt = expiresAt;
      const call = track(() => {
        assertRunning();
        return operation();
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stopped = true;
          reject(new Error('SYNC_INDEXES_E2E_DEADLINE'));
        }, deadlineMs);
      });
      try {
        const result = await Promise.race([call, deadline]);
        if (performance.now() >= expiresAt) {
          throw new Error('SYNC_INDEXES_E2E_DEADLINE');
        }
        return result;
      } catch (error) {
        stopped = true;
        throw error;
      } finally {
        clearTimeout(timer);
        deadlineAt = undefined;
      }
    },

    async write<T>(
      operation: () => Promise<T>,
      isConfirmedFailure?: (error: unknown) => boolean,
    ) {
      return track(async () => {
        assertRunning();
        try {
          return await operation();
        } catch (error) {
          if (!isConfirmedFailure?.(error)) {
            uncertainWrite = true;
            stopped = true;
          }
          throw error;
        }
      });
    },

    async stopAndWait(waitMs: number) {
      stopped = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          Promise.allSettled(pending).then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), waitMs);
          }),
        ]);
        return {
          settled,
          uncertainWrite,
          cleanupAllowed: settled && !uncertainWrite,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

type CleanupTarget = {
  verify(this: void, timeoutMS: number): Promise<void>;
  assertOwned(this: void, name: string, timeoutMS: number): Promise<void>;
  drop(this: void, name: string, timeoutMS: number): Promise<boolean>;
  readResidual(this: void, timeoutMS: number): Promise<string[]>;
};

class CleanupDeadlineError extends Error {}

function cleanupRequestTime(deadline: number, limit: number) {
  const timeoutMS = Math.min(limit, Math.floor(deadline - performance.now()));
  if (timeoutMS <= 0) throw new CleanupDeadlineError();
  return timeoutMS;
}

async function observeCleanupUntil<T>(deadline: number, operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CleanupDeadlineError()),
          Math.max(0, deadline - performance.now()),
        );
      }),
    ]);
    if (performance.now() >= deadline) throw new CleanupDeadlineError();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupSyncIndexesCollections({
  lifecycle,
  owned,
  target,
  closeConnections,
  totalBudgetMs,
  drainWaitMs,
  requestTimeoutMs,
  reportReserveMs,
  closeReserveMs,
}: {
  lifecycle: Pick<ReturnType<typeof createSyncIndexesLifecycle>, 'stopAndWait'>;
  owned: Map<string, string>;
  target?: CleanupTarget;
  closeConnections: () => Promise<void>;
  totalBudgetMs: number;
  drainWaitMs: number;
  requestTimeoutMs: number;
  reportReserveMs: number;
  closeReserveMs: number;
}) {
  const deadline = performance.now() + totalBudgetMs;
  const reportDeadline = deadline - closeReserveMs;
  const writeDeadline = reportDeadline - reportReserveMs;
  const dropObservationDeadline =
    writeDeadline + Math.floor(reportReserveMs / 2);
  const { settled, uncertainWrite, cleanupAllowed } =
    await lifecycle.stopAndWait(
      Math.max(0, Math.min(drainWaitMs, writeDeadline - performance.now())),
    );
  let cleanupIssue: string | undefined;
  let observedResidual: string[] | 'unconfirmed' = 'unconfirmed';
  const completed: string[] = [];
  let unconfirmedDrop = false;
  let trusted = false;

  if (target) {
    try {
      await observeCleanupUntil(
        writeDeadline,
        target.verify(cleanupRequestTime(writeDeadline, requestTimeoutMs)),
      );
      trusted = true;
    } catch (error) {
      cleanupIssue =
        error instanceof CleanupDeadlineError
          ? 'cleanup-deadline'
          : 'target-unconfirmed';
    }

    if (trusted && cleanupAllowed) {
      for (const name of owned.keys()) {
        try {
          await observeCleanupUntil(
            writeDeadline,
            target.assertOwned(
              name,
              cleanupRequestTime(writeDeadline, requestTimeoutMs),
            ),
          );
        } catch (error) {
          cleanupIssue =
            error instanceof CleanupDeadlineError
              ? 'cleanup-deadline'
              : `ownership-unconfirmed:${name}`;
          break;
        }

        let timeoutMS: number;
        try {
          timeoutMS = cleanupRequestTime(writeDeadline, requestTimeoutMs);
        } catch {
          cleanupIssue = 'cleanup-deadline';
          break;
        }
        try {
          // No await between the last deadline check and issuing the drop.
          const dropped = await observeCleanupUntil(
            dropObservationDeadline,
            target.drop(name, timeoutMS),
          );
          if (!dropped) throw new Error('SYNC_INDEXES_E2E_DROP_UNCONFIRMED');
          owned.delete(name);
          completed.push(name);
        } catch {
          cleanupIssue = `drop-unconfirmed:${name}`;
          unconfirmedDrop = true;
          break;
        }
      }
      if (performance.now() >= writeDeadline)
        cleanupIssue ??= 'cleanup-deadline';
    } else if (trusted) {
      cleanupIssue = settled ? 'write-unconfirmed' : 'calls-still-in-flight';
    }

    if (trusted && settled && !uncertainWrite && !unconfirmedDrop) {
      try {
        observedResidual = await observeCleanupUntil(
          reportDeadline,
          target.readResidual(
            cleanupRequestTime(reportDeadline, requestTimeoutMs),
          ),
        );
      } catch {
        cleanupIssue ??= 'residual-unconfirmed';
      }
    }
  }

  let closeConfirmed = false;
  try {
    await observeCleanupUntil(
      deadline,
      Promise.resolve().then(closeConnections),
    );
    closeConfirmed = true;
  } catch {
    cleanupIssue ??= 'connections-close-unconfirmed';
  }
  return {
    cleanupIssue,
    settled,
    uncertainWrite,
    observedResidual,
    completed,
    registered: [...owned.keys()],
    connectionsClosed:
      settled && !uncertainWrite && !unconfirmedDrop && closeConfirmed,
  };
}
