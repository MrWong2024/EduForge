import {
  toTeacherFeedbackListResponse,
  type TeacherFeedbackItem,
  type UpdateTeacherFeedbackRequest,
} from "@/lib/api/types-teacher";
import { toMultilineInputValue } from "@/lib/form-text-values";
import {
  normalizeFeedbackSeverity,
  normalizeFeedbackType,
  type FeedbackSeverityValue,
  type FeedbackTypeValue,
} from "@/lib/ui/feedback-options";
import {
  FEEDBACK_TAG_OPTIONS,
  type FeedbackTagValue,
} from "@/lib/ui/feedback-tags";

export type TeacherFeedbackEditValues = {
  type: FeedbackTypeValue;
  severity: FeedbackSeverityValue;
  message: string;
  suggestion: string;
  tags: FeedbackTagValue[];
};

export function toTeacherFeedbackEditValues(
  feedback: TeacherFeedbackItem,
): TeacherFeedbackEditValues {
  return {
    type: normalizeFeedbackType(feedback.type),
    severity: normalizeFeedbackSeverity(feedback.severity),
    message: toMultilineInputValue(feedback.message ?? ""),
    suggestion: toMultilineInputValue(feedback.suggestion ?? ""),
    tags: [...new Set(feedback.tags)].filter((tag): tag is FeedbackTagValue =>
      FEEDBACK_TAG_OPTIONS.some((option) => option.value === tag),
    ),
  };
}

function getTeacherFeedbackEdits(
  baseline: TeacherFeedbackEditValues,
  draft: TeacherFeedbackEditValues,
): Partial<TeacherFeedbackEditValues> {
  const patch: Partial<TeacherFeedbackEditValues> = {};
  if (draft.type !== baseline.type) {
    patch.type = draft.type;
  }
  if (draft.severity !== baseline.severity) {
    patch.severity = draft.severity;
  }
  if (
    toMultilineInputValue(draft.message) !== toMultilineInputValue(baseline.message)
  ) {
    patch.message = draft.message;
  }
  if (
    toMultilineInputValue(draft.suggestion) !==
    toMultilineInputValue(baseline.suggestion)
  ) {
    patch.suggestion = draft.suggestion;
  }

  // The API stores an empty selection as the single tag "other".
  const originalTags = new Set(baseline.tags.length ? baseline.tags : ["other"]);
  const editedTags = new Set(draft.tags.length ? draft.tags : ["other"]);
  if (
    editedTags.size !== originalTags.size ||
    [...editedTags].some((tag) => !originalTags.has(tag))
  ) {
    patch.tags = [...new Set(draft.tags)];
  }
  return patch;
}

export function buildTeacherFeedbackEditPatch(
  original: TeacherFeedbackItem,
  draft: TeacherFeedbackEditValues,
): UpdateTeacherFeedbackRequest {
  const patch = getTeacherFeedbackEdits(
    toTeacherFeedbackEditValues(original),
    draft,
  );
  const expected: NonNullable<UpdateTeacherFeedbackRequest["expected"]> = {};
  if (patch.message !== undefined) expected.message = original.message ?? "";
  if (patch.suggestion !== undefined) {
    expected.suggestion = original.suggestion ?? null;
  }

  return Object.keys(expected).length > 0 ? { ...patch, expected } : patch;
}

export function findTeacherFeedbackForReview(
  payload: unknown,
  submissionId: string,
  feedbackId: string,
): TeacherFeedbackItem | undefined {
  return toTeacherFeedbackListResponse(payload).items.find(
    (item) =>
      item.source === "TEACHER" &&
      item.submissionId === submissionId &&
      item.id === feedbackId &&
      typeof item.message === "string",
  );
}

export function rebaseTeacherFeedbackDraft(
  original: TeacherFeedbackItem,
  draft: TeacherFeedbackEditValues,
  latest: TeacherFeedbackItem,
): TeacherFeedbackEditValues {
  return {
    ...toTeacherFeedbackEditValues(latest),
    ...getTeacherFeedbackEdits(toTeacherFeedbackEditValues(original), draft),
  };
}
