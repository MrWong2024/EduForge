export const TASK_VISIBILITY_PRIVATE = 'PRIVATE';
export const TASK_VISIBILITY_SHARED = 'SHARED';

export const TASK_VISIBILITIES = [
  TASK_VISIBILITY_PRIVATE,
  TASK_VISIBILITY_SHARED,
] as const;

export type TaskVisibility = (typeof TASK_VISIBILITIES)[number];

export const TASK_TEMPLATE_SCOPE_MINE = 'mine';
export const TASK_TEMPLATE_SCOPE_SHARED = 'shared';
export const TASK_TEMPLATE_SCOPE_ALL = 'all';

export const TASK_TEMPLATE_SCOPES = [
  TASK_TEMPLATE_SCOPE_MINE,
  TASK_TEMPLATE_SCOPE_SHARED,
  TASK_TEMPLATE_SCOPE_ALL,
] as const;

export type TaskTemplateScope = (typeof TASK_TEMPLATE_SCOPES)[number];

export const TASK_TEMPLATE_SCOPE_DEFAULT = TASK_TEMPLATE_SCOPE_MINE;
