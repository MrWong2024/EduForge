export type MongoOperationDeadline = {
  signal: AbortSignal;
  remainingMs(): number;
};

export async function withMongoOperationDeadline<T>(
  budgetMs: number,
  run: (deadline: MongoOperationDeadline) => Promise<T>,
): Promise<T> {
  const reason = new DOMException(
    'MongoDB operation deadline expired',
    'TimeoutError',
  );
  const controller = new AbortController();
  const expiresAt = performance.now() + budgetMs;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw reason;

  const timer = setTimeout(() => controller.abort(reason), budgetMs);
  timer.unref();
  try {
    return await run({
      signal: controller.signal,
      remainingMs: () => {
        const remainingMs = Math.ceil(expiresAt - performance.now());
        if (remainingMs <= 0) controller.abort(reason);
        controller.signal.throwIfAborted();
        return remainingMs;
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
