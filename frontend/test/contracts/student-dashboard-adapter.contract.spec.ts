import { test, expect } from "@playwright/test";
import { toStudentDashboardResponse } from "../../lib/api/types-student";
import { isValidPaginationTotal } from "../../lib/pagination";

// Expected values follow the locked dashboard contract and Backend DTO
// "Teacher / Student Dashboard response family" / completion public state.
test("formal dashboards preserve summaries, submissions, completion, nulls and source references", () => {
  const latest = Object.freeze({
    submissionId: "submission-1",
    attemptNo: 2,
    createdAt: "2026-11-12T09:00:00.000Z",
    aiFeedbackStatus: "SUCCEEDED",
  });
  const submitted = Object.freeze({
    classroomTaskId: "classroom-task-1",
    taskId: "task-1",
    title: "边界检查",
    publishedAt: "2026-11-10T09:00:00.000Z",
    dueAt: "2026-11-15T09:00:00.000Z",
    myLatestSubmission: latest,
    mySubmissionsCount: 2,
    studentVisibilityStatus: "RECENTLY_EXPIRED",
    isHistorical: false,
    completionStatus: Object.freeze({
      status: "QUALIFIED_WITH_WARNINGS",
      severity: "WARN",
      source: "TEACHER",
      latestSubmissionId: "submission-1",
      teacherFeedbackCount: 2,
      aiFeedbackCount: 1,
      teacherWorstSeverity: "WARN",
      aiWorstSeverity: "ERROR",
    }),
  });
  const unsubmitted = Object.freeze({
    classroomTaskId: "classroom-task-2",
    taskId: "task-2",
    title: "空态任务",
    publishedAt: null,
    dueAt: null,
    myLatestSubmission: null,
    mySubmissionsCount: 0,
    studentVisibilityStatus: "CURRENT",
    isHistorical: false,
    completionStatus: Object.freeze({
      status: "NOT_SUBMITTED",
      severity: null,
      source: null,
      latestSubmissionId: null,
      teacherFeedbackCount: 0,
      aiFeedbackCount: 0,
      teacherWorstSeverity: null,
      aiWorstSeverity: null,
    }),
  });
  const row = Object.freeze({
    classroom: Object.freeze({
      id: "classroom-1",
      name: "程序设计一班",
      courseId: "course-1",
      status: "ACTIVE",
      teacher: Object.freeze({
        id: "teacher-1",
        name: "王老师",
        employeeNo: "T001",
      }),
      course: Object.freeze({
        id: "course-1",
        name: "程序设计",
        term: "2026 秋",
        code: "CS101",
      }),
    }),
    tasks: Object.freeze([submitted, unsubmitted]),
  });
  const emptyRow = Object.freeze({
    classroom: Object.freeze({
      id: "classroom-2",
      name: "历史班级",
      courseId: "course-2",
      status: "ARCHIVED",
      teacher: Object.freeze({ id: "teacher-2", name: null, employeeNo: null }),
      course: Object.freeze({
        id: "course-2",
        name: null,
        term: null,
        code: null,
      }),
    }),
    tasks: Object.freeze([]),
  });
  const payload = Object.freeze({
    items: Object.freeze([row, emptyRow]),
    total: 2,
    page: 1,
    limit: 20,
  });
  const before = structuredClone(payload);
  const result = toStudentDashboardResponse(payload);

  expect(isValidPaginationTotal(result.total)).toBe(true);
  expect(result).toMatchObject({
    total: 2,
    page: 1,
    limit: 20,
    items: [
      {
        classroomId: "classroom-1",
        classroomName: "程序设计一班",
        courseId: "course-1",
        status: "ACTIVE",
        teacher: { id: "teacher-1", name: "王老师", employeeNo: "T001" },
        course: {
          id: "course-1",
          name: "程序设计",
          term: "2026 秋",
          code: "CS101",
        },
        tasks: [
          {
            classroomTaskId: "classroom-task-1",
            taskId: "task-1",
            title: "边界检查",
            publishedAt: "2026-11-10T09:00:00.000Z",
            dueAt: "2026-11-15T09:00:00.000Z",
            myLatestSubmission: {
              submissionId: "submission-1",
              attemptNo: 2,
              createdAt: "2026-11-12T09:00:00.000Z",
              aiFeedbackStatus: "SUCCEEDED",
            },
            mySubmissionsCount: 2,
            aiFeedbackStatus: "SUCCEEDED",
            studentVisibilityStatus: "RECENTLY_EXPIRED",
            isHistorical: false,
            completionStatus: {
              status: "QUALIFIED_WITH_WARNINGS",
              severity: "WARN",
              source: "TEACHER",
              latestSubmissionId: "submission-1",
              teacherFeedbackCount: 2,
              aiFeedbackCount: 1,
              teacherWorstSeverity: "WARN",
              aiWorstSeverity: "ERROR",
            },
          },
          {
            classroomTaskId: "classroom-task-2",
            taskId: "task-2",
            title: "空态任务",
            publishedAt: undefined,
            dueAt: undefined,
            myLatestSubmission: null,
            mySubmissionsCount: 0,
            aiFeedbackStatus: undefined,
            studentVisibilityStatus: "CURRENT",
            isHistorical: false,
            completionStatus: {
              status: "NOT_SUBMITTED",
              severity: null,
              source: null,
              latestSubmissionId: null,
              teacherFeedbackCount: 0,
              aiFeedbackCount: 0,
              teacherWorstSeverity: null,
              aiWorstSeverity: null,
            },
          },
        ],
      },
      {
        classroomId: "classroom-2",
        classroomName: "历史班级",
        courseId: "course-2",
        status: "ARCHIVED",
        teacher: { id: "teacher-2", name: null, employeeNo: null },
        course: { id: "course-2", name: null, term: null, code: null },
        tasks: [],
      },
    ],
  });
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(row);
  expect(result.items[1].raw).toBe(emptyRow);
  expect(result.items[0].tasks[0].raw).toBe(submitted);
  expect(result.items[0].tasks[1].raw).toBe(unsubmitted);
  expect(result.items[0].tasks[0].myLatestSubmission?.raw).toBe(latest);
  expect(payload).toStrictEqual(before);
});

