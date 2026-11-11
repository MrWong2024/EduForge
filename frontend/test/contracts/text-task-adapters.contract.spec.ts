import { test, expect } from "@playwright/test";
import {
  toMyTaskDetailResponse,
  toSubmissionDetailResponse,
} from "../../lib/api/types-student";
import {
  groupTeacherFeedbackItems,
  normalizeClassroomTaskStatus,
  toClassroomTask,
  toClassroomTaskSummary,
  toLearningTaskCreateResponse,
  toLearningTaskDetailResponse,
  toLearningTaskListResponse,
  toLearningTaskOption,
  toLearningTaskUpdateResponse,
  toPublishableTaskTemplateListResponse,
  toSubmissionDetailResponse as toTeacherDetail,
  toTeacherFeedbackListResponse,
} from "../../lib/api/types-teacher";
import {
  canSubmitTextTask,
  getTaskSnapshotErrorMessage,
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
import {
  SUBMISSION_LANGUAGE_OPTIONS,
  toDisplaySubmissionLanguage,
} from "../../lib/learning-tasks/submission-language";
import { toDisplayLateDuration } from "../../lib/ui/format";
import { normalizeTaskTemplateVisibility } from "../../lib/learning-tasks/template-visibility-scope";
import { canEditTeacherFeedback } from "../../lib/learning-tasks/teacher-feedback";

test("classroom status adapters preserve only the three exact persisted states", () => {
  for (const status of ["ACTIVE", "CLOSED", "RECALLED"] as const) {
    const task = Object.freeze({ title: "发布标题", status: "ARCHIVED" });
    const payload = Object.freeze({
      id: "classroom-task",
      status,
      taskSnapshotAvailable: true,
      task,
    });
    const before = { ...payload };
    const detail = toClassroomTask(payload);
    const summary = toClassroomTaskSummary(payload);
    expect(normalizeClassroomTaskStatus(status)).toBe(status);
    expect(detail.status).toBe(status);
    expect(summary.status).toBe(status);
    expect(detail.taskStatus).toBe("ARCHIVED");
    expect(summary.taskStatus).toBe("ARCHIVED");
    expect(detail.raw).toBe(payload);
    expect(detail.raw.task).toBe(task);
    expect(payload).toEqual(before);
  }
});

test("classroom status adapters leave a genuinely absent property unknown", () => {
  const task = Object.freeze({ title: "发布标题", status: "PUBLISHED" });
  const payload = Object.freeze({ id: "missing-status", task });
  expect(Object.hasOwn(payload, "status")).toBe(false);
  expect(normalizeClassroomTaskStatus(undefined)).toBeUndefined();
  const detail = toClassroomTask(payload);
  const summary = toClassroomTaskSummary(payload);
  expect(detail.status).toBeUndefined();
  expect(summary.status).toBeUndefined();
  expect(detail.raw).toBe(payload);
  expect(detail.raw.task).toBe(task);
  expect(Object.hasOwn(payload, "status")).toBe(false);
  expect(payload).toEqual({ id: "missing-status", task });
});

test("classroom status adapters reject present invalid values without coercion or input changes", () => {
  for (const status of [
    undefined,
    null,
    "",
    " \t\n ",
    "UNKNOWN",
    "active",
    "closed",
    "recalled",
    "Active",
    " ACTIVE",
    "CLOSED ",
    "\tRECALLED\n",
    Object.freeze([]),
    Object.freeze(["ACTIVE"]),
    Object.freeze({}),
    Object.freeze({ status: "ACTIVE" }),
    0,
    1,
    true,
    false,
  ]) {
    const payload = Object.freeze({ id: "invalid-status", status });
    expect(Object.hasOwn(payload, "status")).toBe(true);
    expect(normalizeClassroomTaskStatus(status)).toBeUndefined();
    const detail = toClassroomTask(payload);
    const summary = toClassroomTaskSummary(payload);
    expect(detail.status).toBeUndefined();
    expect(summary.status).toBeUndefined();
    expect(detail.raw).toBe(payload);
    expect(Object.hasOwn(payload, "status")).toBe(true);
    expect(payload.status).toBe(status);
    expect(payload).toEqual({ id: "invalid-status", status });
  }
});

test("template visibility preserves only exact PRIVATE and SHARED without changing the input", () => {
  for (const visibility of ["PRIVATE", "SHARED"] as const) {
    const payload = Object.freeze({
      id: "template-visibility",
      title: "模板标题",
      status: "PUBLISHED",
      visibility,
    });
    const before = { ...payload };
    const option = toLearningTaskOption(payload);
    expect(normalizeTaskTemplateVisibility(visibility)).toBe(visibility);
    expect(option.visibility).toBe(visibility);
    expect(option.title).toBe("模板标题");
    expect(option.status).toBe("PUBLISHED");
    expect(option.raw).toBe(payload);
    expect(payload).toEqual(before);
  }
});

test("template visibility keeps a genuinely absent property unknown without adding a default", () => {
  const payload = Object.freeze({ id: "missing-visibility" });
  expect(Object.hasOwn(payload, "visibility")).toBe(false);
  expect(normalizeTaskTemplateVisibility(undefined)).toBeUndefined();
  const option = toLearningTaskOption(payload);
  expect(option.visibility).toBeUndefined();
  expect(option.raw).toBe(payload);
  expect(Object.hasOwn(payload, "visibility")).toBe(false);
  expect(payload).toEqual({ id: "missing-visibility" });
});

test("template visibility rejects present invalid values without coercion or input changes", () => {
  for (const visibility of [
    undefined,
    null,
    "",
    " \t\n ",
    "UNKNOWN",
    "private",
    "shared",
    "Private",
    "Shared",
    " PRIVATE",
    "SHARED ",
    "\tSHARED\n",
    Object.freeze([]),
    Object.freeze(["SHARED"]),
    Object.freeze(["PRIVATE"]),
    Object.freeze({}),
    Object.freeze({ visibility: "SHARED" }),
    0,
    1,
    true,
    false,
  ]) {
    const payload = Object.freeze({ id: "invalid-visibility", visibility });
    expect(Object.hasOwn(payload, "visibility")).toBe(true);
    expect(normalizeTaskTemplateVisibility(visibility)).toBeUndefined();
    const option = toLearningTaskOption(payload);
    expect(option.visibility).toBeUndefined();
    expect(option.raw).toBe(payload);
    expect(Object.hasOwn(payload, "visibility")).toBe(true);
    expect(payload.visibility).toBe(visibility);
    expect(payload).toEqual({ id: "invalid-visibility", visibility });
  }
});

test("template detail, write and list response wrappers delegate strict visibility without replacing raw references", () => {
  const privateTask = Object.freeze({ id: "private", visibility: "PRIVATE" });
  const sharedTask = Object.freeze({ id: "shared", visibility: "SHARED" });
  const invalidTask = Object.freeze({ id: "invalid", visibility: " shared " });
  const missingTask = Object.freeze({ id: "missing" });
  for (const [payload, expected] of [
    [privateTask, "PRIVATE"],
    [sharedTask, "SHARED"],
    [invalidTask, undefined],
    [missingTask, undefined],
  ] as const) {
    const envelope = Object.freeze({ data: payload });
    for (const adapt of [
      toLearningTaskDetailResponse,
      toLearningTaskCreateResponse,
      toLearningTaskUpdateResponse,
    ]) {
      const result = adapt(envelope);
      expect(result.visibility).toBe(expected);
      expect(result.raw).toBe(payload);
      expect(envelope.data).toBe(payload);
    }
  }
  const items = Object.freeze([
    privateTask,
    sharedTask,
    invalidTask,
    missingTask,
  ]);
  const envelope = Object.freeze({ items, total: 4, page: 1, limit: 4 });
  for (const adapt of [
    toLearningTaskListResponse,
    toPublishableTaskTemplateListResponse,
  ]) {
    const result = adapt(envelope);
    expect(result.items.map((item) => item.visibility)).toEqual([
      "PRIVATE",
      "SHARED",
      undefined,
      undefined,
    ]);
    expect(result.items.map((item) => item.id)).toEqual([
      "private",
      "shared",
      "invalid",
      "missing",
    ]);
    expect(result.total).toBe(4);
    expect(result.raw).toBe(envelope);
    result.items.forEach((item, index) => expect(item.raw).toBe(items[index]));
  }
  expect(envelope.items).toBe(items);
  expect(invalidTask.visibility).toBe(" shared ");
  expect(Object.hasOwn(missingTask, "visibility")).toBe(false);
});

test("template difficulty comes from the top level without changing raw values", () => {
  for (const difficulty of ["easy", "综合", "  综合\n设计  ", ""]) {
    const payload = Object.freeze({
      id: "template-1",
      difficulty,
      task: Object.freeze({ difficulty: "hard" }),
    });
    const option = toLearningTaskOption(payload);
    expect(option.difficulty).toBe(difficulty);
    expect(option.raw).toBe(payload);
  }
  for (const difficulty of [undefined, null, 1, true, {}]) {
    expect(toLearningTaskOption({ difficulty }).difficulty).toBeUndefined();
  }
});

test("teacher classroom difficulty uses only the formal task projection", () => {
  const task = Object.freeze({ difficulty: "  综合\n设计  " });
  const payload = Object.freeze({
    task,
    difficulty: "hard",
    taskSnapshot: Object.freeze({ difficulty: "medium" }),
    template: Object.freeze({ difficulty: "easy" }),
  });
  const detail = toClassroomTask(payload);
  expect(detail.difficulty).toBe("  综合\n设计  ");
  expect(detail.raw).toBe(payload);
  expect(detail.raw.task).toBe(task);
  for (const difficulty of [undefined, null, 1, ""]) {
    const projected = toClassroomTask({ ...payload, task: { difficulty } });
    expect(projected.difficulty).toBe(difficulty === "" ? "" : undefined);
  }
  expect(
    toClassroomTask({ ...payload, task: undefined }).difficulty,
  ).toBeUndefined();
});

test("student difficulty preserves the formal task and server state without live-template fallback", () => {
  const task = Object.freeze({ difficulty: "综合", title: "发布时标题" });
  const latest = Object.freeze({ submissionId: "older", attemptNo: 2 });
  const payload = Object.freeze({
    task,
    difficulty: "hard",
    template: Object.freeze({ difficulty: "easy" }),
    classroomTask: Object.freeze({ taskSnapshotAvailable: true }),
    submissions: Object.freeze([
      Object.freeze({ id: "older", createdAt: "2026-11-01T00:00:00Z" }),
      Object.freeze({ id: "newer", createdAt: "2026-11-01T01:00:00Z" }),
    ]),
    latest,
    participationStatus: Object.freeze({
      reason: "ACTIVE",
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: false,
      message: null,
    }),
  });
  const before = JSON.stringify(payload);
  const detail = toMyTaskDetailResponse(payload);
  expect(detail.task).toBe(task);
  expect(detail.task.difficulty).toBe("综合");
  expect(detail.raw).toBe(payload);
  expect(detail.latest).toBe(latest);
  expect(detail.submissions.map((item) => item.id)).toEqual(["newer", "older"]);
  expect(detail.participationStatus).toEqual({
    reason: "ACTIVE",
    readOnly: false,
    canSubmit: true,
    canRequestAiFeedback: false,
    message: null,
  });
  expect(
    toMyTaskDetailResponse({ ...payload, task: {} }).task.difficulty,
  ).toBeUndefined();
  expect(JSON.stringify(payload)).toBe(before);
});

test("teacher feedback editing requires an explicit matching author and preserves its input", () => {
  const feedback = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
    message: "保留教师反馈正文",
  });
  const before = { ...feedback };
  expect(canEditTeacherFeedback(feedback, "teacher-1")).toBe(true);
  expect(feedback).toEqual(before);
});

