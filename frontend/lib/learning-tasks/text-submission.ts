import { paths } from "../routes/paths";
import { getCommonErrorSummary } from "../ui/status";
import { toMultilineInputValue } from "../form-text-values";
import type {
  CreateSubmissionRequest,
  SubmissionDetailResponse,
  UpdateSubmissionRequest,
} from "../api/types-student";
export const SUBMISSION_NOTE_MAX_CODE_POINTS = 20_000;
export const countCodePoints = (value: string): number =>
  Array.from(value).length;
export function getSubmissionTextError(
  codeText: string,
  submissionNote: string,
): string | null {
  if (!codeText.trim()) return "请填写代码内容后再提交。";
  if (countCodePoints(submissionNote) > SUBMISSION_NOTE_MAX_CODE_POINTS)
    return "提交说明不能超过 20,000 个 Unicode 码点，请检查说明长度。";
  return null;
}
export const buildTextSubmissionRequest = (
  codeText: string,
  language: string,
  submissionNote: string,
): CreateSubmissionRequest => ({
  content: { codeText, language, submissionNote },
});

export const isValidContentRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isSubmissionReviewStarted = (
  detail: SubmissionDetailResponse,
): boolean =>
  detail.editing.reason === "REVIEW_STARTED" ||
  (typeof detail.reviewStartedAt === "string" &&
    Number.isFinite(Date.parse(detail.reviewStartedAt)));

export const canEditSubmission = (detail: SubmissionDetailResponse): boolean =>
  isValidContentRevision(detail.contentRevision) &&
  detail.editing.canEdit === true &&
  !isSubmissionReviewStarted(detail);

export function acceptSubmissionEditingRead(
  local: SubmissionDetailResponse | null,
  received: SubmissionDetailResponse,
  readSequence: number,
  currentSequence: number,
): SubmissionDetailResponse | null {
  if (
    readSequence !== currentSequence ||
    !isValidContentRevision(received.contentRevision)
  )
    return local;
  if (
    local &&
    isValidContentRevision(local.contentRevision) &&
    (local.contentRevision > received.contentRevision ||
      (local.contentRevision === received.contentRevision &&
        isSubmissionReviewStarted(local) &&
        !isSubmissionReviewStarted(received)))
  )
    return local;
  return received;
}

export function selectSubmissionDisplayDetail(
  pageDetail: SubmissionDetailResponse,
  savedDetail: SubmissionDetailResponse | null,
): SubmissionDetailResponse {
  // A malformed current response must close actions rather than reviving an
  // older permission. A confirmed save can bridge an older page refresh.
  if (!isValidContentRevision(pageDetail.contentRevision)) return pageDetail;
  if (
    savedDetail &&
    isValidContentRevision(savedDetail.contentRevision) &&
    (savedDetail.contentRevision > pageDetail.contentRevision ||
      (savedDetail.contentRevision === pageDetail.contentRevision &&
        !canEditSubmission(savedDetail) &&
        canEditSubmission(pageDetail)))
  )
    return savedDetail;
  return pageDetail;
}

export function buildUpdateSubmissionRequest(
  expectedRevision: number,
  codeText: string,
  language: string,
  submissionNote: string,
): UpdateSubmissionRequest {
  if (!isValidContentRevision(expectedRevision))
    throw new Error("A valid displayed content revision is required");
  return { expectedRevision, content: { codeText, language, submissionNote } };
}

export function captureSubmissionEditBaseline(
  detail: SubmissionDetailResponse,
): UpdateSubmissionRequest | null {
  const revision = detail.contentRevision;
  if (!isValidContentRevision(revision) || !canEditSubmission(detail))
    return null;

  return buildUpdateSubmissionRequest(
    revision,
    detail.content.codeText ?? "",
    detail.content.language ?? "auto",
    detail.content.submissionNote ?? "",
  );
}