test("formal dashboard completion states retain all exact severities and sources", () => {
  const completions = Object.freeze([
    {
      status: "NOT_SUBMITTED",
      severity: null,
      source: null,
      latestSubmissionId: null,
      teacherFeedbackCount: 0,
      aiFeedbackCount: 0,
      teacherWorstSeverity: null,
      aiWorstSeverity: null,
    },
    {
      status: "NO_FEEDBACK",
      severity: null,
      source: null,
      latestSubmissionId: "submission-no-feedback",
      teacherFeedbackCount: 0,
      aiFeedbackCount: 0,
      teacherWorstSeverity: null,
      aiWorstSeverity: null,
    },
    {
      status: "QUALIFIED",
      severity: "INFO",
      source: "AI",
      latestSubmissionId: "submission-qualified",
      teacherFeedbackCount: 0,
      aiFeedbackCount: 1,
      teacherWorstSeverity: null,
      aiWorstSeverity: "INFO",
    },
    {
      status: "QUALIFIED_WITH_WARNINGS",
      severity: "WARN",
      source: "TEACHER",
      latestSubmissionId: "submission-warnings",
      teacherFeedbackCount: 1,
      aiFeedbackCount: 0,
      teacherWorstSeverity: "WARN",
      aiWorstSeverity: null,
    },
    {
      status: "UNQUALIFIED",
      severity: "ERROR",
      source: "AI",
      latestSubmissionId: "submission-unqualified",
      teacherFeedbackCount: 0,
      aiFeedbackCount: 1,
      teacherWorstSeverity: null,
      aiWorstSeverity: "ERROR",
    },
  ]);
  const tasks = Object.freeze(
    completions.map((completionStatus) => ({
      completionStatus,
      myLatestSubmission:
        completionStatus.latestSubmissionId === null
          ? null
          : { submissionId: completionStatus.latestSubmissionId },
    })),
  );
  const row = Object.freeze({ tasks });
  const payload = Object.freeze({ items: Object.freeze([row]) });
  const before = structuredClone(payload);
  const result = toStudentDashboardResponse(payload);

  expect(result.items[0].tasks.map((task) => task.completionStatus)).toStrictEqual(
    completions,
  );
  expect(result.items[0].tasks).toHaveLength(5);
  expect(result.items[0].tasks[0].myLatestSubmission).toBeNull();
  for (const [index, task] of result.items[0].tasks.entries()) {
    expect(task.raw).toBe(tasks[index]);
  }
  expect(result.items[0].raw).toBe(row);
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

test("formal dashboard visibility states retain their independent historical flags", () => {
  const tasks = Object.freeze([
    { studentVisibilityStatus: "CURRENT", isHistorical: false },
    { studentVisibilityStatus: "RECENTLY_EXPIRED", isHistorical: false },
    { studentVisibilityStatus: "HISTORICAL", isHistorical: true },
  ]);
  const payload = Object.freeze({ items: Object.freeze([{ tasks }]) });
  const before = structuredClone(payload);
  const result = toStudentDashboardResponse(payload);

  expect(
    result.items[0].tasks.map((task) => ({
      studentVisibilityStatus: task.studentVisibilityStatus,
      isHistorical: task.isHistorical,
    })),
  ).toStrictEqual(tasks);
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

test("formal fields win over conflicting wrappers, aliases and task-level AI status", () => {
  const latest = Object.freeze({
    submissionId: " formal-submission ",
    id: "legacy-submission",
    attemptNo: 0,
    createdAt: " formal-created-at ",
    aiFeedbackStatus: " PENDING ",
  });
  const task = Object.freeze({
    classroomTaskId: " formal-classroom-task ",
    id: "legacy-task",
    taskId: " formal-task ",
    title: " 正式任务 ",
    name: "旧任务",
    myLatestSubmission: latest,
    mySubmissionsCount: 0,
    aiFeedbackStatus: "SUCCEEDED",
    isHistorical: false,
  });
  const row = Object.freeze({
    classroom: Object.freeze({
      id: " formal-classroom ",
      name: " 正式班级 ",
      courseId: " formal-course ",
      status: " ACTIVE ",
    }),
    classroomId: "legacy-classroom",
    id: "legacy-row",
    classroomName: "旧班级",
    courseId: "legacy-course",
    status: "ARCHIVED",
    tasks: Object.freeze([task]),
  });
  const payload = Object.freeze({
    items: Object.freeze([row]),
    total: 0,
    page: 0,
    limit: 0,
    data: Object.freeze({
      items: Object.freeze([{ id: "legacy-data" }]),
      total: 99,
      page: 99,
      limit: 99,
    }),
  });
  const before = structuredClone(payload);
  const result = toStudentDashboardResponse(payload);

  expect(isValidPaginationTotal(result.total)).toBe(true);
  expect(result).toMatchObject({ total: 0, page: 0, limit: 0 });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    classroomId: "formal-classroom",
    classroomName: "正式班级",
    courseId: "formal-course",
    status: "ACTIVE",
    tasks: [
      {
        classroomTaskId: "formal-classroom-task",
        taskId: "formal-task",
        title: "正式任务",
        mySubmissionsCount: 0,
        isHistorical: false,
        aiFeedbackStatus: "PENDING",
        myLatestSubmission: {
          submissionId: "formal-submission",
          attemptNo: 0,
          createdAt: "formal-created-at",
          aiFeedbackStatus: "PENDING",
        },
      },
    ],
  });
  expect(result.items[0].tasks[0].completionStatus).toBeUndefined();
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(row);
  expect(result.items[0].tasks[0].raw).toBe(task);
  expect(result.items[0].tasks[0].myLatestSubmission?.raw).toBe(latest);
  expect(payload).toStrictEqual(before);
});

for (const [label, payload] of [
  ["bare array", [{ classroom: { id: "legacy" }, tasks: [] }]],
  ["data.items", { data: { items: [{ classroom: { id: "legacy" } }] } }],
  ["data array", { data: [{ classroom: { id: "legacy" } }] }],
] as const) {
  test(`retired ${label} cannot supply dashboard rows`, () => {
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.items).toEqual([]);
    expect(result.total).toBeUndefined();
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    if (label === "bare array") {
      expect(result.raw).toStrictEqual({});
      expect(result.raw).not.toBe(payload);
    } else {
      expect(result.raw).toBe(payload);
    }
    expect(payload).toStrictEqual(before);
  });
}

test("empty, missing or invalid root items never fall back to old containers", () => {
  for (const items of [[], undefined, null, {}, "legacy-list"]) {
    for (const data of [
      { items: [{ classroom: { id: "legacy-classroom" } }] },
      [{ classroom: { id: "legacy-classroom" } }],
    ]) {
      const payload = { items, data, total: 0, page: 1, limit: 20 };
      const result = toStudentDashboardResponse(payload);

      expect(result.items).toEqual([]);
      expect(result).toMatchObject({ total: 0, page: 1, limit: 20 });
      expect(isValidPaginationTotal(result.total)).toBe(true);
      expect(result.raw).toBe(payload);
    }
  }
});

test("pagination keeps finite root numbers without using nested numbers or coercion", () => {
  const row = Object.freeze({
    classroom: Object.freeze({ id: "classroom-total" }),
    tasks: Object.freeze([]),
  });

  for (const total of [undefined, null, "4", Number.NaN, Infinity]) {
    const payload = Object.freeze({
      items: Object.freeze([row]),
      ...(total === undefined ? {} : { total }),
      page: Number.NaN,
      limit: Number.POSITIVE_INFINITY,
      data: Object.freeze({ total: 4, page: 2, limit: 20 }),
      pagination: Object.freeze({ total: 4 }),
    });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.total).toBeUndefined();
    expect(isValidPaginationTotal(result.total)).toBe(false);
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].raw).toBe(row);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }

  for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = Object.freeze({
      items: Object.freeze([row]),
      total,
      page: 1.5,
      limit: 0,
      data: Object.freeze({ total: 4 }),
      pagination: Object.freeze({ total: 4 }),
    });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result).toMatchObject({ total, page: 1.5, limit: 0 });
    expect(isValidPaginationTotal(result.total)).toBe(false);
    expect(result.items[0].raw).toBe(row);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("empty dashboard items accept a positive formal total without a row-count consistency rule", () => {
  const payload = Object.freeze({
    items: Object.freeze([]),
    total: 11,
    page: 3,
    limit: 100,
    data: Object.freeze({ total: 99 }),
    pagination: Object.freeze({ total: 88 }),
  });
  const before = structuredClone(payload);
  const result = toStudentDashboardResponse(payload);

  expect(result.items).toStrictEqual([]);
  expect(result).toMatchObject({ total: 11, page: 3, limit: 100 });
  expect(isValidPaginationTotal(result.total)).toBe(true);
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

for (const [label, formalValue] of [
  ["missing", undefined],
  ["invalid", 123],
  ["blank", " \t\n "],
] as const) {
  test(`${label} formal fields are not rescued by aliases and do not remove rows`, () => {
    const latest = Object.freeze({
      submissionId: formalValue,
      id: "legacy-submission",
      attemptNo: 3,
      createdAt: "2026-11-12T09:00:00.000Z",
    });
    const task = Object.freeze({
      classroomTaskId: formalValue,
      title: formalValue,
      id: "legacy-task",
      name: "旧任务",
      myLatestSubmission: latest,
      aiFeedbackStatus: "SUCCEEDED",
    });
    const row = Object.freeze({
      classroom: Object.freeze({
        id: formalValue,
        name: formalValue,
        courseId: formalValue,
        status: formalValue,
      }),
      classroomId: "legacy-classroom",
      id: "legacy-row",
      classroomName: "旧班级",
      courseId: "legacy-course",
      status: "ACTIVE",
      tasks: Object.freeze([task]),
    });
    const payload = Object.freeze({ items: Object.freeze([row]) });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      classroomId: undefined,
      classroomName: undefined,
      courseId: undefined,
      status: undefined,
      tasks: [
        {
          classroomTaskId: undefined,
          title: undefined,
          aiFeedbackStatus: undefined,
          myLatestSubmission: {
            submissionId: undefined,
            attemptNo: 3,
            createdAt: "2026-11-12T09:00:00.000Z",
          },
        },
      ],
    });
    expect(result.items[0].tasks[0].myLatestSubmission).not.toBeNull();
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(row);
    expect(result.items[0].tasks[0].raw).toBe(task);
    expect(result.items[0].tasks[0].myLatestSubmission?.raw).toBe(latest);
    expect(payload).toStrictEqual(before);
  });
}

