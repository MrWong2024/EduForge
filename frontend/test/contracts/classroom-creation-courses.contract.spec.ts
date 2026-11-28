import { expect, test } from "@playwright/test";
import {
  toClassroomCreateResponse,
  toClassroomListResponse,
  toCourseListResponse,
} from "../../lib/api/types-teacher";
import {
  classroomCourseName,
  classroomCoursePagePath,
  mergeClassroomCourseOptions,
  nextClassroomCoursePage,
  readClassroomCreationCourse,
  resolveClassroomCreationCourses,
  selectClassroomCreationCourseId,
} from "../../lib/classroom-creation-courses";
import {
  BrowserFetchJsonError,
  isDefiniteCreateRejection,
} from "../../lib/api/browser-client";

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

test("a missing selection never submits the old ID or silently picks a replacement", () => {
  const freshOptions = [{ id: "course-002", code: "C002", name: "课程二" }];

  expect(selectClassroomCreationCourseId(freshOptions, "course-001")).toBe("");
  expect(selectClassroomCreationCourseId(freshOptions, "course-002")).toBe("course-002");
  expect(selectClassroomCreationCourseId(freshOptions)).toBe("course-002");
});

test("an exact read restores a valid later-page selection and uses the latest course label", async () => {
  const reads: string[] = [];
  const previousSelection = "course-101";
  const freshOptions = [{ id: "course-001", code: "C001", name: "课程一" }];
  expect(selectClassroomCreationCourseId(freshOptions, previousSelection)).toBe("");

  const checked = await readClassroomCreationCourse(previousSelection, async (id) => {
    reads.push(id);
    return { data: { id: "course-101", code: "C101", name: "后页课程现名" } };
  });
  expect(reads).toEqual(["course-101"]);
  expect(checked).toEqual({ id: "course-101", code: "C101", name: "后页课程现名" });

  const restoredOptions = mergeClassroomCourseOptions(freshOptions, checked ? [checked] : []);
  expect(selectClassroomCreationCourseId(restoredOptions, previousSelection)).toBe("course-101");
});

test("a missing or mismatched exact read cannot restore the absent selection", async () => {
  const missingCourse = new BrowserFetchJsonError(404, {});

  await expect(readClassroomCreationCourse("course-101", async () => {
    throw missingCourse;
  })).rejects.toBe(missingCourse);
  await expect(readClassroomCreationCourse("course-101", async () => ({
    id: "course-201",
    name: "另一门课程",
  }))).resolves.toBeUndefined();
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

test("an explicit create rejection allows correction while transport and 5xx errors require review", () => {
  expect(isDefiniteCreateRejection(new BrowserFetchJsonError(400, {}))).toBe(true);
  expect(isDefiniteCreateRejection(new BrowserFetchJsonError(503, {}))).toBe(false);
  expect(isDefiniteCreateRejection(new TypeError("connection lost"))).toBe(false);
});

test("the classroom create receipt may omit its ID for the existing list fallback", () => {
  expect(toClassroomCreateResponse({ id: "class-1", name: "班级" }).id).toBe("class-1");
  expect(toClassroomCreateResponse({}).id).toBeUndefined();
});
