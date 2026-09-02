import { test, expect } from "@playwright/test";
import { paths } from "../../lib/routes/paths";

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
