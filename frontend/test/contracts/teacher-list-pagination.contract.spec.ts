import { expect, test } from "@playwright/test";
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
