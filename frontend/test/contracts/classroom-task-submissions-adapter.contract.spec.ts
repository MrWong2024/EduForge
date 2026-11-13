import { test, expect } from "@playwright/test";
import { isValidPaginationTotal } from "@/lib/pagination";
import { toClassroomTaskSubmissionsResponse } from "../../lib/api/types-teacher";

// Expected values follow the locked list contract and Backend DTO
// "Submission request / response family", independently of adapter output.
test("formal lists preserve root pagination, row fields, zero feedback and null student names", () => {
  const first = Object.freeze({
    id: "submission-2",
    taskId: "template-1",
    classroomTaskId: "classroom-task-1",
    student: Object.freeze({
      id: "student-1",
      name: "张同学",
      email: "student-1@example.invalid",
      roles: Object.freeze(["STUDENT"]),
      status: "ACTIVE",
      studentNo: "S001",
      employeeNo: null,
    }),
    submittedAt: "2026-11-13T08:00:00.000Z",
    aiFeedbackStatus: "SUCCEEDED",
    attemptNo: 2,
    feedbackCount: 4,
    isLate: false,
    lateBySeconds: 0,
    status: "SUBMITTED",
  });
  const second = Object.freeze({
    id: "submission-1",
    classroomTaskId: "classroom-task-1",
    student: Object.freeze({ id: "student-2", name: null }),
    submittedAt: "2026-11-12T08:00:00.000Z",
    aiFeedbackStatus: "NOT_REQUESTED",
    attemptNo: 1,
    feedbackCount: 0,
  });
  const payload = Object.freeze({
    items: Object.freeze([first, second]),
    page: 2,
    limit: 100,
    total: 102,
  });
  const before = structuredClone(payload);
  const result = toClassroomTaskSubmissionsResponse(payload);

  expect(result).toStrictEqual({
    items: [
      {
        submissionId: "submission-2",
        classroomTaskId: "classroom-task-1",
        studentId: "student-1",
        studentName: "张同学",
        submittedAt: "2026-11-13T08:00:00.000Z",
        aiFeedbackStatus: "SUCCEEDED",
        attemptNo: 2,
        feedbackCount: 4,
        raw: first,
      },
      {
        submissionId: "submission-1",
        classroomTaskId: "classroom-task-1",
        studentId: "student-2",
        studentName: undefined,
        submittedAt: "2026-11-12T08:00:00.000Z",
        aiFeedbackStatus: "NOT_REQUESTED",
        attemptNo: 1,
        feedbackCount: 0,
        raw: second,
      },
    ],
    page: 2,
    limit: 100,
    total: 102,
    raw: payload,
  });
  expect(isValidPaginationTotal(result.total)).toBe(true);
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(first);
  expect(result.items[1].raw).toBe(second);
  expect(payload).toStrictEqual(before);
});

test("formal empty pages retain their total even when it is greater than zero", () => {
  for (const total of [0, 7]) {
    const payload = { items: [], page: 2, limit: 100, total };
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result).toStrictEqual({
      items: [],
      page: 2,
      limit: 100,
      total,
      raw: payload,
    });
    expect(isValidPaginationTotal(result.total)).toBe(true);
  }
});