test("missing or invalid classroom objects leave root aliases unused and preserve root tasks", () => {
  for (const classroom of [undefined, null, "legacy", []]) {
    const result = toStudentDashboardResponse({
      items: [
        {
          classroom,
          classroomId: "legacy-classroom",
          id: "legacy-row",
          classroomName: "旧班级",
          courseId: "legacy-course",
          status: "ACTIVE",
          tasks: [{ classroomTaskId: "formal-task" }],
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      classroomId: undefined,
      classroomName: undefined,
      courseId: undefined,
      status: undefined,
      teacher: { id: "", name: null, employeeNo: null },
      course: { id: "", name: null, term: null, code: null },
      tasks: [{ classroomTaskId: "formal-task" }],
    });
  }
});

test("absent or empty latest submissions remain null and never use root AI status", () => {
  for (const myLatestSubmission of [undefined, null, {}]) {
    const result = toStudentDashboardResponse({
      items: [{ tasks: [{ myLatestSubmission, aiFeedbackStatus: "SUCCEEDED" }] }],
    });

    expect(result.items[0].tasks[0].myLatestSubmission).toBeNull();
    expect(result.items[0].tasks[0].aiFeedbackStatus).toBeUndefined();
    expect(result.items[0].tasks[0].completionStatus).toBeUndefined();
  }
});

test("a latest submission without usable AI status stays present without root AI rescue", () => {
  for (const aiFeedbackStatus of [undefined, null, 123, " \t "]) {
    const latest = { submissionId: "submission-1", aiFeedbackStatus };
    const result = toStudentDashboardResponse({
      items: [
        { tasks: [{ myLatestSubmission: latest, aiFeedbackStatus: "FAILED" }] },
      ],
    });

    expect(result.items[0].tasks[0].myLatestSubmission).toMatchObject({
      submissionId: "submission-1",
      aiFeedbackStatus: undefined,
    });
    expect(result.items[0].tasks[0].aiFeedbackStatus).toBeUndefined();
    expect(result.items[0].tasks[0].myLatestSubmission?.raw).toBe(latest);
  }
});

test("completion remains an independent formal projection with the existing parsing defaults", () => {
  const result = toStudentDashboardResponse({
    items: [
      {
        tasks: [
          {
            myLatestSubmission: {
              submissionId: "submission-1",
              aiFeedbackStatus: "SUCCEEDED",
            },
            mySubmissionsCount: 10,
            completionStatus: {
              status: "NO_FEEDBACK",
              severity: null,
              source: null,
              latestSubmissionId: " submission-1 ",
              teacherFeedbackCount: 0,
              aiFeedbackCount: 0,
              teacherWorstSeverity: null,
              aiWorstSeverity: null,
            },
          },
          {
            myLatestSubmission: { aiFeedbackStatus: "SUCCEEDED" },
            mySubmissionsCount: 1,
            completionStatus: { status: "unknown" },
          },
          {
            myLatestSubmission: { aiFeedbackStatus: "FAILED" },
            studentVisibilityStatus: "HISTORICAL",
            isHistorical: true,
            completionStatus: {
              status: "QUALIFIED",
              severity: "unknown",
              source: "unknown",
              latestSubmissionId: null,
              teacherFeedbackCount: "2",
              aiFeedbackCount: Number.NaN,
              teacherWorstSeverity: "unknown",
              aiWorstSeverity: "unknown",
            },
          },
        ],
      },
    ],
  });

  expect(result.items[0].tasks[0].completionStatus).toStrictEqual({
    status: "NO_FEEDBACK",
    severity: null,
    source: null,
    latestSubmissionId: "submission-1",
    teacherFeedbackCount: 0,
    aiFeedbackCount: 0,
    teacherWorstSeverity: null,
    aiWorstSeverity: null,
  });
  expect(result.items[0].tasks[1].completionStatus).toBeUndefined();
  expect(result.items[0].tasks[2].completionStatus).toStrictEqual({
    status: "QUALIFIED",
    severity: null,
    source: null,
    latestSubmissionId: null,
    teacherFeedbackCount: 0,
    aiFeedbackCount: 0,
    teacherWorstSeverity: null,
    aiWorstSeverity: null,
  });
  expect(result.items[0].tasks[2]).toMatchObject({
    studentVisibilityStatus: "HISTORICAL",
    isHistorical: true,
  });
});

test("invalid dashboard completion states cannot be repaired by trimming, counts, submissions or old wrappers", () => {
  for (const status of [
    undefined,
    null,
    "",
    " \t\n ",
    " QUALIFIED ",
    " NO_FEEDBACK ",
    "qualified",
    "No_Feedback",
    "UNKNOWN",
    7,
    true,
    ["QUALIFIED"],
    {},
  ]) {
    const latest = Object.freeze({
      submissionId: "submission-existing",
      aiFeedbackStatus: "SUCCEEDED",
    });
    const task = Object.freeze({
      myLatestSubmission: latest,
      mySubmissionsCount: 2,
      completionStatus: Object.freeze({
        status,
        severity: "INFO",
        source: "AI",
        teacherFeedbackCount: 0,
        aiFeedbackCount: 3,
        data: Object.freeze({ status: "QUALIFIED" }),
      }),
      data: Object.freeze({ completionStatus: { status: "QUALIFIED" } }),
    });
    const row = Object.freeze({ tasks: Object.freeze([task]) });
    const payload = Object.freeze({ items: Object.freeze([row]) });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].tasks).toHaveLength(1);
    expect(result.items[0].tasks[0].completionStatus).toBeUndefined();
    expect(result.items[0].tasks[0].mySubmissionsCount).toBe(2);
    expect(result.items[0].tasks[0].myLatestSubmission?.raw).toBe(latest);
    expect(result.items[0].tasks[0].raw).toBe(task);
    expect(result.items[0].raw).toBe(row);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("each invalid completion companion becomes null without changing other dashboard fields", () => {
  const formal = Object.freeze({
    status: "QUALIFIED_WITH_WARNINGS",
    severity: "WARN",
    source: "TEACHER",
    latestSubmissionId: "submission-1",
    teacherFeedbackCount: 2,
    aiFeedbackCount: 1,
    teacherWorstSeverity: "WARN",
    aiWorstSeverity: "ERROR",
  });
  for (const [field, value] of [
    ["severity", " WARN "],
    ["source", " TEACHER "],
    ["teacherWorstSeverity", " WARN "],
    ["aiWorstSeverity", " ERROR "],
  ] as const) {
    const task = Object.freeze({
      completionStatus: Object.freeze({ ...formal, [field]: value }),
    });
    const payload = Object.freeze({ items: Object.freeze([{ tasks: [task] }]) });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.items[0].tasks[0].completionStatus).toStrictEqual({
      ...formal,
      [field]: null,
    });
    expect(result.items[0].tasks[0].raw).toBe(task);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("invalid dashboard visibility keeps rows and independent historical flags without old-source rescue", () => {
  for (const [studentVisibilityStatus, isHistorical] of [
    [undefined, true],
    [null, false],
    ["", true],
    [" \t ", false],
    [" CURRENT ", true],
    ["historical", false],
    ["UNKNOWN", true],
    [7, false],
    [true, true],
    [["CURRENT"], false],
    [{}, true],
  ] as const) {
    const task = Object.freeze({
      studentVisibilityStatus,
      isHistorical,
      data: Object.freeze({ studentVisibilityStatus: "CURRENT" }),
    });
    const row = Object.freeze({ tasks: Object.freeze([task]) });
    const payload = Object.freeze({ items: Object.freeze([row]) });
    const before = structuredClone(payload);
    const result = toStudentDashboardResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].tasks).toHaveLength(1);
    expect(result.items[0].tasks[0]).toMatchObject({
      classroomTaskId: undefined,
      studentVisibilityStatus: undefined,
      isHistorical,
    });
    expect(result.items[0].tasks[0].raw).toBe(task);
    expect(result.items[0].raw).toBe(row);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});
