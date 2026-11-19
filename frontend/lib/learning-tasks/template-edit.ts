import {
  toLearningTaskUpdateResponse,
  type LearningTaskDetailResponse,
  type UpdateLearningTaskRequest,
} from "../api/types-teacher";
import {
  buildAiContextRefsPatch,
  formatAiContextRefs,
  parseAiContextRefsJson,
  readAiContextRefs,
} from "./ai-context-refs";
import {
  normalizeTaskCourseLabel,
  TASK_COURSE_LABEL_UNCLASSIFIED,
} from "./course-labels";
import { toDifficultyInputValue, updateDifficultyPayload } from "./difficulty";
import { buildUpdateTaskRubric, getRubricNotes } from "./rubric";
import {
  normalizeTaskTemplateVisibility,
  TASK_TEMPLATE_VISIBILITY_SHARED,
  type TaskTemplateVisibility,
} from "./template-visibility-scope";

export type TaskTemplateEditDraft = {
  title: string;
  description: string;
  knowledgeModule: string;
  courseLabel: string;
  visibility: TaskTemplateVisibility;
  difficulty: string;
  rubricNotes: string;
  aiContextText: string;
};

export type TaskTemplateEditRequestResult =
  | { kind: "unchanged" }
  | { kind: "invalid"; field: keyof TaskTemplateEditDraft; message: string }
  | { kind: "changed"; payload: UpdateLearningTaskRequest };

export type TaskTemplateEditReceiptResult =
  | { kind: "invalid"; message: string }
  | {
      kind: "valid";
      task: LearningTaskDetailResponse;
      draft: TaskTemplateEditDraft;
    };

const courseLabelInput = (value: unknown): string => {
  const label = normalizeTaskCourseLabel(value);
  return label && label !== TASK_COURSE_LABEL_UNCLASSIFIED ? label : "";
};

export function toTaskTemplateEditDraft(
  task: LearningTaskDetailResponse,
): TaskTemplateEditDraft {
  return {
    title: task.title ?? "",
    description: task.description ?? "",
    knowledgeModule: task.knowledgeModule ?? "",
    courseLabel: courseLabelInput(task.courseLabel),
    visibility:
      normalizeTaskTemplateVisibility(task.visibility) ??
      TASK_TEMPLATE_VISIBILITY_SHARED,
    difficulty: toDifficultyInputValue(task.difficulty),
    rubricNotes: getRubricNotes(task.rubric),
    aiContextText: formatAiContextRefs(task.aiContextRefs ?? []),
  };
}

export function buildTaskTemplateEditRequest(
  baseline: Readonly<TaskTemplateEditDraft>,
  draft: Readonly<TaskTemplateEditDraft>,
): TaskTemplateEditRequestResult {
  for (const [field, message] of [
    ["title", "请填写任务模板标题。"],
    ["description", "请填写任务模板描述。"],
    ["knowledgeModule", "请填写知识模块。"],
  ] as const) {
    if (!draft[field].trim()) return { kind: "invalid", field, message };
  }

  let refsPatch: Pick<UpdateLearningTaskRequest, "aiContextRefs">;
  try {
    refsPatch = buildAiContextRefsPatch(
      draft.aiContextText,
      parseAiContextRefsJson(baseline.aiContextText),
    );
  } catch (error) {
    return {
      kind: "invalid",
      field: "aiContextText",
      message: error instanceof Error ? error.message : "引用 JSON 不合法。",
    };
  }

  const payload: UpdateLearningTaskRequest = {
    ...updateDifficultyPayload(baseline.difficulty, draft.difficulty),
    ...refsPatch,
  };
  if (draft.title.trim() !== baseline.title.trim()) {
    payload.title = draft.title.trim();
  }
  if (draft.description !== baseline.description) {
    payload.description = draft.description;
  }
  if (draft.knowledgeModule.trim() !== baseline.knowledgeModule.trim()) {
    payload.knowledgeModule = draft.knowledgeModule.trim();
  }
  if (
    courseLabelInput(draft.courseLabel) !==
    courseLabelInput(baseline.courseLabel)
  ) {
    payload.courseLabel = courseLabelInput(draft.courseLabel);
  }
  if (draft.visibility !== baseline.visibility) {
    payload.visibility = draft.visibility;
  }
  if (draft.rubricNotes.trim() !== baseline.rubricNotes.trim()) {
    payload.rubric = buildUpdateTaskRubric(draft.rubricNotes);
  }
  return Object.keys(payload).length
    ? { kind: "changed", payload }
    : { kind: "unchanged" };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function confirmTaskTemplateEditReceipt(
  taskId: string,
  rawResponse: unknown,
  submittedPayload: UpdateLearningTaskRequest,
): TaskTemplateEditReceiptResult {
  const invalid: TaskTemplateEditReceiptResult = {
    kind: "invalid",
    message: "保存结果无法确认，请刷新核对后再操作。",
  };
  try {
    const task = toLearningTaskUpdateResponse(rawResponse);
    const source = task.raw;
    // Check the source fields as well as the adapter, which intentionally has
    // display fallbacks that cannot confirm a successful write.
    if (
      source.id !== taskId ||
      !task.createdById ||
      ["title", "description", "knowledgeModule"].some(
        (field) => typeof source[field] !== "string" || !source[field].trim(),
      ) ||
      (source.status !== "DRAFT" &&
        source.status !== "PUBLISHED" &&
        source.status !== "ARCHIVED") ||
      (source.visibility !== "PRIVATE" && source.visibility !== "SHARED") ||
      (source.courseLabel !== undefined &&
        typeof source.courseLabel !== "string") ||
      (source.difficulty !== undefined &&
        typeof source.difficulty !== "string") ||
      (source.rubric !== undefined &&
        (!isRecord(source.rubric) ||
          (source.rubric.notes !== undefined &&
            typeof source.rubric.notes !== "string")))
    ) {
      return invalid;
    }
    if (submittedPayload.aiContextRefs !== undefined) {
      const returnedRefs = readAiContextRefs(source.aiContextRefs);
      const submittedRefs = readAiContextRefs(submittedPayload.aiContextRefs);
      if (JSON.stringify(returnedRefs) !== JSON.stringify(submittedRefs)) {
        return invalid;
      }
    }
    return { kind: "valid", task, draft: toTaskTemplateEditDraft(task) };
  } catch {
    return invalid;
  }
}
