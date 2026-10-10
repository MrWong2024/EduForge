import type {
  RequestAiFeedbackResponse,
  SubmissionDetailResponse,
} from "../api/types-student";
import { normalizeAiStatus, type AiReview, type AiStatus } from "./ai-review";

type Operation = {
  submissionId: string;
  sequence: number;
  kind: "request" | "read";
  explicit: boolean;
};
type Snapshot = { status: AiStatus | undefined; review: AiReview | undefined };

// This guard belongs to one mounted submission. It orders local operations,
// not backend Job transitions. Page props are only the initial read.
export class SubmissionAiOperations {
  private sequence = 0;
  private active: Operation | null = null;
  private confirmedJob = false;
  private needsConfirmation = false;
  private accepted: Snapshot;

  constructor(
    readonly submissionId: string,
    status?: string,
    review?: AiReview,
  ) {
    this.accepted = { status: normalizeAiStatus(status), review };
  }
  get view() {
    return {
      ...this.accepted,
      busy: this.active?.kind ?? null,
      confirmedJob: this.confirmedJob,
      needsConfirmation: this.needsConfirmation,
      canRequest:
        this.active === null &&
        !this.confirmedJob &&
        !this.needsConfirmation &&
        this.accepted.review?.canRequest === true,
    };
  }
  beginRequest(): Operation | null {
    if (!this.view.canRequest) return null;
    return this.start("request", false);
  }
  beginRead(explicit: boolean): Operation | null {
    if (this.active || (this.needsConfirmation && !explicit)) return null;
    return this.start("read", explicit);
  }
  private start(kind: Operation["kind"], explicit: boolean): Operation {
    this.active = {
      submissionId: this.submissionId,
      sequence: ++this.sequence,
      kind,
      explicit,
    };
    return this.active;
  }
  private matches(operation: Operation, kind: Operation["kind"]): boolean {
    return (
      operation.submissionId === this.submissionId &&
      operation.sequence === this.active?.sequence &&
      operation.kind === kind &&
      this.active.kind === kind
    );
  }
  finishRequest(
    operation: Operation,
    result?: RequestAiFeedbackResponse,
  ): boolean | null {
    if (!this.matches(operation, "request")) return null;
    this.active = null;
    const status =
      normalizeAiStatus(result?.aiFeedbackStatus) ??
      normalizeAiStatus(result?.status);
    if (
      !result ||
      result.submissionId !== this.submissionId ||
      !result.jobId ||
      !status
    ) {
      this.needsConfirmation = true;
      return false;
    }
    this.confirmedJob = true;
    // POST is not a full summary: do not reuse pre-request usage/eligibility.
    this.accepted = { status, review: undefined };
    return true;
  }
  finishRead(
    operation: Operation,
    detail?: SubmissionDetailResponse,
  ): boolean | null {
    if (!this.matches(operation, "read")) return null;
    this.active = null;
    if (
      !detail ||
      !isCompleteAiDetail(detail, this.submissionId) ||
      (this.confirmedJob &&
        (detail.aiFeedbackStatus === "NOT_REQUESTED" ||
          detail.aiReview?.canRequest === true))
    ) {
      this.needsConfirmation = true;
      return false;
    }
    this.accepted = {
      status: normalizeAiStatus(detail.aiFeedbackStatus),
      review: detail.aiReview,
    };
    if (operation.explicit) this.needsConfirmation = false;
    return true;
  }
  cancelPending(): void {
    if (this.active?.kind === "request") this.needsConfirmation = true;
    ++this.sequence;
    this.active = null;
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function isCompleteAiDetail(
  detail: SubmissionDetailResponse,
  submissionId: string,
): boolean {
  const summary = record(detail.raw.aiReview),
    usage = record(summary.usage);
  // The mapper preserves unknowns. A recovery read must contain the public
  // summary fields, rather than turning omitted fields into a confirmation.
  return (
    detail.id === submissionId &&
    normalizeAiStatus(detail.aiFeedbackStatus) !== undefined &&
    typeof detail.aiReview?.canRequest === "boolean" &&
    typeof detail.aiReview.retryScheduled === "boolean" &&
    detail.aiReview.inputCoverage !== null &&
    (summary.provider === null ||
      summary.provider === "stub" ||
      summary.provider === "bailian") &&
    [
      "provider",
      "canRequest",
      "requestBlockReason",
      "failure",
      "retryScheduled",
      "nextRetryAt",
      "inputCoverage",
      "usage",
    ].every((key) => Object.hasOwn(summary, key)) &&
    [
      "reservedRequests",
      "reportedRequests",
      "promptTokens",
      "completionTokens",
      "totalTokens",
    ].every((key) => Object.hasOwn(usage, key))
  );
}
