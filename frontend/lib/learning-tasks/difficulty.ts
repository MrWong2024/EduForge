export const TASK_DIFFICULTY_OPTIONS = [
  { value: "easy", label: "基础" },
  { value: "medium", label: "进阶" },
  { value: "hard", label: "挑战" },
] as const;

export const parseDifficultyFilter = (
  value: unknown,
): (typeof TASK_DIFFICULTY_OPTIONS)[number]["value"] | undefined =>
  TASK_DIFFICULTY_OPTIONS.find((option) => option.value === value)?.value;

export const TASK_DIFFICULTY_HELP =
  "相对于本课程当前教学阶段：基础侧重直接运用，进阶侧重综合运用，挑战侧重开放设计或复杂问题。仅用于教学定位，不影响评阅标准。";

export const toDifficultyInputValue = (value: unknown): string =>
  parseDifficultyFilter(value) ?? "";

export const getDifficultyLabel = (value: unknown): string =>
  TASK_DIFFICULTY_OPTIONS.find((option) => option.value === value)?.label ??
  "未设置";

export const createDifficultyPayload = (
  value: string,
): { difficulty?: string } => {
  const difficulty = toDifficultyInputValue(value);
  return difficulty ? { difficulty } : {};
};

export const updateDifficultyPayload = (
  initial: unknown,
  value: string,
): { difficulty?: string } => {
  const difficulty = toDifficultyInputValue(value);
  return difficulty === toDifficultyInputValue(initial) ? {} : { difficulty };
};
