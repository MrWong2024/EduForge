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
  canCreateTextSubmission,
  getSavedSubmissionHref,
  getTextSubmissionError,
  countCodePoints,
  getSubmissionTextError,
  buildUpdateSubmissionRequest,
  canEditSubmission,
  isDraftRevisionCurrent,
  isSavedSubmissionRevision,
  selectSubmissionDisplayDetail,
  getSubmissionRevisionError,
} from "../../lib/learning-tasks/text-submission";

test("only an explicit valid revision and complete server editing permission allow editing", () => {
  const valid = {
    contentRevision: 0,
    editing: { canEdit: true, reason: null, message: null },
  };
  expect(canEditSubmission(toSubmissionDetailResponse(valid))).toBe(true);
  for (const contentRevision of [
    undefined,
    null,
    "0",
    -1,
    1.5,
    Number.NaN,
    Infinity,
  ]) {
    const detail = toSubmissionDetailResponse({ ...valid, contentRevision });
    expect(canEditSubmission(detail)).toBe(false);
    expect(detail.contentRevision).toBe(
      contentRevision === null ? null : undefined,
    );
  }
  for (const editing of [
    undefined,
    null,
    {},
    { canEdit: true },
    { canEdit: "true", reason: null, message: null },
    { canEdit: true, reason: "UNKNOWN", message: null },
    { canEdit: false, reason: "REVIEW_STARTED", message: "已进入评阅" },
  ]) {
    expect(
      canEditSubmission(toSubmissionDetailResponse({ ...valid, editing })),
    ).toBe(false);
  }
  const times = {
    lastEditedAt: "2026-10-28T01:00:00.000Z",
    lastEditIsLate: true,
    reviewStartedAt: null,
  };
  expect(toSubmissionDetailResponse({ ...valid, ...times })).toMatchObject(
    times,
  );
  expect(toTeacherDetail({ ...valid, ...times })).toEqual(
    toSubmissionDetailResponse({ ...valid, ...times }),
  );
  const malformed = toSubmissionDetailResponse({
    lastEditedAt: "bad",
    lastEditIsLate: "true",
    reviewStartedAt: 123,
  });
  expect(malformed.lastEditedAt).toBeUndefined();
  expect(malformed.lastEditIsLate).toBeUndefined();
  expect(malformed.reviewStartedAt).toBeUndefined();
});

test("edit requests preserve text, require captured revision and contain only the content whitelist", () => {
  const code = "  print('😀')\r\n\t ",
    note = " 说明\n ";
  expect(buildUpdateSubmissionRequest(2, code, "python", note)).toEqual({
    expectedRevision: 2,
    content: { language: "python", codeText: code, submissionNote: note },
  });
  expect(
    buildUpdateSubmissionRequest(0, code, "auto", "").content.submissionNote,
  ).toBe("");
  for (const revision of [-1, 1.5, Number.NaN, Infinity])
    expect(() =>
      buildUpdateSubmissionRequest(revision, code, "auto", note),
    ).toThrow();
});

test("a refreshed work version invalidates the captured student or teacher draft until explicit confirmation", () => {
  for (const text of ["学生保留的代码草稿", "教师保留的评语草稿"]) {
    const draft = { baseRevision: 2, text };
    const refreshed = toSubmissionDetailResponse({ contentRevision: 3 });
    expect(
      isDraftRevisionCurrent(draft.baseRevision, refreshed.contentRevision),
    ).toBe(false);
    expect(draft).toEqual({ baseRevision: 2, text });
    expect(isDraftRevisionCurrent(draft.baseRevision, undefined)).toBe(false);
    expect(isDraftRevisionCurrent(draft.baseRevision, 2)).toBe(true);
    // The explicit confirmation keeps user input while changing only its reviewed basis.
    const confirmed = { ...draft, baseRevision: refreshed.contentRevision };
    expect(confirmed.text).toBe(text);
    expect(
      isDraftRevisionCurrent(confirmed.baseRevision, refreshed.contentRevision),
    ).toBe(true);
  }
  expect(
    getSubmissionRevisionError({ code: "SUBMISSION_REVISION_CONFLICT" }),
  ).toContain("旧版作品");
  expect(
    getSubmissionRevisionError({ code: "SUBMISSION_REVIEW_STARTED" }),
  ).toContain("已进入评阅");
  expect(
    getSubmissionRevisionError({ message: "private stack" }),
  ).not.toContain("private stack");
});

test("a confirmed edit accepts an authoritative later version without accepting stale or invalid revisions", () => {
  expect(isSavedSubmissionRevision(2, 3)).toBe(true);
  expect(isSavedSubmissionRevision(2, 4)).toBe(true);
  for (const revision of [2, 1, null, undefined, "3", -1, 3.5, Number.NaN])
    expect(isSavedSubmissionRevision(2, revision)).toBe(false);
  expect(isSavedSubmissionRevision(undefined, 3)).toBe(false);
});

