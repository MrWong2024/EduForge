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
