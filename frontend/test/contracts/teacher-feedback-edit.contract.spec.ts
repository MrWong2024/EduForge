import { expect, test } from "@playwright/test";
import {
  resolveTeacherFeedbackItem,
  toTeacherFeedbackListResponse,
  toUpdateTeacherFeedbackResponse,
} from "../../lib/api/types-teacher";
import {
  buildTeacherFeedbackEditPatch,
  findTeacherFeedbackForReview,
  rebaseTeacherFeedbackDraft,
  toTeacherFeedbackEditValues,
} from "../../lib/learning-tasks/teacher-feedback-edit";

const feedbackId = "teacher-feedback-contract";
const submissionId = "submission-feedback-contract";
const feedback = {
  id: feedbackId,
  submissionId,
  source: "TEACHER",
  type: "STYLE",
  severity: "WARN",
  message: "\r\n  正文 A\r\n\t检查变量名\r末行  \r\n",
  suggestion: "  建议 A\r\n\r\n另起一段  ",
  tags: ["naming", "style"],
  createdAt: "2026-11-25T08:00:00.000Z",
  updatedAt: "2026-11-25T08:01:00.000Z",
};

const [openingItem] = toTeacherFeedbackListResponse([feedback]).items;
const openingValues = toTeacherFeedbackEditValues(openingItem);

test("the teacher feedback list preserves raw multiline text and keeps normalized metadata", () => {
  const [item, empty, missing] = toTeacherFeedbackListResponse({
    data: {
      items: [
        { ...feedback, id: "  teacher-feedback-contract  ", source: " TEACHER " },
        { ...feedback, suggestion: "" },
        { ...feedback, suggestion: null, message: 12 },
      ],
    },
  }).items;

  expect(item).toMatchObject({
    id: feedbackId,
    source: "TEACHER",
    message: "\r\n  正文 A\r\n\t检查变量名\r末行  \r\n",
    suggestion: "  建议 A\r\n\r\n另起一段  ",
  });
  expect(empty.suggestion).toBe("");
  expect(missing.suggestion).toBeUndefined();
  expect(missing.message).toBeUndefined();
});

test("restoring either text, including equivalent textarea line endings, leaves no PATCH fields", () => {
  expect(openingValues.message).toBe("\n  正文 A\n\t检查变量名\n末行  \n");
  expect(openingValues.suggestion).toBe("  建议 A\n\n另起一段  ");

  const changedDraft = {
    ...openingValues,
    message: "临时正文",
    suggestion: "临时建议",
  };
  expect(
    buildTeacherFeedbackEditPatch(openingItem, changedDraft),
  ).toStrictEqual({
    message: "临时正文",
    suggestion: "临时建议",
    expected: {
      message: "\r\n  正文 A\r\n\t检查变量名\r末行  \r\n",
      suggestion: "  建议 A\r\n\r\n另起一段  ",
    },
  });
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...changedDraft,
      message: "\r  正文 A\n\t检查变量名\r\n末行  \n",
      suggestion: "  建议 A\r\r\n另起一段  ",
    }),
  ).toStrictEqual({});
});

test("a suggestion-only draft omits the opening body, severity and tags after a list update", () => {
  const draft = { ...openingValues, suggestion: "  修改建议\n\n" };
  const [updatedItem] = toTeacherFeedbackListResponse([
    {
      ...feedback,
      message: "正文 B",
      severity: "ERROR",
      tags: ["correctness"],
      updatedAt: "2026-11-25T08:02:00.000Z",
    },
  ]).items;

  expect(buildTeacherFeedbackEditPatch(openingItem, draft)).toStrictEqual({
    suggestion: "  修改建议\n\n",
    expected: { suggestion: "  建议 A\r\n\r\n另起一段  " },
  });
  const reopened = toTeacherFeedbackEditValues(updatedItem);
  expect(reopened).toMatchObject({
    message: "正文 B",
    severity: "ERROR",
    tags: ["correctness"],
  });
  expect(
    buildTeacherFeedbackEditPatch(updatedItem, {
      ...reopened,
      suggestion: "新建议",
    }),
  ).toStrictEqual({
    suggestion: "新建议",
    expected: { suggestion: "  建议 A\r\n\r\n另起一段  " },
  });
});

test("a real body edit preserves extra indentation, boundary spaces and empty lines", () => {
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...openingValues,
      message: "\n    正文 A\n\t检查变量名\n末行   \n\n",
    }),
  ).toStrictEqual({
    message: "\n    正文 A\n\t检查变量名\n末行   \n\n",
    expected: { message: "\r\n  正文 A\r\n\t检查变量名\r末行  \r\n" },
  });
});

test("clearing an existing suggestion sends an explicit empty string", () => {
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...openingValues,
      suggestion: "",
    }),
  ).toStrictEqual({
    suggestion: "",
    expected: { suggestion: "  建议 A\r\n\r\n另起一段  " },
  });
});

test("missing and null suggestions share an expectation while an empty string stays exact", () => {
  for (const [original, expected] of [[undefined, null], [null, null], ["", ""]] as const) {
    const [item] = toTeacherFeedbackListResponse([{ ...feedback, suggestion: original }]).items;
    const draft = toTeacherFeedbackEditValues(item);
    expect(buildTeacherFeedbackEditPatch(item, draft)).toStrictEqual({});
    expect(
      buildTeacherFeedbackEditPatch(item, { ...draft, suggestion: "新建议" }),
    ).toStrictEqual({ suggestion: "新建议", expected: { suggestion: expected } });
  }
});

