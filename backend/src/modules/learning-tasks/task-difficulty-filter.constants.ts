export const TASK_DIFFICULTY_FILTER_VALUES = [
  'easy',
  'medium',
  'hard',
] as const;

export type TaskDifficultyFilter =
  (typeof TASK_DIFFICULTY_FILTER_VALUES)[number];