test("teacher feedback editing rejects missing, blank and non-string identifiers even when both identities match", () => {
  const valid = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingId = Object.freeze({
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingAuthor = Object.freeze({ id: "feedback-1", source: "TEACHER" });
  expect(canEditTeacherFeedback(missingId, "teacher-1")).toBe(false);
  expect(canEditTeacherFeedback(missingAuthor, "teacher-1")).toBe(false);
  expect(canEditTeacherFeedback(missingAuthor, undefined)).toBe(false);
  expect(Object.hasOwn(missingId, "id")).toBe(false);
  expect(Object.hasOwn(missingAuthor, "createdBy")).toBe(false);
  for (const value of [
    undefined,
    null,
    "",
    " \t\n ",
    1,
    false,
    Object.freeze([]),
    Object.freeze({}),
  ]) {
    const invalidId = Object.freeze({ ...valid, id: value });
    const invalidAuthor = Object.freeze({ ...valid, createdBy: value });
    expect(canEditTeacherFeedback(invalidId, "teacher-1")).toBe(false);
    expect(canEditTeacherFeedback(valid, value)).toBe(false);
    expect(canEditTeacherFeedback(invalidAuthor, "teacher-1")).toBe(false);
    expect(canEditTeacherFeedback(invalidAuthor, value)).toBe(false);
    expect(invalidId.id).toBe(value);
    expect(invalidAuthor.createdBy).toBe(value);
  }
});

test("teacher feedback editing does not infer sources or normalize identity matches", () => {
  const valid = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingSource = Object.freeze({
    id: "feedback-1",
    createdBy: "teacher-1",
  });
  expect(canEditTeacherFeedback(missingSource, "teacher-1")).toBe(false);
  expect(Object.hasOwn(missingSource, "source")).toBe(false);
  for (const source of [
    undefined,
    null,
    "AI",
    "UNKNOWN",
    "teacher",
    " TEACHER ",
  ]) {
    const feedback = Object.freeze({ ...valid, source });
    expect(canEditTeacherFeedback(feedback, "teacher-1")).toBe(false);
    expect(feedback.source).toBe(source);
  }
  for (const [createdBy, currentUserId] of [
    ["other-teacher", "teacher-1"],
    [" teacher-1", "teacher-1"],
    ["teacher-1", "teacher-1 "],
    ["Teacher-1", "teacher-1"],
    ["teacher-1", "TEACHER-1"],
  ]) {
    const feedback = Object.freeze({ ...valid, createdBy });
    expect(canEditTeacherFeedback(feedback, currentUserId)).toBe(false);
    expect(feedback.createdBy).toBe(createdBy);
  }
  const identicalRawIds = Object.freeze({ ...valid, createdBy: " teacher-1 " });
  expect(canEditTeacherFeedback(identicalRawIds, " teacher-1 ")).toBe(true);
  expect(identicalRawIds.createdBy).toBe(" teacher-1 ");
});

test("teacher feedback adapters preserve known authors and leave absent or null authors unknown without changing content or raw references", () => {
  const content = Object.freeze({
    source: "TEACHER",
    type: "STYLE",
    severity: "WARN",
    message: "保留教师反馈正文",
    suggestion: "保留修改建议",
    tags: Object.freeze(["readability"]),
    createdAt: "2026-11-01T01:00:00Z",
  });
  const known = Object.freeze({
    ...content,
    id: "known",
    createdBy: "teacher-1",
  });
  const missing = Object.freeze({ ...content, id: "missing" });
  const nullAuthor = Object.freeze({ ...content, id: "null", createdBy: null });
  const items = Object.freeze([known, missing, nullAuthor]);
  const payload = Object.freeze({ items });
  const before = JSON.stringify(payload);
  const result = toTeacherFeedbackListResponse(payload);

  expect(result.items.map((item) => item.createdBy)).toEqual([
    "teacher-1",
    undefined,
    undefined,
  ]);
  expect(
    result.items.map((item) => canEditTeacherFeedback(item, "teacher-1")),
  ).toEqual([true, false, false]);
  for (const [index, item] of result.items.entries()) {
    expect(item.raw).toBe(items[index]);
    expect(item).toMatchObject({
      source: "TEACHER",
      type: "STYLE",
      severity: "WARN",
      message: "保留教师反馈正文",
      suggestion: "保留修改建议",
      tags: ["readability"],
      createdAt: "2026-11-01T01:00:00Z",
    });
  }
  expect(result.raw).toBe(payload);
  expect(payload.items).toBe(items);
  expect(Object.hasOwn(missing, "createdBy")).toBe(false);
  expect(nullAuthor.createdBy).toBeNull();
  expect(JSON.stringify(payload)).toBe(before);
});

test("teacher feedback groups keep teacher and AI records in descending creation time without mutating input", () => {
  const items = toTeacherFeedbackListResponse([
    {
      id: "teacher-older",
      source: "TEACHER",
      createdAt: "2026-11-01T01:00:00Z",
    },
    { id: "ai-older", source: "AI", createdAt: "2026-11-01T02:00:00Z" },
    {
      id: "teacher-newer",
      source: "TEACHER",
      createdAt: "2026-11-01T03:00:00Z",
    },
    { id: "ai-newer", source: "AI", createdAt: "2026-11-01T04:00:00Z" },
  ]).items;
  const before = JSON.stringify(items);
  Object.freeze(items);
  for (const item of items) Object.freeze(item);
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher.map((item) => item.id)).toEqual([
    "teacher-newer",
    "teacher-older",
  ]);
  expect(grouped.ai.map((item) => item.id)).toEqual(["ai-newer", "ai-older"]);
  expect(grouped.other).toEqual([]);
  expect(grouped.teacher[0]).toBe(items[2]);
  expect(grouped.ai[0]).toBe(items[3]);
  expect(JSON.stringify(items)).toBe(before);
});

test("unknown and missing feedback sources retain the original records only in the other group", () => {
  const items = toTeacherFeedbackListResponse([
    { id: "unknown", source: "UNRECOGNIZED", message: "保留未知来源反馈" },
    { id: "missing", message: "保留缺失来源反馈" },
    { id: "lowercase", source: "teacher", message: "不推断正式来源" },
  ]).items;
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher).toEqual([]);
  expect(grouped.ai).toEqual([]);
  expect(grouped.other).toEqual(items);
  for (const [index, item] of grouped.other.entries()) {
    expect(item).toBe(items[index]);
  }
});

