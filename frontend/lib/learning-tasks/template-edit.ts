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

function diffTaskTemplateEditDraft(
  baseline: Readonly<TaskTemplateEditDraft>,
  draft: Readonly<TaskTemplateEditDraft>,
) {
  const difficultyPatch = updateDifficultyPayload(
    baseline.difficulty,
    draft.difficulty,
  );
  const references = (() => {
    try {
      const patch: Pick<UpdateLearningTaskRequest, "aiContextRefs"> =
        buildAiContextRefsPatch(
          draft.aiContextText,
          parseAiContextRefsJson(baseline.aiContextText),
        );
      return { kind: "valid" as const, patch };
    } catch (error) {
      return {
        kind: "invalid" as const,
        message: error instanceof Error ? error.message : "引用 JSON 不合法。",
      };
    }
  })();
  return {
    changed: {
      title: draft.title.trim() !== baseline.title.trim(),
      description: draft.description !== baseline.description,
      knowledgeModule:
        draft.knowledgeModule.trim() !== baseline.knowledgeModule.trim(),
      courseLabel:
        courseLabelInput(draft.courseLabel) !==
        courseLabelInput(baseline.courseLabel),
      visibility: draft.visibility !== baseline.visibility,
      difficulty: difficultyPatch.difficulty !== undefined,
      rubricNotes: draft.rubricNotes.trim() !== baseline.rubricNotes.trim(),
      aiContextText:
        references.kind === "invalid" ||
        references.patch.aiContextRefs !== undefined,
    },
    difficultyPatch,
    references,
  };
}

export function reconcileTaskTemplatePublishedDraft(
  baseline: Readonly<TaskTemplateEditDraft>,
  draft: Readonly<TaskTemplateEditDraft>,
  published: Readonly<TaskTemplateEditDraft>,
): TaskTemplateEditDraft {
  const { changed } = diffTaskTemplateEditDraft(baseline, draft);
  return {
    title: changed.title ? draft.title : published.title,
    description: changed.description
      ? draft.description
      : published.description,
    knowledgeModule: changed.knowledgeModule
      ? draft.knowledgeModule
      : published.knowledgeModule,
    courseLabel: changed.courseLabel
      ? draft.courseLabel
      : published.courseLabel,
    visibility: changed.visibility ? draft.visibility : published.visibility,
    difficulty: changed.difficulty ? draft.difficulty : published.difficulty,
    rubricNotes: changed.rubricNotes
      ? draft.rubricNotes
      : published.rubricNotes,
    aiContextText: changed.aiContextText
      ? draft.aiContextText
      : published.aiContextText,
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

  const diff = diffTaskTemplateEditDraft(baseline, draft);
  if (diff.references.kind === "invalid") {
    return {
      kind: "invalid",
      field: "aiContextText",
      message: diff.references.message,
    };
  }

  const payload: UpdateLearningTaskRequest = {
    ...diff.difficultyPatch,
    ...diff.references.patch,
  };
  if (diff.changed.title) {
    payload.title = draft.title.trim();
  }
  if (diff.changed.description) {
    payload.description = draft.description;
  }
  if (diff.changed.knowledgeModule) {
    payload.knowledgeModule = draft.knowledgeModule.trim();
  }
  if (diff.changed.courseLabel) {
    payload.courseLabel = courseLabelInput(draft.courseLabel);
  }
  if (diff.changed.visibility) {
    payload.visibility = draft.visibility;
  }
  if (diff.changed.rubricNotes) {
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
        source.rubric !== null &&
        !isRecord(source.rubric))
    ) {
      return invalid;
    }
    if (submittedPayload.rubric !== undefined) {
      const submittedRubric = submittedPayload.rubric;
      const returnedRubric = source.rubric;
      if (!isRecord(submittedRubric) || !isRecord(returnedRubric)) {
        return invalid;
      }
      const submittedKeys = Object.keys(submittedRubric);
      const returnedKeys = Object.keys(returnedRubric);
      if (submittedKeys.length === 0) {
        if (returnedKeys.length !== 0) return invalid;
      } else if (
        submittedKeys.length !== 1 ||
        submittedKeys[0] !== "notes" ||
        typeof submittedRubric.notes !== "string" ||
        returnedKeys.length !== 1 ||
        returnedKeys[0] !== "notes" ||
        returnedRubric.notes !== submittedRubric.notes
      ) {
        return invalid;
      }
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
