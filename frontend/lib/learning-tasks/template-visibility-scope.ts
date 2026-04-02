export const TASK_TEMPLATE_VISIBILITY_PRIVATE = "PRIVATE";
export const TASK_TEMPLATE_VISIBILITY_SHARED = "SHARED";

export const TASK_TEMPLATE_VISIBILITIES = [
  TASK_TEMPLATE_VISIBILITY_PRIVATE,
  TASK_TEMPLATE_VISIBILITY_SHARED,
] as const;

export type TaskTemplateVisibility = (typeof TASK_TEMPLATE_VISIBILITIES)[number];

export const TASK_TEMPLATE_SCOPE_MINE = "mine";
export const TASK_TEMPLATE_SCOPE_SHARED = "shared";
export const TASK_TEMPLATE_SCOPE_ALL = "all";

export const TASK_TEMPLATE_SCOPES = [
  TASK_TEMPLATE_SCOPE_MINE,
  TASK_TEMPLATE_SCOPE_SHARED,
  TASK_TEMPLATE_SCOPE_ALL,
] as const;

export type TaskTemplateScope = (typeof TASK_TEMPLATE_SCOPES)[number];

export const DEFAULT_TASK_TEMPLATE_SCOPE: TaskTemplateScope = TASK_TEMPLATE_SCOPE_MINE;

export const TASK_TEMPLATE_VISIBILITY_LABELS: Record<TaskTemplateVisibility, string> = {
  PRIVATE: "私有",
  SHARED: "共享",
};

export const TASK_TEMPLATE_SCOPE_LABELS: Record<TaskTemplateScope, string> = {
  mine: "我的模板",
  shared: "共享模板",
  all: "全部模板",
};

export const normalizeTaskTemplateVisibility = (
  value: unknown
): TaskTemplateVisibility | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toUpperCase();
  if (trimmed === TASK_TEMPLATE_VISIBILITY_PRIVATE) {
    return TASK_TEMPLATE_VISIBILITY_PRIVATE;
  }
  if (trimmed === TASK_TEMPLATE_VISIBILITY_SHARED) {
    return TASK_TEMPLATE_VISIBILITY_SHARED;
  }
  return undefined;
};

export const normalizeTaskTemplateScope = (
  value: unknown
): TaskTemplateScope | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === TASK_TEMPLATE_SCOPE_MINE) {
    return TASK_TEMPLATE_SCOPE_MINE;
  }
  if (trimmed === TASK_TEMPLATE_SCOPE_SHARED) {
    return TASK_TEMPLATE_SCOPE_SHARED;
  }
  if (trimmed === TASK_TEMPLATE_SCOPE_ALL) {
    return TASK_TEMPLATE_SCOPE_ALL;
  }
  return undefined;
};

export const toTaskTemplateVisibilityLabel = (value: unknown): string => {
  const normalized =
    normalizeTaskTemplateVisibility(value) ?? TASK_TEMPLATE_VISIBILITY_SHARED;
  return TASK_TEMPLATE_VISIBILITY_LABELS[normalized];
};