test("no feedback remains distinguishable from feedback with only an unrecognized source", () => {
  expect(groupTeacherFeedbackItems([])).toEqual({
    teacher: [],
    ai: [],
    other: [],
  });
  const items = toTeacherFeedbackListResponse([
    { id: "unknown-only", source: "UNRECOGNIZED" },
  ]).items;
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher).toEqual([]);
  expect(grouped.ai).toEqual([]);
  expect(grouped.other).toHaveLength(1);
  expect(grouped.other[0]).toBe(items[0]);
});

test("student task history uses actual createdAt instants and keeps equal-time input order", () => {
  const submissions = [
    {
      id: "offset-first",
      attemptNo: 100,
      createdAt: "2026-11-01T10:00:00+08:00",
    },
    {
      id: "newest",
      attemptNo: 1,
      createdAt: "2026-11-01T02:30:00Z",
      updatedAt: "2026-11-01T02:31:00Z",
      lastEditedAt: "2026-11-01T02:31:00Z",
    },
    {
      id: "same-instant-second",
      attemptNo: 99,
      createdAt: "2026-11-01T03:00:00+01:00",
    },
    {
      id: "oldest",
      attemptNo: 300,
      createdAt: "2026-11-01T01:59:59Z",
      updatedAt: "2099-01-01T00:00:00Z",
      lastEditedAt: "2099-01-01T00:00:00Z",
    },
    {
      id: "same-instant-third",
      attemptNo: 200,
      createdAt: "2026-10-31T22:00:00-04:00",
    },
  ];
  const detail = toMyTaskDetailResponse({ submissions });
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "newest",
    "offset-first",
    "same-instant-second",
    "same-instant-third",
    "oldest",
  ]);
});

