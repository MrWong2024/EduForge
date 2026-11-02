import { test, expect } from "@playwright/test";
import {
  TASK_DIFFICULTY_OPTIONS,
  getDifficultyLabel,
  toDifficultyInputValue,
  createDifficultyPayload,
  updateDifficultyPayload,
} from "../../lib/learning-tasks/difficulty";

test("difficulty options keep the teaching labels, storage values and order", () => {
  expect(TASK_DIFFICULTY_OPTIONS).toEqual([
    { value: "easy", label: "基础" },
    { value: "medium", label: "进阶" },
    { value: "hard", label: "挑战" },
  ]);
  expect(getDifficultyLabel("easy")).toBe("基础");
  expect(getDifficultyLabel("medium")).toBe("进阶");
  expect(getDifficultyLabel("hard")).toBe("挑战");
});

test("missing, blank and invalid difficulty values remain unset", () => {
  for (const value of [undefined, null, "", " \t\n ", 0, true, {}, []]) {
    expect(getDifficultyLabel(value)).toBe("未设置");
    expect(toDifficultyInputValue(value)).toBe("");
  }
});

test("unknown nonempty values preserve exact text without aliases or case guessing", () => {
  for (const value of ["综合", "EASY", " easy ", "  综合\n设计  ", "<img>"]) {
    expect(getDifficultyLabel(value)).toBe(value);
    expect(toDifficultyInputValue(value)).toBe(value);
  }
});

test("create omits unset difficulty and sends selected English values", () => {
  expect(createDifficultyPayload("")).toEqual({});
  expect(createDifficultyPayload("easy")).toEqual({ difficulty: "easy" });
  expect(createDifficultyPayload("medium")).toEqual({ difficulty: "medium" });
  expect(createDifficultyPayload("hard")).toEqual({ difficulty: "hard" });
});

test("edit omits unchanged values and sends an explicit empty string to clear", () => {
  for (const initial of [undefined, null, "", " \t ", 0]) {
    expect(updateDifficultyPayload(initial, "")).toEqual({});
  }
  expect(updateDifficultyPayload("easy", "easy")).toEqual({});
  expect(updateDifficultyPayload("easy", "")).toEqual({ difficulty: "" });
  expect(updateDifficultyPayload("easy", "hard")).toEqual({
    difficulty: "hard",
  });
});

test("an unchanged legacy value survives unrelated edits and can be replaced or cleared", () => {
  expect(updateDifficultyPayload("综合", "综合")).toEqual({});
  expect(updateDifficultyPayload("综合", "medium")).toEqual({
    difficulty: "medium",
  });
  expect(updateDifficultyPayload("综合", "")).toEqual({ difficulty: "" });
  expect(updateDifficultyPayload("  综合\n设计  ", "  综合\n设计  ")).toEqual(
    {},
  );
});

test("difficulty handling leaves input objects and the option catalog unchanged", () => {
  const input = Object.freeze({ difficulty: "综合", title: "保留标题" });
  const before = JSON.stringify(TASK_DIFFICULTY_OPTIONS);
  getDifficultyLabel(input);
  toDifficultyInputValue(input);
  updateDifficultyPayload(input, "");
  createDifficultyPayload(input.difficulty);
  expect(input).toEqual({ difficulty: "综合", title: "保留标题" });
  expect(JSON.stringify(TASK_DIFFICULTY_OPTIONS)).toBe(before);
});
