import { test, expect } from "@playwright/test";
import {
  toListFeedbackResponse,
  toMyTaskDetailResponse,
  toSubmissionDetailResponse,
} from "../../lib/api/types-student";
import {
  groupTeacherFeedbackItems,
  normalizeClassroomStatus,
  normalizeClassroomTaskStatus,
  normalizeCourseStatus,
  toClassroomCreateResponse,
  toClassroomDetailResponse,
  toClassroomListResponse,
  toClassroomStudentsResponse,
  toClassroomSummary,
  toClassroomTask,
  toClassroomTaskSummary,
  toClassroomTasksResponse,
  toClassroomUpdateResponse,
  toCourseCreateResponse,
  toCourseDetailResponse,
  toCourseListResponse,
  toCourseOverviewResponse,
  toCourseSummary,
  toCourseUpdateResponse,
  toLearningTaskCreateResponse,
  toLearningTaskDetailResponse,
  toLearningTaskListResponse,
  toLearningTaskOption,
  toLearningTaskUpdateResponse,
  toLearningTrajectoryResponse,
  toPublishableTaskTemplateListResponse,
  toSubmissionDetailResponse as toTeacherDetail,
  toSubmitTaskResponse,
  toTeacherFeedbackListResponse,
} from "../../lib/api/types-teacher";
import {
  canSubmitTextTask,
  getTaskSnapshotErrorMessage,
  getTaskSnapshotMessage,
} from "../../lib/learning-tasks/ai-review";
import {
  buildTextSubmissionRequest,
  canCreateTextSubmission,
  getSavedSubmissionHref,
  getTextSubmissionError,
  countCodePoints,
  getSubmissionTextError,
  buildUpdateSubmissionRequest,
  canEditSubmission,
  isDraftRevisionCurrent,
  isSavedSubmissionRevision,
  selectSubmissionDisplayDetail,
  getSubmissionRevisionError,
} from "../../lib/learning-tasks/text-submission";
import {
  SUBMISSION_LANGUAGE_OPTIONS,
  toDisplaySubmissionLanguage,
} from "../../lib/learning-tasks/submission-language";
import { toDisplayLateDuration } from "../../lib/ui/format";
import { normalizeTaskTemplateVisibility } from "../../lib/learning-tasks/template-visibility-scope";
import { canEditTeacherFeedback } from "../../lib/learning-tasks/teacher-feedback";
import {
  canEditTaskTemplate,
  isTaskTemplateAuthor,
} from "../../lib/learning-tasks/ai-context-refs";

test("course and classroom status normalizers preserve only the exact formal states", () => {
  for (const status of ["ACTIVE", "ARCHIVED"] as const) {
    for (const normalize of [normalizeCourseStatus, normalizeClassroomStatus]) {
      expect(normalize(status)).toBe(status);
    }
  }
});

test("course and classroom status normalizers reject missing and invalid values without coercion", () => {
  const missing: Readonly<Record<string, unknown>> = Object.freeze({});
  for (const normalize of [normalizeCourseStatus, normalizeClassroomStatus]) {
    expect(normalize(missing.status)).toBeUndefined();
    for (const status of [
      undefined,
      null,
      "",
      " \t\n ",
      "UNKNOWN",
      "active",
      "archived",
      "Active",
      "Archived",
      " ACTIVE",
      "ACTIVE ",
      "ARCHIVED ",
      "\tARCHIVED\n",
      Object.freeze([]),
      Object.freeze(["ACTIVE"]),
      Object.freeze({}),
      Object.freeze({ status: "ARCHIVED" }),
      0,
      1,
      true,
      false,
    ]) {
      expect(normalize(status)).toBeUndefined();
    }
  }
  expect(Object.hasOwn(missing, "status")).toBe(false);
  expect(missing).toEqual({});
});

test("direct course and classroom mappers preserve adjacent fields and their existing raw semantics", () => {
  const nestedCourse = Object.freeze({
    id: "course-1",
    courseId: "legacy-nested-course",
    name: "课程",
    status: "archived",
  });
  for (const { fields, expectedStatus, hasStatus } of [
    { fields: { status: "ACTIVE" }, expectedStatus: "ACTIVE", hasStatus: true },
    {
      fields: { status: "ARCHIVED" },
      expectedStatus: "ARCHIVED",
      hasStatus: true,
    },
    {
      fields: { status: " active " },
      expectedStatus: undefined,
      hasStatus: true,
    },
    { fields: {}, expectedStatus: undefined, hasStatus: false },
  ] as const) {
    const course = Object.freeze({
      id: "course-1",
      courseId: "legacy-course",
      code: "CS-101",
      name: "课程名称",
      term: "2026秋",
      courseLabel: "程序设计基础",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-11-01T08:00:00.000Z",
      ...fields,
    });
    const classroom = Object.freeze({
      id: "classroom-1",
      classroomId: "legacy-classroom",
      courseId: "course-1",
      name: "班级名称",
      joinCode: "JOIN-001",
      course: nestedCourse,
      ...fields,
    });
    const beforeCourse = structuredClone(course);
    const beforeClassroom = structuredClone(classroom);

    for (const adapt of [toCourseSummary, toCourseCreateResponse]) {
      const result = adapt(course);
      expect(result).toMatchObject({
        id: "course-1",
        code: "CS-101",
        name: "课程名称",
        term: "2026秋",
        courseLabel: "程序设计基础",
      });
      expect(result.status).toBe(expectedStatus);
      expect(result.raw).toBe(course);
    }
    expect(toCourseSummary(course)).toMatchObject({
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-11-01T08:00:00.000Z",
    });
    for (const adapt of [toClassroomSummary, toClassroomCreateResponse]) {
      const result = adapt(classroom);
      expect(result).toMatchObject({
        id: "classroom-1",
        courseId: "course-1",
        name: "班级名称",
        joinCode: "JOIN-001",
        course: { id: "course-1", name: "课程", status: "archived" },
      });
      expect(result.status).toBe(expectedStatus);
    }
    expect(toClassroomSummary(classroom)).not.toHaveProperty("raw");
    expect(toClassroomCreateResponse(classroom).raw).toBe(classroom);
    expect(Object.hasOwn(course, "status")).toBe(hasStatus);
    expect(Object.hasOwn(classroom, "status")).toBe(hasStatus);
    expect(course).toEqual(beforeCourse);
    expect(classroom).toEqual(beforeClassroom);
  }
});

test("course and classroom detail and update consume top-level fields despite conflicting data", () => {
  const course = Object.freeze({
    id: "selected-course",
    code: "CS-102",
    name: "选中课程",
    term: "2026秋",
    status: "archived",
  });
  const classroom = Object.freeze({
    id: "selected-classroom",
    courseId: "selected-course",
    name: "选中班级",
    joinCode: "JOIN-002",
    status: " ACTIVE ",
  });
  const ignoredCourse = Object.freeze({
    id: "ignored-course",
    name: "忽略的课程",
    status: "ACTIVE",
  });
  const ignoredClassroom = Object.freeze({
    id: "ignored-classroom",
    name: "忽略的班级",
    status: "ARCHIVED",
  });
  const coursePayload = Object.freeze({ ...course, data: ignoredCourse });
  const classroomPayload = Object.freeze({
    ...classroom,
    data: ignoredClassroom,
  });
  const beforeCourse = structuredClone(coursePayload);
  const beforeClassroom = structuredClone(classroomPayload);

  for (const adapt of [toCourseDetailResponse, toCourseUpdateResponse]) {
    const result = adapt(coursePayload);
    expect(result).toMatchObject({
      id: "selected-course",
      code: "CS-102",
      name: "选中课程",
      term: "2026秋",
    });
    expect(result.status).toBeUndefined();
    expect(result.raw).toBe(coursePayload);
  }
  for (const adapt of [toClassroomDetailResponse, toClassroomUpdateResponse]) {
    const result = adapt(classroomPayload);
    expect(result).toMatchObject({
      id: "selected-classroom",
      courseId: "selected-course",
      name: "选中班级",
      joinCode: "JOIN-002",
    });
    expect(result.status).toBeUndefined();
    expect(result).not.toHaveProperty("raw");
  }
  expect(coursePayload.data).toBe(ignoredCourse);
  expect(classroomPayload.data).toBe(ignoredClassroom);
  expect(coursePayload).toEqual(beforeCourse);
  expect(classroomPayload).toEqual(beforeClassroom);
});

test("course and classroom lists retain mixed-status rows, order and pagination", () => {
  const courses = Object.freeze([
    Object.freeze({ id: "course-active", status: "ACTIVE" }),
    Object.freeze({ id: "course-unknown", status: " archived " }),
    Object.freeze({ id: "course-archived", status: "ARCHIVED" }),
  ]);
  const classrooms = Object.freeze([
    Object.freeze({ id: "classroom-archived", status: "ARCHIVED" }),
    Object.freeze({ id: "classroom-unknown", status: "active" }),
    Object.freeze({ id: "classroom-active", status: "ACTIVE" }),
  ]);
  const coursePayload = Object.freeze({
    items: courses,
    total: 31,
    page: 3,
    limit: 100,
  });
  const classroomPayload = Object.freeze({
    items: classrooms,
    total: 42,
    page: 4,
    limit: 100,
  });
  const beforeCourse = structuredClone(coursePayload);
  const beforeClassroom = structuredClone(classroomPayload);
  const courseResult = toCourseListResponse(coursePayload);
  const classroomResult = toClassroomListResponse(classroomPayload);

  expect(courseResult).toMatchObject({ total: 31, page: 3, limit: 100 });
  expect(courseResult.items.map((item) => item.id)).toEqual([
    "course-active",
    "course-unknown",
    "course-archived",
  ]);
  expect(courseResult.items.map((item) => item.status)).toEqual([
    "ACTIVE",
    undefined,
    "ARCHIVED",
  ]);
  expect(courseResult.raw).toBe(coursePayload);
  courseResult.items.forEach((item, index) =>
    expect(item.raw).toBe(courses[index]),
  );
  expect(classroomResult).toMatchObject({ total: 42, page: 4, limit: 100 });
  expect(classroomResult.items.map((item) => item.id)).toEqual([
    "classroom-archived",
    "classroom-unknown",
    "classroom-active",
  ]);
  expect(classroomResult.items.map((item) => item.status)).toEqual([
    "ARCHIVED",
    undefined,
    "ACTIVE",
  ]);
  expect(classroomResult).not.toHaveProperty("raw");
  classroomResult.items.forEach((item) =>
    expect(item).not.toHaveProperty("raw"),
  );
  expect(coursePayload.items).toBe(courses);
  expect(classroomPayload.items).toBe(classrooms);
  expect(coursePayload).toEqual(beforeCourse);
  expect(classroomPayload).toEqual(beforeClassroom);
});

test("course overview preserves top-level metrics, exact zero, nullable AI and raw references", () => {
  const course = Object.freeze({
    id: "overview-course",
    courseId: "legacy-overview-course",
    code: "CS-103",
    name: "总览课程",
    term: "2026秋",
    status: " ARCHIVED ",
  });
  const item = Object.freeze({
    classroomId: "overview-classroom",
    name: "总览班级",
    studentsCount: 2,
    publishedClassroomTasks: 3,
    distinctStudentsSubmitted: 0,
    overallSubmissionCoverage: 0,
    submissionRate: 0,
    lateSubmissionsCount: 0,
    lateStudentsCount: 0,
    ai: Object.freeze({
      jobsTotal: 0,
      pendingJobs: 0,
      failedJobs: 0,
      aiSuccessRate: null,
      topErrors: Object.freeze([
        Object.freeze({ code: "RATE_LIMIT", count: 0 }),
      ]),
    }),
  });
  const emptyItem = Object.freeze({
    classroomId: "overview-empty-classroom",
    name: "空班级",
    studentsCount: 0,
    ai: Object.freeze({ aiSuccessRate: 0 }),
  });
  const ignored = Object.freeze({
    course: Object.freeze({ id: "ignored-course", status: "ACTIVE" }),
    window: "7d",
    page: 99,
    limit: 1,
    total: 999,
    items: Object.freeze([
      Object.freeze({ classroomId: "ignored-classroom", studentsCount: 999 }),
    ]),
  });
  const payload = Object.freeze({
    course,
    window: "all",
    generatedAt: "2026-11-01T09:00:00.000Z",
    page: 2,
    limit: 20,
    total: 21,
    items: Object.freeze([item, emptyItem]),
    data: ignored,
  });
  const before = structuredClone(payload);
  const result = toCourseOverviewResponse(payload);

  expect(result.course).toMatchObject({
    id: "overview-course",
    code: "CS-103",
    name: "总览课程",
    term: "2026秋",
  });
  expect(result.course?.status).toBeUndefined();
  expect(result.course?.raw).toBe(course);
  expect(result).toMatchObject({
    window: "all",
    generatedAt: "2026-11-01T09:00:00.000Z",
    page: 2,
    limit: 20,
    total: 21,
    items: [
      {
        classroomId: "overview-classroom",
        name: "总览班级",
        studentsCount: 2,
        publishedClassroomTasks: 3,
        distinctStudentsSubmitted: 0,
        overallSubmissionCoverage: 0,
        submissionRate: 0,
        lateSubmissionsCount: 0,
        lateStudentsCount: 0,
        aiJobsTotal: 0,
        aiPendingJobs: 0,
        aiFailedJobs: 0,
        aiSuccessRate: null,
        topErrors: [{ code: "RATE_LIMIT", count: 0 }],
      },
      {
        classroomId: "overview-empty-classroom",
        name: "空班级",
        studentsCount: 0,
        aiSuccessRate: 0,
      },
    ],
  });
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(item);
  expect(result.items[1].raw).toBe(emptyItem);
  expect(payload.data).toBe(ignored);
  expect(payload).toStrictEqual(before);
});

test("entity and nested course IDs do not fall back to old aliases when formal IDs are unusable", () => {
  for (const scenario of [
    {
      idFields: Object.freeze({}),
      hasId: false,
      courseAdapt: toCourseSummary,
      classroomAdapt: toClassroomSummary,
      classroomRaw: false,
    },
    {
      idFields: Object.freeze({ id: null }),
      hasId: true,
      courseAdapt: toCourseCreateResponse,
      classroomAdapt: toClassroomCreateResponse,
      classroomRaw: true,
    },
    {
      idFields: Object.freeze({ id: Object.freeze(["invalid-id"]) }),
      hasId: true,
      courseAdapt: toCourseUpdateResponse,
      classroomAdapt: toClassroomUpdateResponse,
      classroomRaw: false,
    },
  ]) {
    const nestedCourse = Object.freeze({
      courseId: "legacy-nested-course",
      name: "保留的课程摘要",
      status: "archived",
      ...scenario.idFields,
    });
    const course = Object.freeze({
      courseId: "legacy-course-id",
      code: "CS-104",
      name: "保留课程",
      term: "2026秋",
      ...scenario.idFields,
    });
    const classroom = Object.freeze({
      classroomId: "legacy-classroom-id",
      courseId: "actual-related-course",
      name: "保留班级",
      joinCode: "JOIN-004",
      course: nestedCourse,
      ...scenario.idFields,
    });
    const beforeCourse = structuredClone(course);
    const beforeClassroom = structuredClone(classroom);
    const courseResult = scenario.courseAdapt(course);
    const classroomResult = scenario.classroomAdapt(classroom);

    expect(courseResult.id).toBeUndefined();
    expect(courseResult).toMatchObject({
      code: "CS-104",
      name: "保留课程",
      term: "2026秋",
    });
    expect(courseResult.raw).toBe(course);
    expect(classroomResult.id).toBeUndefined();
    expect(classroomResult).toMatchObject({
      courseId: "actual-related-course",
      name: "保留班级",
      joinCode: "JOIN-004",
      course: { name: "保留的课程摘要", status: "archived" },
    });
    expect(classroomResult.course?.id).toBeUndefined();
    expect(classroomResult.course).not.toHaveProperty("raw");
    expect(Object.hasOwn(classroomResult, "raw")).toBe(scenario.classroomRaw);
    if ("raw" in classroomResult) expect(classroomResult.raw).toBe(classroom);
    expect(Object.hasOwn(course, "id")).toBe(scenario.hasId);
    expect(Object.hasOwn(classroom, "id")).toBe(scenario.hasId);
    expect(Object.hasOwn(nestedCourse, "id")).toBe(scenario.hasId);
    expect(course).toStrictEqual(beforeCourse);
    expect(classroom).toStrictEqual(beforeClassroom);
  }
});

