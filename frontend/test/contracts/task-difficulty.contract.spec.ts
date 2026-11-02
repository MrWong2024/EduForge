import { test, expect } from "@playwright/test";
import {
  TASK_DIFFICULTY_OPTIONS,
  getDifficultyLabel,
  toDifficultyInputValue,
  createDifficultyPayload,
  updateDifficultyPayload,
  parseDifficultyFilter,
} from "../../lib/learning-tasks/difficulty";
import { buildQueryString } from "../../lib/ui/format";

test("difficulty filters accept only exact individual values and omit all difficulties", () => {
  expect(parseDifficultyFilter("easy")).toBe("easy");
  expect(parseDifficultyFilter("medium")).toBe("medium");
  expect(parseDifficultyFilter("hard")).toBe("hard");
  for (const value of [
    undefined,
    null,
    "",
    " \t\n ",
    "综合",
    "Easy",
    "EASY",
    " easy ",
    "easy,medium",
    ["easy"],
    ["easy", "hard"],
    [],
    0,
    true,
    {},
  ]) {
    expect(parseDifficultyFilter(value)).toBeUndefined();
    expect(buildQueryString({ difficulty: parseDifficultyFilter(value) })).toBe(
      "",
    );
  }
});

test("filter queries use the existing encoder and never send an empty difficulty", () => {
  expect(buildQueryString({ difficulty: parseDifficultyFilter("easy") })).toBe(
    "difficulty=easy",
  );
  expect(
    buildQueryString({ difficulty: parseDifficultyFilter("medium") }),
  ).toBe("difficulty=medium");
  expect(buildQueryString({ difficulty: parseDifficultyFilter("hard") })).toBe(
    "difficulty=hard",
  );
  expect(
    buildQueryString({
      difficulty: parseDifficultyFilter("medium"),
      knowledgeModule: "综合 & 设计",
      page: 2,
    }),
  ).toBe(
    "difficulty=medium&knowledgeModule=%E7%BB%BC%E5%90%88+%26+%E8%AE%BE%E8%AE%A1&page=2",
  );
  expect(
    buildQueryString({ page: 1, difficulty: parseDifficultyFilter("") }),
  ).toBe("page=1");
});

test("filter parsing does not normalize stored difficulty or mutate URL arrays", () => {
  const values = Object.freeze(["easy", "hard"]);
  expect(parseDifficultyFilter(values)).toBeUndefined();
  expect(values).toEqual(["easy", "hard"]);
  for (const value of ["综合", "Easy", " easy "]) {
    expect(parseDifficultyFilter(value)).toBeUndefined();
    expect(getDifficultyLabel(value)).toBe(value);
    expect(toDifficultyInputValue(value)).toBe(value);
    expect(updateDifficultyPayload(value, value)).toEqual({});
  }
});

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
