import { test, expect } from "@playwright/test";
import {
  toExportSnapshotResponse,
  toProcessAssessmentResponse,
  toReviewPackResponse,
  toWeeklyReportResponse,
} from "../../lib/api/types-teacher";

test("weekly reports preserve formal groups, zero values and source references despite legacy conflicts", () => {
  const classroom = Object.freeze({
    id: "classroom-weekly",
    name: "正式班级",
    courseId: "course-1",
    status: "ARCHIVED",
  });
  const progress = Object.freeze({
    studentsCount: 3,
    publishedClassroomTasks: 2,
    dueClassroomTasks: 0,
    distinctStudentsSubmitted: 2,
    submissionRate: 0.6667,
    lateSubmissionsCount: 0,
    lateStudentsCount: 0,
  });
  const atRisk = Object.freeze({
    notSubmittedStudentsCount: 1,
    sampleStudentIds: Object.freeze(["student-3"]),
  });
  const aiHealth = Object.freeze({
    jobs: Object.freeze({
      total: 2,
      succeeded: 1,
      failed: 0,
      pending: 1,
      running: 0,
      dead: 0,
    }),
    successRate: 0.5,
    rateLimitRatio: 0,
    timeoutRatio: 0,
    errors: Object.freeze([]),
  });
  const firstTag = Object.freeze({ tag: "logic", count: 2 });
  const secondTag = Object.freeze({ tag: "boundary", count: 0 });
  const payload = Object.freeze({
    classroom,
    window: "all",
    generatedAt: "2026-11-12T08:00:00.000Z",
    progress,
    atRisk,
    aiHealth,
    topTags: Object.freeze([firstTag, secondTag]),
    classroomId: "legacy-classroom-id",
    summary: Object.freeze({ studentsCount: 999, submissionRate: 1 }),
    overview: Object.freeze({ successRate: 1 }),
    items: Object.freeze([Object.freeze({ tag: "legacy", count: 999 })]),
    data: Object.freeze({
      classroom: Object.freeze({ id: "ignored-classroom" }),
      progress: Object.freeze({ studentsCount: 999 }),
      atRisk: Object.freeze({ notSubmittedStudentsCount: 999 }),
      aiHealth: Object.freeze({ successRate: 1 }),
      topTags: Object.freeze([Object.freeze({ tag: "ignored", count: 999 })]),
    }),
  });
  const before = structuredClone(payload);
  const result = toWeeklyReportResponse(payload);

  expect(result).toMatchObject({
    classroom: {
      id: "classroom-weekly",
      name: "正式班级",
      courseId: "course-1",
      status: "ARCHIVED",
    },
    window: "all",
    generatedAt: "2026-11-12T08:00:00.000Z",
    progress: {
      studentsCount: 3,
      publishedClassroomTasks: 2,
      dueClassroomTasks: 0,
      distinctStudentsSubmitted: 2,
      submissionRate: 0.6667,
      lateSubmissionsCount: 0,
      lateStudentsCount: 0,
    },
    atRisk: { notSubmittedStudentsCount: 1, sampleStudentIds: ["student-3"] },
    aiHealth: {
      jobs: {
        total: 2,
        succeeded: 1,
        failed: 0,
        pending: 1,
        running: 0,
        dead: 0,
      },
      successRate: 0.5,
      rateLimitRatio: 0,
      timeoutRatio: 0,
      errors: [],
    },
    topTags: [
      { tag: "logic", count: 2 },
      { tag: "boundary", count: 0 },
    ],
  });
  expect(result.classroom).toBe(classroom);
  expect(result.progress).toBe(progress);
  expect(result.atRisk).toBe(atRisk);
  expect(result.aiHealth).toBe(aiHealth);
  expect(result.topTags[0]).toBe(firstTag);
  expect(result.topTags[1]).toBe(secondTag);
  expect(result.raw).toBe(payload);
  for (const field of ["summary", "overview", "items", "classroomId"]) {
    expect(result).not.toHaveProperty(field);
  }
  expect(payload).toStrictEqual(before);
});