test("student task history puts unusable createdAt values last in their original order", () => {
  const submissions = [
    { id: "missing", updatedAt: "2099-01-01T00:00:00Z" },
    { id: "epoch", createdAt: "1970-01-01T00:00:00Z" },
    { id: "null", createdAt: null },
    { id: "empty", createdAt: "" },
    { id: "recent", createdAt: "2026-11-01T00:00:00Z" },
    {
      id: "invalid",
      createdAt: "not-a-date",
      lastEditedAt: "2099-01-01T00:00:00Z",
    },
    { id: "number", createdAt: 0 },
    { id: "whitespace", createdAt: " \t " },
  ];
  const detail = toMyTaskDetailResponse({ submissions });
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "recent",
    "epoch",
    "missing",
    "null",
    "empty",
    "invalid",
    "number",
    "whitespace",
  ]);
});

test("student task history accepts frozen empty and single-entry lists", () => {
  const empty = Object.freeze([]);
  expect(toMyTaskDetailResponse({ submissions: empty }).submissions).toEqual([]);
  const submission = Object.freeze({
    id: "only-submission",
    createdAt: "2026-11-01T00:00:00Z",
  });
  const submissions = Object.freeze([submission]);
  const detail = toMyTaskDetailResponse(Object.freeze({ submissions }));
  expect(detail.submissions.map((item) => item.id)).toEqual(["only-submission"]);
  expect(detail.submissions).not.toBe(submissions);
  expect(detail.submissions[0]).toBe(submission);
});