test("formal sources win conflicts while raw keeps retired keys and existing string parsing", () => {
  const row = Object.freeze({
    id: " formal-submission ",
    submissionId: "legacy-submission",
    classroomTaskId: " formal-classroom-task ",
    student: Object.freeze({
      id: " formal-student ",
      name: " 正式姓名 ",
      displayName: "旧显示名",
    }),
    studentId: "legacy-student",
    studentName: "旧姓名",
    submittedAt: " formal-submitted-at ",
    createdAt: "legacy-created-at",
    aiFeedbackStatus: " PENDING ",
    ai: Object.freeze({ feedbackStatus: "FAILED" }),
    attemptNo: 0,
    feedbackCount: 0,
    feedback: Object.freeze({ count: 99 }),
    feedbackItemsCount: 98,
    feedbackSummary: Object.freeze({ totalItems: 97 }),
  });
  const payload = Object.freeze({
    items: Object.freeze([row]),
    page: 2,
    limit: 100,
    total: 1,
    pagination: Object.freeze({ page: 9, limit: 9, total: 9 }),
    data: Object.freeze({
      items: Object.freeze([{ id: "legacy-row" }]),
      page: 8,
      limit: 8,
      total: 8,
    }),
  });
  const before = structuredClone(payload);
  const result = toClassroomTaskSubmissionsResponse(payload);

  expect(result).toStrictEqual({
    items: [
      {
        submissionId: "formal-submission",
        classroomTaskId: "formal-classroom-task",
        studentId: "formal-student",
        studentName: "正式姓名",
        submittedAt: "formal-submitted-at",
        aiFeedbackStatus: "PENDING",
        attemptNo: 0,
        feedbackCount: 0,
        raw: row,
      },
    ],
    page: 2,
    limit: 100,
    total: 1,
    raw: payload,
  });
  expect(isValidPaginationTotal(result.total)).toBe(true);
  expect(result.raw).toBe(payload);
  expect(result.items[0].raw).toBe(row);
  expect(payload).toStrictEqual(before);
});

for (const { label, fields, student } of [
  { label: "missing", fields: {}, student: {} },
  {
    label: "invalid",
    fields: {
      id: 123,
      classroomTaskId: false,
      submittedAt: null,
      aiFeedbackStatus: [],
      attemptNo: "3",
      feedbackCount: "8",
    },
    student: { id: 123, name: null },
  },
  {
    label: "blank or nonfinite",
    fields: {
      id: " \t ",
      classroomTaskId: " \n ",
      submittedAt: " ",
      aiFeedbackStatus: " \t ",
      attemptNo: Number.NaN,
      feedbackCount: Number.POSITIVE_INFINITY,
    },
    student: { id: " ", name: " \t " },
  },
] as const) {
  test(`${label} formal row fields are never rescued by retired aliases`, () => {
    const row = Object.freeze({
      ...fields,
      student: Object.freeze({ displayName: "旧显示名", ...student }),
      submissionId: "legacy-submission",
      studentId: "legacy-student",
      studentName: "旧姓名",
      createdAt: "legacy-created-at",
      ai: Object.freeze({ feedbackStatus: "SUCCEEDED" }),
      feedback: Object.freeze({ count: 9 }),
      feedbackItemsCount: 8,
    });
    const payload = Object.freeze({ items: Object.freeze([row]) });
    const before = structuredClone(payload);
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result.items).toStrictEqual([
      {
        submissionId: undefined,
        classroomTaskId: undefined,
        studentId: undefined,
        studentName: undefined,
        submittedAt: undefined,
        aiFeedbackStatus: undefined,
        attemptNo: undefined,
        feedbackCount: undefined,
        raw: row,
      },
    ]);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(row);
    expect(payload).toStrictEqual(before);
  });
}

for (const { label, root, data } of [
  {
    label: "empty",
    root: { items: [] },
    data: { items: [{ id: "legacy-wrapped-row" }] },
  },
  {
    label: "missing",
    root: {},
    data: [{ id: "legacy-data-array-row" }],
  },
  {
    label: "invalid",
    root: { items: {} },
    data: { items: [{ id: "legacy-wrapped-row" }] },
  },
  {
    label: "null",
    root: { items: null },
    data: { items: [{ id: "legacy-wrapped-row" }] },
  },
] as const) {
  test(`${label} root items ignore old containers and retain independent finite root pagination`, () => {
    const payload = {
      ...root,
      data,
      page: 0,
      limit: -2,
      total: 1.5,
      pagination: { page: 9, limit: 9, total: 9 },
    };
    const before = structuredClone(payload);
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result).toStrictEqual({
      items: [],
      page: 0,
      limit: -2,
      total: 1.5,
      raw: payload,
    });
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  });
}

