import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildReviewPackStudentGroups,
  describeRepeatSubmissions,
  ReviewPackStudentGroupCards,
  summarizeReviewPackStudentGroups,
} from "../../app/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack/review-pack-student-groups";
import { toReviewPackResponse } from "../../lib/api/types-teacher";

const groupTitles = ["AI 评阅未报错误", "已提交，需核对", "窗口内未提交"];
const unsupportedConclusions = /较多错误|错误较多|返工|稳定|已合格|未稳定通过/;

const textOf = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function renderGroups(studentTiers: unknown): { cards: string[]; summary: string } {
  const groups = buildReviewPackStudentGroups(toReviewPackResponse({ studentTiers }).studentTiers);
  const html = renderToStaticMarkup(createElement(ReviewPackStudentGroupCards, { groups }));
  return {
    cards: html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [],
    summary: summarizeReviewPackStudentGroups(groups),
  };
}

function expectGroupCounts(
  { cards, summary }: ReturnType<typeof renderGroups>,
  counts: [number, number, number],
) {
  expect(cards).toHaveLength(groupTitles.length);
  groupTitles.forEach((title, index) => {
    expect(textOf(cards[index])).toContain(`${title}（${counts[index]}）`);
    expect(summary).toMatch(new RegExp(`${title}[（(：\\s]*${counts[index]}\\s*人`));
  });
  expect(summary).not.toMatch(unsupportedConclusions);
}

function studentRow(card: string, name: string): string {
  const rows = card.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  const row = rows.map(textOf).find((candidate) => candidate.includes(name));
  expect(row, `student row for ${name}`).toBeDefined();
  return row ?? "";
}

test("uses the complete server grouping for the cards and summary, preserving both watch counts", () => {
  const mixed = renderGroups({
    good: [{ studentId: "good", studentName: "学生甲", attemptsCount: 1, latestErrorCount: 0 }],
    watch: [
      { studentId: "watch-zero", studentName: "学生乙", attemptsCount: 2, latestErrorCount: 0 },
      { studentId: "watch-one", studentName: "学生丙", attemptsCount: 1, latestErrorCount: 1 },
    ],
    notSubmitted: [{ studentId: "missing", studentName: "学生丁" }],
  });

  expectGroupCounts(mixed, [1, 2, 1]);
  const zero = studentRow(mixed.cards[1], "学生乙");
  const one = studentRow(mixed.cards[1], "学生丙");
  expect(zero).toMatch(/窗口内提交次数：\s*2\s*次/);
  expect(zero).toMatch(/最新提交的 AI 错误级反馈：\s*0\s*条/);
  expect(one).toMatch(/窗口内提交次数：\s*1\s*次/);
  expect(one).toMatch(/最新提交的 AI 错误级反馈：\s*1\s*条/);
  expect(`${zero} ${one}`).not.toMatch(/未申请|排队|评阅失败|正在处理/);
  expect(textOf(mixed.cards[1])).not.toMatch(unsupportedConclusions);
  expect(studentRow(mixed.cards[2], "学生丁")).not.toContain("错误级反馈");
});

test("all-good students keep the same group names and a three-submission fact", () => {
  const allGood = renderGroups({
    good: [{ studentId: "good", studentName: "学生甲", attemptsCount: 3, latestErrorCount: 0 }],
    watch: [],
    notSubmitted: [],
  });

  expectGroupCounts(allGood, [1, 0, 0]);
  const row = studentRow(allGood.cards[0], "学生甲");
  expect(row).toMatch(/窗口内提交次数：\s*3\s*次/);
  expect(row).toMatch(/最新提交的 AI 错误级反馈：\s*0\s*条/);
  expect(row).not.toMatch(unsupportedConclusions);
});

test("distinguishes no submissions in the window from absent grouping data", () => {
  const allWaiting = renderGroups({
    good: [],
    watch: [],
    notSubmitted: [
      { studentId: "one", studentName: "学生甲" },
      { studentId: "two", studentName: "学生乙" },
    ],
  });
  expectGroupCounts(allWaiting, [0, 0, 2]);
  expect(studentRow(allWaiting.cards[2], "学生甲")).not.toContain("错误级反馈");

  const empty = renderGroups({ good: [], watch: [], notSubmitted: [] });
  expect(empty.summary).toMatch(/未返回.*学生分层数据|暂无.*学生分层数据/);
  expect(empty.summary).not.toMatch(unsupportedConclusions);
});

test("renders missing counts as a dash without inferring a job status", () => {
  const missing = renderGroups({
    good: [],
    watch: [{ studentId: "unknown-counts", studentName: "学生甲" }],
    notSubmitted: [],
  });
  const row = studentRow(missing.cards[1], "学生甲");
  expect(row).toMatch(/窗口内提交次数：\s*—/);
  expect(row).toMatch(/最新提交的 AI 错误级反馈：\s*—/);
  expect(row).not.toMatch(/未申请|排队|评阅失败|正在处理/);
});

test("describes each positive repeat-submission bucket as a headcount", () => {
  const twice = describeRepeatSubmissions(4, 0);
  const threePlus = describeRepeatSubmissions(undefined, 2);
  const both = describeRepeatSubmissions(4, 2);

  const twiceFact = /4\s*名学生[^。]*提交\s*2\s*次/;
  const threePlusFact = /2\s*名学生[^。]*提交\s*3\s*次及以上/;
  expect(twice).toMatch(twiceFact);
  expect(twice).not.toContain("3 次");
  expect(threePlus).toMatch(threePlusFact);
  expect(threePlus).not.toContain("提交 2 次");
  expect(both).toMatch(twiceFact);
  expect(both).toMatch(threePlusFact);
  expect(`${twice}${threePlus}${both}`).not.toMatch(unsupportedConclusions);
  expect(describeRepeatSubmissions(0, 0)).toBe("");
  expect(describeRepeatSubmissions()).toBe("");
});