test("history ordering preserves frozen records, feedback, raw facts and server task state", () => {
  const feedbackItems = Object.freeze([
    Object.freeze({
      source: "AI",
      type: "OTHER",
      severity: "WARN",
      message: "  保留反馈原文\n ",
      suggestion: "  核对修改  ",
      tags: Object.freeze(["synthetic"]),
    }),
  ]);
  const feedbackSummary = Object.freeze({
    totalItems: 1,
    topTags: Object.freeze([Object.freeze({ tag: "synthetic", count: 1 })]),
    severityBreakdown: Object.freeze({ INFO: 0, WARN: 1, ERROR: 0 }),
  });
  const older = Object.freeze({
    id: "authoritative-latest",
    attemptNo: 2,
    createdAt: "2026-11-01T00:00:00Z",
    aiFeedbackStatus: "SUCCEEDED",
    feedbackSummary,
    feedbackItems,
  });
  const newer = Object.freeze({
    id: "first-in-history",
    attemptNo: 1,
    createdAt: "2026-11-01T01:00:00Z",
    aiFeedbackStatus: "NOT_REQUESTED",
  });
  const submissions = Object.freeze([older, newer]);
  const latest = Object.freeze({
    submissionId: "authoritative-latest",
    attemptNo: 2,
    aiFeedbackStatus: "SUCCEEDED",
    feedbackSummary,
    feedbackItems,
  });
  const completionStatus = Object.freeze({
    status: "QUALIFIED_WITH_WARNINGS",
    severity: "WARN",
    source: "AI",
    latestSubmissionId: "authoritative-latest",
    teacherFeedbackCount: 0,
    aiFeedbackCount: 1,
    teacherWorstSeverity: null,
    aiWorstSeverity: "WARN",
  });
  const participationStatus = Object.freeze({
    readOnly: true,
    canSubmit: false,
    canRequestAiFeedback: false,
    reason: "CLASSROOM_TASK_NOT_ACTIVE",
    message: "课堂任务已关闭",
  });
  const payload = Object.freeze({
    submissions,
    latest,
    completionStatus,
    participationStatus,
  });
  const before = JSON.stringify(payload);
  const detail = toMyTaskDetailResponse(payload);
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "first-in-history",
    "authoritative-latest",
  ]);
  expect(detail.submissions).not.toBe(submissions);
  expect(detail.submissions[0]).toBe(newer);
  expect(detail.submissions[1]).toBe(older);
  expect(detail.submissions[1].feedbackItems).toBe(feedbackItems);
  expect(detail.submissions[1].feedbackSummary).toBe(feedbackSummary);
  expect(detail.latest).toBe(latest);
  expect(detail.completionStatus).toEqual(completionStatus);
  expect(detail.participationStatus).toEqual(participationStatus);
  expect(detail.raw).toBe(payload);
  expect(detail.raw.submissions).toBe(submissions);
  expect(JSON.stringify(payload)).toBe(before);
  expect(submissions.map((submission) => submission.id)).toEqual([
    "authoritative-latest",
    "first-in-history",
  ]);
});

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
    "作品内容已变化，当前操作依据的是旧版作品。当前输入已保留，请在本页核对最新作品，确认后再继续。",
  );
  expect(getSubmissionRevisionError(body(reviewStarted))).toBe(
    "本次提交已进入评阅，不能再修改作品。未保存的修改已保留，请在本页核对当前作品与反馈。",
  );
  expect(getSubmissionRevisionError(body(invalidState))).toBe(
    "提交状态暂不可用。当前输入已保留，请在本页核对详情或联系教师。",
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
      "提交状态已变化。当前输入已保留，请先在本页核对最新详情。",
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

test("keeps snapshot and allowLate without projecting retired classroom settings", () => {
  const payload = {
    id: "instance",
    taskSnapshotAvailable: true,
    publishedAt: "2026-10-01T00:00:00.000Z",
    dueAt: "2026-10-20T00:00:00.000Z",
    settings: { allowLate: false },
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
    taskSnapshotAvailable: true,
    allowLate: false,
    dueAt: "2026-10-20T00:00:00.000Z",
    title: "发布标题",
    description: "发布说明",
    rubric: { dimensions: { design: 20 }, notes: "教师参考" },
  });
  expect(list).toMatchObject({
    taskSnapshotAvailable: true,
    allowLate: false,
  });
  expect(detail.raw).toBe(payload);
  // Residual classroom settings remain raw facts, not formal adapter output.
  const legacy = {
    ...payload,
    maxAttempts: 99,
    settings: {
      ...payload.settings,
      maxAttempts: 2,
      aiFeedbackMode: "DISABLED",
    },
  };
  const legacyDetail = toClassroomTask(legacy);
  const legacyList = toClassroomTaskSummary(legacy);
  expect(legacyDetail).not.toHaveProperty("aiFeedbackMode");
  expect(legacyDetail).not.toHaveProperty("maxAttempts");
  expect(legacyList).not.toHaveProperty("maxAttempts");
  expect(legacyList).toEqual(list);
  expect(legacyDetail.allowLate).toBe(false);
  expect(legacyDetail.raw).toBe(legacy);
  expect(legacyDetail.raw.settings).toBe(legacy.settings);
  expect(legacyDetail.raw).toHaveProperty("settings.maxAttempts", 2);
  expect(legacyDetail.raw).toHaveProperty("maxAttempts", 99);
  const studentPayload = { classroomTask: legacy };
  const studentDetail = toMyTaskDetailResponse(studentPayload);
  expect(studentDetail.classroomTask.settings).toEqual({ allowLate: false });
  expect(studentDetail.raw).toBe(studentPayload);
  expect(studentDetail.raw.classroomTask).toBe(legacy);
});
test("requires explicit snapshot and backend submit permission, independent of AI request permission", () => {
  const detail = toMyTaskDetailResponse({
    classroomTask: {
      taskSnapshotAvailable: true,
      settings: { allowLate: true },
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
  expect(detail.classroomTask.settings).toEqual({
    allowLate: true,
  });
  expect(detail.participationStatus?.canRequestAiFeedback).toBe(false);
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
  expect(getTaskSnapshotMessage(true)).toBe("已保存的课堂任务内容");
  expect(getTaskSnapshotMessage(false)).toBe(
    "课堂任务内容快照缺失或无效，请联系教师核对。",
  );
  expect(getTaskSnapshotMessage(undefined)).toBe(
    "课堂任务内容信息暂不可用，请刷新核对后继续。",
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

test("recognizes only the exact public snapshot error for 403 or 409", () => {
  const message = "课堂任务内容快照缺失或无效，请联系教师核对。";
  const body = Object.freeze({ message, code: "PRIVATE_INTERNAL_CODE" });
  for (const status of [403, 409]) {
    expect(getTaskSnapshotErrorMessage(status, body)).toBe(
      "课堂任务内容快照缺失或无效，请联系教师核对。",
    );
  }
  for (const status of [200, 400, 401, 404, 422, 429, 500]) {
    expect(getTaskSnapshotErrorMessage(status, body)).toBeUndefined();
  }
  for (const data of [
    undefined,
    null,
    message,
    [],
    [message],
    Object.assign([], { message }),
    {},
    { code: "TASK_SNAPSHOT_MISSING" },
    { message: undefined },
    { message: null },
    { message: 0 },
    { message: false },
    { message: {} },
    { message: [message] },
    { message: "unknown error" },
    { message: "该课堂任务未保存发布内容，请教师重新布置后继续。" },
    {
      message:
        "未保存发布时任务内容，当前说明为模板现状；请教师重新布置后继续。",
    },
    { message: ` ${message}` },
    { message: `${message} ` },
    { message: `${message}\nprivate synthetic stack` },
  ]) {
    expect(getTaskSnapshotErrorMessage(409, data)).toBeUndefined();
  }
  expect(getTextSubmissionError(409, body)).toBe(
    "课堂任务内容快照缺失或无效，请联系教师核对。",
  );
  expect(getTextSubmissionError(403, body)).toBe("无权限提交该课堂任务。");
  expect(
    getTextSubmissionError(409, {
      message: "该课堂任务未保存发布内容，请教师重新布置后继续。",
    }),
  ).toBe("提交作业失败，请稍后重试。");
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
    "课堂任务内容快照缺失或无效，请联系教师核对。",
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

test("submission language labels share the unchanged option values and order", () => {
  const options = [
    { value: "auto", label: "自动识别（默认）" },
    { value: "java", label: "Java" },
    { value: "javascript", label: "JavaScript" },
    { value: "typescript", label: "TypeScript" },
    { value: "python", label: "Python" },
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "other", label: "Other" },
  ];
  expect(SUBMISSION_LANGUAGE_OPTIONS).toEqual(options);
  for (const { value, label } of options) {
    expect(toDisplaySubmissionLanguage(value)).toBe(label);
    expect(toDisplaySubmissionLanguage(` \t${value.toUpperCase()}\n `)).toBe(
      label,
    );
  }
  expect(SUBMISSION_LANGUAGE_OPTIONS).toEqual(options);
});

test("submission language display preserves unknown spelling and rejects missing values", () => {
  expect(toDisplaySubmissionLanguage(" Rust ")).toBe("Rust");
  expect(toDisplaySubmissionLanguage(" CuStOm-Lang ")).toBe("CuStOm-Lang");
  for (const value of [undefined, null, "", " \t\n ", 0, true, {}, []]) {
    expect(toDisplaySubmissionLanguage(value)).toBe("—");
  }
});

test("language labels do not replace raw request or student and teacher response values", () => {
  for (const language of [
    "auto",
    "java",
    "javascript",
    "typescript",
    "python",
    "c",
    "cpp",
    "other",
    "CuStOm-Lang",
  ]) {
    expect(buildTextSubmissionRequest("code", language, "").content.language).toBe(
      language,
    );
    expect(
      buildUpdateSubmissionRequest(0, "code", language, "").content.language,
    ).toBe(language);
    const payload = { content: { language, codeText: "code" } };
    for (const detail of [
      toSubmissionDetailResponse(payload),
      toTeacherDetail(payload),
    ]) {
      expect(detail.language).toBe(language);
      expect(detail.content.language).toBe(language);
      expect(detail.raw).toBe(payload);
    }
  }
});

test("late duration keeps the existing second, minute, hour and day boundaries", () => {
  for (const [seconds, label] of [
    [0, "超时不足 1 秒"],
    [59, "超时 59 秒"],
    [60, "超时 1 分钟"],
    [61, "超时 1 分钟 1 秒"],
    [3599, "超时 59 分钟 59 秒"],
    [3600, "超时 1 小时"],
    [3661, "超时 1 小时 1 分钟"],
    [86399, "超时 23 小时 59 分钟"],
    [86400, "超时 1 天"],
    [90061, "超时 1 天 1 小时"],
    [1438856, "超时 16 天 15 小时"],
  ] as const) {
    expect(toDisplayLateDuration(seconds)).toBe(label);
  }
  for (const value of [undefined, null, "60", -1, 1.5, Number.NaN, Infinity]) {
    expect(toDisplayLateDuration(value)).toBeUndefined();
  }
});
