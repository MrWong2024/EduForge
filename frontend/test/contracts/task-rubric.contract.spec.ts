import { expect, test } from "@playwright/test";
import {
  buildCreateTaskRubric,
  buildUpdateTaskRubric,
  getCandidateRubricSummary,
  getRubricNotes,
  getRubricSummary,
} from "../../lib/learning-tasks/rubric";
import { toLearningTaskUpdateResponse } from "../../lib/api/types-teacher";

const input =
  " \n使用多态统一处理支付方式。\n\n  提供正常与异常输入的验证记录。\n ";
const notes = "使用多态统一处理支付方式。\n\n  提供正常与异常输入的验证记录。";

test("create and update send only trimmed notes while preserving internal text and line breaks", () => {
  expect(buildCreateTaskRubric(input)).toEqual({ notes });
  expect(buildUpdateTaskRubric(input)).toEqual({ notes });
});

test("blank creation omits rubric and blank editing explicitly clears it", () => {
  for (const blank of ["", " \n\t "]) {
    expect(buildCreateTaskRubric(blank)).toBeUndefined();
    expect(buildUpdateTaskRubric(blank)).toEqual({});
  }
  expect(
    JSON.parse(JSON.stringify({ rubric: buildCreateTaskRubric(" \n") })),
  ).toEqual({});
  expect(
    JSON.parse(JSON.stringify({ rubric: buildUpdateTaskRubric(" \n") })),
  ).toEqual({ rubric: {} });
});

test("notes reading and summaries use string notes only", () => {
  expect(getRubricNotes({ notes: input })).toBe(input);
  expect(getRubricSummary({ notes: input })).toBe("已填写");
  for (const rubric of [
    undefined,
    null,
    {},
    { notes: " \n\t" },
    { notes: 1 },
  ]) {
    expect(getRubricSummary(rubric)).toBe("未填写");
  }
  expect(getRubricNotes({})).toBe("");
  expect(getRubricNotes({ notes: 1 })).toBe("");
});

test("candidate field absence remains unknown rather than claiming no notes", () => {
  expect(getCandidateRubricSummary(undefined)).toBe(
    "候选列表未提供评阅标准，请到模板详情核对",
  );
  expect(getCandidateRubricSummary({})).toBe("未填写");
  expect(getCandidateRubricSummary({ notes: " \n" })).toBe("未填写");
  expect(getCandidateRubricSummary({ notes })).toBe("已填写");
});

test("successful response notes can seed consecutive edit, clear and refill saves", () => {
  const edited = toLearningTaskUpdateResponse({
    id: "task",
    rubric: { notes },
  });
  expect(getRubricNotes(edited.rubric)).toBe(notes);
  expect(buildUpdateTaskRubric("")).toEqual({});
  const cleared = toLearningTaskUpdateResponse({ id: "task", rubric: {} });
  expect(cleared.rubric).toBeUndefined();
  expect(getRubricNotes(cleared.rubric)).toBe("");
  expect(buildUpdateTaskRubric("  重新填写\n保留换行  ")).toEqual({
    notes: "重新填写\n保留换行",
  });
});
