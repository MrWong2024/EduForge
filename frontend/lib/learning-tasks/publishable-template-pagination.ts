import type { LearningTaskOption } from "../api/types-teacher";

type TemplatePagePosition = {
  page: number;
  limit: number;
  total: number;
};

type TemplatePage = Partial<TemplatePagePosition> & {
  items: readonly LearningTaskOption[];
};

function pageValue(value: number | undefined, minimum: number, fallback: number) {
  return value !== undefined && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fallback;
}

export function resolvePublishableTemplatePage(
  response: TemplatePage,
  expected: TemplatePagePosition,
) {
  const page = pageValue(response.page, 1, expected.page);
  const limit = pageValue(response.limit, 1, expected.limit);
  const total = pageValue(response.total, 0, expected.total);

  // The adapter preserves one row per item, before de-duplicating the candidates.
  const hasMore =
    response.items.length >= limit && page >= expected.page && page * limit < total;
  return { page, limit, total, hasMore };
}

export function mergePublishableTemplates(
  previous: readonly LearningTaskOption[],
  items: readonly LearningTaskOption[],
): LearningTaskOption[] {
  const seen = new Set<string>();
  return [...previous, ...items].filter(({ id }) => {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
