export type MemberRemovalFeedback =
  | { kind: "success"; message: string }
  | {
      kind: "error";
      studentName: string;
      status?: number;
      summary: string;
      detail?: string;
    };

export function updateMemberRemovalFeedback(
  current: ReadonlyMap<string, MemberRemovalFeedback>,
  studentUserId: string,
  feedback: MemberRemovalFeedback | null,
): ReadonlyMap<string, MemberRemovalFeedback> {
  if (feedback === null && !current.has(studentUserId)) return current;
  const next = new Map(current);
  if (feedback === null) next.delete(studentUserId);
  else next.set(studentUserId, feedback);
  return next;
}