export function planSubmissionEdit(
  baseline: Readonly<UpdateSubmissionRequest>,
  draft: Readonly<UpdateSubmissionRequest["content"]>,
): UpdateSubmissionRequest | null {
  const original = baseline.content;
  const codeChanged =
    toMultilineInputValue(draft.codeText) !==
    toMultilineInputValue(original.codeText);
  const noteChanged =
    toMultilineInputValue(draft.submissionNote) !==
    toMultilineInputValue(original.submissionNote);

  if (draft.language === original.language && !codeChanged && !noteChanged)
    return null;

  return buildUpdateSubmissionRequest(
    baseline.expectedRevision,
    codeChanged ? draft.codeText : original.codeText,
    draft.language,
    noteChanged ? draft.submissionNote : original.submissionNote,
  );
}

export const isDraftRevisionCurrent = (
  baseRevision: unknown,
  currentRevision: unknown,
): boolean =>
  isValidContentRevision(baseRevision) && baseRevision === currentRevision;

export const isSavedSubmissionRevision = (
  baseRevision: unknown,
  returnedRevision: unknown,
): boolean =>
  isValidContentRevision(baseRevision) &&
  isValidContentRevision(returnedRevision) &&
  returnedRevision > baseRevision;

export function isSubmissionReviewStartedError(data: unknown): boolean {
  const code =
    data && typeof data === "object" && "code" in data ? data.code : undefined;
  const message =
    data && typeof data === "object" && "message" in data
      ? data.message
      : undefined;
  // The public exception filter preserves the message but may omit code.
  // Match only the complete known public strings; never display raw errors.
  return (
    code === "SUBMISSION_REVIEW_STARTED" ||
    message ===
      "本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。"
  );
}

export function getSubmissionRevisionError(data: unknown): string {
  const code =
    data && typeof data === "object" && "code" in data ? data.code : undefined;
  const message =
    data && typeof data === "object" && "message" in data
      ? data.message
      : undefined;
  if (isSubmissionReviewStartedError(data))
    return "本次提交已进入评阅，不能再修改作品。未保存的修改已保留，请在本页核对当前作品与反馈。";
  if (
    code === "SUBMISSION_REVISION_CONFLICT" ||
    message === "作品内容已变化，请查看最新提交并核对草稿后明确继续。"
  )
    return "作品内容已变化，当前操作依据的是旧版作品。当前输入已保留，请在本页核对最新作品，确认后再继续。";
  if (
    code === "SUBMISSION_INVALID_STATE" ||
    message === "提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。"
  )
    return "提交状态暂不可用。当前输入已保留，请在本页核对详情或联系教师。";
  return "提交状态已变化。当前输入已保留，请先在本页核对最新详情。";
}

// Network completion does not clear a confirmed save.
export const canCreateTextSubmission = (
  inFlight: boolean,
  resultUncertain: boolean,
  savedSubmissionId: string | null,
): boolean => !inFlight && !resultUncertain && savedSubmissionId === null;

export const getSavedSubmissionHref = (
  submissionId: string,
  classroomId: string,
  classroomTaskId: string,
): string =>
  paths.student.submissionDetail(submissionId) +
  "?" +
  new URLSearchParams({ classroomId, classroomTaskId }).toString();

const submissionConflictMessages = new Set([
  "班级已归档，不能继续提交该任务。",
  "课堂任务已关闭，不能继续提交。",
  "该课堂任务未保存发布内容，请教师重新布置后继续。",
]);
export function getTextSubmissionError(status: number, data: unknown): string {
  const message =
    data && typeof data === "object" && "message" in data
      ? data.message
      : undefined;
  if (typeof message === "string") {
    if (
      status === 403 &&
      message === "Late submission is not allowed for this classroom task"
    )
      return "已截止，禁止迟交，请联系老师。";
    if (status === 409 && submissionConflictMessages.has(message))
      return message;
    if (status === 429) {
      const match =
        /^提交过于频繁。当前设置的提交冷却时间为 ([1-9]\d*) 秒，请约 ([1-9]\d*) 秒后再试。$/u.exec(
          message,
        );
      if (
        match &&
        match[0] === message &&
        Number.isSafeInteger(Number(match[1])) &&
        Number.isSafeInteger(Number(match[2]))
      )
        return message;
    }
  }
  return status === 403
    ? "无权限提交该课堂任务。"
    : getCommonErrorSummary(status, "提交作业");
}
