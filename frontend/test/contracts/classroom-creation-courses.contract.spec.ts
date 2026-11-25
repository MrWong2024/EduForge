import { expect, test } from "@playwright/test";
import {
  toClassroomListResponse,
  toCourseListResponse,
} from "../../lib/api/types-teacher";
import {
  classroomCourseName,
  classroomCoursePagePath,
  mergeClassroomCourseOptions,
  nextClassroomCoursePage,
  resolveClassroomCreationCourses,
} from "../../lib/classroom-creation-courses";

const firstPage = toCourseListResponse({
  items: [
    { id: "course-001", code: "C001", name: "课程一" },
    { id: "course-002", code: "C002", name: "课程二", status: "ARCHIVED" },
  ],
  page: 1,
  limit: 100,
  total: 101,
});

test("ordinary and first-page entry points choose the expected course without a detail request", async () => {
  const reads: string[] = [];
  const read = async (id: string) => { reads.push(id); };

  const ordinary = await resolveClassroomCreationCourses(firstPage, undefined, read);
  const contextual = await resolveClassroomCreationCourses(firstPage, "course-002", read);

  expect(ordinary.initialCourseId).toBe("course-001");
  expect(contextual.initialCourseId).toBe("course-002");
  expect(contextual.targetUnavailable).toBe(false);
  expect(reads).toEqual([]);
});

test("the matching supplemental course is selected and remains unique after the next page", async () => {
  const reads: string[] = [];
  const contextual = await resolveClassroomCreationCourses(firstPage, "course-101", async (id) => {
    reads.push(id);
    return { data: { id: "course-101", code: "C101", name: "后页课程" } };
  });

  expect(reads).toEqual(["course-101"]);
  expect(contextual.initialCourseId).toBe("course-101");
  expect(contextual.targetUnavailable).toBe(false);
  expect(contextual.nextPage).toBe(2);
  expect(classroomCoursePagePath(2)).toBe("courses?page=2&limit=100");

  const remainingPage = toCourseListResponse({
    items: [{ id: "course-101", code: "C101", name: "后页课程" }],
    page: 2,
    limit: 100,
    total: 101,
  });
  expect(mergeClassroomCourseOptions(contextual.courses, remainingPage.items).map(({ id }) => id))
    .toEqual(["course-001", "course-002", "course-101"]);
  expect(nextClassroomCoursePage(remainingPage, 2)).toBeUndefined();
});

test("an unavailable target never becomes the first available course", async () => {
  const unavailable = await resolveClassroomCreationCourses(firstPage, "missing-course", async () => {
    throw new Error("fixture 404");
  });
  const mismatched = await resolveClassroomCreationCourses(firstPage, "missing-course", async () => ({
    id: "wrong-course",
    name: "另一个课程",
  }));
  const empty = await resolveClassroomCreationCourses(firstPage, "", async () => ({ id: "" }));

  for (const result of [unavailable, mismatched, empty]) {
    expect(result.targetUnavailable).toBe(true);
    expect(result.initialCourseId).toBeUndefined();
    expect(result.courses.map(({ id }) => id)).toEqual(["course-001", "course-002"]);
  }
});

test("classroom row names take precedence, then use the known-course mapping", () => {
  const rows = toClassroomListResponse({ items: [
    { courseId: "course-101", course: { name: "后页课程" } },
    { courseId: "course-001", course: { name: "行内名称" } },
    { courseId: "course-001", course: { name: " " } },
    { courseId: "course-002" },
  ] }).items;
  const names = new Map([["course-001", "课程一"], ["course-002", " "]]);

  expect(rows.map((row) => classroomCourseName(row, names)))
    .toEqual(["后页课程", "行内名称", "课程一", "未知课程"]);
});