test("type and severity edits send each changed enum independently", () => {
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...openingValues,
      type: "BUG",
    }),
  ).toStrictEqual({ type: "BUG" });
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...openingValues,
      severity: "ERROR",
    }),
  ).toStrictEqual({ severity: "ERROR" });
});

test("tag order and duplicate tags do not affect the PATCH", () => {
  expect(
    buildTeacherFeedbackEditPatch(openingItem, {
      ...openingValues,
      tags: ["style", "naming", "style"],
    }),
  ).toStrictEqual({});
  expect(
    buildTeacherFeedbackEditPatch(
      { ...openingItem, tags: ["naming", "style", "naming"] },
      { ...openingValues, tags: ["style", "naming"] },
    ),
  ).toStrictEqual({});
});

test("clearing naming sends an empty array while empty and other alone are equivalent", () => {
  const draft = { ...openingValues, tags: [] };

  expect(
    buildTeacherFeedbackEditPatch({ ...openingItem, tags: ["naming"] }, draft),
  ).toStrictEqual({ tags: [] });
  expect(
    buildTeacherFeedbackEditPatch({ ...openingItem, tags: ["other"] }, draft),
  ).toStrictEqual({});
  expect(
    buildTeacherFeedbackEditPatch({ ...openingItem, tags: [] }, { ...openingValues, tags: ["other"] }),
  ).toStrictEqual({});
});

const savedFeedback = {
  ...feedback,
  message: "  正文 B\n\n",
  suggestion: "",
  tags: ["other"],
  updatedAt: "2026-11-25T08:02:00.000Z",
};

test("a matching PATCH receipt preserves the confirmed fields and starts the next diff", () => {
  const confirmed = toUpdateTeacherFeedbackResponse(
    savedFeedback,
    submissionId,
    feedbackId,
  );
  expect(confirmed).toMatchObject({
    submissionId,
    id: feedbackId,
    message: "  正文 B\n\n",
    suggestion: "",
    tags: ["other"],
  });

  const latestItem = resolveTeacherFeedbackItem(openingItem, confirmed ?? undefined);
  const reopened = toTeacherFeedbackEditValues(latestItem);
  expect(reopened).toMatchObject({
    message: "  正文 B\n\n",
    suggestion: "",
    tags: ["other"],
  });
  expect(
    buildTeacherFeedbackEditPatch(latestItem, { ...reopened, severity: "INFO" }),
  ).toStrictEqual({ severity: "INFO" });
});

test("a PATCH receipt must belong to the requested teacher feedback and submission", () => {
  for (const receipt of [
    { ...savedFeedback, id: "different-feedback" },
    { ...savedFeedback, submissionId: "different-submission" },
    { ...savedFeedback, source: "AI" },
  ]) {
    expect(
      toUpdateTeacherFeedbackResponse(receipt, submissionId, feedbackId),
    ).toBeNull();
  }
});

test("an equal-time list cannot replace the PATCH receipt and a newer list can", () => {
  const confirmed = toUpdateTeacherFeedbackResponse(
    savedFeedback,
    submissionId,
    feedbackId,
  );
  const [sameTimestamp, newer] = toTeacherFeedbackListResponse([
    { ...feedback, updatedAt: "2026-11-25T08:02:00.000Z" },
    {
      ...feedback,
      message: "正文 C",
      updatedAt: "2026-11-25T08:03:00.000Z",
    },
  ]).items;

  expect(
    resolveTeacherFeedbackItem(sameTimestamp, confirmed ?? undefined).message,
  ).toBe("  正文 B\n\n");
  expect(
    resolveTeacherFeedbackItem(newer, confirmed ?? undefined).message,
  ).toBe("正文 C");
});

test("explicit conflict review takes the matching formal read independently of an equal-time receipt", () => {
  const latestMessage = "  已保存的正文 C\r\n\r\n\t保留原文  ";
  const latestSuggestion = "已保存新建议";
  const latestFeedback = {
    ...savedFeedback,
    message: latestMessage,
    suggestion: latestSuggestion,
    severity: "ERROR",
    tags: ["correctness"],
  };
  const latest = findTeacherFeedbackForReview([
    { ...latestFeedback, id: "other-feedback" },
    { ...latestFeedback, submissionId: "other-submission" },
    { ...latestFeedback, source: "AI" },
    latestFeedback,
  ], submissionId, feedbackId);
  expect(latest?.message).toBe(latestMessage);
  if (!latest) throw new Error("Missing matching feedback");

  const draft = { ...openingValues, message: "  我的正文\n\n\t保留草稿  " };
  const confirmedDraft = rebaseTeacherFeedbackDraft(openingItem, draft, latest);
  expect(confirmedDraft).toMatchObject({
    message: draft.message,
    suggestion: latestSuggestion,
    severity: "ERROR",
    tags: ["correctness"],
  });
  expect(buildTeacherFeedbackEditPatch(latest, confirmedDraft)).toStrictEqual({
    message: draft.message,
    expected: { message: latestMessage },
  });
  expect(findTeacherFeedbackForReview([
    { ...latestFeedback, source: "AI" },
    { ...latestFeedback, message: null },
  ], submissionId, feedbackId)).toBeUndefined();
});
