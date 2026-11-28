import { parseDifficultyFilter } from "./difficulty";

export type TemplateListQueryChanges = Partial<
  Record<
    "scope" | "status" | "courseLabel" | "knowledgeModule" | "difficulty" | "page",
    string | undefined
  >
>;

export function readTemplateListDifficulty(
  params: URLSearchParams,
  fallback?: string,
) {
  const values = params.getAll("difficulty");
  return parseDifficultyFilter(
    values.length === 0 ? fallback : values.length === 1 ? values[0] : values,
  );
}

export function normalizeTemplateListQuery(query: string) {
  const params = new URLSearchParams(query);
  params.delete("stage");
  const difficulty = readTemplateListDifficulty(params);
  if (difficulty) {
    params.set("difficulty", difficulty);
  } else {
    params.delete("difficulty");
  }
  return params;
}

export function updateTemplateListQuery(
  query: string,
  changes: TemplateListQueryChanges,
) {
  const params = normalizeTemplateListQuery(query);
  for (const [name, value] of Object.entries(changes)) {
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
  }
  params.set("page", changes.page ?? "1");
  return params.toString();
}
