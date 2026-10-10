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
