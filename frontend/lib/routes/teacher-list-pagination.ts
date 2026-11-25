export function findLastPageForOutOfRangeRequest(
  page: number,
  limit: number,
  total: unknown,
): number | undefined {
  if (
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    return undefined;
  }

  const lastPage = Math.max(1, Math.ceil(total / limit));
  return page > lastPage ? lastPage : undefined;
}