test("missing, null, nonfinite and numeric-string root pagination never use pagination or data fields", () => {
  for (const root of [
    {},
    { page: null, limit: null, total: null },
    {
      page: Number.NaN,
      limit: Number.POSITIVE_INFINITY,
      total: Number.NEGATIVE_INFINITY,
    },
    { page: "1", limit: "100", total: "7" },
  ]) {
    const payload = {
      ...root,
      items: [{ id: "formal-submission" }],
      pagination: { page: 2, limit: 20, total: 7 },
      data: { page: 3, limit: 30, total: 8 },
    };
    const before = structuredClone(payload);
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].submissionId).toBe("formal-submission");
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    expect(result.total).toBeUndefined();
    expect(isValidPaginationTotal(result.total)).toBe(false);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(payload.items[0]);
    expect(payload).toStrictEqual(before);
  }
});

test("finite submission totals keep mapper values while the page count guard rejects invalid counts", () => {
  const row = Object.freeze({ id: "formal-count-submission" });
  for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = Object.freeze({
      items: Object.freeze([row]),
      total,
      page: 2,
      limit: 100,
    });
    const before = structuredClone(payload);
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result.items.map((item) => item.submissionId)).toStrictEqual([
      "formal-count-submission",
    ]);
    expect(result.total).toBe(total);
    expect(isValidPaginationTotal(result.total)).toBe(false);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(100);
    expect(result.raw).toBe(payload);
    expect(result.items[0].raw).toBe(row);
    expect(payload).toStrictEqual(before);
  }
});

test("retired bare arrays and primitive payloads produce no rows or inferred pagination and keep root raw", () => {
  for (const payload of [
    [{ id: "legacy-submission" }, { id: "legacy-submission-2" }],
    null,
    undefined,
    "legacy-payload",
    0,
    false,
  ]) {
    const before = structuredClone(payload);
    const result = toClassroomTaskSubmissionsResponse(payload);

    expect(result).toStrictEqual({
      items: [],
      page: undefined,
      limit: undefined,
      total: undefined,
      raw: payload,
    });
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("missing IDs and invalid members preserve positions, duplicate students and IDs without sorting", () => {
  const first = Object.freeze({
    id: "duplicate-id",
    student: Object.freeze({ id: "same-student", name: "乙同学" }),
    submittedAt: "2026-11-12T08:00:00.000Z",
    attemptNo: -1.5,
    feedbackCount: -2.25,
  });
  const missingId = Object.freeze({
    student: Object.freeze({ id: "student-without-submission-id" }),
    submittedAt: "not-a-date",
  });
  const last = Object.freeze({
    id: "duplicate-id",
    student: Object.freeze({ id: "same-student", name: "甲同学" }),
    submittedAt: "2026-11-13T08:00:00.000Z",
  });
  const payload = Object.freeze({
    items: Object.freeze([
      first,
      null,
      missingId,
      "invalid-row",
      Object.freeze([{ id: "nested-array-row" }]),
      last,
    ]),
  });
  const before = structuredClone(payload);
  const result = toClassroomTaskSubmissionsResponse(payload);

  expect(result.items.map((item) => item.submissionId)).toStrictEqual([
    "duplicate-id",
    undefined,
    undefined,
    undefined,
    undefined,
    "duplicate-id",
  ]);
  expect(result.items[0]).toMatchObject({
    studentId: "same-student",
    attemptNo: -1.5,
    feedbackCount: -2.25,
  });
  expect(result.items[2]).toMatchObject({
    submissionId: undefined,
    studentId: "student-without-submission-id",
    submittedAt: "not-a-date",
  });
  for (const index of [1, 3, 4]) {
    expect(result.items[index]).toStrictEqual({
      submissionId: undefined,
      classroomTaskId: undefined,
      studentId: undefined,
      studentName: undefined,
      submittedAt: undefined,
      aiFeedbackStatus: undefined,
      attemptNo: undefined,
      feedbackCount: undefined,
      raw: {},
    });
  }
  expect(result.items[0].raw).toBe(first);
  expect(result.items[2].raw).toBe(missingId);
  expect(result.items[5].raw).toBe(last);
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});
