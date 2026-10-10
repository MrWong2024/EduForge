import { test, expect } from "@playwright/test";
import {
  toMyTaskDetailResponse,
  toSubmissionDetailResponse,
} from "../../lib/api/types-student";
import {
  toClassroomTask,
  toClassroomTaskSummary,
  toSubmissionDetailResponse as toTeacherDetail,
} from "../../lib/api/types-teacher";
import {
  AI_FEEDBACK_MODES,
  canSubmitTextTask,
  getTaskSnapshotMessage,
} from "../../lib/learning-tasks/ai-review";
import {
  buildTextSubmissionRequest,
  countCodePoints,
  getSubmissionTextError,
} from "../../lib/learning-tasks/text-submission";

test("preserves source, independent note and declaration without trimming", () => {
  const codeText =
    "  ===== FILE: src/main.ts =====\n\tconst value = '<img>';\n  ";
  const submissionNote = "  设计与核对\n\t修订：😀  ";
  const declaration = "  使用外部 AI 讨论方案\n  ";
  expect(
    buildTextSubmissionRequest(codeText, "typescript", submissionNote),
  ).toEqual({ content: { codeText, language: "typescript", submissionNote } });
  const payload = {
    id: "submission-1",
    taskTitle: "发布标题",
    taskSnapshotAvailable: true,
    content: { codeText, language: "typescript", submissionNote },
    meta: { aiUsageDeclaration: declaration },
  };
  const student = toSubmissionDetailResponse(payload);
  expect(student.content).toEqual({
    codeText,
    language: "typescript",
    submissionNote,
  });
  expect(student.meta).toEqual({ aiUsageDeclaration: declaration });
  expect(toTeacherDetail(payload)).toEqual(student);
});

test("allows 20,000 Unicode code points including non-BMP and variation selectors", () => {
  for (const note of [
    "a".repeat(20_000),
    "😀".repeat(20_000),
    "👩\uFE0F".repeat(10_000),
  ]) {
    expect(getSubmissionTextError("code", note)).toBeNull();
    expect(getSubmissionTextError("code", note + "中")).toBe(
      "提交说明不能超过 20,000 个 Unicode 码点，请检查说明长度。",
    );
  }
  expect(countCodePoints("A中😀\n👩\uFE0F")).toBe(6);
});
test("allows an empty note and rejects whitespace-only source", () => {
  expect(getSubmissionTextError("  code\n ", "")).toBeNull();
  expect(getSubmissionTextError(" \t\n", "说明")).toBe(
    "请填写代码内容后再提交。",
  );
  expect(
    buildTextSubmissionRequest("  code\n ", "auto", "").content.codeText,
  ).toBe("  code\n ");
});

test("consumes four real instance modes without losing existing settings", () => {
  for (const aiFeedbackMode of AI_FEEDBACK_MODES) {
    const payload = {
      id: "instance",
      taskSnapshotAvailable: true,
      publishedAt: "2026-10-01T00:00:00.000Z",
      dueAt: "2026-10-20T00:00:00.000Z",
      settings: { aiFeedbackMode, allowLate: false, maxAttempts: 2 },
      task: {
        title: "发布标题",
        description: "发布说明",
        status: "ARCHIVED",
        rubric: { dimensions: { design: 20 }, notes: "教师参考" },
      },
    };
    const detail = toClassroomTask(payload),
      list = toClassroomTaskSummary(payload);
    expect(detail).toMatchObject({
      aiFeedbackMode,
      taskSnapshotAvailable: true,
      allowLate: false,
      maxAttempts: 2,
      dueAt: "2026-10-20T00:00:00.000Z",
      title: "发布标题",
      description: "发布说明",
      rubric: { dimensions: { design: 20 }, notes: "教师参考" },
    });
    expect(list).toMatchObject({
      aiFeedbackMode,
      taskSnapshotAvailable: true,
      allowLate: false,
      maxAttempts: 2,
    });
  }
});
test("requires explicit snapshot and backend submit permission, independent of AI request permission", () => {
  const detail = toMyTaskDetailResponse({
    classroomTask: {
      taskSnapshotAvailable: true,
      settings: { aiFeedbackMode: "TEACHER_ONLY" },
    },
    task: { status: "ARCHIVED" },
    participationStatus: {
      reason: "ACTIVE",
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: false,
      message: null,
    },
  });
  expect(detail.classroomTask.settings.aiFeedbackMode).toBe("TEACHER_ONLY");
  expect(
    canSubmitTextTask(
      detail.classroomTask.taskSnapshotAvailable,
      detail.participationStatus?.canSubmit,
    ),
  ).toBe(true);
  expect(canSubmitTextTask(false, true)).toBe(false);
  expect(canSubmitTextTask(undefined, true)).toBe(false);
  expect(canSubmitTextTask(true, undefined)).toBe(false);
  expect(canSubmitTextTask(true, false)).toBe(false);
});
test("keeps missing and false snapshot distinct and closes incomplete participation", () => {
  expect(
    toMyTaskDetailResponse({ classroomTask: { taskSnapshotAvailable: false } })
      .classroomTask.taskSnapshotAvailable,
  ).toBe(false);
  expect(
    toMyTaskDetailResponse({ classroomTask: {} }).classroomTask
      .taskSnapshotAvailable,
  ).toBeUndefined();
  expect(getTaskSnapshotMessage(false)).toBe(
    "未保存发布时任务内容，当前说明为模板现状；请教师重新布置后继续。",
  );
  const detail = toMyTaskDetailResponse({
    participationStatus: {
      reason: "ACTIVE",
      canSubmit: "true",
      canRequestAiFeedback: 1,
    },
  });
  expect(detail.participationStatus?.canSubmit).toBe(false);
  expect(detail.participationStatus?.canRequestAiFeedback).toBe(false);
  expect(detail.participationStatus?.readOnly).toBe(true);
});
