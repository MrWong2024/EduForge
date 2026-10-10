import { paths } from "../routes/paths";
import { getCommonErrorSummary } from "../ui/status";
import type { CreateSubmissionRequest } from "../api/types-student";
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
