import { test, expect } from "@playwright/test";
import {
  getDashboardItems,
  toDashboardResponse,
} from "../../lib/api/types-teacher";
import {
  getTeacherDashboardSummary,
  getTeacherDashboardTaskDisplay,
} from "../../lib/teacher-dashboard";

// Fixed expectations follow the locked teacher dashboard contract and Backend
// DTO response family; numeric/title/tag cases retain the specified display rules.
test("formal teacher dashboards preserve summary, task display, archive adaptation and input references", () => {
  const task = Object.freeze({
    classroomTaskId: "classroom-task-1",
    title: "边界检查",
    classroomTaskStatus: "CLOSED",
    taskTemplateStatus: "ARCHIVED",
    taskPublisher: Object.freeze({ id: "teacher-2", name: "李老师" }),
    dueAt: null,
    distinctStudentsSubmitted: 8,
    submissionsCount: 12,
    lateDistinctStudentsCount: 2,
    lateSubmissionsCount: 3,
    aiFeedback: Object.freeze({
      succeeded: 5,
      failed: 1,
      pending: 2,
      running: 3,
      dead: 4,
      notRequested: 6,
    }),
    topTags: Object.freeze([
      Object.freeze({ tag: "readability", count: 2 }),
      Object.freeze({ tag: "logic", count: 0 }),
    ]),
  });
  const payload = Object.freeze({
    classroom: Object.freeze({ id: "classroom-1", name: "程序设计一班" }),
    summary: Object.freeze({
      studentsCount: 10,
      publishedTasksCount: 4,
      lateStudentsTotal: 2,
      lateSubmissionsTotal: 3,
    }),
    tasks: Object.freeze([task]),
    archiveSuggestion: Object.freeze({
      suggested: true,
      reason: " NO_RECENT_SUBMISSIONS ",
      message: " 建议归档 ",
      lastSubmissionAt: " 2026-11-01T09:00:00.000Z ",
      latestActiveTaskDueAt: null,
      inactiveDays: 12,
    }),
  });
  const before = structuredClone(payload);
  const dashboard = toDashboardResponse(payload);
  const items = getDashboardItems(dashboard);

  expect(getTeacherDashboardSummary(dashboard, items.length)).toStrictEqual({
    studentsCount: 10,
    publishedTasksCount: 4,
    lateStudentsTotal: 2,
  });
  expect(getTeacherDashboardTaskDisplay(items[0])).toStrictEqual({
    classroomTaskId: "classroom-task-1",
    title: "边界检查",
    submittedStudentsCount: 8,
    submissionsCount: 12,
    lateDistinctStudentsCount: 2,
    lateSubmissionsCount: 3,
    aiBreakdown: {
      succeeded: 5,
      failed: 1,
      pending: 2,
      running: 3,
      dead: 4,
      notRequested: 6,
    },
    topTags: [
      { key: "readability-0", label: "readability", count: 2 },
      { key: "logic-1", label: "logic", count: 0 },
    ],
  });
  expect(dashboard.archiveSuggestion).toStrictEqual({
    suggested: true,
    reason: "NO_RECENT_SUBMISSIONS",
    message: "建议归档",
    lastSubmissionAt: "2026-11-01T09:00:00.000Z",
    latestActiveTaskDueAt: null,
    inactiveDays: 12,
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toBe(task);
  expect(dashboard.tasks).toBe(payload.tasks);
  expect(dashboard.classroom).toBe(payload.classroom);
  expect(dashboard.summary).toBe(payload.summary);
  expect(dashboard).not.toHaveProperty("raw");
  expect(payload).toStrictEqual(before);
});

test("legal empty tasks and omitted late totals keep the existing empty-state defaults", () => {
  const payload = Object.freeze({
    summary: Object.freeze({ studentsCount: 0, publishedTasksCount: 0 }),
    tasks: Object.freeze([]),
    lateStudentsTotal: 99,
    items: Object.freeze([{ classroomTaskId: "legacy-task" }]),
  });
  const dashboard = toDashboardResponse(payload);
  const items = getDashboardItems(dashboard);

  expect(items).toStrictEqual([]);
  expect(getTeacherDashboardSummary(dashboard, items.length)).toStrictEqual({
    studentsCount: 0,
    publishedTasksCount: 0,
    lateStudentsTotal: 0,
  });
  expect(dashboard).toBe(payload);
});

test("formal sources and real zeroes win over conflicting wrappers and aliases", () => {
  const task = Object.freeze({
    classroomTaskId: " formal-task ",
    id: "legacy-task",
    title: " 正式任务 ",
    name: "旧任务",
    distinctStudentsSubmitted: 0,
    submissionsCount: 0,
    lateDistinctStudentsCount: 0,
    lateSubmissionsCount: 0,
    aiFeedback: Object.freeze({
      succeeded: 0,
      failed: 0,
      pending: 0,
      running: 0,
      dead: 0,
      notRequested: 0,
      SUCCEEDED: 99,
      FAILED: 99,
      PENDING: 99,
      RUNNING: 99,
      DEAD: 99,
      NOT_REQUESTED: 99,
    }),
    aiStatusBreakdown: Object.freeze({
      SUCCEEDED: 88,
      FAILED: 88,
      PENDING: 88,
      RUNNING: 88,
      DEAD: 88,
      NOT_REQUESTED: 88,
    }),
    topTags: Object.freeze([
      Object.freeze({
        tag: " formal-tag ",
        name: "old-name",
        label: "old-label",
        count: 0,
      }),
    ]),
  });
  const payload = Object.freeze({
    summary: Object.freeze({
      studentsCount: 0,
      publishedTasksCount: 0,
      lateStudentsTotal: 0,
    }),
    studentsCount: 77,
    publishedTasksCount: 77,
    lateStudentsTotal: 77,
    tasks: Object.freeze([task]),
    items: Object.freeze([{ classroomTaskId: "legacy-items" }]),
    data: Object.freeze({
      items: Object.freeze([{ classroomTaskId: "legacy-data-items" }]),
      tasks: Object.freeze([{ classroomTaskId: "legacy-data-tasks" }]),
    }),
  });
  const before = structuredClone(payload);
  const dashboard = toDashboardResponse(payload);
  const items = getDashboardItems(dashboard);

  expect(getTeacherDashboardSummary(dashboard, items.length)).toStrictEqual({
    studentsCount: 0,
    publishedTasksCount: 0,
    lateStudentsTotal: 0,
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toBe(task);
  expect(getTeacherDashboardTaskDisplay(items[0])).toStrictEqual({
    classroomTaskId: "formal-task",
    title: "正式任务",
    submittedStudentsCount: 0,
    submissionsCount: 0,
    lateDistinctStudentsCount: 0,
    lateSubmissionsCount: 0,
    aiBreakdown: {
      succeeded: 0,
      failed: 0,
      pending: 0,
      running: 0,
      dead: 0,
      notRequested: 0,
    },
    topTags: [{ key: "formal-tag-0", label: "formal-tag", count: 0 }],
  });
  expect(dashboard).toBe(payload);
  expect(dashboard.items).toBe(payload.items);
  expect(items[0].id).toBe("legacy-task");
  expect(payload).toStrictEqual(before);
});

for (const [label, payload] of [
  ["items", { items: [{ classroomTaskId: "legacy" }] }],
  ["data.items", { data: { items: [{ classroomTaskId: "legacy" }] } }],
  ["data.tasks", { data: { tasks: [{ classroomTaskId: "legacy" }] } }],
] as const) {
  test(`retired ${label} cannot supply teacher dashboard rows`, () => {
    const dashboard = toDashboardResponse(payload);

    expect(getDashboardItems(dashboard)).toStrictEqual([]);
    expect(dashboard).toBe(payload);
  });
}

test("empty, missing or invalid root tasks never recover rows from legacy containers", () => {
  for (const tasks of [[], undefined, null, {}, "legacy-list"]) {
    const payload = {
      tasks,
      items: [{ classroomTaskId: "legacy-items" }],
      data: {
        items: [{ classroomTaskId: "legacy-data-items" }],
        tasks: [{ classroomTaskId: "legacy-data-tasks" }],
      },
    };
    const before = structuredClone(payload);
    const dashboard = toDashboardResponse(payload);

    expect(getDashboardItems(dashboard)).toStrictEqual([]);
    expect(payload).toStrictEqual(before);
  }
});

test("unavailable formal summary fields use only defaults and the selected task count", () => {
  for (const summary of [
    undefined,
    null,
    {},
    {
      studentsCount: "bad",
      publishedTasksCount: Number.NaN,
      lateStudentsTotal: false,
    },
    {
      studentsCount: " ",
      publishedTasksCount: null,
      lateStudentsTotal: Number.POSITIVE_INFINITY,
    },
  ]) {
    const dashboard = toDashboardResponse({
      summary,
      studentsCount: 99,
      publishedTasksCount: 99,
      lateStudentsTotal: 99,
      tasks: [{ classroomTaskId: "task-1" }, { classroomTaskId: "task-2" }],
      items: [{ classroomTaskId: "legacy" }],
    });
    const items = getDashboardItems(dashboard);

    expect(getTeacherDashboardSummary(dashboard, items.length)).toStrictEqual({
      studentsCount: 0,
      publishedTasksCount: 2,
      lateStudentsTotal: 0,
    });
  }
});

test("numeric display keeps finite parsing, truncation, nonnegative values and existing defaults", () => {
  for (const [value, count, publishedCount] of [
    [3.9, 3, 3],
    [" 4.8 ", 4, 4],
    [-2.7, 0, 0],
    ["-1.1", 0, 0],
    ["0", 0, 0],
    [" ", 0, 1],
    [Number.NaN, 0, 1],
    [Number.POSITIVE_INFINITY, 0, 1],
    [false, 0, 1],
    ["2bad", 0, 1],
  ] as const) {
    const dashboard = toDashboardResponse({
      summary: {
        studentsCount: value,
        publishedTasksCount: value,
        lateStudentsTotal: value,
      },
      tasks: [
        {
          distinctStudentsSubmitted: value,
          submissionsCount: value,
          lateDistinctStudentsCount: value,
          lateSubmissionsCount: value,
          aiFeedback: {
            succeeded: value,
            failed: value,
            pending: value,
            running: value,
            dead: value,
            notRequested: value,
          },
        },
      ],
    });
    const items = getDashboardItems(dashboard);

    expect(getTeacherDashboardSummary(dashboard, items.length)).toStrictEqual({
      studentsCount: count,
      publishedTasksCount: publishedCount,
      lateStudentsTotal: count,
    });
    expect(getTeacherDashboardTaskDisplay(items[0])).toMatchObject({
      submittedStudentsCount: count,
      submissionsCount: count,
      lateDistinctStudentsCount: count,
      lateSubmissionsCount: count,
      aiBreakdown: {
        succeeded: count,
        failed: count,
        pending: count,
        running: count,
        dead: count,
        notRequested: count,
      },
    });
  }
});

test("missing, invalid or blank formal identity fields never use task id or name aliases", () => {
  for (const [classroomTaskId, title] of [
    [undefined, undefined],
    [123, {}],
    [" \t ", " \n "],
  ]) {
    const task = { classroomTaskId, title, id: "legacy-id", name: "旧标题" };
    const dashboard = toDashboardResponse({ tasks: [task] });
    const items = getDashboardItems(dashboard);

    expect(items).toHaveLength(1);
    expect(items[0]).toBe(task);
    expect(getTeacherDashboardTaskDisplay(items[0])).toMatchObject({
      classroomTaskId: undefined,
      title: "未命名任务",
    });
  }
});

test("formal titles retain existing number and boolean display behavior", () => {
  for (const [title, expected] of [
    [0, "0"],
    [7.5, "7.5"],
    [true, "是"],
    [false, "否"],
  ] as const) {
    const items = getDashboardItems(toDashboardResponse({ tasks: [{ title }] }));

    expect(getTeacherDashboardTaskDisplay(items[0]).title).toBe(expected);
  }
});

test("missing or invalid lowercase AI counts never use uppercase or breakdown aliases", () => {
  for (const aiFeedback of [
    undefined,
    {
      SUCCEEDED: 9,
      FAILED: 9,
      PENDING: 9,
      RUNNING: 9,
      DEAD: 9,
      NOT_REQUESTED: 9,
    },
    {
      succeeded: "bad",
      failed: null,
      pending: Number.NaN,
      running: false,
      dead: {},
      notRequested: " ",
      SUCCEEDED: 9,
      FAILED: 9,
      PENDING: 9,
      RUNNING: 9,
      DEAD: 9,
      NOT_REQUESTED: 9,
    },
  ]) {
    const items = getDashboardItems(
      toDashboardResponse({
        tasks: [
          {
            aiFeedback,
            aiStatusBreakdown: {
              SUCCEEDED: 8,
              FAILED: 8,
              PENDING: 8,
              RUNNING: 8,
              DEAD: 8,
              NOT_REQUESTED: 8,
            },
          },
        ],
      }),
    );

    expect(getTeacherDashboardTaskDisplay(items[0]).aiBreakdown).toStrictEqual({
      succeeded: 0,
      failed: 0,
      pending: 0,
      running: 0,
      dead: 0,
      notRequested: 0,
    });
  }
});

test("formal tags keep trim, case-insensitive order, original-index keys and the three-tag limit", () => {
  const task = Object.freeze({
    topTags: Object.freeze([
      Object.freeze({ tag: " Readability ", count: 0 }),
      Object.freeze({ tag: "READABILITY", count: 99 }),
      Object.freeze({ name: "legacy-name", count: 2 }),
      Object.freeze({ label: "legacy-label", count: 3 }),
      "legacy-string",
      Object.freeze({ tag: " Custom ", count: "2.9" }),
      Object.freeze({ tag: "missing-count" }),
      Object.freeze({ tag: "fourth-tag", count: 4 }),
    ]),
  });
  const before = structuredClone(task);

  expect(getTeacherDashboardTaskDisplay(task).topTags).toStrictEqual([
    { key: "readability-0", label: "Readability", count: 0 },
    { key: "custom-5", label: "Custom", count: 2 },
    { key: "missing-count-6", label: "missing-count", count: undefined },
  ]);
  expect(task).toStrictEqual(before);
});

test("unavailable tags and legacy tag shapes produce the existing no-tags result", () => {
  for (const topTags of [
    undefined,
    null,
    {},
    [],
    ["legacy-string", { name: "legacy-name" }, { label: "legacy-label" }],
    [
      { tag: " ", name: "legacy-name" },
      { tag: 7, label: "legacy-label" },
      null,
      [],
    ],
  ]) {
    expect(getTeacherDashboardTaskDisplay({ topTags }).topTags).toStrictEqual([]);
  }
});

test("archive adaptation keeps nullable defaults and leaves absent or empty suggestions untouched", () => {
  const payload = Object.freeze({
    archiveSuggestion: Object.freeze({
      suggested: "true",
      reason: "unknown",
      message: " ",
      lastSubmissionAt: 123,
      latestActiveTaskDueAt: null,
      inactiveDays: "5",
    }),
    tasks: Object.freeze([]),
    items: Object.freeze([{ id: "legacy-row" }]),
  });
  const before = structuredClone(payload);
  const dashboard = toDashboardResponse(payload);

  expect(dashboard.archiveSuggestion).toStrictEqual({
    suggested: false,
    reason: null,
    message: null,
    lastSubmissionAt: null,
    latestActiveTaskDueAt: null,
    inactiveDays: null,
  });
  expect(dashboard.tasks).toBe(payload.tasks);
  expect(dashboard.items).toBe(payload.items);
  expect(dashboard).not.toHaveProperty("raw");
  expect(payload).toStrictEqual(before);

  for (const archiveSuggestion of [undefined, null, {}]) {
    const emptyPayload = { tasks: [], archiveSuggestion };

    expect(toDashboardResponse(emptyPayload)).toBe(emptyPayload);
    expect(emptyPayload.archiveSuggestion).toBe(archiveSuggestion);
  }
});
