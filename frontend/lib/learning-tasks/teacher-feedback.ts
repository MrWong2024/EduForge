export const canEditTeacherFeedback = (
  feedback: { id?: unknown; source?: unknown; createdBy?: unknown },
  currentUserId: unknown,
): boolean =>
  feedback.source === "TEACHER" &&
  typeof feedback.id === "string" &&
  feedback.id.trim().length > 0 &&
  typeof currentUserId === "string" &&
  currentUserId.trim().length > 0 &&
  typeof feedback.createdBy === "string" &&
  feedback.createdBy.trim().length > 0 &&
  feedback.createdBy === currentUserId;