test("detail and update fields are not rescued from data when top-level fields are missing or invalid", () => {
  const course = Object.freeze({
    id: null,
    courseId: "legacy-course",
    code: false,
    term: null,
    status: " active ",
    data: Object.freeze({
      id: "data-course",
      code: "CS-DATA",
      name: "嵌套课程",
      term: "2026秋",
      status: "ACTIVE",
    }),
  });
  const classroom = Object.freeze({
    id: Object.freeze({ value: "invalid-classroom-id" }),
    classroomId: "legacy-classroom",
    courseId: "actual-related-course",
    name: null,
    joinCode: false,
    status: null,
    data: Object.freeze({
      id: "data-classroom",
      courseId: "data-course",
      name: "嵌套班级",
      joinCode: "DATA-JOIN",
      status: "ARCHIVED",
      course: Object.freeze({ id: "data-course", name: "嵌套课程" }),
    }),
  });
  const beforeCourse = structuredClone(course);
  const beforeClassroom = structuredClone(classroom);

  for (const adapt of [toCourseDetailResponse, toCourseUpdateResponse]) {
    const result = adapt(course);
    expect(result.id).toBeUndefined();
    expect(result.code).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.term).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.raw).toBe(course);
  }
  for (const adapt of [toClassroomDetailResponse, toClassroomUpdateResponse]) {
    const result = adapt(classroom);
    expect(result.id).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.joinCode).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.course).toBeUndefined();
    expect(result.courseId).toBe("actual-related-course");
    expect(result).not.toHaveProperty("raw");
  }
  expect(Object.hasOwn(course, "name")).toBe(false);
  expect(course).toStrictEqual(beforeCourse);
  expect(classroom).toStrictEqual(beforeClassroom);
});

test("classroom optional course summaries retain readable fields without requiring a course ID", () => {
  const onlyAlias = Object.freeze({ courseId: "legacy-nested-course" });
  const partial = Object.freeze({
    courseId: "legacy-nested-course",
    name: "局部课程摘要",
    term: "2026秋",
    status: "archived",
  });
  for (const scenario of [
    { fields: Object.freeze({}), expectedCourse: undefined },
    { fields: Object.freeze({ course: onlyAlias }), expectedCourse: undefined },
    {
      fields: Object.freeze({ course: partial }),
      expectedCourse: {
        id: undefined,
        code: undefined,
        name: "局部课程摘要",
        term: "2026秋",
        courseLabel: undefined,
        status: "archived",
      },
    },
  ]) {
    const payload = Object.freeze({
      id: "classroom-optional-course",
      courseId: "actual-related-course",
      name: "保留班级",
      ...scenario.fields,
    });
    const before = structuredClone(payload);
    const result = toClassroomSummary(payload);

    expect(result).toMatchObject({
      id: "classroom-optional-course",
      courseId: "actual-related-course",
      name: "保留班级",
    });
    expect(result.course).toEqual(scenario.expectedCourse);
    expect(result).not.toHaveProperty("raw");
    if (scenario.expectedCourse) expect(result.course).not.toHaveProperty("raw");
    expect(payload).toStrictEqual(before);
  }
});

test("course and classroom lists retire legacy wrappers without inferring pagination", () => {
  const row = Object.freeze({ id: "legacy-row", status: "ACTIVE" });
  const items = Object.freeze([row]);
  for (const payload of [
    items,
    Object.freeze({
      data: Object.freeze({ items, total: 19, page: 3, limit: 5 }),
    }),
    Object.freeze({ data: items }),
  ]) {
    const before = structuredClone(payload);
    for (const { adapt, hasRaw } of [
      { adapt: toCourseListResponse, hasRaw: true },
      { adapt: toClassroomListResponse, hasRaw: false },
    ]) {
      const result = adapt(payload);
      expect(result.items).toEqual([]);
      expect(result.total).toBeUndefined();
      expect(result.page).toBeUndefined();
      expect(result.limit).toBeUndefined();
      expect(Object.hasOwn(result, "raw")).toBe(hasRaw);
      if ("raw" in result) expect(result.raw).toBe(payload);
    }
    expect(payload).toStrictEqual(before);
  }
});

test("course and classroom list items and pagination use only their top-level sources", () => {
  const first = Object.freeze({
    id: "formal-first",
    courseId: "actual-related-course",
    status: "ACTIVE",
  });
  const second = Object.freeze({ id: "formal-second", status: "ARCHIVED" });
  const formalItems = Object.freeze([first, second]);
  const ignored = Object.freeze({
    items: Object.freeze([Object.freeze({ id: "ignored-row" })]),
    total: 707,
    page: 7,
    limit: 7,
  });
  for (const scenario of [
    {
      fields: Object.freeze({ items: formalItems, total: 41, page: 2, limit: 100 }),
      expectedIds: ["formal-first", "formal-second"],
      total: 41,
      page: 2,
      limit: 100,
    },
    {
      fields: Object.freeze({ items: Object.freeze([]), total: 0, page: 1, limit: 100 }),
      expectedIds: [],
      total: 0,
      page: 1,
      limit: 100,
    },
    {
      fields: Object.freeze({}),
      expectedIds: [],
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      fields: Object.freeze({ items: null, total: null, page: "2", limit: Number.NaN }),
      expectedIds: [],
      total: undefined,
      page: undefined,
      limit: undefined,
    },
  ]) {
    const payload = Object.freeze({
      ...scenario.fields,
      data: ignored,
      pagination: Object.freeze({ total: 903, page: 9, limit: 3 }),
    });
    const before = structuredClone(payload);
    for (const { adapt, hasRaw } of [
      { adapt: toCourseListResponse, hasRaw: true },
      { adapt: toClassroomListResponse, hasRaw: false },
    ]) {
      const result = adapt(payload);
      expect(result.items.map((item) => item.id)).toEqual(scenario.expectedIds);
      expect(result.total).toBe(scenario.total);
      expect(result.page).toBe(scenario.page);
      expect(result.limit).toBe(scenario.limit);
      expect(Object.hasOwn(result, "raw")).toBe(hasRaw);
      if ("raw" in result) expect(result.raw).toBe(payload);
      result.items.forEach((item, index) => {
        expect(Object.hasOwn(item, "raw")).toBe(hasRaw);
        if ("raw" in item) expect(item.raw).toBe(formalItems[index]);
      });
      if (!hasRaw && scenario.expectedIds.length > 0) {
        expect(result.items[0]).toMatchObject({ courseId: "actual-related-course" });
      }
    }
    expect(payload).toStrictEqual(before);
  }
});

test("course overview safely ignores a data-only response instead of rescuing its fields", () => {
  const payload = Object.freeze({
    data: Object.freeze({
      course: Object.freeze({ id: "ignored-course", status: "ACTIVE" }),
      window: "all",
      generatedAt: "2026-11-01T09:00:00.000Z",
      total: 9,
      page: 1,
      limit: 20,
      items: Object.freeze([Object.freeze({ classroomId: "ignored-classroom" })]),
    }),
  });
  const before = structuredClone(payload);
  const result = toCourseOverviewResponse(payload);

  expect(result).toEqual({
    course: undefined,
    window: undefined,
    generatedAt: undefined,
    total: undefined,
    page: undefined,
    limit: undefined,
    items: [],
    raw: payload,
  });
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

test("classroom members preserve exact formal states, user fields and pagination", () => {
  const active = Object.freeze({
    id: "student-active",
    email: "active@example.invalid",
    roles: Object.freeze(["student"]),
    status: "ACTIVE",
    name: "在班成员",
    studentNo: "S-001",
    employeeNo: "E-001",
    joinedAt: "2026-11-01T08:00:00.000Z",
  });
  const removed = Object.freeze({
    id: "student-removed",
    email: "removed@example.invalid",
    roles: Object.freeze(["student"]),
    status: "REMOVED",
    name: "已移除成员",
    studentNo: "S-002",
    employeeNo: "E-002",
    joinedAt: "2026-11-02T08:00:00.000Z",
  });
  const payload = Object.freeze({
    items: Object.freeze([active, removed]),
    total: 123,
    page: 2,
    limit: 100,
  });
  const before = structuredClone(payload);
  const result = toClassroomStudentsResponse(payload);

  expect(result).toMatchObject({
    items: [
      {
        userId: "student-active",
        email: "active@example.invalid",
        status: "ACTIVE",
        name: "在班成员",
        studentNo: "S-001",
        enrolledAt: "2026-11-01T08:00:00.000Z",
      },
      {
        userId: "student-removed",
        email: "removed@example.invalid",
        status: "REMOVED",
        name: "已移除成员",
        studentNo: "S-002",
        enrolledAt: "2026-11-02T08:00:00.000Z",
      },
    ],
    total: 123,
    page: 2,
    limit: 100,
  });
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(active);
  expect(result.items[1].raw).toBe(removed);
  expect(payload).toEqual(before);
});

test("classroom members leave absent status unknown despite valid legacy aliases", () => {
  for (const enrollmentStatus of ["ACTIVE", "REMOVED"] as const) {
    const member = Object.freeze({
      id: "missing-status",
      name: "保留成员资料",
      enrollmentStatus,
    });
    const payload = Object.freeze({
      items: Object.freeze([member]),
      total: 17,
    });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      userId: "missing-status",
      name: "保留成员资料",
    });
    expect(result.items[0].status).toBeUndefined();
    expect(result.total).toBe(17);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(member);
    expect(result.items[0].raw.enrollmentStatus).toBe(enrollmentStatus);
    expect(Object.hasOwn(member, "status")).toBe(false);
    expect(payload).toEqual(before);
  }
});

test("classroom members reject invalid status without normalization, defaults or alias rescue", () => {
  for (const status of [
    undefined,
    null,
    "",
    " \t\n ",
    "UNKNOWN",
    "active",
    "removed",
    "Active",
    "Removed",
    " ACTIVE",
    "ACTIVE ",
    "REMOVED ",
    "\tREMOVED\n",
    Object.freeze([]),
    Object.freeze(["ACTIVE"]),
    Object.freeze({}),
    Object.freeze({ status: "ACTIVE" }),
    0,
    1,
    true,
    false,
  ]) {
    const member = Object.freeze({
      id: "invalid-status",
      name: "保留异常状态成员",
      status,
      enrollmentStatus: "ACTIVE",
    });
    const payload = Object.freeze({
      items: Object.freeze([member]),
      total: 19,
    });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe("invalid-status");
    expect(result.items[0].name).toBe("保留异常状态成员");
    expect(result.items[0].status).toBeUndefined();
    expect(result.total).toBe(19);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(member);
    expect(Object.hasOwn(member, "status")).toBe(true);
    expect(member.status).toBe(status);
    expect(result.items[0].raw.enrollmentStatus).toBe("ACTIVE");
    expect(payload).toEqual(before);
  }
});

test("classroom members use formal status when the legacy alias conflicts", () => {
  for (const [status, enrollmentStatus] of [
    ["ACTIVE", "REMOVED"],
    ["REMOVED", "ACTIVE"],
  ] as const) {
    const member = Object.freeze({
      id: "conflicting-status",
      status,
      enrollmentStatus,
    });
    const payload = Object.freeze({ items: Object.freeze([member]) });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items[0].status).toBe(status);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(member);
    expect(result.items[0].raw.enrollmentStatus).toBe(enrollmentStatus);
    expect(payload).toEqual(before);
  }
});

test("classroom members use only formal fields when every legacy source conflicts", () => {
  const member = Object.freeze({
    id: " formal-member ",
    userId: "legacy-user-id",
    studentId: "legacy-student-id",
    name: " 正式姓名 ",
    studentName: "旧姓名",
    email: " formal@example.invalid ",
    studentNo: " S-101 ",
    joinedAt: " 2026-11-01T08:00:00.000Z ",
    enrolledAt: "2020-01-01T00:00:00.000Z",
    createdAt: "2019-01-01T00:00:00.000Z",
    user: Object.freeze({
      id: "legacy-nested-id",
      name: "嵌套旧姓名",
      email: "legacy@example.invalid",
    }),
    profile: Object.freeze({ studentNo: "S-LEGACY-PROFILE" }),
    student: Object.freeze({ number: "S-LEGACY-STUDENT" }),
    status: "ACTIVE",
    roles: Object.freeze(["student"]),
    employeeNo: "E-101",
  });
  const payload = Object.freeze({ items: Object.freeze([member]) });
  const before = structuredClone(payload);
  const result = toClassroomStudentsResponse(payload);

  expect(result.items).toEqual([
    {
      userId: "formal-member",
      name: "正式姓名",
      email: "formal@example.invalid",
      studentNo: "S-101",
      enrolledAt: "2026-11-01T08:00:00.000Z",
      status: "ACTIVE",
      raw: member,
    },
  ]);
  expect(result.items[0]).not.toHaveProperty("roles");
  expect(result.items[0]).not.toHaveProperty("employeeNo");
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(member);
  expect(result.items[0].raw.user).toBe(member.user);
  expect(result.items[0].raw.userId).toBe("legacy-user-id");
  expect(result.items[0].raw.enrolledAt).toBe("2020-01-01T00:00:00.000Z");
  expect(payload).toStrictEqual(before);
});

test("classroom members retain ACTIVE rows without filling invalid formal fields from aliases", () => {
  const aliases = Object.freeze({
    userId: "legacy-user-id",
    studentId: "legacy-student-id",
    studentName: "旧姓名",
    user: Object.freeze({
      id: "legacy-nested-id",
      name: "嵌套旧姓名",
      email: "legacy@example.invalid",
    }),
    profile: Object.freeze({ studentNo: "S-LEGACY-PROFILE" }),
    student: Object.freeze({ number: "S-LEGACY-STUDENT" }),
    enrolledAt: "2020-01-01T00:00:00.000Z",
    createdAt: "2019-01-01T00:00:00.000Z",
  });
  const missing = Object.freeze({ ...aliases, status: "ACTIVE" });
  for (const field of ["id", "name", "email", "studentNo", "joinedAt"]) {
    expect(Object.hasOwn(missing, field)).toBe(false);
  }
  for (const member of [
    missing,
    Object.freeze({
      ...aliases,
      id: null,
      name: null,
      email: null,
      studentNo: null,
      joinedAt: null,
      status: "ACTIVE",
    }),
    Object.freeze({
      ...aliases,
      id: Object.freeze({ id: "invalid-id" }),
      name: false,
      email: 101,
      studentNo: Object.freeze(["S-INVALID"]),
      joinedAt: " \t ",
      status: "ACTIVE",
    }),
  ]) {
    const payload = Object.freeze({ items: Object.freeze([member]) });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items).toEqual([
      {
        userId: undefined,
        name: undefined,
        email: undefined,
        studentNo: undefined,
        enrolledAt: undefined,
        status: "ACTIVE",
        raw: member,
      },
    ]);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(member);
    expect(result.items[0].raw.userId).toBe("legacy-user-id");
    expect(result.items[0].raw.enrolledAt).toBe("2020-01-01T00:00:00.000Z");
    expect(payload).toStrictEqual(before);
  }
});