test("distinguishes real public 409 responses after the exception filter omits code", () => {
  const body = (message: unknown) => ({
    statusCode: 409,
    timestamp: "2026-10-28T01:00:00.000Z",
    path: "/api/learning-tasks/submissions/submission-1",
    message,
  });
  const contentChanged = "作品内容已变化，请查看最新提交并核对草稿后明确继续。";
  const reviewStarted =
    "本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。";
  const invalidState =
    "提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。";
  expect(getSubmissionRevisionError(body(contentChanged))).toBe(
    "作品内容已变化，当前操作依据的是旧版作品。草稿已保留，请刷新查看并明确确认后继续。",
  );
  expect(getSubmissionRevisionError(body(reviewStarted))).toBe(
    "本次提交已进入评阅，不能再修改作品。草稿已保留，请核对当前作品与反馈。",
  );
  expect(getSubmissionRevisionError(body(invalidState))).toBe(
    "提交状态暂不可用。草稿已保留，请核对详情或联系教师。",
  );
  for (const message of [
    "private stack",
    contentChanged + " ",
    reviewStarted + "\nprivate stack",
    invalidState + "private stack",
    [reviewStarted],
    null,
  ]) {
    expect(getSubmissionRevisionError(body(message))).toBe(
      "提交状态已变化。草稿已保留，请先核对最新详情。",
    );
  }
});

test("saved work bridges an old page response but cannot revive permission from an invalid latest detail", () => {
  const permission = { canEdit: true, reason: null, message: null };
  const old = toSubmissionDetailResponse({
    contentRevision: 0,
    content: { codeText: "A" },
    editing: permission,
  });
  const saved = toSubmissionDetailResponse({
    contentRevision: 1,
    content: { codeText: "B" },
    editing: permission,
  });
  expect(selectSubmissionDisplayDetail(old, saved)).toBe(saved);
  for (const contentRevision of [undefined, null, -1, "1"]) {
    const invalid = toSubmissionDetailResponse({
      contentRevision,
      editing: permission,
    });
    const display = selectSubmissionDisplayDetail(invalid, saved);
    expect(display).toBe(invalid);
    expect(canEditSubmission(display)).toBe(false);
  }
  const locked = toSubmissionDetailResponse({
    ...saved.raw,
    reviewStartedAt: "2026-10-28T01:00:00Z",
    editing: {
      canEdit: false,
      reason: "REVIEW_STARTED",
      message: "已进入评阅",
    },
  });
  expect(selectSubmissionDisplayDetail(locked, saved)).toBe(locked);
  expect(selectSubmissionDisplayDetail(saved, locked)).toBe(locked);
});

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

test("a saved submission stays locked after busy ends and recovery opens that same detail", () => {
  expect(canCreateTextSubmission(false, false, null)).toBe(true);
  expect(canCreateTextSubmission(true, false, null)).toBe(false);
  expect(canCreateTextSubmission(false, true, null)).toBe(false);
  expect(canCreateTextSubmission(false, false, "saved/作品")).toBe(false);
  expect(canCreateTextSubmission(true, false, "saved/作品")).toBe(false);
  expect(getSavedSubmissionHref("saved/作品", "class one", "task/two")).toBe(
    "/student/submissions/saved%2F%E4%BD%9C%E5%93%81?classroomId=class+one&classroomTaskId=task%2Ftwo",
  );
});
test("maps only actual public messages for cooldown, conflicts and late submission", () => {
  const body = (statusCode: number, message: string) => ({
    statusCode,
    timestamp: "2026-10-11T00:00:00Z",
    path: "/api/classrooms/c/tasks/t/submissions",
    message,
  });
  const cooldown =
    "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。";
  expect(getTextSubmissionError(429, body(429, cooldown))).toBe(cooldown);
  for (const message of [
    "班级已归档，不能继续提交该任务。",
    "课堂任务已关闭，不能继续提交。",
    "该课堂任务未保存发布内容，请教师重新布置后继续。",
  ])
    expect(getTextSubmissionError(409, body(409, message))).toBe(message);
  expect(
    getTextSubmissionError(
      403,
      body(403, "Late submission is not allowed for this classroom task"),
    ),
  ).toBe("已截止，禁止迟交，请联系老师。");
});
test("unknown or mismatched error messages never become user-facing raw exceptions", () => {
  const unknown = "Internal exception: synthetic stack at private-service.ts";
  expect(getTextSubmissionError(403, { message: unknown })).toBe(
    "无权限提交该课堂任务。",
  );
  for (const [status, message] of [
    [429, unknown],
    [409, unknown],
    [429, "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。\n"],
    [
      429,
      "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。 " +
        unknown,
    ],
    [429, "提交过于频繁。当前设置的提交冷却时间为 0 秒，请约 3 秒后再试。"],
    [500, "课堂任务已关闭，不能继续提交。"],
  ] as const) {
    const result = getTextSubmissionError(status, { message });
    expect(result).not.toContain(unknown);
    expect(result).not.toBe(message);
  }
  expect(
    getTextSubmissionError(403, { code: "LATE_SUBMISSION_NOT_ALLOWED" }),
  ).toBe("无权限提交该课堂任务。");
});
