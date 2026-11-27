import {
  toListFeedbackResponse,
  toSubmissionDetailResponse,
} from "../api/types-student";

type ReadSubmissionJson = (
  path: string,
  options: { cache: "no-store"; signal?: AbortSignal },
) => Promise<unknown>;

export async function readSubmissionWithFeedback(
  submissionId: string,
  readJson: ReadSubmissionJson,
) {
  const path = `learning-tasks/submissions/${encodeURIComponent(submissionId)}`;
  const expectedId = submissionId.toLowerCase();
  const initialDetail = toSubmissionDetailResponse(
    await readJson(path, { cache: "no-store" }),
  );
  const feedback = toListFeedbackResponse(
    await readJson(`${path}/feedback`, { cache: "no-store" }),
  );
  if (initialDetail.id !== expectedId) throw new Error("Mismatched submission");
  if (feedback.items.length === 0) return { detail: initialDetail, feedback };

  // REVIEW_STARTED on the first read may come from a separate, later lookup
  // than the work's content. Only the timestamp from that document pins it.
  const detail = initialDetail.reviewStartedAt
    ? initialDetail
    : toSubmissionDetailResponse(
        await readJson(path, {
          cache: "no-store",
          // The signal also opts out of Next's per-render request deduplication.
          signal: AbortSignal.timeout(30_000),
        }),
      );
  if (
    detail.id !== expectedId ||
    detail.editing.canEdit ||
    (!detail.reviewStartedAt && detail.editing.reason !== "REVIEW_STARTED")
  ) {
    throw new Error("Submission and feedback are inconsistent");
  }
  return { detail, feedback };
}