test("classroom member legacy wrappers no longer project members or infer pagination", () => {
  const member = Object.freeze({ id: "legacy-wrapped", status: "ACTIVE" });
  const items = Object.freeze([member]);
  for (const payload of [
    items,
    Object.freeze({
      data: Object.freeze({ items, total: 23, page: 3, limit: 10 }),
    }),
    Object.freeze({ data: items }),
  ]) {
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items).toEqual([]);
    expect(result.total).toBeUndefined();
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("classroom member top-level items and pagination override conflicting legacy structures", () => {
  const member = Object.freeze({ id: "formal-top-level", status: "REMOVED" });
  const legacy = Object.freeze({ id: "legacy-nested", status: "ACTIVE" });
  for (const { items, expectedUserIds } of [
    { items: Object.freeze([member]), expectedUserIds: ["formal-top-level"] },
    { items: Object.freeze([]), expectedUserIds: [] },
  ]) {
    const payload = Object.freeze({
      items,
      total: 41,
      page: 2,
      limit: 100,
      data: Object.freeze({
        items: Object.freeze([legacy]),
        total: 903,
        page: 9,
        limit: 3,
      }),
      pagination: Object.freeze({ total: 707, page: 7, limit: 7 }),
    });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items.map((item) => item.userId)).toEqual(expectedUserIds);
    expect(result.total).toBe(41);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(100);
    if (items.length > 0) {
      expect(result.items[0].status).toBe("REMOVED");
      expect(result.items[0].raw).toBe(member);
    }
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("classroom member missing or invalid top-level pagination never uses legacy values", () => {
  const member = Object.freeze({ id: "formal-no-pagination", status: "ACTIVE" });
  for (const fields of [
    Object.freeze({}),
    Object.freeze({ total: null, page: "2", limit: Number.NaN }),
  ]) {
    const payload = Object.freeze({
      items: Object.freeze([member]),
      ...fields,
      data: Object.freeze({ total: 903, page: 9, limit: 3 }),
      pagination: Object.freeze({ total: 707, page: 7, limit: 7 }),
    });
    const before = structuredClone(payload);
    const result = toClassroomStudentsResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe("formal-no-pagination");
    expect(result.total).toBeUndefined();
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(member);
    expect(payload).toStrictEqual(before);
  }
});

test("learning trajectory keeps structured student details and statistics without projecting old name aliases", () => {
  const student = Object.freeze({
    id: "student-1",
    name: "正式姓名",
    studentNo: "S-001",
    email: "student-1@example.com",
  });
  const item = Object.freeze({
    studentId: "student-1",
    student,
    studentName: "旧别名姓名",
    name: "旧顶层姓名",
    attemptsCount: 3,
    latestAttemptAt: "2026-11-10T08:00:00.000Z",
    latestAiFeedbackStatus: "SUCCEEDED",
    trend: {
      errorCountFirst: 4,
      errorCountLatest: 1,
      errorDelta: -3,
      topTagsFirst: [{ tag: "logic", count: 4 }],
      topTagsLatest: [{ tag: "logic", count: 1 }],
    },
    attempts: [
      {
        submissionId: "submission-3",
        attemptNo: 3,
        createdAt: "2026-11-10T08:00:00.000Z",
        isLate: false,
        aiFeedbackStatus: "SUCCEEDED",
        feedbackCount: 2,
        feedbackSummary: {
          totalItems: 1,
          severityBreakdown: { INFO: 0, WARN: 0, ERROR: 1 },
          topTags: [{ tag: "logic", count: 1 }],
        },
      },
    ],
  });
  const payload = Object.freeze({
    classroomId: "classroom-1",
    classroomTaskId: "classroom-task-1",
    window: "7d",
    page: 2,
    limit: 5,
    total: 6,
    items: Object.freeze([item]),
  });
  const before = structuredClone(payload);
  const result = toLearningTrajectoryResponse(payload);
  expect(result).toMatchObject({
    classroomId: "classroom-1",
    classroomTaskId: "classroom-task-1",
    window: "7d",
    page: 2,
    limit: 5,
    total: 6,
    items: [
      {
        studentId: "student-1",
        student: {
          id: "student-1",
          name: "正式姓名",
          studentNo: "S-001",
          email: "student-1@example.com",
        },
        attemptsCount: 3,
        latestAttemptAt: "2026-11-10T08:00:00.000Z",
        latestAiFeedbackStatus: "SUCCEEDED",
        trend: {
          errorCountFirst: 4,
          errorCountLatest: 1,
          errorDelta: -3,
          topTagsFirst: [{ tag: "logic", count: 4 }],
          topTagsLatest: [{ tag: "logic", count: 1 }],
        },
        attempts: [
          {
            submissionId: "submission-3",
            attemptNo: 3,
            createdAt: "2026-11-10T08:00:00.000Z",
            isLate: false,
            aiFeedbackStatus: "SUCCEEDED",
            feedbackCount: 2,
            feedbackSummary: {
              totalItems: 1,
              severityBreakdown: { INFO: 0, WARN: 0, ERROR: 1 },
              topTags: [{ tag: "logic", count: 1 }],
            },
          },
        ],
      },
    ],
  });
  expect(result.items[0]).not.toHaveProperty("studentName");
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(item);
  expect(result.items[0].student?.raw).toBe(student);
  expect(result.items[0].raw.studentName).toBe("旧别名姓名");
  expect(result.items[0].raw.name).toBe("旧顶层姓名");
  expect(payload).toEqual(before);
});

for (const nameState of ["null", "missing"] as const) {
  test(`learning trajectory preserves a ${nameState} structured name despite populated old aliases`, () => {
    const student = Object.freeze(
      nameState === "null"
        ? { id: "student-2", name: null, studentNo: "S-002", email: null }
        : { id: "student-2", studentNo: "S-002", email: null },
    );
    const item = Object.freeze({
      studentId: "student-2",
      student,
      studentName: "旧别名姓名",
      name: "旧顶层姓名",
      attemptsCount: 0,
    });
    const payload = Object.freeze({ items: Object.freeze([item]) });
    const before = structuredClone(payload);
    const result = toLearningTrajectoryResponse(payload);
    expect(result.items[0].student?.name).toBe(
      nameState === "null" ? null : undefined,
    );
    expect(result.items[0].student).toMatchObject({
      id: "student-2",
      studentNo: "S-002",
      email: null,
    });
    expect(result.items[0].attemptsCount).toBe(0);
    expect(result.items[0]).not.toHaveProperty("studentName");
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(item);
    expect(result.items[0].student?.raw).toBe(student);
    expect(Object.hasOwn(student, "name")).toBe(nameState === "null");
    expect(payload).toEqual(before);
  });
}

test("learning trajectory keeps the studentId-only fallback without synthesizing a name from old aliases", () => {
  const item = Object.freeze({
    studentId: "student-3",
    studentName: "旧别名姓名",
    name: "旧顶层姓名",
  });
  const payload = Object.freeze({ items: Object.freeze([item]) });
  const before = structuredClone(payload);
  const result = toLearningTrajectoryResponse(payload);
  expect(result.items[0].studentId).toBe("student-3");
  expect(result.items[0].student).toEqual({ id: "student-3", raw: {} });
  expect(result.items[0].student).not.toHaveProperty("name");
  expect(result.items[0]).not.toHaveProperty("studentName");
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(item);
  expect(Object.hasOwn(item, "student")).toBe(false);
  expect(payload).toEqual(before);
});

test("classroom status adapters preserve only the three exact persisted states", () => {
  for (const status of ["ACTIVE", "CLOSED", "RECALLED"] as const) {
    const task = Object.freeze({ title: "发布标题", status: "ARCHIVED" });
    const payload = Object.freeze({
      id: "classroom-task",
      status,
      taskSnapshotAvailable: true,
      task,
    });
    const before = { ...payload };
    const detail = toClassroomTask(payload);
    const summary = toClassroomTaskSummary(payload);
    expect(normalizeClassroomTaskStatus(status)).toBe(status);
    expect(detail.status).toBe(status);
    expect(summary.status).toBe(status);
    expect(detail.taskStatus).toBe("ARCHIVED");
    expect(summary.taskStatus).toBe("ARCHIVED");
    expect(detail.raw).toBe(payload);
    expect(detail.raw.task).toBe(task);
    expect(payload).toEqual(before);
  }
});

test("classroom status adapters leave a genuinely absent property unknown", () => {
  const task = Object.freeze({ title: "发布标题", status: "PUBLISHED" });
  const payload = Object.freeze({ id: "missing-status", task });
  expect(Object.hasOwn(payload, "status")).toBe(false);
  expect(normalizeClassroomTaskStatus(undefined)).toBeUndefined();
  const detail = toClassroomTask(payload);
  const summary = toClassroomTaskSummary(payload);
  expect(detail.status).toBeUndefined();
  expect(summary.status).toBeUndefined();
  expect(detail.raw).toBe(payload);
  expect(detail.raw.task).toBe(task);
  expect(Object.hasOwn(payload, "status")).toBe(false);
  expect(payload).toEqual({ id: "missing-status", task });
});

test("classroom status adapters reject present invalid values without coercion or input changes", () => {
  for (const status of [
    undefined,
    null,
    "",
    " \t\n ",
    "UNKNOWN",
    "active",
    "closed",
    "recalled",
    "Active",
    " ACTIVE",
    "CLOSED ",
    "\tRECALLED\n",
    Object.freeze([]),
    Object.freeze(["ACTIVE"]),
    Object.freeze({}),
    Object.freeze({ status: "ACTIVE" }),
    0,
    1,
    true,
    false,
  ]) {
    const payload = Object.freeze({ id: "invalid-status", status });
    expect(Object.hasOwn(payload, "status")).toBe(true);
    expect(normalizeClassroomTaskStatus(status)).toBeUndefined();
    const detail = toClassroomTask(payload);
    const summary = toClassroomTaskSummary(payload);
    expect(detail.status).toBeUndefined();
    expect(summary.status).toBeUndefined();
    expect(detail.raw).toBe(payload);
    expect(Object.hasOwn(payload, "status")).toBe(true);
    expect(payload.status).toBe(status);
    expect(payload).toEqual({ id: "invalid-status", status });
  }
});

test("classroom task entries use formal identity, content and settings without legacy overrides", () => {
  for (const allowLate of [true, false]) {
    const rubric = Object.freeze({});
    const task = Object.freeze({
      id: "ignored-nested-template-id",
      taskId: "ignored-nested-task-id",
      title: "正式发布标题",
      description: "正式发布说明",
      knowledgeModule: "formal-module",
      status: "ARCHIVED",
      difficulty: "  综合\n设计  ",
      rubric,
      publishedAt: "2020-01-01T00:00:00.000Z",
    });
    const settings = Object.freeze({ allowLate, feedbackEnabled: true });
    const payload = Object.freeze({
      id: "formal-instance",
      classroomTaskId: "legacy-instance-id",
      classroomId: "actual-classroom",
      taskId: "actual-template",
      taskSnapshotAvailable: true,
      status: "ACTIVE",
      title: "旧根标题",
      name: "旧根名称",
      description: "旧根说明",
      knowledgeModule: "legacy-module",
      taskStatus: "ROOT_STATUS",
      learningTaskStatus: "ROOT_LEARNING_STATUS",
      allowLate: !allowLate,
      difficulty: "ignored-root-difficulty",
      publishedAt: "2026-11-12T08:00:00.000Z",
      dueAt: "2026-11-30T08:00:00.000Z",
      task,
      settings,
      taskPublisher: Object.freeze({ id: "publisher-1", name: "正式发布者" }),
      createdBy: "ignored-publisher",
      aiStatus: "legacy-ai-status",
      aiFeedbackStatus: "legacy-feedback-status",
      data: Object.freeze({ id: "ignored-data-instance" }),
    });
    const before = structuredClone(payload);
    const expectedCommon = {
      taskSnapshotAvailable: true,
      taskId: "actual-template",
      status: "ACTIVE",
      title: "正式发布标题",
      description: "正式发布说明",
      taskStatus: "ARCHIVED",
      dueAt: "2026-11-30T08:00:00.000Z",
      allowLate,
      publishedAt: "2026-11-12T08:00:00.000Z",
      taskPublisher: { id: "publisher-1", name: "正式发布者" },
    };
    const expectedSummary = {
      ...expectedCommon,
      classroomTaskId: "formal-instance",
      knowledgeModule: "formal-module",
    };
    const summary = toClassroomTaskSummary(payload);
    expect(summary).toMatchObject(expectedSummary);
    expect(summary.rubric).toBe(rubric);
    expect(summary).not.toHaveProperty("raw");
    expect(summary).not.toHaveProperty("difficulty");
    expect(summary).not.toHaveProperty("aiStatus");

    for (const adapt of [toClassroomTask, toSubmitTaskResponse]) {
      const detail = adapt(payload);
      expect(detail).toMatchObject({
        ...expectedCommon,
        id: "formal-instance",
        classroomId: "actual-classroom",
        difficulty: "  综合\n设计  ",
      });
      expect(detail.rubric).toBe(rubric);
      expect(detail).not.toHaveProperty("feedbackEnabled");
      expect(detail.raw).toBe(payload);
      expect(detail.raw.task).toBe(task);
      expect(detail.raw.settings).toBe(settings);
      expect(detail.raw).toHaveProperty("settings.feedbackEnabled", true);
      expect(detail.raw).toHaveProperty("aiStatus", "legacy-ai-status");
    }

    const listPayload = Object.freeze({
      items: Object.freeze([payload]),
      total: 1,
      page: 1,
      limit: 100,
    });
    const beforeList = structuredClone(listPayload);
    const list = toClassroomTasksResponse(listPayload);
    expect(list).toMatchObject({
      items: [expectedSummary],
      total: 1,
      page: 1,
      limit: 100,
    });
    expect(list.items[0].rubric).toBe(rubric);
    expect(list).not.toHaveProperty("raw");
    expect(list.items[0]).not.toHaveProperty("raw");
    expect(list.items[0]).not.toHaveProperty("aiStatus");
    expect(listPayload).toStrictEqual(beforeList);
    expect(payload).toStrictEqual(before);
  }
});

test("classroom task entries do not rescue missing or invalid formal identity, content and settings", () => {
  const nestedAliases = Object.freeze({
    id: "ignored-nested-template-id",
    taskId: "ignored-nested-task-id",
    publishedAt: "2020-01-01T00:00:00.000Z",
  });
  for (const scenario of [
    {
      fields: Object.freeze({}),
      task: nestedAliases,
      settings: Object.freeze({ feedbackEnabled: true }),
      hasId: false,
    },
    {
      fields: Object.freeze({ id: null, taskId: null, publishedAt: null }),
      task: Object.freeze({
        ...nestedAliases,
        title: 12,
        description: null,
        status: false,
        knowledgeModule: Object.freeze([]),
      }),
      settings: Object.freeze({ allowLate: "false", feedbackEnabled: true }),
      hasId: true,
    },
    {
      fields: Object.freeze({
        id: Object.freeze([]),
        taskId: Object.freeze({ id: "invalid-task-id" }),
        publishedAt: 42,
      }),
      task: Object.freeze({
        ...nestedAliases,
        title: " \t ",
        description: false,
        status: Object.freeze({}),
        knowledgeModule: null,
        rubric: Object.freeze([]),
      }),
      settings: Object.freeze({ allowLate: null, feedbackEnabled: true }),
      hasId: true,
    },
  ]) {
    const payload = Object.freeze({
      ...scenario.fields,
      classroomTaskId: "legacy-instance-id",
      classroomId: "actual-classroom",
      taskSnapshotAvailable: "true",
      status: "ACTIVE",
      task: scenario.task,
      settings: scenario.settings,
      title: "旧根标题",
      name: "旧根名称",
      description: "旧根说明",
      knowledgeModule: "legacy-module",
      taskStatus: "ROOT_STATUS",
      learningTaskStatus: "ROOT_LEARNING_STATUS",
      allowLate: true,
      createdBy: "ignored-publisher",
      aiStatus: "legacy-ai-status",
      aiFeedbackStatus: "legacy-feedback-status",
      taskSnapshot: Object.freeze({ title: "忽略的快照内容" }),
    });
    const before = structuredClone(payload);
    const summary = toClassroomTaskSummary(payload);
    expect(summary.classroomTaskId).toBeUndefined();
    expect(summary.taskId).toBeUndefined();
    expect(summary.title).toBeUndefined();
    expect(summary.description).toBeUndefined();
    expect(summary.taskStatus).toBeUndefined();
    expect(summary.knowledgeModule).toBeUndefined();
    expect(summary.publishedAt).toBeUndefined();
    expect(summary.allowLate).toBeUndefined();
    expect(summary.taskSnapshotAvailable).toBeUndefined();
    expect(summary.rubric).toBeUndefined();
    expect(summary.taskPublisher).toBeNull();
    expect(summary.status).toBe("ACTIVE");
    expect(summary).not.toHaveProperty("aiStatus");
    expect(summary).not.toHaveProperty("raw");

    for (const adapt of [toClassroomTask, toSubmitTaskResponse]) {
      const detail = adapt(payload);
      expect(detail.id).toBeUndefined();
      expect(detail.taskId).toBeUndefined();
      expect(detail.classroomId).toBe("actual-classroom");
      expect(detail.title).toBeUndefined();
      expect(detail.description).toBeUndefined();
      expect(detail.taskStatus).toBeUndefined();
      expect(detail.publishedAt).toBeUndefined();
      expect(detail.allowLate).toBeUndefined();
      expect(detail.taskSnapshotAvailable).toBeUndefined();
      expect(detail.rubric).toBeUndefined();
      expect(detail.taskPublisher).toBeNull();
      expect(detail.status).toBe("ACTIVE");
      expect(detail).not.toHaveProperty("feedbackEnabled");
      expect(detail.raw).toBe(payload);
      expect(detail.raw.task).toBe(scenario.task);
      expect(detail.raw.settings).toBe(scenario.settings);
    }
    expect(Object.hasOwn(payload, "id")).toBe(scenario.hasId);
    expect(Object.hasOwn(payload, "taskId")).toBe(scenario.hasId);
    expect(payload).toStrictEqual(before);
  }
});

test("classroom task lists retain root row order, missing-ID rows and optional pagination", () => {
  const first = Object.freeze({
    id: "instance-first",
    taskId: "template-first",
    status: "CLOSED",
    task: Object.freeze({ title: "第一项" }),
  });
  const unidentified = Object.freeze({
    classroomTaskId: "legacy-instance-id",
    taskId: "template-without-instance-id",
    status: "ACTIVE",
    task: Object.freeze({ title: "保留缺少正式 ID 的行" }),
  });
  const last = Object.freeze({
    id: "instance-last",
    taskId: "template-last",
    status: "RECALLED",
    task: Object.freeze({ title: "最后一项" }),
  });
  const items = Object.freeze([first, unidentified, last]);
  const payload = Object.freeze({
    items,
    total: 3,
    page: 1,
    limit: 100,
    data: Object.freeze({
      items: Object.freeze([Object.freeze({ id: "ignored-instance" })]),
      total: 999,
      page: 9,
      limit: 9,
    }),
  });
  const unpagedPayload = Object.freeze({ items: Object.freeze([first]) });
  const before = structuredClone(payload);
  const beforeUnpaged = structuredClone(unpagedPayload);
  const result = toClassroomTasksResponse(payload);

  expect(result.items.map((item) => item.classroomTaskId)).toEqual([
    "instance-first",
    undefined,
    "instance-last",
  ]);
  expect(result.items.map((item) => item.taskId)).toEqual([
    "template-first",
    "template-without-instance-id",
    "template-last",
  ]);
  expect(result.items.map((item) => item.title)).toEqual([
    "第一项",
    "保留缺少正式 ID 的行",
    "最后一项",
  ]);
  expect(result.items.map((item) => item.status)).toEqual([
    "CLOSED",
    "ACTIVE",
    "RECALLED",
  ]);
  expect(result).toMatchObject({ total: 3, page: 1, limit: 100 });
  expect(result).not.toHaveProperty("raw");
  result.items.forEach((item) => {
    expect(item).not.toHaveProperty("raw");
    expect(item).not.toHaveProperty("aiStatus");
  });
  const unpaged = toClassroomTasksResponse(unpagedPayload);
  expect(unpaged.items).toHaveLength(1);
  expect(unpaged.items[0].classroomTaskId).toBe("instance-first");
  expect(unpaged.total).toBeUndefined();
  expect(unpaged.page).toBeUndefined();
  expect(unpaged.limit).toBeUndefined();
  expect(unpaged).not.toHaveProperty("raw");
  expect(payload).toStrictEqual(before);
  expect(unpagedPayload).toStrictEqual(beforeUnpaged);
});

test("classroom task lists reject old wrappers and never rescue empty or invalid root items and pagination", () => {
  const oldItems = Object.freeze([Object.freeze({ id: "ignored-instance" })]);
  const oldData = Object.freeze({
    items: oldItems,
    total: 999,
    page: 9,
    limit: 9,
  });
  for (const scenario of [
    { payload: oldItems, total: undefined, page: undefined, limit: undefined },
    {
      payload: Object.freeze({ data: oldData }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({ data: oldItems }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({
        data: Object.freeze({ data: oldItems, total: 999, page: 9, limit: 9 }),
      }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({
        items: Object.freeze([]),
        total: 0,
        page: 0,
        limit: 0,
        data: oldData,
      }),
      total: 0,
      page: 0,
      limit: 0,
    },
    {
      payload: Object.freeze({
        items: null,
        total: Number.NaN,
        page: "2",
        limit: null,
        data: oldData,
      }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({
        items: Object.freeze({ invalid: true }),
        data: oldData,
      }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
  ]) {
    const before = structuredClone(scenario.payload);
    const result = toClassroomTasksResponse(scenario.payload);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(scenario.total);
    expect(result.page).toBe(scenario.page);
    expect(result.limit).toBe(scenario.limit);
    expect(result).not.toHaveProperty("raw");
    expect(scenario.payload).toStrictEqual(before);
  }
});

test("template visibility preserves only exact PRIVATE and SHARED without changing the input", () => {
  for (const visibility of ["PRIVATE", "SHARED"] as const) {
    const payload = Object.freeze({
      id: "template-visibility",
      title: "模板标题",
      status: "PUBLISHED",
      visibility,
    });
    const before = { ...payload };
    const option = toLearningTaskOption(payload);
    expect(normalizeTaskTemplateVisibility(visibility)).toBe(visibility);
    expect(option.visibility).toBe(visibility);
    expect(option.title).toBe("模板标题");
    expect(option.status).toBe("PUBLISHED");
    expect(option.raw).toBe(payload);
    expect(payload).toEqual(before);
  }
});

test("template visibility keeps a genuinely absent property unknown without adding a default", () => {
  const payload = Object.freeze({ id: "missing-visibility" });
  expect(Object.hasOwn(payload, "visibility")).toBe(false);
  expect(normalizeTaskTemplateVisibility(undefined)).toBeUndefined();
  const option = toLearningTaskOption(payload);
  expect(option.visibility).toBeUndefined();
  expect(option.raw).toBe(payload);
  expect(Object.hasOwn(payload, "visibility")).toBe(false);
  expect(payload).toEqual({ id: "missing-visibility" });
});

test("template visibility rejects present invalid values without coercion or input changes", () => {
  for (const visibility of [
    undefined,
    null,
    "",
    " \t\n ",
    "UNKNOWN",
    "private",
    "shared",
    "Private",
    "Shared",
    " PRIVATE",
    "SHARED ",
    "\tSHARED\n",
    Object.freeze([]),
    Object.freeze(["SHARED"]),
    Object.freeze(["PRIVATE"]),
    Object.freeze({}),
    Object.freeze({ visibility: "SHARED" }),
    0,
    1,
    true,
    false,
  ]) {
    const payload = Object.freeze({ id: "invalid-visibility", visibility });
    expect(Object.hasOwn(payload, "visibility")).toBe(true);
    expect(normalizeTaskTemplateVisibility(visibility)).toBeUndefined();
    const option = toLearningTaskOption(payload);
    expect(option.visibility).toBeUndefined();
    expect(option.raw).toBe(payload);
    expect(Object.hasOwn(payload, "visibility")).toBe(true);
    expect(payload.visibility).toBe(visibility);
    expect(payload).toEqual({ id: "invalid-visibility", visibility });
  }
});

test("template detail, write and list responses preserve strict visibility and raw references", () => {
  const privateTask = Object.freeze({ id: "private", visibility: "PRIVATE" });
  const sharedTask = Object.freeze({ id: "shared", visibility: "SHARED" });
  const invalidTask = Object.freeze({ id: "invalid", visibility: " shared " });
  const missingTask = Object.freeze({ id: "missing" });
  for (const [payload, expected] of [
    [privateTask, "PRIVATE"],
    [sharedTask, "SHARED"],
    [invalidTask, undefined],
    [missingTask, undefined],
  ] as const) {
    const before = structuredClone(payload);
    for (const adapt of [
      toLearningTaskDetailResponse,
      toLearningTaskCreateResponse,
      toLearningTaskUpdateResponse,
    ]) {
      const result = adapt(payload);
      expect(result.visibility).toBe(expected);
      expect(result.raw).toBe(payload);
    }
    expect(payload).toStrictEqual(before);
  }
  const items = Object.freeze([
    privateTask,
    sharedTask,
    invalidTask,
    missingTask,
  ]);
  const envelope = Object.freeze({ items, total: 4, page: 1, limit: 4 });
  const beforeList = structuredClone(envelope);
  for (const adapt of [
    toLearningTaskListResponse,
    toPublishableTaskTemplateListResponse,
  ]) {
    const result = adapt(envelope);
    expect(result.items.map((item) => item.visibility)).toEqual([
      "PRIVATE",
      "SHARED",
      undefined,
      undefined,
    ]);
    expect(result.items.map((item) => item.id)).toEqual([
      "private",
      "shared",
      "invalid",
      "missing",
    ]);
    expect(result.total).toBe(4);
    expect(result.raw).toBe(envelope);
    result.items.forEach((item, index) => expect(item.raw).toBe(items[index]));
  }
  expect(envelope.items).toBe(items);
  expect(invalidTask.visibility).toBe(" shared ");
  expect(Object.hasOwn(missingTask, "visibility")).toBe(false);
  expect(envelope).toStrictEqual(beforeList);
});

test("template root responses preserve formal identity, author and optional fields despite legacy conflicts", () => {
  const rubric = Object.freeze({ notes: "保留正式评阅说明" });
  const payload = Object.freeze({
    id: "formal-template",
    taskId: "legacy-template-id",
    createdBy: "teacher-formal",
    createdById: "ignored-top-level-author",
    title: "正式模板",
    description: "正式模板说明",
    knowledgeModule: "programming",
    courseLabel: "程序设计基础",
    status: "DRAFT",
    visibility: "PRIVATE",
    difficulty: "  综合\n设计  ",
    rubric,
    aiContextRefs: Object.freeze([]),
    publisher: Object.freeze({ id: "teacher-publisher", name: "正式发布者" }),
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-12T08:00:00.000Z",
    raw: Object.freeze({ id: "ignored-raw-id", createdBy: "teacher-raw" }),
    data: Object.freeze({
      id: "ignored-data-id",
      createdBy: Object.freeze({ id: "teacher-data" }),
      title: "旧包装标题",
      visibility: "SHARED",
    }),
  });
  const before = structuredClone(payload);
  for (const adapt of [
    toLearningTaskOption,
    toLearningTaskDetailResponse,
    toLearningTaskCreateResponse,
    toLearningTaskUpdateResponse,
  ]) {
    const result = adapt(payload);
    expect(result).toMatchObject({
      id: "formal-template",
      createdById: "teacher-formal",
      title: "正式模板",
      description: "正式模板说明",
      knowledgeModule: "programming",
      courseLabel: "程序设计基础",
      status: "DRAFT",
      visibility: "PRIVATE",
      difficulty: "  综合\n设计  ",
      rubric: { notes: "保留正式评阅说明" },
      publisher: { id: "teacher-publisher", name: "正式发布者" },
      createdAt: "2026-11-01T08:00:00.000Z",
      updatedAt: "2026-11-12T08:00:00.000Z",
    });
    expect(result.aiContextRefs).toEqual([]);
    expect(result.rubric).toBe(rubric);
    expect(result.raw).toBe(payload);
    expect(isTaskTemplateAuthor("teacher-formal", result.createdById)).toBe(true);
    expect(
      canEditTaskTemplate("teacher-formal", result.createdById, result.status),
    ).toBe(true);
    expect(isTaskTemplateAuthor("teacher-publisher", result.createdById)).toBe(
      false,
    );
  }
  expect(payload).toStrictEqual(before);
});

test("template IDs and author eligibility are never restored from aliases or author objects", () => {
  for (const scenario of [
    {
      fields: Object.freeze({ createdBy: Object.freeze({ id: "teacher-self" }) }),
      expectedId: undefined,
    },
    {
      fields: Object.freeze({
        id: null,
        createdBy: Object.freeze({ _id: "teacher-self" }),
      }),
      expectedId: undefined,
    },
    {
      fields: Object.freeze({
        id: Object.freeze(["invalid-template-id"]),
        createdBy: Object.freeze({ userId: "teacher-self" }),
      }),
      expectedId: undefined,
    },
    {
      fields: Object.freeze({ id: "formal-template", createdBy: null }),
      expectedId: "formal-template",
    },
    {
      fields: Object.freeze({ id: "formal-template", createdBy: 42 }),
      expectedId: "formal-template",
    },
    {
      fields: Object.freeze({ id: "formal-template" }),
      expectedId: "formal-template",
    },
  ]) {
    const payload = Object.freeze({
      ...scenario.fields,
      taskId: "legacy-template-id",
      createdById: "teacher-self",
      title: "保留模板资料",
      visibility: "PRIVATE",
      status: "DRAFT",
      publisher: Object.freeze({ id: "teacher-self", name: "公开发布者" }),
      raw: Object.freeze({ id: "raw-template-id", createdBy: "teacher-self" }),
      data: Object.freeze({ id: "data-template-id", createdBy: "teacher-self" }),
    });
    const before = structuredClone(payload);
    const result = toLearningTaskOption(payload);

    expect(result.id).toBe(scenario.expectedId);
    expect(result.createdById).toBeUndefined();
    expect(result.title).toBe("保留模板资料");
    expect(result.publisher).toEqual({ id: "teacher-self", name: "公开发布者" });
    expect(isTaskTemplateAuthor("teacher-self", result.createdById)).toBe(false);
    expect(
      canEditTaskTemplate("teacher-self", result.createdById, result.status),
    ).toBe(false);
    expect(result.raw).toBe(payload);
    expect(result.raw.createdById).toBe("teacher-self");
    expect(payload).toStrictEqual(before);
  }
});

test("template single-entity data wrappers cannot supply identity, visibility or optional content", () => {
  const source = Object.freeze({
    id: "ignored-template",
    createdBy: "teacher-self",
    title: "旧包装模板",
    visibility: "SHARED",
    rubric: Object.freeze({ notes: "旧包装说明" }),
    aiContextRefs: Object.freeze([]),
    publisher: Object.freeze({ id: "teacher-self" }),
  });
  const payload = Object.freeze({ data: source });
  const before = structuredClone(payload);
  for (const adapt of [
    toLearningTaskDetailResponse,
    toLearningTaskCreateResponse,
    toLearningTaskUpdateResponse,
  ]) {
    const result = adapt(payload);
    expect(result.id).toBeUndefined();
    expect(result.createdById).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.visibility).toBeUndefined();
    expect(result.rubric).toBeUndefined();
    expect(result.aiContextRefs).toBeUndefined();
    expect(result.publisher).toBeNull();
    expect(result.raw).toBe(payload);
    expect(result.raw.data).toBe(source);
  }
  expect(payload).toStrictEqual(before);
});

test("template and candidate lists retain formal author sources, row order and missing-ID rows", () => {
  const first = Object.freeze({
    id: "template-first",
    taskId: "ignored-task-id",
    createdBy: "teacher-self",
    title: "正式模板",
    status: "PUBLISHED",
    visibility: "PRIVATE",
    rubric: Object.freeze({}),
    aiContextRefs: Object.freeze([]),
    publisher: null,
  });
  const unidentified = Object.freeze({
    taskId: "legacy-only-task-id",
    createdBy: "teacher-other",
    title: "保留缺少正式标识的行",
    status: "PUBLISHED",
    visibility: "SHARED",
  });
  const candidate = Object.freeze({
    id: "candidate-third",
    createdBy: "teacher-candidate",
    createdById: "ignored-candidate-author",
    title: "正式发布候选",
    status: "PUBLISHED",
    visibility: "SHARED",
    difficulty: "hard",
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-12T08:00:00.000Z",
    publisher: Object.freeze({ id: "teacher-publisher", name: "候选发布者" }),
  });
  const items = Object.freeze([first, unidentified, candidate]);
  const payload = Object.freeze({
    items,
    total: 3,
    page: 1,
    limit: 100,
    data: Object.freeze({
      items: Object.freeze([Object.freeze({ id: "ignored-nested-task" })]),
    }),
  });
  const before = structuredClone(payload);
  const unpagedPayload = Object.freeze({ items: Object.freeze([candidate]) });
  const beforeUnpaged = structuredClone(unpagedPayload);
  for (const adapt of [
    toLearningTaskListResponse,
    toPublishableTaskTemplateListResponse,
  ]) {
    const result = adapt(payload);
    expect(result.items.map((item) => item.id)).toEqual([
      "template-first",
      undefined,
      "candidate-third",
    ]);
    expect(result.items.map((item) => item.createdById)).toEqual([
      "teacher-self",
      "teacher-other",
      "teacher-candidate",
    ]);
    expect(result).toMatchObject({ total: 3, page: 1, limit: 100 });
    expect(result.items[0].rubric).toBeUndefined();
    expect(result.items[0].aiContextRefs).toEqual([]);
    expect(result.items[0].publisher).toBeNull();
    expect(result.items[1].title).toBe("保留缺少正式标识的行");
    expect(result.items[2]).toMatchObject({
      title: "正式发布候选",
      difficulty: "hard",
      publisher: { id: "teacher-publisher", name: "候选发布者" },
      createdAt: "2026-11-01T08:00:00.000Z",
      updatedAt: "2026-11-12T08:00:00.000Z",
    });
    expect(result.items[2].rubric).toBeUndefined();
    expect(result.items[2].aiContextRefs).toBeUndefined();
    expect(Object.hasOwn(candidate, "rubric")).toBe(false);
    expect(Object.hasOwn(candidate, "aiContextRefs")).toBe(false);
    expect(result.raw).toBe(payload);
    result.items.forEach((item, index) => expect(item.raw).toBe(items[index]));
    const unpaged = adapt(unpagedPayload);
    expect(unpaged.items).toHaveLength(1);
    expect(unpaged.items[0].id).toBe("candidate-third");
    expect(unpaged.items[0].raw).toBe(candidate);
    expect(unpaged.total).toBeUndefined();
    expect(unpaged.page).toBeUndefined();
    expect(unpaged.limit).toBeUndefined();
    expect(unpaged.raw).toBe(unpagedPayload);
  }
  expect(payload).toStrictEqual(before);
  expect(unpagedPayload).toStrictEqual(beforeUnpaged);
});

test("template and candidate lists reject old wrappers and never rescue unusable top-level items", () => {
  const legacyItems = Object.freeze([
    Object.freeze({ id: "legacy-task", createdBy: "teacher-self" }),
  ]);
  const legacyData = Object.freeze({
    items: legacyItems,
    total: 9,
    page: 3,
    limit: 3,
  });
  for (const scenario of [
    { payload: legacyItems, total: undefined, page: undefined, limit: undefined },
    {
      payload: Object.freeze({ data: legacyData }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({ data: legacyItems }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({
        items: Object.freeze([]),
        total: 0,
        page: 1,
        limit: 100,
        data: legacyData,
      }),
      total: 0,
      page: 1,
      limit: 100,
    },
    {
      payload: Object.freeze({ items: null, data: legacyData }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
    {
      payload: Object.freeze({
        items: Object.freeze({ items: legacyItems }),
        data: legacyData,
      }),
      total: undefined,
      page: undefined,
      limit: undefined,
    },
  ]) {
    const before = structuredClone(scenario.payload);
    for (const adapt of [
      toLearningTaskListResponse,
      toPublishableTaskTemplateListResponse,
    ]) {
      const result = adapt(scenario.payload);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(scenario.total);
      expect(result.page).toBe(scenario.page);
      expect(result.limit).toBe(scenario.limit);
      expect(result.raw).toBe(scenario.payload);
    }
    expect(scenario.payload).toStrictEqual(before);
  }
});

test("template difficulty comes from the top level without changing raw values", () => {
  for (const difficulty of ["easy", "综合", "  综合\n设计  ", ""]) {
    const payload = Object.freeze({
      id: "template-1",
      difficulty,
      task: Object.freeze({ difficulty: "hard" }),
    });
    const option = toLearningTaskOption(payload);
    expect(option.difficulty).toBe(difficulty);
    expect(option.raw).toBe(payload);
  }
  for (const difficulty of [undefined, null, 1, true, {}]) {
    expect(toLearningTaskOption({ difficulty }).difficulty).toBeUndefined();
  }
});

test("teacher classroom difficulty uses only the formal task projection", () => {
  const task = Object.freeze({ difficulty: "  综合\n设计  " });
  const payload = Object.freeze({
    task,
    difficulty: "hard",
    taskSnapshot: Object.freeze({ difficulty: "medium" }),
    template: Object.freeze({ difficulty: "easy" }),
  });
  const detail = toClassroomTask(payload);
  expect(detail.difficulty).toBe("  综合\n设计  ");
  expect(detail.raw).toBe(payload);
  expect(detail.raw.task).toBe(task);
  for (const difficulty of [undefined, null, 1, ""]) {
    const projected = toClassroomTask({ ...payload, task: { difficulty } });
    expect(projected.difficulty).toBe(difficulty === "" ? "" : undefined);
  }
  expect(
    toClassroomTask({ ...payload, task: undefined }).difficulty,
  ).toBeUndefined();
});

test("student difficulty preserves the formal task and server state without live-template fallback", () => {
  const task = Object.freeze({ difficulty: "综合", title: "发布时标题" });
  const latest = Object.freeze({ submissionId: "older", attemptNo: 2 });
  const payload = Object.freeze({
    task,
    difficulty: "hard",
    template: Object.freeze({ difficulty: "easy" }),
    classroomTask: Object.freeze({ taskSnapshotAvailable: true }),
    submissions: Object.freeze([
      Object.freeze({ id: "older", createdAt: "2026-11-01T00:00:00Z" }),
      Object.freeze({ id: "newer", createdAt: "2026-11-01T01:00:00Z" }),
    ]),
    latest,
    participationStatus: Object.freeze({
      reason: "ACTIVE",
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: false,
      message: null,
    }),
  });
  const before = JSON.stringify(payload);
  const detail = toMyTaskDetailResponse(payload);
  expect(detail.task).toBe(task);
  expect(detail.task.difficulty).toBe("综合");
  expect(detail.raw).toBe(payload);
  expect(detail.latest).toBe(latest);
  expect(detail.submissions.map((item) => item.id)).toEqual(["newer", "older"]);
  expect(detail.participationStatus).toEqual({
    reason: "ACTIVE",
    readOnly: false,
    canSubmit: true,
    canRequestAiFeedback: false,
    message: null,
  });
  expect(
    toMyTaskDetailResponse({ ...payload, task: {} }).task.difficulty,
  ).toBeUndefined();
  expect(JSON.stringify(payload)).toBe(before);
});

test("teacher feedback editing requires an explicit matching author and preserves its input", () => {
  const feedback = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
    message: "保留教师反馈正文",
  });
  const before = { ...feedback };
  expect(canEditTeacherFeedback(feedback, "teacher-1")).toBe(true);
  expect(feedback).toEqual(before);
});

test("teacher feedback editing rejects missing, blank and non-string identifiers even when both identities match", () => {
  const valid = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingId = Object.freeze({
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingAuthor = Object.freeze({ id: "feedback-1", source: "TEACHER" });
  expect(canEditTeacherFeedback(missingId, "teacher-1")).toBe(false);
  expect(canEditTeacherFeedback(missingAuthor, "teacher-1")).toBe(false);
  expect(canEditTeacherFeedback(missingAuthor, undefined)).toBe(false);
  expect(Object.hasOwn(missingId, "id")).toBe(false);
  expect(Object.hasOwn(missingAuthor, "createdBy")).toBe(false);
  for (const value of [
    undefined,
    null,
    "",
    " \t\n ",
    1,
    false,
    Object.freeze([]),
    Object.freeze({}),
  ]) {
    const invalidId = Object.freeze({ ...valid, id: value });
    const invalidAuthor = Object.freeze({ ...valid, createdBy: value });
    expect(canEditTeacherFeedback(invalidId, "teacher-1")).toBe(false);
    expect(canEditTeacherFeedback(valid, value)).toBe(false);
    expect(canEditTeacherFeedback(invalidAuthor, "teacher-1")).toBe(false);
    expect(canEditTeacherFeedback(invalidAuthor, value)).toBe(false);
    expect(invalidId.id).toBe(value);
    expect(invalidAuthor.createdBy).toBe(value);
  }
});

test("teacher feedback editing does not infer sources or normalize identity matches", () => {
  const valid = Object.freeze({
    id: "feedback-1",
    source: "TEACHER",
    createdBy: "teacher-1",
  });
  const missingSource = Object.freeze({
    id: "feedback-1",
    createdBy: "teacher-1",
  });
  expect(canEditTeacherFeedback(missingSource, "teacher-1")).toBe(false);
  expect(Object.hasOwn(missingSource, "source")).toBe(false);
  for (const source of [
    undefined,
    null,
    "AI",
    "UNKNOWN",
    "teacher",
    " TEACHER ",
  ]) {
    const feedback = Object.freeze({ ...valid, source });
    expect(canEditTeacherFeedback(feedback, "teacher-1")).toBe(false);
    expect(feedback.source).toBe(source);
  }
  for (const [createdBy, currentUserId] of [
    ["other-teacher", "teacher-1"],
    [" teacher-1", "teacher-1"],
    ["teacher-1", "teacher-1 "],
    ["Teacher-1", "teacher-1"],
    ["teacher-1", "TEACHER-1"],
  ]) {
    const feedback = Object.freeze({ ...valid, createdBy });
    expect(canEditTeacherFeedback(feedback, currentUserId)).toBe(false);
    expect(feedback.createdBy).toBe(createdBy);
  }
  const identicalRawIds = Object.freeze({ ...valid, createdBy: " teacher-1 " });
  expect(canEditTeacherFeedback(identicalRawIds, " teacher-1 ")).toBe(true);
  expect(identicalRawIds.createdBy).toBe(" teacher-1 ");
});

test("teacher feedback adapters preserve known authors and leave absent or null authors unknown without changing content or raw references", () => {
  const content = Object.freeze({
    submissionId: "submission-1",
    source: "TEACHER",
    type: "STYLE",
    severity: "WARN",
    message: "保留教师反馈正文",
    suggestion: "保留修改建议",
    tags: Object.freeze(["readability"]),
    scoreHint: 0,
    createdAt: "2026-11-01T01:00:00Z",
    updatedAt: "2026-11-01T02:00:00Z",
  });
  const known = Object.freeze({
    ...content,
    id: "known",
    createdBy: "teacher-1",
  });
  const missing = Object.freeze({ ...content, id: "missing" });
  const nullAuthor = Object.freeze({ ...content, id: "null", createdBy: null });
  const payload = Object.freeze([known, missing, nullAuthor]);
  const before = JSON.stringify(payload);

  for (const adapt of [toListFeedbackResponse, toTeacherFeedbackListResponse]) {
    const result = adapt(payload);
    if (!Array.isArray(result.raw)) {
      throw new Error("Expected feedback array raw projection");
    }

    expect(result.items.map((item) => item.id)).toEqual([
      "known",
      "missing",
      "null",
    ]);
    expect(result.items.map((item) => item.createdBy)).toEqual([
      "teacher-1",
      undefined,
      undefined,
    ]);
    expect(
      result.items.map((item) => canEditTeacherFeedback(item, "teacher-1")),
    ).toEqual([true, false, false]);
    for (const [index, item] of result.items.entries()) {
      expect(item.raw).toBe(payload[index]);
      expect(result.raw[index]).toBe(payload[index]);
      expect(item).toMatchObject({
        submissionId: "submission-1",
        source: "TEACHER",
        type: "STYLE",
        severity: "WARN",
        message: "保留教师反馈正文",
        suggestion: "保留修改建议",
        tags: ["readability"],
        scoreHint: 0,
        createdAt: "2026-11-01T01:00:00Z",
        updatedAt: "2026-11-01T02:00:00Z",
      });
    }
    expect(result.raw).toEqual([known, missing, nullAuthor]);
  }
  expect(Object.hasOwn(missing, "createdBy")).toBe(false);
  expect(nullAuthor.createdBy).toBeNull();
  expect(JSON.stringify(payload)).toBe(before);
});

test("feedback arrays retain input order and the existing invalid-member degradation", () => {
  const first = Object.freeze({ id: "first", message: "第一条" });
  const last = Object.freeze({ id: "last", source: "AI", message: "最后一条" });
  const payload = Object.freeze([first, null, 7, Object.freeze([]), last]);
  const before = structuredClone(payload);

  for (const adapt of [toListFeedbackResponse, toTeacherFeedbackListResponse]) {
    expect(adapt([])).toStrictEqual({ items: [], raw: [] });
    const result = adapt(payload);
    if (!Array.isArray(result.raw)) {
      throw new Error("Expected feedback array raw projection");
    }

    expect(result.items.map((item) => item.id)).toEqual([
      "first",
      undefined,
      undefined,
      undefined,
      "last",
    ]);
    expect(result.items[0].raw).toBe(first);
    expect(result.items[4].raw).toBe(last);
    expect(result.raw[0]).toBe(first);
    expect(result.raw[4]).toBe(last);
    expect(result.raw).toStrictEqual([first, {}, {}, {}, last]);
    for (const index of [1, 2, 3]) {
      expect(result.items[index]).toStrictEqual({
        id: undefined,
        submissionId: undefined,
        createdBy: undefined,
        source: undefined,
        type: undefined,
        severity: undefined,
        message: undefined,
        suggestion: undefined,
        tags: [],
        scoreHint: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        raw: {},
      });
    }
  }
  expect(payload).toStrictEqual(before);
});

const wrappedFeedback = Object.freeze({
  id: "legacy-feedback",
  submissionId: "submission-1",
  createdBy: "teacher-1",
  source: "TEACHER",
  type: "STYLE",
  severity: "WARN",
  message: "旧包装正文",
  createdAt: "2026-11-01T01:00:00Z",
  updatedAt: "2026-11-01T02:00:00Z",
});

for (const [label, payload] of [
  ["items", { items: [wrappedFeedback] }],
  ["data.items", { data: { items: [wrappedFeedback] } }],
  ["data array", { data: [wrappedFeedback] }],
] as const) {
  test(`feedback adapters retire ${label} without changing object raw references`, () => {
    const before = structuredClone(payload);

    for (const adapt of [toListFeedbackResponse, toTeacherFeedbackListResponse]) {
      const result = adapt(payload);

      expect(result.items).toStrictEqual([]);
      expect(result.raw).toBe(payload);
    }
    expect(payload).toStrictEqual(before);
  });
}

test("other non-array feedback inputs keep empty lists and existing object degradation", () => {
  for (const adapt of [toListFeedbackResponse, toTeacherFeedbackListResponse]) {
    for (const payload of [undefined, null, 7, "feedback", false]) {
      expect(adapt(payload)).toStrictEqual({ items: [], raw: {} });
    }
    const object = Object.freeze({ id: "single-feedback", message: "单条对象" });
    const result = adapt(object);

    expect(result.items).toStrictEqual([]);
    expect(result.raw).toBe(object);
  }
});

test("teacher feedback groups keep teacher and AI records in descending creation time without mutating input", () => {
  const items = toTeacherFeedbackListResponse([
    {
      id: "teacher-older",
      source: "TEACHER",
      createdAt: "2026-11-01T01:00:00Z",
    },
    { id: "ai-older", source: "AI", createdAt: "2026-11-01T02:00:00Z" },
    {
      id: "teacher-newer",
      source: "TEACHER",
      createdAt: "2026-11-01T03:00:00Z",
    },
    { id: "ai-newer", source: "AI", createdAt: "2026-11-01T04:00:00Z" },
  ]).items;
  const before = JSON.stringify(items);
  Object.freeze(items);
  for (const item of items) Object.freeze(item);
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher.map((item) => item.id)).toEqual([
    "teacher-newer",
    "teacher-older",
  ]);
  expect(grouped.ai.map((item) => item.id)).toEqual(["ai-newer", "ai-older"]);
  expect(grouped.other).toEqual([]);
  expect(grouped.teacher[0]).toBe(items[2]);
  expect(grouped.ai[0]).toBe(items[3]);
  expect(JSON.stringify(items)).toBe(before);
});

test("unknown and missing feedback sources retain the original records only in the other group", () => {
  const items = toTeacherFeedbackListResponse([
    { id: "unknown", source: "UNRECOGNIZED", message: "保留未知来源反馈" },
    { id: "missing", message: "保留缺失来源反馈" },
    { id: "lowercase", source: "teacher", message: "不推断正式来源" },
  ]).items;
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher).toEqual([]);
  expect(grouped.ai).toEqual([]);
  expect(grouped.other).toEqual(items);
  for (const [index, item] of grouped.other.entries()) {
    expect(item).toBe(items[index]);
  }
});

test("no feedback remains distinguishable from feedback with only an unrecognized source", () => {
  expect(groupTeacherFeedbackItems([])).toEqual({
    teacher: [],
    ai: [],
    other: [],
  });
  const items = toTeacherFeedbackListResponse([
    { id: "unknown-only", source: "UNRECOGNIZED" },
  ]).items;
  const grouped = groupTeacherFeedbackItems(items);
  expect(grouped.teacher).toEqual([]);
  expect(grouped.ai).toEqual([]);
  expect(grouped.other).toHaveLength(1);
  expect(grouped.other[0]).toBe(items[0]);
});

test("student task history uses actual createdAt instants and keeps equal-time input order", () => {
  const submissions = [
    {
      id: "offset-first",
      attemptNo: 100,
      createdAt: "2026-11-01T10:00:00+08:00",
    },
    {
      id: "newest",
      attemptNo: 1,
      createdAt: "2026-11-01T02:30:00Z",
      updatedAt: "2026-11-01T02:31:00Z",
      lastEditedAt: "2026-11-01T02:31:00Z",
    },
    {
      id: "same-instant-second",
      attemptNo: 99,
      createdAt: "2026-11-01T03:00:00+01:00",
    },
    {
      id: "oldest",
      attemptNo: 300,
      createdAt: "2026-11-01T01:59:59Z",
      updatedAt: "2099-01-01T00:00:00Z",
      lastEditedAt: "2099-01-01T00:00:00Z",
    },
    {
      id: "same-instant-third",
      attemptNo: 200,
      createdAt: "2026-10-31T22:00:00-04:00",
    },
  ];
  const detail = toMyTaskDetailResponse({ submissions });
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "newest",
    "offset-first",
    "same-instant-second",
    "same-instant-third",
    "oldest",
  ]);
});

test("student task history puts unusable createdAt values last in their original order", () => {
  const submissions = [
    { id: "missing", updatedAt: "2099-01-01T00:00:00Z" },
    { id: "epoch", createdAt: "1970-01-01T00:00:00Z" },
    { id: "null", createdAt: null },
    { id: "empty", createdAt: "" },
    { id: "recent", createdAt: "2026-11-01T00:00:00Z" },
    {
      id: "invalid",
      createdAt: "not-a-date",
      lastEditedAt: "2099-01-01T00:00:00Z",
    },
    { id: "number", createdAt: 0 },
    { id: "whitespace", createdAt: " \t " },
  ];
  const detail = toMyTaskDetailResponse({ submissions });
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "recent",
    "epoch",
    "missing",
    "null",
    "empty",
    "invalid",
    "number",
    "whitespace",
  ]);
});

test("student task history accepts frozen empty and single-entry lists", () => {
  const empty = Object.freeze([]);
  expect(toMyTaskDetailResponse({ submissions: empty }).submissions).toEqual([]);
  const submission = Object.freeze({
    id: "only-submission",
    createdAt: "2026-11-01T00:00:00Z",
  });
  const submissions = Object.freeze([submission]);
  const detail = toMyTaskDetailResponse(Object.freeze({ submissions }));
  expect(detail.submissions.map((item) => item.id)).toEqual(["only-submission"]);
  expect(detail.submissions).not.toBe(submissions);
  expect(detail.submissions[0]).toBe(submission);
});

test("history ordering preserves frozen records, feedback, raw facts and server task state", () => {
  const feedbackItems = Object.freeze([
    Object.freeze({
      source: "AI",
      type: "OTHER",
      severity: "WARN",
      message: "  保留反馈原文\n ",
      suggestion: "  核对修改  ",
      tags: Object.freeze(["synthetic"]),
    }),
  ]);
  const feedbackSummary = Object.freeze({
    totalItems: 1,
    topTags: Object.freeze([Object.freeze({ tag: "synthetic", count: 1 })]),
    severityBreakdown: Object.freeze({ INFO: 0, WARN: 1, ERROR: 0 }),
  });
  const older = Object.freeze({
    id: "authoritative-latest",
    attemptNo: 2,
    createdAt: "2026-11-01T00:00:00Z",
    aiFeedbackStatus: "SUCCEEDED",
    feedbackSummary,
    feedbackItems,
  });
  const newer = Object.freeze({
    id: "first-in-history",
    attemptNo: 1,
    createdAt: "2026-11-01T01:00:00Z",
    aiFeedbackStatus: "NOT_REQUESTED",
  });
  const submissions = Object.freeze([older, newer]);
  const latest = Object.freeze({
    submissionId: "authoritative-latest",
    attemptNo: 2,
    aiFeedbackStatus: "SUCCEEDED",
    feedbackSummary,
    feedbackItems,
  });
  const completionStatus = Object.freeze({
    status: "QUALIFIED_WITH_WARNINGS",
    severity: "WARN",
    source: "AI",
    latestSubmissionId: "authoritative-latest",
    teacherFeedbackCount: 0,
    aiFeedbackCount: 1,
    teacherWorstSeverity: null,
    aiWorstSeverity: "WARN",
  });
  const participationStatus = Object.freeze({
    readOnly: true,
    canSubmit: false,
    canRequestAiFeedback: false,
    reason: "CLASSROOM_TASK_NOT_ACTIVE",
    message: "课堂任务已关闭",
  });
  const payload = Object.freeze({
    submissions,
    latest,
    completionStatus,
    participationStatus,
  });
  const before = JSON.stringify(payload);
  const detail = toMyTaskDetailResponse(payload);
  expect(detail.submissions.map((submission) => submission.id)).toEqual([
    "first-in-history",
    "authoritative-latest",
  ]);
  expect(detail.submissions).not.toBe(submissions);
  expect(detail.submissions[0]).toBe(newer);
  expect(detail.submissions[1]).toBe(older);
  expect(detail.submissions[1].feedbackItems).toBe(feedbackItems);
  expect(detail.submissions[1].feedbackSummary).toBe(feedbackSummary);
  expect(detail.latest).toBe(latest);
  expect(detail.completionStatus).toEqual(completionStatus);
  expect(detail.participationStatus).toEqual(participationStatus);
  expect(detail.raw).toBe(payload);
  expect(detail.raw.submissions).toBe(submissions);
  expect(JSON.stringify(payload)).toBe(before);
  expect(submissions.map((submission) => submission.id)).toEqual([
    "authoritative-latest",
    "first-in-history",
  ]);
});

test("formal create responses keep root identity, revision zero and content language with original text", () => {
  const codeText = "  print('created')\r\n\t ";
  const submissionNote = "  创建说明\n😀  ";
  const declaration = "  使用 AI 讨论思路\n  ";
  const payload = Object.freeze({
    id: "created-submission",
    taskId: "task-1",
    classroomTaskId: "classroom-task-1",
    studentId: "student-1",
    content: Object.freeze({ language: "python", codeText, submissionNote }),
    meta: Object.freeze({ aiUsageDeclaration: declaration }),
    submittedAt: "2026-11-13T01:00:00.000Z",
    createdAt: "2026-11-13T01:00:00.000Z",
    attemptNo: 1,
    contentRevision: 0,
    lastEditedAt: null,
    lastEditIsLate: null,
    reviewStartedAt: null,
    editing: Object.freeze({ canEdit: true, reason: null, message: null }),
    isLate: false,
    lateBySeconds: 0,
    aiFeedbackStatus: "NOT_REQUESTED",
  });
  const before = structuredClone(payload);

  for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
    const result = adapt(payload);

    expect(result).toMatchObject({
      id: "created-submission",
      taskId: "task-1",
      classroomTaskId: "classroom-task-1",
      studentId: "student-1",
      language: "python",
      content: { language: "python", codeText, submissionNote },
      meta: { aiUsageDeclaration: declaration },
      submittedAt: "2026-11-13T01:00:00.000Z",
      attemptNo: 1,
      contentRevision: 0,
      lastEditedAt: null,
      lastEditIsLate: null,
      reviewStartedAt: null,
      editing: { canEdit: true, reason: null, message: null },
      isLate: false,
      lateBySeconds: 0,
      aiFeedbackStatus: "NOT_REQUESTED",
    });
    expect(canEditSubmission(result)).toBe(true);
    expect(result.raw).toBe(payload);
  }
  expect(payload).toStrictEqual(before);
});

test("formal detail and saved edit responses preserve root facts and original content", () => {
  const codeText = "  const updated = true;\n\t ";
  const submissionNote = "  修改说明\n  ";
  const declaration = "  已独立核对 AI 建议\n ";
  const payload = Object.freeze({
    id: "updated-submission",
    taskId: "task-2",
    classroomTaskId: "classroom-task-2",
    studentId: "student-2",
    studentName: "王同学",
    taskTitle: "正式快照标题",
    taskSnapshotAvailable: true,
    language: "typescript",
    content: Object.freeze({ language: "typescript", codeText, submissionNote }),
    meta: Object.freeze({ aiUsageDeclaration: declaration }),
    submittedAt: "2026-11-13T02:00:00.000Z",
    attemptNo: 2,
    contentRevision: 1,
    lastEditedAt: "2026-11-13T03:00:00.000Z",
    lastEditIsLate: true,
    reviewStartedAt: null,
    editing: Object.freeze({ canEdit: true, reason: null, message: null }),
    isLate: false,
    lateBySeconds: 0,
    aiFeedbackStatus: "NOT_REQUESTED",
  });
  const before = structuredClone(payload);

  for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
    const result = adapt(payload);

    expect(result).toMatchObject({
      id: "updated-submission",
      taskId: "task-2",
      classroomTaskId: "classroom-task-2",
      studentId: "student-2",
      studentName: "王同学",
      taskTitle: "正式快照标题",
      taskSnapshotAvailable: true,
      language: "typescript",
      content: { language: "typescript", codeText, submissionNote },
      meta: { aiUsageDeclaration: declaration },
      submittedAt: "2026-11-13T02:00:00.000Z",
      attemptNo: 2,
      contentRevision: 1,
      lastEditedAt: "2026-11-13T03:00:00.000Z",
      lastEditIsLate: true,
      reviewStartedAt: null,
      editing: { canEdit: true, reason: null, message: null },
      isLate: false,
      lateBySeconds: 0,
      aiFeedbackStatus: "NOT_REQUESTED",
    });
    expect(result.raw).toBe(payload);
  }
  expect(payload).toStrictEqual(before);
});

test("submission root fields win over conflicting data and submission objects", () => {
  const legacy = Object.freeze({
    id: "legacy-submission",
    taskId: "legacy-task",
    classroomTaskId: "legacy-classroom-task",
    studentId: "legacy-student",
    language: "legacy-language",
    content: Object.freeze({
      language: "legacy-language",
      codeText: "old code",
      submissionNote: "old note",
    }),
    meta: Object.freeze({ aiUsageDeclaration: "old declaration" }),
    submittedAt: "2000-01-01T00:00:00.000Z",
    contentRevision: 99,
    editing: Object.freeze({ canEdit: true, reason: null, message: null }),
    taskSnapshotAvailable: true,
    aiFeedbackStatus: "SUCCEEDED",
    aiReview: Object.freeze({ canRequest: true }),
  });
  const payload = Object.freeze({
    id: "formal-submission",
    taskId: "formal-task",
    classroomTaskId: "formal-classroom-task",
    studentId: "formal-student",
    language: null,
    content: Object.freeze({
      language: " python ",
      codeText: "  root code\n ",
      submissionNote: "",
    }),
    meta: Object.freeze({ aiUsageDeclaration: "" }),
    submittedAt: null,
    createdAt: "2026-11-13T04:00:00.000Z",
    contentRevision: 0,
    editing: Object.freeze({
      canEdit: false,
      reason: "REVIEW_STARTED",
      message: "已进入评阅",
    }),
    taskSnapshotAvailable: false,
    aiFeedbackStatus: "NOT_REQUESTED",
    aiReview: Object.freeze({ canRequest: false }),
    data: legacy,
    submission: legacy,
  });
  const before = structuredClone(payload);

  for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
    const result = adapt(payload);

    expect(result).toMatchObject({
      id: "formal-submission",
      taskId: "formal-task",
      classroomTaskId: "formal-classroom-task",
      studentId: "formal-student",
      language: "python",
      content: {
        language: "python",
        codeText: "  root code\n ",
        submissionNote: "",
      },
      meta: { aiUsageDeclaration: "" },
      submittedAt: null,
      contentRevision: 0,
      editing: {
        canEdit: false,
        reason: "REVIEW_STARTED",
        message: "已进入评阅",
      },
      taskSnapshotAvailable: false,
      aiFeedbackStatus: "NOT_REQUESTED",
      aiReview: { canRequest: false },
    });
    expect(canEditSubmission(result)).toBe(false);
    expect(result.raw).toBe(payload);
    expect(result.raw.data).toBe(legacy);
    expect(result.raw.submission).toBe(legacy);
  }
  expect(payload).toStrictEqual(before);
});

for (const key of ["data", "submission"] as const) {
  test(`retired submission ${key} objects cannot supply missing root facts or operation permission`, () => {
    const legacy = Object.freeze({
      id: "legacy-submission",
      taskId: "legacy-task",
      classroomTaskId: "legacy-classroom-task",
      studentId: "legacy-student",
      content: Object.freeze({
        language: "python",
        codeText: "legacy code",
        submissionNote: "legacy note",
      }),
      meta: Object.freeze({ aiUsageDeclaration: "legacy declaration" }),
      submittedAt: "2026-11-13T05:00:00.000Z",
      contentRevision: 0,
      editing: Object.freeze({ canEdit: true, reason: null, message: null }),
      taskSnapshotAvailable: true,
      aiReview: Object.freeze({ canRequest: true }),
    });
    const payload = Object.freeze({ [key]: legacy });
    const before = structuredClone(payload);

    for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
      const result = adapt(payload);

      expect(result).toMatchObject({
        id: undefined,
        taskId: undefined,
        classroomTaskId: undefined,
        studentId: undefined,
        language: undefined,
        content: {
          language: undefined,
          codeText: undefined,
          submissionNote: undefined,
        },
        meta: undefined,
        submittedAt: undefined,
        contentRevision: undefined,
        editing: { canEdit: false, reason: null, message: null },
        taskSnapshotAvailable: undefined,
        aiReview: undefined,
      });
      expect(canEditSubmission(result)).toBe(false);
      expect(result.raw).toBe(payload);
    }
    expect(payload).toStrictEqual(before);
  });
}

test("unusable root submission fields are not rescued by complete legacy objects", () => {
  const legacy = Object.freeze({
    id: "legacy-submission",
    content: Object.freeze({
      language: "python",
      codeText: "legacy code",
      submissionNote: "legacy note",
    }),
    meta: Object.freeze({ aiUsageDeclaration: "legacy declaration" }),
    contentRevision: 5,
    editing: Object.freeze({ canEdit: true, reason: null, message: null }),
    taskSnapshotAvailable: true,
    aiReview: Object.freeze({ canRequest: true }),
  });
  const payload = Object.freeze({
    id: " \t ",
    language: 7,
    content: Object.freeze({ language: " ", codeText: null, submissionNote: 7 }),
    meta: Object.freeze({ aiUsageDeclaration: null }),
    contentRevision: null,
    editing: Object.freeze({ canEdit: true, reason: null, message: null }),
    taskSnapshotAvailable: false,
    aiReview: null,
    data: legacy,
    submission: legacy,
  });
  const before = structuredClone(payload);

  for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
    const result = adapt(payload);

    expect(result).toMatchObject({
      id: undefined,
      language: undefined,
      content: { language: undefined, codeText: null, submissionNote: undefined },
      meta: undefined,
      contentRevision: null,
      editing: { canEdit: false, reason: null, message: null },
      taskSnapshotAvailable: false,
      aiReview: undefined,
    });
    expect(canEditSubmission(result)).toBe(false);
    expect(result.raw).toBe(payload);
  }
  expect(payload).toStrictEqual(before);
});

test("submittedAt uses only its nullable trimmed root string without createdAt rescue or date validation", () => {
  for (const [submittedAt, expected] of [
    [" 2026-11-13T06:00:00.000Z ", "2026-11-13T06:00:00.000Z"],
    [null, null],
    [undefined, undefined],
    [7, undefined],
    [" \t\n ", undefined],
    [" not-a-date ", "not-a-date"],
  ] as const) {
    const payload = Object.freeze({
      submittedAt,
      createdAt: "2026-11-13T07:00:00.000Z",
    });

    for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
      const result = adapt(payload);

      expect(result.submittedAt).toBe(expected);
      expect(result.raw).toBe(payload);
      expect(payload.submittedAt).toBe(submittedAt);
    }
  }
});

test("non-object submission inputs keep the existing empty-record degradation", () => {
  for (const payload of [
    undefined,
    null,
    7,
    "submission",
    [{ id: "legacy-array" }],
  ]) {
    for (const adapt of [toSubmissionDetailResponse, toTeacherDetail]) {
      const result = adapt(payload);

      expect(result.id).toBeUndefined();
      expect(result.contentRevision).toBeUndefined();
      expect(result.editing.canEdit).toBe(false);
      expect(result.aiReview).toBeUndefined();
      expect(result.raw).toStrictEqual({});
    }
  }
});

test("only an explicit valid revision and complete server editing permission allow editing", () => {
  const valid = {
    contentRevision: 0,
    editing: { canEdit: true, reason: null, message: null },
  };
  expect(canEditSubmission(toSubmissionDetailResponse(valid))).toBe(true);
  for (const contentRevision of [
    undefined,
    null,
    "0",
    -1,
    1.5,
    Number.NaN,
    Infinity,
  ]) {
    const detail = toSubmissionDetailResponse({ ...valid, contentRevision });
    expect(canEditSubmission(detail)).toBe(false);
    expect(detail.contentRevision).toBe(
      contentRevision === null ? null : undefined,
    );
  }
  for (const editing of [
    undefined,
    null,
    {},
    { canEdit: true },
    { canEdit: "true", reason: null, message: null },
    { canEdit: true, reason: "UNKNOWN", message: null },
    { canEdit: false, reason: "REVIEW_STARTED", message: "已进入评阅" },
  ]) {
    expect(
      canEditSubmission(toSubmissionDetailResponse({ ...valid, editing })),
    ).toBe(false);
  }
  const times = {
    lastEditedAt: "2026-10-28T01:00:00.000Z",
    lastEditIsLate: true,
    reviewStartedAt: null,
  };
  expect(toSubmissionDetailResponse({ ...valid, ...times })).toMatchObject(
    times,
  );
  expect(toTeacherDetail({ ...valid, ...times })).toEqual(
    toSubmissionDetailResponse({ ...valid, ...times }),
  );
  const malformed = toSubmissionDetailResponse({
    lastEditedAt: "bad",
    lastEditIsLate: "true",
    reviewStartedAt: 123,
  });
  expect(malformed.lastEditedAt).toBeUndefined();
  expect(malformed.lastEditIsLate).toBeUndefined();
  expect(malformed.reviewStartedAt).toBeUndefined();
});

test("edit requests preserve text, require captured revision and contain only the content whitelist", () => {
  const code = "  print('😀')\r\n\t ",
    note = " 说明\n ";
  expect(buildUpdateSubmissionRequest(2, code, "python", note)).toEqual({
    expectedRevision: 2,
    content: { language: "python", codeText: code, submissionNote: note },
  });
  expect(
    buildUpdateSubmissionRequest(0, code, "auto", "").content.submissionNote,
  ).toBe("");
  for (const revision of [-1, 1.5, Number.NaN, Infinity])
    expect(() =>
      buildUpdateSubmissionRequest(revision, code, "auto", note),
    ).toThrow();
});

test("a refreshed work version invalidates the captured student or teacher draft until explicit confirmation", () => {
  for (const text of ["学生保留的代码草稿", "教师保留的评语草稿"]) {
    const draft = { baseRevision: 2, text };
    const refreshed = toSubmissionDetailResponse({ contentRevision: 3 });
    expect(
      isDraftRevisionCurrent(draft.baseRevision, refreshed.contentRevision),
    ).toBe(false);
    expect(draft).toEqual({ baseRevision: 2, text });
    expect(isDraftRevisionCurrent(draft.baseRevision, undefined)).toBe(false);
    expect(isDraftRevisionCurrent(draft.baseRevision, 2)).toBe(true);
    // The explicit confirmation keeps user input while changing only its reviewed basis.
    const confirmed = { ...draft, baseRevision: refreshed.contentRevision };
    expect(confirmed.text).toBe(text);
    expect(
      isDraftRevisionCurrent(confirmed.baseRevision, refreshed.contentRevision),
    ).toBe(true);
  }
  expect(
    getSubmissionRevisionError({ code: "SUBMISSION_REVISION_CONFLICT" }),
  ).toContain("旧版作品");
  expect(
    getSubmissionRevisionError({ code: "SUBMISSION_REVIEW_STARTED" }),
  ).toContain("已进入评阅");
  expect(
    getSubmissionRevisionError({ message: "private stack" }),
  ).not.toContain("private stack");
});

test("a confirmed edit accepts an authoritative later version without accepting stale or invalid revisions", () => {
  expect(isSavedSubmissionRevision(2, 3)).toBe(true);
  expect(isSavedSubmissionRevision(2, 4)).toBe(true);
  for (const revision of [2, 1, null, undefined, "3", -1, 3.5, Number.NaN])
    expect(isSavedSubmissionRevision(2, revision)).toBe(false);
  expect(isSavedSubmissionRevision(undefined, 3)).toBe(false);
});

test("distinguishes real public 409 responses after the exception filter omits code", () => {
  const body = (message: unknown) => ({
    statusCode: 409,
    timestamp: "2026-10-28T01:00:00.000Z",
    path: "/api/learning-tasks/submissions/submission-1",
    message,
  });
  const contentChanged = "作品内容已变化，请查看最新提交并核对草稿后明确继续。";
  const reviewStarted =
    "本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。";
  const invalidState =
    "提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。";
  expect(getSubmissionRevisionError(body(contentChanged))).toBe(
    "作品内容已变化，当前操作依据的是旧版作品。当前输入已保留，请在本页核对最新作品，确认后再继续。",
  );
  expect(getSubmissionRevisionError(body(reviewStarted))).toBe(
    "本次提交已进入评阅，不能再修改作品。未保存的修改已保留，请在本页核对当前作品与反馈。",
  );
  expect(getSubmissionRevisionError(body(invalidState))).toBe(
    "提交状态暂不可用。当前输入已保留，请在本页核对详情或联系教师。",
  );
  for (const message of [
    "private stack",
    contentChanged + " ",
    reviewStarted + "\nprivate stack",
    invalidState + "private stack",
    [reviewStarted],
    null,
  ]) {
    expect(getSubmissionRevisionError(body(message))).toBe(
      "提交状态已变化。当前输入已保留，请先在本页核对最新详情。",
    );
  }
});

test("saved work bridges an old page response but cannot revive permission from an invalid latest detail", () => {
  const permission = { canEdit: true, reason: null, message: null };
  const old = toSubmissionDetailResponse({
    contentRevision: 0,
    content: { codeText: "A" },
    editing: permission,
  });
  const saved = toSubmissionDetailResponse({
    contentRevision: 1,
    content: { codeText: "B" },
    editing: permission,
  });
  expect(selectSubmissionDisplayDetail(old, saved)).toBe(saved);
  for (const contentRevision of [undefined, null, -1, "1"]) {
    const invalid = toSubmissionDetailResponse({
      contentRevision,
      editing: permission,
    });
    const display = selectSubmissionDisplayDetail(invalid, saved);
    expect(display).toBe(invalid);
    expect(canEditSubmission(display)).toBe(false);
  }
  const locked = toSubmissionDetailResponse({
    ...saved.raw,
    reviewStartedAt: "2026-10-28T01:00:00Z",
    editing: {
      canEdit: false,
      reason: "REVIEW_STARTED",
      message: "已进入评阅",
    },
  });
  expect(selectSubmissionDisplayDetail(locked, saved)).toBe(locked);
  expect(selectSubmissionDisplayDetail(saved, locked)).toBe(locked);
});

test("preserves source, independent note and declaration without trimming", () => {
  const codeText =
    "  ===== FILE: src/main.ts =====\n\tconst value = '<img>';\n  ";
  const submissionNote = "  设计与核对\n\t修订：😀  ";
  const declaration = "  使用外部 AI 讨论方案\n  ";
  expect(
    buildTextSubmissionRequest(codeText, "typescript", submissionNote),
  ).toEqual({ content: { codeText, language: "typescript", submissionNote } });
  const payload = {
    id: "submission-1",
    taskTitle: "发布标题",
    taskSnapshotAvailable: true,
    content: { codeText, language: "typescript", submissionNote },
    meta: { aiUsageDeclaration: declaration },
  };
  const student = toSubmissionDetailResponse(payload);
  expect(student.content).toEqual({
    codeText,
    language: "typescript",
    submissionNote,
  });
  expect(student.meta).toEqual({ aiUsageDeclaration: declaration });
  expect(toTeacherDetail(payload)).toEqual(student);
});

test("allows 20,000 Unicode code points including non-BMP and variation selectors", () => {
  for (const note of [
    "a".repeat(20_000),
    "😀".repeat(20_000),
    "👩\uFE0F".repeat(10_000),
  ]) {
    expect(getSubmissionTextError("code", note)).toBeNull();
    expect(getSubmissionTextError("code", note + "中")).toBe(
      "提交说明不能超过 20,000 个 Unicode 码点，请检查说明长度。",
    );
  }
  expect(countCodePoints("A中😀\n👩\uFE0F")).toBe(6);
});
test("allows an empty note and rejects whitespace-only source", () => {
  expect(getSubmissionTextError("  code\n ", "")).toBeNull();
  expect(getSubmissionTextError(" \t\n", "说明")).toBe(
    "请填写代码内容后再提交。",
  );
  expect(
    buildTextSubmissionRequest("  code\n ", "auto", "").content.codeText,
  ).toBe("  code\n ");
});

test("keeps snapshot and allowLate without projecting retired classroom settings", () => {
  const payload = {
    id: "instance",
    taskSnapshotAvailable: true,
    publishedAt: "2026-10-01T00:00:00.000Z",
    dueAt: "2026-10-20T00:00:00.000Z",
    settings: { allowLate: false },
    task: {
      title: "发布标题",
      description: "发布说明",
      status: "ARCHIVED",
      rubric: { dimensions: { design: 20 }, notes: "教师参考" },
    },
  };
  const detail = toClassroomTask(payload),
    list = toClassroomTaskSummary(payload);
  expect(detail).toMatchObject({
    taskSnapshotAvailable: true,
    allowLate: false,
    dueAt: "2026-10-20T00:00:00.000Z",
    title: "发布标题",
    description: "发布说明",
    rubric: { dimensions: { design: 20 }, notes: "教师参考" },
  });
  expect(list).toMatchObject({
    taskSnapshotAvailable: true,
    allowLate: false,
  });
  expect(detail.raw).toBe(payload);
  // Residual classroom settings remain raw facts, not formal adapter output.
  const legacy = {
    ...payload,
    maxAttempts: 99,
    settings: {
      ...payload.settings,
      maxAttempts: 2,
      aiFeedbackMode: "DISABLED",
    },
  };
  const legacyDetail = toClassroomTask(legacy);
  const legacyList = toClassroomTaskSummary(legacy);
  expect(legacyDetail).not.toHaveProperty("aiFeedbackMode");
  expect(legacyDetail).not.toHaveProperty("maxAttempts");
  expect(legacyList).not.toHaveProperty("maxAttempts");
  expect(legacyList).toEqual(list);
  expect(legacyDetail.allowLate).toBe(false);
  expect(legacyDetail.raw).toBe(legacy);
  expect(legacyDetail.raw.settings).toBe(legacy.settings);
  expect(legacyDetail.raw).toHaveProperty("settings.maxAttempts", 2);
  expect(legacyDetail.raw).toHaveProperty("maxAttempts", 99);
  const studentPayload = { classroomTask: legacy };
  const studentDetail = toMyTaskDetailResponse(studentPayload);
  expect(studentDetail.classroomTask.settings).toEqual({ allowLate: false });
  expect(studentDetail.raw).toBe(studentPayload);
  expect(studentDetail.raw.classroomTask).toBe(legacy);
});
test("requires explicit snapshot and backend submit permission, independent of AI request permission", () => {
  const detail = toMyTaskDetailResponse({
    classroomTask: {
      taskSnapshotAvailable: true,
      settings: { allowLate: true },
    },
    task: { status: "ARCHIVED" },
    participationStatus: {
      reason: "ACTIVE",
      readOnly: false,
      canSubmit: true,
      canRequestAiFeedback: false,
      message: null,
    },
  });
  expect(detail.classroomTask.settings).toEqual({
    allowLate: true,
  });
  expect(detail.participationStatus?.canRequestAiFeedback).toBe(false);
  expect(
    canSubmitTextTask(
      detail.classroomTask.taskSnapshotAvailable,
      detail.participationStatus?.canSubmit,
    ),
  ).toBe(true);
  expect(canSubmitTextTask(false, true)).toBe(false);
  expect(canSubmitTextTask(undefined, true)).toBe(false);
  expect(canSubmitTextTask(true, undefined)).toBe(false);
  expect(canSubmitTextTask(true, false)).toBe(false);
});
test("preserves classroom-level participation flags and message", () => {
  const participationStatus = Object.freeze({
    reason: "CLASSROOM_NOT_ACTIVE",
    readOnly: true,
    canSubmit: false,
    canRequestAiFeedback: false,
    message: "班级已归档或不可参与，仅可查看历史提交与反馈。",
  });
  const payload = Object.freeze({ participationStatus });
  const before = structuredClone(payload);
  const detail = toMyTaskDetailResponse(payload);

  expect(detail.participationStatus).toEqual({
    reason: "CLASSROOM_NOT_ACTIVE",
    readOnly: true,
    canSubmit: false,
    canRequestAiFeedback: false,
    message: "班级已归档或不可参与，仅可查看历史提交与反馈。",
  });
  expect(detail.raw).toBe(payload);
  expect(payload).toEqual(before);
});

test("rejects the retired participation reason without losing task or history facts", () => {
  const classroom = Object.freeze({
    id: "classroom-1",
    name: "班级",
    status: "ACTIVE",
  });
  const classroomTask = Object.freeze({
    id: "classroom-task-1",
    taskSnapshotAvailable: true,
    settings: Object.freeze({ allowLate: true }),
  });
  const task = Object.freeze({
    id: "task-1",
    title: "已保存的任务标题",
    description: "  保留任务内容\n ",
    status: "ARCHIVED",
  });
  const submission = Object.freeze({
    id: "submission-1",
    attemptNo: 1,
    createdAt: "2026-11-01T08:00:00.000Z",
    content: Object.freeze({ codeText: "  保留历史源码\n " }),
  });
  const submissions = Object.freeze([submission]);
  const latest = Object.freeze({ submissionId: "submission-1", attemptNo: 1 });
  const completionStatus = Object.freeze({
    status: "NO_FEEDBACK",
    severity: null,
    source: null,
    latestSubmissionId: "submission-1",
    teacherFeedbackCount: 0,
    aiFeedbackCount: 0,
    teacherWorstSeverity: null,
    aiWorstSeverity: null,
  });
  for (const flags of [
    { readOnly: true, canSubmit: false, canRequestAiFeedback: false },
    { readOnly: false, canSubmit: true, canRequestAiFeedback: true },
  ]) {
    const participationStatus = Object.freeze({
      ...flags,
      reason: "TASK_NOT_PUBLISHED",
      message: "旧参与原因提示",
    });
    const payload = Object.freeze({
      classroom,
      classroomTask,
      task,
      submissions,
      latest,
      completionStatus,
      participationStatus,
    });
    const before = structuredClone(payload);
    const detail = toMyTaskDetailResponse(payload);

    expect(detail.participationStatus).toBeUndefined();
    expect(detail.participationStatus?.canRequestAiFeedback).not.toBe(true);
    expect(detail.classroomTask.taskSnapshotAvailable).toBe(true);
    expect(
      canSubmitTextTask(
        detail.classroomTask.taskSnapshotAvailable,
        detail.participationStatus?.canSubmit,
      ),
    ).toBe(false);
    expect(detail.classroom).toBe(classroom);
    expect(detail.classroomTask).toEqual(classroomTask);
    expect(detail.task).toBe(task);
    expect(detail.submissions).toEqual([submission]);
    expect(detail.submissions[0]).toBe(submission);
    expect(detail.latest).toBe(latest);
    expect(detail.completionStatus).toEqual(completionStatus);
    expect(detail.raw).toBe(payload);
    expect(detail.raw.classroomTask).toBe(classroomTask);
    expect(detail.raw.submissions).toBe(submissions);
    expect(detail.raw.participationStatus).toBe(participationStatus);
    expect(detail.raw).toHaveProperty(
      "participationStatus.reason",
      "TASK_NOT_PUBLISHED",
    );
    expect(payload).toEqual(before);
  }
});

test("keeps unknown and genuinely missing participation reasons unavailable", () => {
  for (const { participationStatus, hasReason } of [
    {
      participationStatus: Object.freeze({
        reason: "UNKNOWN",
        readOnly: false,
        canSubmit: true,
        canRequestAiFeedback: true,
        message: "未知原因",
      }),
      hasReason: true,
    },
    {
      participationStatus: Object.freeze({
        readOnly: false,
        canSubmit: true,
        canRequestAiFeedback: true,
        message: "缺少原因",
      }),
      hasReason: false,
    },
  ]) {
    const payload = Object.freeze({
      classroomTask: Object.freeze({ taskSnapshotAvailable: true }),
      participationStatus,
    });
    const before = structuredClone(payload);
    const detail = toMyTaskDetailResponse(payload);

    expect(detail.participationStatus).toBeUndefined();
    expect(detail.participationStatus?.canRequestAiFeedback).not.toBe(true);
    expect(
      canSubmitTextTask(
        detail.classroomTask.taskSnapshotAvailable,
        detail.participationStatus?.canSubmit,
      ),
    ).toBe(false);
    expect(detail.raw).toBe(payload);
    expect(detail.raw.participationStatus).toBe(participationStatus);
    expect(Object.hasOwn(participationStatus, "reason")).toBe(hasReason);
    expect(payload).toEqual(before);
  }
});

test("keeps missing and false snapshot distinct and closes incomplete participation", () => {
  expect(
    toMyTaskDetailResponse({ classroomTask: { taskSnapshotAvailable: false } })
      .classroomTask.taskSnapshotAvailable,
  ).toBe(false);
  expect(
    toMyTaskDetailResponse({ classroomTask: {} }).classroomTask
      .taskSnapshotAvailable,
  ).toBeUndefined();
  expect(getTaskSnapshotMessage(true)).toBe("已保存的课堂任务内容");
  expect(getTaskSnapshotMessage(false)).toBe(
    "课堂任务内容快照缺失或无效，请联系教师核对。",
  );
  expect(getTaskSnapshotMessage(undefined)).toBe(
    "课堂任务内容信息暂不可用，请刷新核对后继续。",
  );
  const detail = toMyTaskDetailResponse({
    participationStatus: {
      reason: "ACTIVE",
      canSubmit: "true",
      canRequestAiFeedback: 1,
    },
  });
  expect(detail.participationStatus?.canSubmit).toBe(false);
  expect(detail.participationStatus?.canRequestAiFeedback).toBe(false);
  expect(detail.participationStatus?.readOnly).toBe(true);
});

test("recognizes only the exact public snapshot error for 403 or 409", () => {
  const message = "课堂任务内容快照缺失或无效，请联系教师核对。";
  const body = Object.freeze({ message, code: "PRIVATE_INTERNAL_CODE" });
  for (const status of [403, 409]) {
    expect(getTaskSnapshotErrorMessage(status, body)).toBe(
      "课堂任务内容快照缺失或无效，请联系教师核对。",
    );
  }
  for (const status of [200, 400, 401, 404, 422, 429, 500]) {
    expect(getTaskSnapshotErrorMessage(status, body)).toBeUndefined();
  }
  for (const data of [
    undefined,
    null,
    message,
    [],
    [message],
    Object.assign([], { message }),
    {},
    { code: "TASK_SNAPSHOT_MISSING" },
    { message: undefined },
    { message: null },
    { message: 0 },
    { message: false },
    { message: {} },
    { message: [message] },
    { message: "unknown error" },
    { message: "该课堂任务未保存发布内容，请教师重新布置后继续。" },
    {
      message:
        "未保存发布时任务内容，当前说明为模板现状；请教师重新布置后继续。",
    },
    { message: ` ${message}` },
    { message: `${message} ` },
    { message: `${message}\nprivate synthetic stack` },
  ]) {
    expect(getTaskSnapshotErrorMessage(409, data)).toBeUndefined();
  }
  expect(getTextSubmissionError(409, body)).toBe(
    "课堂任务内容快照缺失或无效，请联系教师核对。",
  );
  expect(getTextSubmissionError(403, body)).toBe("无权限提交该课堂任务。");
  expect(
    getTextSubmissionError(409, {
      message: "该课堂任务未保存发布内容，请教师重新布置后继续。",
    }),
  ).toBe("提交作业失败，请稍后重试。");
});

test("a saved submission stays locked after busy ends and recovery opens that same detail", () => {
  expect(canCreateTextSubmission(false, false, null)).toBe(true);
  expect(canCreateTextSubmission(true, false, null)).toBe(false);
  expect(canCreateTextSubmission(false, true, null)).toBe(false);
  expect(canCreateTextSubmission(false, false, "saved/作品")).toBe(false);
  expect(canCreateTextSubmission(true, false, "saved/作品")).toBe(false);
  expect(getSavedSubmissionHref("saved/作品", "class one", "task/two")).toBe(
    "/student/submissions/saved%2F%E4%BD%9C%E5%93%81?classroomId=class+one&classroomTaskId=task%2Ftwo",
  );
});
test("maps only actual public messages for cooldown, conflicts and late submission", () => {
  const body = (statusCode: number, message: string) => ({
    statusCode,
    timestamp: "2026-10-11T00:00:00Z",
    path: "/api/classrooms/c/tasks/t/submissions",
    message,
  });
  const cooldown =
    "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。";
  expect(getTextSubmissionError(429, body(429, cooldown))).toBe(cooldown);
  for (const message of [
    "班级已归档，不能继续提交该任务。",
    "课堂任务已关闭，不能继续提交。",
    "课堂任务内容快照缺失或无效，请联系教师核对。",
  ])
    expect(getTextSubmissionError(409, body(409, message))).toBe(message);
  expect(
    getTextSubmissionError(
      403,
      body(403, "Late submission is not allowed for this classroom task"),
    ),
  ).toBe("已截止，禁止迟交，请联系老师。");
});
test("unknown or mismatched error messages never become user-facing raw exceptions", () => {
  const unknown = "Internal exception: synthetic stack at private-service.ts";
  expect(getTextSubmissionError(403, { message: unknown })).toBe(
    "无权限提交该课堂任务。",
  );
  for (const [status, message] of [
    [429, unknown],
    [409, unknown],
    [429, "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。\n"],
    [
      429,
      "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。 " +
        unknown,
    ],
    [429, "提交过于频繁。当前设置的提交冷却时间为 0 秒，请约 3 秒后再试。"],
    [500, "课堂任务已关闭，不能继续提交。"],
  ] as const) {
    const result = getTextSubmissionError(status, { message });
    expect(result).not.toContain(unknown);
    expect(result).not.toBe(message);
  }
  expect(
    getTextSubmissionError(403, { code: "LATE_SUBMISSION_NOT_ALLOWED" }),
  ).toBe("无权限提交该课堂任务。");
});

test("submission language labels share the unchanged option values and order", () => {
  const options = [
    { value: "auto", label: "自动识别（默认）" },
    { value: "java", label: "Java" },
    { value: "javascript", label: "JavaScript" },
    { value: "typescript", label: "TypeScript" },
    { value: "python", label: "Python" },
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "other", label: "Other" },
  ];
  expect(SUBMISSION_LANGUAGE_OPTIONS).toEqual(options);
  for (const { value, label } of options) {
    expect(toDisplaySubmissionLanguage(value)).toBe(label);
    expect(toDisplaySubmissionLanguage(` \t${value.toUpperCase()}\n `)).toBe(
      label,
    );
  }
  expect(SUBMISSION_LANGUAGE_OPTIONS).toEqual(options);
});