test("weekly reports do not rescue missing, invalid or empty formal groups from old sources", () => {
  const emptyGroup = Object.freeze({});
  const emptyFields = Object.freeze({
    classroom: emptyGroup,
    progress: emptyGroup,
    atRisk: emptyGroup,
    aiHealth: emptyGroup,
    topTags: Object.freeze([]),
  });
  for (const fields of [
    Object.freeze({}),
    Object.freeze({
      classroom: Object.freeze([]),
      progress: null,
      atRisk: 7,
      aiHealth: "invalid",
      topTags: emptyGroup,
      window: null,
      generatedAt: 42,
    }),
    emptyFields,
  ]) {
    const legacy = Object.freeze({
      classroom: Object.freeze({ id: "ignored-classroom" }),
      progress: Object.freeze({ studentsCount: 999 }),
      atRisk: Object.freeze({ notSubmittedStudentsCount: 999 }),
      aiHealth: Object.freeze({ successRate: 1 }),
      topTags: Object.freeze([Object.freeze({ tag: "ignored", count: 999 })]),
      window: "7d",
      generatedAt: "2020-01-01T00:00:00.000Z",
    });
    const payload = Object.freeze({
      ...fields,
      classroomId: "legacy-classroom-id",
      summary: legacy,
      overview: legacy,
      items: legacy.topTags,
      data: legacy,
    });
    const before = structuredClone(payload);
    const result = toWeeklyReportResponse(payload);

    expect(result.classroom).toEqual({});
    expect(result.progress).toEqual({});
    expect(result.atRisk).toEqual({});
    expect(result.aiHealth).toEqual({});
    expect(result.topTags).toEqual([]);
    expect(result.window).toBeUndefined();
    expect(result.generatedAt).toBeUndefined();
    if (fields === emptyFields) {
      expect(result.classroom).toBe(emptyGroup);
      expect(result.progress).toBe(emptyGroup);
      expect(result.atRisk).toBe(emptyGroup);
      expect(result.aiHealth).toBe(emptyGroup);
    }
    for (const field of ["summary", "overview", "items", "classroomId"]) {
      expect(result).not.toHaveProperty(field);
    }
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("process assessments preserve formal rows, pagination, counts and object identity", () => {
  const first = Object.freeze({
    studentId: "student-pa-1",
    studentName: "正式学生",
    studentNo: null,
    submittedTasksCount: 1,
    publishedTasksCount: 2,
    submittedTasksRate: 0.5,
    submissionsCount: 3,
    aiRequestedCount: 4,
    aiSucceededCount: 0,
    aiRequestedTasksCount: 1,
    aiSucceededTasksCount: 0,
    lateSubmissionsCount: 0,
    score: 60,
    riskLevel: "LOW",
    topTags: Object.freeze([Object.freeze({ tag: "logic", count: 0 })]),
    id: "legacy-student-id",
    name: "旧姓名",
    completionRate: 1,
    progress: 1,
    risk: "HIGH",
    comment: "旧问题摘要",
    note: "旧备注",
  });
  const second = Object.freeze({
    studentId: "student-pa-2",
    studentName: "未知学生",
    studentNo: null,
    submittedTasksCount: 0,
    publishedTasksCount: 2,
    submittedTasksRate: 0,
    submissionsCount: 0,
    aiRequestedCount: 0,
    aiSucceededCount: 0,
    score: 0,
    riskLevel: "HIGH",
    topTags: Object.freeze([]),
  });
  const rubric = Object.freeze({
    submittedTasksRate: 0.45,
    submissionsCount: 0.15,
    aiRequestQualityProxy: 0.2,
    codeQualityProxy: 0.2,
  });
  const legacyItems = Object.freeze([
    Object.freeze({ studentId: "ignored-student" }),
  ]);
  const payload = Object.freeze({
    classroomId: "classroom-pa",
    window: "30d",
    page: 2,
    limit: 50,
    total: 52,
    rubric,
    items: Object.freeze([first, second]),
    rows: legacyItems,
    data: Object.freeze({ items: legacyItems, rows: legacyItems }),
    pagination: Object.freeze({ page: 9, limit: 9, total: 999 }),
  });
  const before = structuredClone(payload);
  const result = toProcessAssessmentResponse(payload);

  expect(result).toMatchObject({
    classroomId: "classroom-pa",
    window: "30d",
    page: 2,
    limit: 50,
    total: 52,
  });
  expect(result.items.map((item) => item.studentId)).toEqual([
    "student-pa-1",
    "student-pa-2",
  ]);
  expect(result.items[0]).toMatchObject({
    studentName: "正式学生",
    studentNo: null,
    submittedTasksRate: 0.5,
    submissionsCount: 3,
    aiRequestedCount: 4,
    aiSucceededCount: 0,
    aiRequestedTasksCount: 1,
    aiSucceededTasksCount: 0,
    riskLevel: "LOW",
    topTags: [{ tag: "logic", count: 0 }],
  });
  expect(result.items[1]).toMatchObject({
    studentName: "未知学生",
    studentNo: null,
    submittedTasksRate: 0,
    submissionsCount: 0,
    aiRequestedCount: 0,
    aiSucceededCount: 0,
    score: 0,
    topTags: [],
  });
  expect(result.items[0]).toBe(first);
  expect(result.items[1]).toBe(second);
  expect(result.raw).toBe(payload);
  expect(result.raw.rubric).toBe(rubric);
  expect(payload).toStrictEqual(before);
});

test("process assessments retire rows and data wrappers and never repair items or pagination", () => {
  const legacyItems = Object.freeze([
    Object.freeze({ studentId: "ignored-student" }),
  ]);
  const formal = Object.freeze({
    studentId: "formal-student",
    studentName: "保留成员",
    submittedTasksRate: 0,
  });
  for (const scenario of [
    { fields: Object.freeze({ rows: legacyItems }), ids: [] },
    {
      fields: Object.freeze({ data: Object.freeze({ items: legacyItems }) }),
      ids: [],
    },
    {
      fields: Object.freeze({ data: Object.freeze({ rows: legacyItems }) }),
      ids: [],
    },
    { fields: Object.freeze({ data: legacyItems }), ids: [] },
    {
      fields: Object.freeze({
        items: Object.freeze([]),
        rows: legacyItems,
        data: Object.freeze({ items: legacyItems }),
      }),
      ids: [],
    },
    {
      fields: Object.freeze({
        items: null,
        page: "2",
        limit: null,
        total: Number.NaN,
        rows: legacyItems,
        data: Object.freeze({ rows: legacyItems }),
      }),
      ids: [],
    },
    {
      fields: Object.freeze({
        items: Object.freeze([formal]),
        rows: legacyItems,
        data: legacyItems,
      }),
      ids: ["formal-student"],
    },
  ]) {
    const payload = Object.freeze({
      classroomId: "classroom-pa",
      window: "all",
      ...scenario.fields,
      pagination: Object.freeze({ page: 9, limit: 9, total: 999 }),
    });
    const before = structuredClone(payload);
    const result = toProcessAssessmentResponse(payload);

    expect(result.classroomId).toBe("classroom-pa");
    expect(result.window).toBe("all");
    expect(result.items.map((item) => item.studentId)).toEqual(scenario.ids);
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
    expect(result.total).toBeUndefined();
    if (scenario.ids.length > 0) expect(result.items[0]).toBe(formal);
    expect(result.raw).toBe(payload);
    expect(payload).toStrictEqual(before);
  }
});

test("review packs preserve complete tiers, formal identities and both example tag fields", () => {
  const first = Object.freeze({
    studentId: "good-1",
    studentName: "正式学生一",
    studentNo: null,
    attemptsCount: 1,
    latestErrorCount: 0,
    id: "legacy-id",
    userId: "legacy-user-id",
    name: "旧姓名",
    student: Object.freeze({ name: "嵌套旧姓名" }),
    latestAiFeedbackStatus: "SUCCEEDED",
  });
  const second = Object.freeze({
    studentId: "good-2",
    studentName: "正式学生二",
    studentNo: "S-002",
    attemptsCount: 2,
    latestErrorCount: 0,
  });
  const watch = Object.freeze({
    studentId: "watch-1",
    studentName: "关注学生",
    studentNo: null,
    attemptsCount: 3,
    latestErrorCount: 2,
  });
  const notSubmitted = Object.freeze({
    studentId: "not-submitted-1",
    studentName: "未知学生",
    studentNo: null,
  });
  const tiers = Object.freeze({
    good: Object.freeze([first, second]),
    watch: Object.freeze([watch]),
    notSubmitted: Object.freeze([notSubmitted]),
  });
  const overview = Object.freeze({
    studentsCount: 4,
    submittedStudentsCount: 3,
    submissionRate: 0.75,
    attemptsDistribution: Object.freeze({
      "0": 1,
      "1": 1,
      "2": 1,
      "3plus": 1,
      "3+": 999,
    }),
    lateSubmissionsCount: 0,
    lateStudentsCount: 0,
    ai: Object.freeze({
      jobsTotal: 2,
      successRate: 0,
      errorsTop: Object.freeze([]),
      totalJobs: 999,
    }),
    studentCount: 999,
    submitRate: 1,
  });
  const commonIssues = Object.freeze({
    topTags: Object.freeze([
      Object.freeze({ tag: "logic", count: 2, name: "旧标签", total: 999 }),
    ]),
    topTypes: Object.freeze([
      Object.freeze({ type: "CORRECTNESS", count: 0, label: "旧类型" }),
    ]),
    topSeverities: Object.freeze([
      Object.freeze({ severity: "ERROR", count: 0, level: "旧等级" }),
    ]),
  });
  const example = Object.freeze({
    feedbackId: "feedback-1",
    submissionId: "submission-1",
    attemptNo: 0,
    severity: "ERROR",
    type: "CORRECTNESS",
    message: "正式问题",
    suggestion: "可选建议",
    source: "AI",
    primaryTag: "logic",
    matchedTags: Object.freeze(["logic", "boundary"]),
    tags: Object.freeze(["logic", "style"]),
  });
  const optionalExample = Object.freeze({
    feedbackId: "feedback-2",
    primaryTag: "style",
    matchedTags: Object.freeze([]),
    tags: Object.freeze(["style"]),
  });
  const payload = Object.freeze({
    classroomId: "classroom-review",
    classroomTaskId: "classroom-task-1",
    window: "7d",
    overview,
    commonIssues,
    studentTiers: tiers,
    examples: Object.freeze([example, optionalExample]),
  });
  const before = structuredClone(payload);
  const result = toReviewPackResponse(payload);

  expect(result).toMatchObject({
    classroomId: "classroom-review",
    classroomTaskId: "classroom-task-1",
    window: "7d",
  });
  expect(result.overview).toMatchObject({
    studentsCount: 4,
    submittedStudentsCount: 3,
    submissionRate: 0.75,
    lateSubmissionsCount: 0,
    lateStudentsCount: 0,
    ai: { jobsTotal: 2, successRate: 0 },
  });
  expect(result.commonIssues).toMatchObject({
    topTags: [{ tag: "logic", count: 2 }],
    topTypes: [{ type: "CORRECTNESS", count: 0 }],
    topSeverities: [{ severity: "ERROR", count: 0 }],
  });
  expect(result.studentTiers.good).toMatchObject([
    {
      studentId: "good-1",
      studentName: "正式学生一",
      studentNo: null,
      attemptsCount: 1,
      latestErrorCount: 0,
    },
    {
      studentId: "good-2",
      studentName: "正式学生二",
      studentNo: "S-002",
      attemptsCount: 2,
      latestErrorCount: 0,
    },
  ]);
  expect(result.studentTiers.watch).toMatchObject([
    {
      studentId: "watch-1",
      studentName: "关注学生",
      studentNo: null,
      attemptsCount: 3,
      latestErrorCount: 2,
    },
  ]);
  expect(result.studentTiers.notSubmitted).toMatchObject([
    { studentId: "not-submitted-1", studentName: "未知学生", studentNo: null },
  ]);
  expect(result.examples[0]).toMatchObject({
    feedbackId: "feedback-1",
    submissionId: "submission-1",
    attemptNo: 0,
    primaryTag: "logic",
    suggestion: "可选建议",
    matchedTags: ["logic", "boundary"],
    tags: ["logic", "style"],
  });
  expect(result.examples[1].suggestion).toBeUndefined();
  expect(result.examples[1].matchedTags).toEqual([]);
  expect(result.examples[1].tags).toEqual(["style"]);
  expect(result.examples[0].raw).toBe(example);
  expect(result.examples[1].raw).toBe(optionalExample);
  expect(result.overview).toBe(overview);
  expect(result.commonIssues).toBe(commonIssues);
  expect(result.studentTiers.raw).toBe(tiers);
  for (const tier of ["good", "watch", "notSubmitted"] as const) {
    result.studentTiers[tier].forEach((item, index) => {
      expect(item.raw).toBe(tiers[tier][index]);
      expect(item).not.toHaveProperty("latestAiFeedbackStatus");
    });
  }
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

test("all review tiers reject legacy identity rescue and preserve unknown names, null student numbers and zero counts", () => {
  const missing = Object.freeze({
    id: "legacy-id",
    userId: "legacy-user",
    name: "旧姓名",
    student: Object.freeze({ name: "嵌套旧姓名" }),
    studentNo: null,
    attemptsCount: 0,
    latestErrorCount: 0,
    latestAiFeedbackStatus: "SUCCEEDED",
  });
  const nulled = Object.freeze({
    studentId: null,
    studentName: null,
    id: "legacy-id",
    userId: "legacy-user",
    name: "旧姓名",
    student: Object.freeze({ name: "嵌套旧姓名" }),
    studentNo: null,
    attemptsCount: 0,
    latestErrorCount: 0,
    latestAiFeedbackStatus: null,
  });
  const invalid = Object.freeze({
    studentId: 123,
    studentName: " \t ",
    id: "legacy-id",
    userId: "legacy-user",
    name: "旧姓名",
    student: Object.freeze({ name: "嵌套旧姓名" }),
    studentNo: null,
    latestAiFeedbackStatus: "PENDING",
  });
  const tiers = Object.freeze({
    good: Object.freeze([missing]),
    watch: Object.freeze([nulled]),
    notSubmitted: Object.freeze([invalid]),
  });
  const payload = Object.freeze({
    studentTiers: tiers,
    examples: Object.freeze([]),
  });
  const before = structuredClone(payload);
  const result = toReviewPackResponse(payload);

  expect(Object.hasOwn(missing, "studentId")).toBe(false);
  expect(Object.hasOwn(missing, "studentName")).toBe(false);
  for (const tier of ["good", "watch", "notSubmitted"] as const) {
    expect(result.studentTiers[tier]).toHaveLength(1);
    const item = result.studentTiers[tier][0];
    expect(item.studentId).toBeUndefined();
    expect(item.studentName).toBe("未知学生");
    expect(item.studentNo).toBeNull();
    expect(item).not.toHaveProperty("latestAiFeedbackStatus");
    expect(item.raw).toBe(tiers[tier][0]);
  }
  expect(result.studentTiers.good[0].attemptsCount).toBe(0);
  expect(result.studentTiers.good[0].latestErrorCount).toBe(0);
  expect(result.studentTiers.watch[0].attemptsCount).toBe(0);
  expect(result.studentTiers.watch[0].latestErrorCount).toBe(0);
  expect(result.studentTiers.notSubmitted[0].attemptsCount).toBeUndefined();
  expect(result.studentTiers.notSubmitted[0].latestErrorCount).toBeUndefined();
  expect(result.examples).toEqual([]);
  expect(result.studentTiers.raw).toBe(tiers);
  expect(result.raw).toBe(payload);
  expect(payload).toStrictEqual(before);
});

test("snapshot previews preserve top-level groups and note text, whitespace, duplicates and order", () => {
  const meta = Object.freeze({
    generatedAt: "2026-11-12T08:00:00.000Z",
    window: "30d",
    effectiveWindow: "30d",
    notes: Object.freeze([
      "perTask omitted by includePerTask=false",
      "",
      "  原文说明  ",
      "perTask omitted by includePerTask=false",
    ]),
  });
  const summary = Object.freeze({
    progress: Object.freeze({ studentsCount: 2, publishedClassroomTasks: 0 }),
    aiHealth: Object.freeze({ successRate: 0 }),
    commonIssues: Object.freeze({ topTags: Object.freeze([]) }),
    late: Object.freeze({ lateSubmissionsCount: 0, lateStudentsCount: 0 }),
  });
  const payload = Object.freeze({
    meta,
    summary,
    classroomId: "legacy-classroom-id",
    window: "all",
    data: Object.freeze({
      meta: Object.freeze({
        window: "7d",
        notes: Object.freeze(["忽略的提示"]),
      }),
      summary: Object.freeze({ studentsCount: 999 }),
    }),
  });
  const before = structuredClone(payload);
  const result = toExportSnapshotResponse(payload);

  expect(result.meta).toMatchObject({
    generatedAt: "2026-11-12T08:00:00.000Z",
    window: "30d",
    effectiveWindow: "30d",
  });
  expect(result.summary).toMatchObject({
    progress: { studentsCount: 2, publishedClassroomTasks: 0 },
    aiHealth: { successRate: 0 },
    late: { lateSubmissionsCount: 0, lateStudentsCount: 0 },
  });
  expect(result.notes).toEqual([
    "perTask omitted by includePerTask=false",
    "",
    "  原文说明  ",
    "perTask omitted by includePerTask=false",
  ]);
  expect(result.meta).toBe(meta);
  expect(result.summary).toBe(summary);
  expect(result.raw).toBe(payload);
  expect(result).not.toHaveProperty("classroomId");
  expect(result).not.toHaveProperty("window");
  expect(payload).toStrictEqual(before);
});

test("snapshot previews do not rescue missing or empty groups and never turn a single note into an array", () => {
  const empty = Object.freeze({});
  const emptyNotesMeta = Object.freeze({ notes: Object.freeze([]) });
  const stringNotesMeta = Object.freeze({ notes: "旧单条提示" });
  for (const scenario of [
    { fields: Object.freeze({}), metaRef: undefined, summaryRef: undefined },
    {
      fields: Object.freeze({ meta: null, summary: 7 }),
      metaRef: undefined,
      summaryRef: undefined,
    },
    {
      fields: Object.freeze({ meta: empty, summary: empty }),
      metaRef: empty,
      summaryRef: empty,
    },
    {
      fields: Object.freeze({ meta: emptyNotesMeta, summary: empty }),
      metaRef: emptyNotesMeta,
      summaryRef: empty,
    },
    {
      fields: Object.freeze({ meta: stringNotesMeta, summary: empty }),
      metaRef: stringNotesMeta,
      summaryRef: empty,
    },
  ]) {
    const payload = Object.freeze({
      ...scenario.fields,
      classroomId: "legacy-classroom-id",
      window: "all",
      data: Object.freeze({
        meta: Object.freeze({ notes: Object.freeze(["忽略的提示"]) }),
        summary: Object.freeze({ studentsCount: 999 }),
      }),
    });
    const before = structuredClone(payload);
    const result = toExportSnapshotResponse(payload);

    expect(result.notes).toEqual([]);
    if (scenario.metaRef) expect(result.meta).toBe(scenario.metaRef);
    else expect(result.meta).toEqual({});
    if (scenario.summaryRef) expect(result.summary).toBe(scenario.summaryRef);
    else expect(result.summary).toEqual({});
    expect(result.raw).toBe(payload);
    expect(result).not.toHaveProperty("classroomId");
    expect(result).not.toHaveProperty("window");
    expect(payload).toStrictEqual(before);
  }
});
