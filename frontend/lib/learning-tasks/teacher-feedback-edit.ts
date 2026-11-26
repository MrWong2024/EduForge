import type {
  TeacherFeedbackItem,
  UpdateTeacherFeedbackRequest,
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

export function buildTeacherFeedbackEditPatch(
  baseline: TeacherFeedbackEditValues,
  draft: TeacherFeedbackEditValues,
): UpdateTeacherFeedbackRequest {
  const patch: UpdateTeacherFeedbackRequest = {};
  if (draft.type !== baseline.type) {
    patch.type = draft.type;
  }
  if (draft.severity !== baseline.severity) {
    patch.severity = draft.severity;
  }
  if (toMultilineInputValue(draft.message) !== toMultilineInputValue(baseline.message)) {
    patch.message = draft.message;
  }
  if (toMultilineInputValue(draft.suggestion) !== toMultilineInputValue(baseline.suggestion)) {
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