test("submission language display preserves unknown spelling and rejects missing values", () => {
  expect(toDisplaySubmissionLanguage(" Rust ")).toBe("Rust");
  expect(toDisplaySubmissionLanguage(" CuStOm-Lang ")).toBe("CuStOm-Lang");
  for (const value of [undefined, null, "", " \t\n ", 0, true, {}, []]) {
    expect(toDisplaySubmissionLanguage(value)).toBe("—");
  }
});

test("language labels do not replace raw request or student and teacher response values", () => {
  for (const language of [
    "auto",
    "java",
    "javascript",
    "typescript",
    "python",
    "c",
    "cpp",
    "other",
    "CuStOm-Lang",
  ]) {
    expect(buildTextSubmissionRequest("code", language, "").content.language).toBe(
      language,
    );
    expect(
      buildUpdateSubmissionRequest(0, "code", language, "").content.language,
    ).toBe(language);
    const payload = { content: { language, codeText: "code" } };
    for (const detail of [
      toSubmissionDetailResponse(payload),
      toTeacherDetail(payload),
    ]) {
      expect(detail.language).toBe(language);
      expect(detail.content.language).toBe(language);
      expect(detail.raw).toBe(payload);
    }
  }
});

test("late duration keeps the existing second, minute, hour and day boundaries", () => {
  for (const [seconds, label] of [
    [0, "超时不足 1 秒"],
    [59, "超时 59 秒"],
    [60, "超时 1 分钟"],
    [61, "超时 1 分钟 1 秒"],
    [3599, "超时 59 分钟 59 秒"],
    [3600, "超时 1 小时"],
    [3661, "超时 1 小时 1 分钟"],
    [86399, "超时 23 小时 59 分钟"],
    [86400, "超时 1 天"],
    [90061, "超时 1 天 1 小时"],
    [1438856, "超时 16 天 15 小时"],
  ] as const) {
    expect(toDisplayLateDuration(seconds)).toBe(label);
  }
  for (const value of [undefined, null, "60", -1, 1.5, Number.NaN, Infinity]) {
    expect(toDisplayLateDuration(value)).toBeUndefined();
  }
});
