import { expect, test } from "@playwright/test";
import { updateMemberRemovalFeedback } from "../../lib/classroom-member-removal";
import { findLastPageForOutOfRangeRequest } from "../../lib/routes/teacher-list-pagination";

test("teacher lists recover directly to the last page for the effective limit", () => {
  expect(findLastPageForOutOfRangeRequest(5, 2, 5)).toBe(3);
  expect(findLastPageForOutOfRangeRequest(101, 1, 2)).toBe(2);
  expect(findLastPageForOutOfRangeRequest(2, 100, 100)).toBe(1);
});

test("teacher lists keep valid high pages and the first page of an empty list", () => {
  expect(findLastPageForOutOfRangeRequest(101, 1, 101)).toBeUndefined();
  expect(findLastPageForOutOfRangeRequest(2, 100, 101)).toBeUndefined();
  expect(findLastPageForOutOfRangeRequest(1, 100, 0)).toBeUndefined();
  expect(findLastPageForOutOfRangeRequest(2, 100, 0)).toBe(1);
});

test("teacher lists require a reliable total and effective page size for recovery", () => {
  for (const total of [undefined, null, "2", -1, 2.5, Number.NaN, Infinity]) {
    expect(findLastPageForOutOfRangeRequest(5, 1, total)).toBeUndefined();
  }
  expect(findLastPageForOutOfRangeRequest(5, 0, 2)).toBeUndefined();
});

test("member removals retain each student's result when another row starts or finishes", () => {
  const aFailure = { kind: "error", studentName: "学生甲", summary: "暂时失败" } as const;
  const bFailure = { kind: "error", studentName: "学生乙", summary: "权限不足" } as const;
  const bSuccess = { kind: "success", message: "已将学生乙移出班级。" } as const;

  const afterA = updateMemberRemovalFeedback(new Map(), "student-a", aFailure);
  const afterB = updateMemberRemovalFeedback(afterA, "student-b", bFailure);
  expect([...afterB.values()]).toEqual([aFailure, bFailure]);

  const retryB = updateMemberRemovalFeedback(afterB, "student-b", null);
  expect([...retryB.values()]).toEqual([aFailure]);
  const finishB = updateMemberRemovalFeedback(retryB, "student-b", bSuccess);
  expect([...finishB.values()]).toEqual([aFailure, bSuccess]);
  expect([...afterB.values()]).toEqual([aFailure, bFailure]);

  const retryA = updateMemberRemovalFeedback(finishB, "student-a", null);
  expect([...retryA.entries()]).toEqual([["student-b", bSuccess]]);
});
