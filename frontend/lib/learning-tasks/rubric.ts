type TaskRubricNotes = { notes: string };

export const getRubricNotes = (rubric: unknown): string => {
  if (!rubric || typeof rubric !== "object" || Array.isArray(rubric)) {
    return "";
  }
  const notes = (rubric as Record<string, unknown>).notes;
  return typeof notes === "string" ? notes : "";
};

export const buildCreateTaskRubric = (
  notes: string,
): TaskRubricNotes | undefined => {
  const trimmedNotes = notes.trim();
  return trimmedNotes ? { notes: trimmedNotes } : undefined;
};

export const buildUpdateTaskRubric = (
  notes: string,
): TaskRubricNotes | Record<string, never> =>
  buildCreateTaskRubric(notes) ?? {};

export const getRubricSummary = (rubric: unknown): "已填写" | "未填写" =>
  getRubricNotes(rubric).trim() ? "已填写" : "未填写";

export const getCandidateRubricSummary = (rubric: unknown): string =>
  rubric === undefined
    ? "候选列表未提供评阅标准，请到模板详情核对"
    : getRubricSummary(rubric);
