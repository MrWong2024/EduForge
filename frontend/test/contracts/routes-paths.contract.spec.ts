import { test, expect } from "@playwright/test";
import { paths } from "../../lib/routes/paths";
import { toSafeTaskListReturnTo } from "../../lib/routes/task-list-return-to";

test("keeps key entry routes stable", () => {
  expect(paths.login).toBe("/login");
  expect(paths.teacher.home).toBe("/teacher");
  expect(paths.student.dashboard).toBe("/student/dashboard");
});

test("encodes reserved characters in dynamic path segments", () => {
  expect(paths.teacher.classroomDashboard("class/1")).toBe(
    "/teacher/classrooms/class%2F1/dashboard",
  );
  expect(paths.student.submissionDetail("submission 1")).toBe(
    "/student/submissions/submission%201",
  );
});

test("encodes the classroom query while keeping the published filter", () => {
  expect(paths.teacher.tasksFromClassroom("class/1 &status=DRAFT")).toBe(
    "/teacher/tasks?fromClassroomId=class%2F1%20%26status%3DDRAFT&status=PUBLISHED",
  );
});

test("encodes both segments of the classroom task submissions route", () => {
  expect(paths.teacher.classroomTaskSubmissions("class/1", "task 2/班")).toBe(
    "/teacher/classrooms/class%2F1/tasks/task%202%2F%E7%8F%AD/submissions",
  );
});

test.describe("task template list returnTo", () => {
  for (const [label, value] of [
    ["undefined", undefined],
    ["empty input", ""],
    ["whitespace", " \t\r\n "],
    [
      "normalized double slash path",
      "/teacher/tasks/../../..//example.com/?stage=4",
    ],
    [
      "encoded dot traversal",
      "/teacher/tasks/%2e%2e/%2e%2e/%2e%2e//example.com/?stage=4",
    ],
    ["protocol relative URL", "//example.com/teacher/tasks"],
    ["absolute URL", "https://example.com/teacher/tasks"],
    ["relative path", "teacher/tasks"],
    ["query without a path", "?scope=all"],
    ["normalized external origin", "/\\example.com/teacher/tasks"],
    ["URL parse error", "/\\[invalid-host]/teacher/tasks"],
    ["list subpath", "/teacher/tasks/task-id/edit?scope=all"],
    ["prefix lookalike", "/teacher/tasks-extra"],
    ["another page", "/teacher/classrooms"],
    ["trailing slash", "/teacher/tasks/?page=2"],
  ] as const) {
    test(`falls back for ${label}`, () => {
      expect(toSafeTaskListReturnTo(value)).toBe("/teacher/tasks");
    });
  }

  test("keeps the exact task list path", () => {
    expect(toSafeTaskListReturnTo("/teacher/tasks")).toBe("/teacher/tasks");
  });

  test("trims a valid list address", () => {
    expect(toSafeTaskListReturnTo(" \t/teacher/tasks?scope=mine#list\n ")).toBe(
      "/teacher/tasks?scope=mine#list",
    );
  });

  test("preserves list context, repeated query order and hash idempotently", () => {
    const result = toSafeTaskListReturnTo(
      "/teacher/tasks?scope=all&knowledgeModule=类与对象&knowledgeModule=继承&fromClassroomId=班级甲&page=2#list",
    );
    const url = new URL(result, "https://return-to-contract.invalid");
    expect(result.startsWith("//")).toBe(false);
    expect(url.origin).toBe("https://return-to-contract.invalid");
    expect(url.pathname).toBe("/teacher/tasks");
    expect([...url.searchParams.entries()]).toEqual([
      ["scope", "all"],
      ["knowledgeModule", "类与对象"],
      ["knowledgeModule", "继承"],
      ["fromClassroomId", "班级甲"],
      ["page", "2"],
    ]);
    expect(url.hash).toBe("#list");
    expect(toSafeTaskListReturnTo(result)).toBe(result);
  });

  test("removes every stage parameter without losing context idempotently", () => {
    const result = toSafeTaskListReturnTo(
      "/teacher/tasks?stage=1&scope=mine&stage=4&page=2#list",
    );
    expect(result).toBe("/teacher/tasks?scope=mine&page=2#list");
    expect(toSafeTaskListReturnTo(result)).toBe(
      "/teacher/tasks?scope=mine&page=2#list",
    );
  });
});
