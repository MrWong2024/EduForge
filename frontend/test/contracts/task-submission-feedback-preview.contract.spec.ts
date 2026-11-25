import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskSubmissionHistoryEntry } from "../../components/student/TaskSubmissionHistoryEntry";
import { toMyTaskDetailResponse } from "../../lib/api/types-student";

const oldSubmission = {
  id: "older-submission",
  attemptNo: 1,
  createdAt: "2026-10-01T12:00:00Z",
  feedbackItems: [{ source: "AI", type: "STYLE", severity: "INFO", message: "旧尝试反馈" }],
};

const newSubmission = {
  id: "newer-submission",
  attemptNo: 2,
  createdAt: "2026-10-02T12:00:00Z",
  feedbackItems: [
    {
      source: "AI",
      type: "BUG",
      severity: "WARN",
      message: "新尝试反馈一\n正文第二行",
      suggestion: "建议第一行\n建议第二行",
      tags: ["correctness"],
    },
    { source: "AI", type: "OTHER", severity: "INFO", message: "新尝试反馈二" },
    { source: "TEACHER", type: "OTHER", severity: "INFO", message: "教师反馈正文" },
  ],
};

function renderHistoryEntries(payload: unknown, includeFeedbackItems: boolean) {
  const detail = toMyTaskDetailResponse(payload);
  const html = renderToStaticMarkup(createElement("table", null, detail.submissions.map(
    (submission) => createElement(TaskSubmissionHistoryEntry, {
      key: String(submission.id),
      submission,
      aiStatus: "已生成",
      feedbackHref: `/student/submissions/${submission.id}?classroomId=class-1&classroomTaskId=task-1`,
      includeFeedbackItems,
    }),
  )));
  return html.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? [];
}

test("renders ordered AI feedback inside the history entry for its own attempt", () => {
  const entries = renderHistoryEntries({
    submissions: [oldSubmission, newSubmission],
    latest: { submissionId: "newer-submission", feedbackItems: newSubmission.feedbackItems },
  }, true);

  expect(entries).toHaveLength(2);
  expect(entries[0]).toContain("第 2 次提交的 AI 反馈预览");
  expect(entries[0]).toMatch(/新尝试反馈一\n正文第二行[\s\S]*新尝试反馈二/);
  expect(entries[0]).toContain("建议第一行\n建议第二行");
  expect(entries[0]).toContain("correctness - 正确性");
  expect(entries[0]).toContain("BUG - 缺陷 · WARN - 警告");
  expect(entries[0]).not.toContain("旧尝试反馈");
  expect(entries[0]).not.toContain("教师反馈正文");
  expect(entries[1]).toContain("第 1 次提交的 AI 反馈预览");
  expect(entries[1]).toContain("旧尝试反馈");
  expect(entries[1]).not.toContain("新尝试反馈");
  expect(entries[1]).not.toContain("建议：");
  expect(entries[1]).not.toContain("标签：");
});

test("hides preview content when disabled and preserves both complete feedback links", () => {
  const entries = renderHistoryEntries({ submissions: [oldSubmission, newSubmission] }, false);

  expect(entries).toHaveLength(2);
  expect(entries.join("")).not.toMatch(/AI 反馈预览|新尝试反馈|旧尝试反馈/);
  expect(entries[0]).toContain('href="/student/submissions/newer-submission?classroomId=class-1&amp;classroomTaskId=task-1"');
  expect(entries[1]).toContain('href="/student/submissions/older-submission?classroomId=class-1&amp;classroomTaskId=task-1"');
});

test("empty or missing preview arrays leave a scoped empty state and the full link", () => {
  const entries = renderHistoryEntries({ submissions: [
    { ...oldSubmission, feedbackItems: [] },
    { id: "missing-preview", attemptNo: 3 },
  ] }, true);

  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect(entry).toContain("本次暂无 AI 反馈预览");
    expect(entry).toContain("查看反馈");
    expect(entry).not.toContain("尚未评阅");
  }
});
