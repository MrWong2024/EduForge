import { expect, test } from "@playwright/test";
import { isValidPaginationTotal } from "@/lib/pagination";
import {
  toAiLearningAnalyticsOverviewResponse,
  toAiLearningAnalyticsStudentsResponse,
  toAiLearningAnalyticsStudentDetailResponse,
} from "../../lib/api/types-teacher";
import {
  buildAiLearningAnalyticsSubmissionHref,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
  getAiLearningAnalyticsDetailedOutcomeLabel,
  getAiLearningAnalyticsOverallOutcomeLabel,
  getAiLearningAnalyticsEngagementStatusLabel,
  getAiLearningAnalyticsDeltaMeaning,
  getAiLearningAnalyticsUncomparedRevisionMessage,
  getAiLearningAnalyticsEvidenceNotes,
  getAiLearningAnalyticsMethodologyVersionLabel,
  parseAiLearningAnalyticsEngagementStatus,
  selectAiLearningAnalyticsTeachingAttention,
} from "../../lib/ai-learning-analytics";

const methodology = { version: "AI_FEEDBACK_INTERVENTION_V1_2" };
const evidence = {
  sourceUncertainComparableCount: 2,
  modelChangedComparableCount: 1,
  simulatedExcludedSampleCount: 1,
};

test("all analytics adapters retain exact formal context windows over conflicting old sources", () => {
  for (const window of ["all", "7d", "30d"]) {
    const context = Object.freeze({
      classroomId: "window-classroom",
      classroomName: "窗口班级",
      courseId: "window-course",
      courseName: "窗口课程",
      courseCode: "CS101",
      courseTerm: null,
      generatedAt: "2026-11-14T08:00:00.000Z",
      window,
      effectiveTaskCount: 0,
      excludedTaskIds: Object.freeze(["excluded-task"]),
    });
    const data = Object.freeze({ context: Object.freeze({ window: "30d" }) });
    const raw = Object.freeze({ context: Object.freeze({ window: "all" }) });
    const input = Object.freeze({
      context,
      methodology,
      window: "7d",
      data,
      raw,
      items: Object.freeze([
        Object.freeze({
          studentId: "window-student",
          studentNo: null,
          submittedTasksCount: 0,
        }),
        Object.freeze({ studentName: "保留缺标识的行" }),
      ]),
      taskTrends: Object.freeze([
        Object.freeze({
          classroomTaskId: "window-trend",
          postFeedbackRevisionRate: 0,
        }),
      ]),
      taskPoints: Object.freeze([
        Object.freeze({
          classroomTaskId: "window-point",
          attemptsCount: 0,
          issueLoadDelta: null,
        }),
      ]),
    });
    const before = structuredClone(input);
    for (const adapt of [
      toAiLearningAnalyticsOverviewResponse,
      toAiLearningAnalyticsStudentsResponse,
      toAiLearningAnalyticsStudentDetailResponse,
    ]) {
      const response = adapt(input);

      expect(response.context).toEqual(context);
      expect(response.methodology.version).toBe("AI_FEEDBACK_INTERVENTION_V1_2");
      if ("items" in response) {
        expect(response.items.map((student) => student.studentId)).toEqual([
          "window-student",
          "",
        ]);
        expect(response.items[0]).toMatchObject({
          studentNo: null,
          submittedTasksCount: 0,
        });
        expect(response.items[1].studentName).toBe("保留缺标识的行");
      }
      if ("taskTrends" in response) {
        expect(response.taskTrends).toMatchObject([
          { classroomTaskId: "window-trend", postFeedbackRevisionRate: 0 },
        ]);
      }
      if ("taskPoints" in response) {
        expect(response.taskPoints).toMatchObject([
          {
            classroomTaskId: "window-point",
            attemptsCount: 0,
            issueLoadDelta: null,
          },
        ]);
      }
      expect(response.raw).toBe(input);
      expect(response.raw.context).toBe(context);
      expect(response.raw.window).toBe("7d");
      expect(response.raw.data).toBe(data);
      expect(response.raw.raw).toBe(raw);
    }
    expect(input).toStrictEqual(before);
  }
});

test("all analytics adapters leave absent and invalid response windows unknown without alias or wrapper rescue", () => {
  const context = Object.freeze({
    classroomId: "window-classroom",
    classroomName: "窗口班级",
    effectiveTaskCount: 2,
    excludedTaskIds: Object.freeze(["excluded-task"]),
  });
  const emptyContext = {
    classroomId: "",
    classroomName: "未命名班级",
    effectiveTaskCount: 0,
    excludedTaskIds: [],
  };
  for (const { fields, expectedContext } of [
    { fields: {}, expectedContext: emptyContext },
    { fields: { context: null }, expectedContext: emptyContext },
    { fields: { context: "all" }, expectedContext: emptyContext },
    { fields: { context: Object.freeze([]) }, expectedContext: emptyContext },
    ...[
      {},
      { window: null },
      { window: "" },
      { window: " \t\n " },
      { window: "ALL" },
      { window: "7D" },
      { window: " all " },
      { window: "\t30d\n" },
      { window: "FUTURE" },
      { window: 42 },
      { window: false },
      { window: Object.freeze(["all"]) },
      { window: Object.freeze({ window: "all" }) },
    ].map((windowFields) => ({
      fields: { context: Object.freeze({ ...context, ...windowFields }) },
      expectedContext: context,
    })),
  ]) {
    const data = Object.freeze({ context: Object.freeze({ window: "30d" }) });
    const raw = Object.freeze({ context: Object.freeze({ window: "7d" }) });
    const input = Object.freeze({
      ...fields,
      window: "all",
      data,
      raw,
      items: Object.freeze([
        { studentId: "window-student", submittedTasksCount: 0 },
      ]),
      taskTrends: Object.freeze([{ classroomTaskId: "window-trend" }]),
      taskPoints: Object.freeze([{ classroomTaskId: "window-point" }]),
    });
    const before = structuredClone(input);
    for (const adapt of [
      toAiLearningAnalyticsOverviewResponse,
      toAiLearningAnalyticsStudentsResponse,
      toAiLearningAnalyticsStudentDetailResponse,
    ]) {
      const response = adapt(input);

      expect(response.context).toMatchObject({
        ...expectedContext,
        window: undefined,
      });
      if ("items" in response) {
        expect(response.items[0].studentId).toBe("window-student");
      }
      if ("taskTrends" in response) {
        expect(response.taskTrends[0].classroomTaskId).toBe("window-trend");
      }
      if ("taskPoints" in response) {
        expect(response.taskPoints[0].classroomTaskId).toBe("window-point");
      }
      expect(response.raw).toBe(input);
      expect(response.raw.window).toBe("all");
      expect(response.raw.data).toBe(data);
      expect(response.raw.raw).toBe(raw);
    }
    expect(input).toStrictEqual(before);
  }
});

test("formal overall outcomes retain every business conclusion and its existing label", () => {
  const cases = [
    ["INSUFFICIENT_DATA", "可比数据不足"],
    ["IMPROVED_OVERALL", "可比任务负荷净下降"],
    ["NO_NET_CHANGE", "净变化为零"],
    ["REGRESSED_OVERALL", "可比任务负荷净上升"],
  ] as const;
  const rows = Object.freeze(
    cases.map(([overallOutcome], index) =>
      Object.freeze({
        studentId: `overall-${index}`,
        overallOutcome,
        engagementStatus: "QUALITY_COMPARABLE",
        growthTrend: "IMPROVING",
        data: Object.freeze({ overallOutcome: "REGRESSED_OVERALL" }),
      }),
    ),
  );
  const input = Object.freeze({ items: rows });
  const before = structuredClone(input);
  const students = toAiLearningAnalyticsStudentsResponse(input);

  expect(students.items.map((student) => student.studentId)).toEqual([
    "overall-0",
    "overall-1",
    "overall-2",
    "overall-3",
  ]);
  for (const [index, [expected, label]] of cases.entries()) {
    const detailInput = Object.freeze({ summary: rows[index] });
    const detail = toAiLearningAnalyticsStudentDetailResponse(detailInput);

    expect(students.items[index].overallOutcome).toBe(expected);
    expect(detail.summary.overallOutcome).toBe(expected);
    expect(
      getAiLearningAnalyticsOverallOutcomeLabel(
        students.items[index].overallOutcome,
      ),
    ).toBe(label);
    expect(
      getAiLearningAnalyticsOverallOutcomeLabel(detail.summary.overallOutcome),
    ).toBe(label);
    expect(students.items[index].engagementStatus).toBe("QUALITY_COMPARABLE");
    expect(detail.summary.engagementStatus).toBe("QUALITY_COMPARABLE");
    expect(detail.raw).toBe(detailInput);
  }
  expect(students.raw).toBe(input);
  expect(input).toStrictEqual(before);
});

test("formal engagement stages retain all six values including no submission and their existing labels", () => {
  const cases = [
    ["NO_SUBMISSION", "未提交任务"],
    ["SUBMITTED_WITHOUT_AI_REQUEST", "已提交，未请求 AI 反馈"],
    ["AI_REQUESTED_WITHOUT_DELIVERY", "已请求 AI 反馈，暂无可用反馈交付"],
    ["AI_DELIVERED_WITHOUT_REVISION", "已获可用反馈，尚无可确认的后续更新"],
    ["REVISED_WITHOUT_COMPARABLE", "已有作品更新，暂无反馈可对照结果"],
    ["QUALITY_COMPARABLE", "已形成反馈可对照结果"],
  ] as const;
  const rows = Object.freeze(
    cases.map(([engagementStatus], index) =>
      Object.freeze({
        studentId: `engagement-${index}`,
        overallOutcome: "INSUFFICIENT_DATA",
        engagementStatus,
        data: Object.freeze({ engagementStatus: "QUALITY_COMPARABLE" }),
      }),
    ),
  );
  const input = Object.freeze({ items: rows });
  const before = structuredClone(input);
  const students = toAiLearningAnalyticsStudentsResponse(input);

  expect(students.items).toHaveLength(6);
  for (const [index, [expected, label]] of cases.entries()) {
    const detailInput = Object.freeze({ summary: rows[index] });
    const detail = toAiLearningAnalyticsStudentDetailResponse(detailInput);

    expect(students.items[index].studentId).toBe(`engagement-${index}`);
    expect(students.items[index].engagementStatus).toBe(expected);
    expect(detail.summary.engagementStatus).toBe(expected);
    expect(
      getAiLearningAnalyticsEngagementStatusLabel(
        students.items[index].engagementStatus,
      ),
    ).toBe(label);
    expect(
      getAiLearningAnalyticsEngagementStatusLabel(detail.summary.engagementStatus),
    ).toBe(label);
    expect(students.items[index].overallOutcome).toBe("INSUFFICIENT_DATA");
    expect(detail.summary.overallOutcome).toBe("INSUFFICIENT_DATA");
    expect(detail.raw).toBe(detailInput);
  }
  expect(students.raw).toBe(input);
  expect(input).toStrictEqual(before);
});

test("formal task outcomes retain all five values including not comparable and their existing labels", () => {
  const cases = [
    ["IMPROVED", "负荷下降"],
    ["REMAINED_CLEAN", "前后均无错误或警告"],
    ["UNCHANGED_WITH_ISSUES", "非零负荷持平"],
    ["REGRESSED", "负荷上升"],
    ["NOT_COMPARABLE", "不可对照"],
  ] as const;
  const points = Object.freeze(
    cases.map(([detailedOutcome], index) =>
      Object.freeze({
        classroomTaskId: `outcome-${index}`,
        detailedOutcome,
        outcome: "REGRESSED",
        data: Object.freeze({ detailedOutcome: "IMPROVED" }),
      }),
    ),
  );
  const input = Object.freeze({ taskPoints: points });
  const before = structuredClone(input);
  const detail = toAiLearningAnalyticsStudentDetailResponse(input);

  expect(detail.taskPoints).toHaveLength(5);
  for (const [index, [expected, label]] of cases.entries()) {
    expect(detail.taskPoints[index].classroomTaskId).toBe(`outcome-${index}`);
    expect(detail.taskPoints[index].detailedOutcome).toBe(expected);
    expect(
      getAiLearningAnalyticsDetailedOutcomeLabel(
        detail.taskPoints[index].detailedOutcome,
      ),
    ).toBe(label);
  }
  expect(detail.raw).toBe(input);
  expect(input).toStrictEqual(before);
});

test("invalid student result fields stay unknown independently of other results, counts and old sources", () => {
  const legacy = Object.freeze({
    overallOutcome: "IMPROVED_OVERALL",
    engagementStatus: "QUALITY_COMPARABLE",
  });
  for (const { field, otherField, valid, expectedOther, variants } of [
    {
      field: "overallOutcome",
      otherField: "engagementStatus",
      valid: { engagementStatus: "QUALITY_COMPARABLE" },
      expectedOther: "QUALITY_COMPARABLE",
      variants: ["improved_overall", " IMPROVED_OVERALL ", "\tNO_NET_CHANGE\n"],
    },
    {
      field: "engagementStatus",
      otherField: "overallOutcome",
      valid: { overallOutcome: "NO_NET_CHANGE" },
      expectedOther: "NO_NET_CHANGE",
      variants: ["no_submission", " NO_SUBMISSION ", "\tQUALITY_COMPARABLE\n"],
    },
  ] as const) {
    for (const value of [
      undefined,
      null,
      "",
      "FUTURE",
      ...variants,
      42,
      false,
      Object.freeze(["IMPROVED_OVERALL"]),
      Object.freeze({ overallOutcome: "IMPROVED_OVERALL" }),
    ]) {
      const row = Object.freeze({
        ...valid,
        ...(value === undefined ? {} : { [field]: value }),
        studentId: "unknown-result-student",
        submittedTasksCount: 3,
        postFeedbackRevisionRate: 0,
        averageIssueLoadDelta: null,
        outcome: "IMPROVED",
        growthTrend: "IMPROVING",
        data: legacy,
      });
      const input = Object.freeze({
        items: Object.freeze([row]),
        data: { items: [legacy] },
      });
      const detailInput = Object.freeze({
        summary: row,
        data: { summary: legacy },
      });
      const before = structuredClone(input);
      const detailBefore = structuredClone(detailInput);
      const students = toAiLearningAnalyticsStudentsResponse(input);
      const detail = toAiLearningAnalyticsStudentDetailResponse(detailInput);

      expect(students.items).toHaveLength(1);
      expect(students.items[0].studentId).toBe("unknown-result-student");
      expect(students.items[0]).not.toHaveProperty("raw");
      for (const metrics of [students.items[0], detail.summary]) {
        expect(metrics[field]).toBeUndefined();
        expect(metrics[otherField]).toBe(expectedOther);
        expect(metrics).toMatchObject({
          submittedTasksCount: 3,
          postFeedbackRevisionRate: 0,
          averageIssueLoadDelta: null,
        });
        if (field === "overallOutcome") {
          expect(
            getAiLearningAnalyticsOverallOutcomeLabel(metrics.overallOutcome),
          ).toBe("结果未知");
          expect(
            getAiLearningAnalyticsEngagementStatusLabel(metrics.engagementStatus),
          ).toBe("已形成反馈可对照结果");
        } else {
          expect(
            getAiLearningAnalyticsEngagementStatusLabel(metrics.engagementStatus),
          ).toBe("参与阶段未知");
          expect(
            getAiLearningAnalyticsOverallOutcomeLabel(metrics.overallOutcome),
          ).toBe("净变化为零");
        }
      }
      expect(students.raw).toBe(input);
      expect(detail.raw).toBe(detailInput);
      expect(input).toStrictEqual(before);
      expect(detailInput).toStrictEqual(detailBefore);
    }
  }
});

test("invalid detailed results stay unknown despite comparable zero-load points and old outcomes", () => {
  for (const value of [
    undefined,
    null,
    "",
    "FUTURE",
    "not_comparable",
    " NOT_COMPARABLE ",
    "\tIMPROVED\n",
    42,
    false,
    Object.freeze(["IMPROVED"]),
    Object.freeze({ detailedOutcome: "IMPROVED" }),
  ]) {
    const point = Object.freeze({
      ...(value === undefined ? {} : { detailedOutcome: value }),
      classroomTaskId: "unknown-result-task",
      attemptsCount: 3,
      qualityComparable: true,
      issueLoadBefore: 0,
      issueLoadAfter: 0,
      issueLoadDelta: 0,
      outcome: "IMPROVED",
      data: Object.freeze({ detailedOutcome: "REMAINED_CLEAN" }),
    });
    const input = Object.freeze({
      taskPoints: Object.freeze([point]),
      data: Object.freeze({ taskPoints: [{ detailedOutcome: "NOT_COMPARABLE" }] }),
    });
    const before = structuredClone(input);
    const detail = toAiLearningAnalyticsStudentDetailResponse(input);

    expect(detail.taskPoints).toHaveLength(1);
    expect(detail.taskPoints[0]).toMatchObject({
      classroomTaskId: "unknown-result-task",
      detailedOutcome: undefined,
      attemptsCount: 3,
      qualityComparable: true,
      issueLoadBefore: 0,
      issueLoadAfter: 0,
      issueLoadDelta: 0,
    });
    expect(
      getAiLearningAnalyticsDetailedOutcomeLabel(
        detail.taskPoints[0].detailedOutcome,
      ),
    ).toBe("结果未知");
    expect(detail.raw).toBe(input);
    expect(input).toStrictEqual(before);
  }
});

test("student filter echoes distinguish explicit null and formal values from independently missing or invalid fields", () => {
  const data = Object.freeze({
    filters: Object.freeze({
      q: "ignored",
      overallOutcome: "IMPROVED_OVERALL",
      engagementStatus: "NO_SUBMISSION",
    }),
  });
  for (const { field, otherField, other, cases } of [
    {
      field: "overallOutcome",
      otherField: "engagementStatus",
      other: "QUALITY_COMPARABLE",
      cases: [
        [null, null],
        ["NO_NET_CHANGE", "NO_NET_CHANGE"],
        [undefined, undefined],
        ["FUTURE", undefined],
        [" NO_NET_CHANGE ", undefined],
        ["no_net_change", undefined],
        [42, undefined],
      ],
    },
    {
      field: "engagementStatus",
      otherField: "overallOutcome",
      other: "NO_NET_CHANGE",
      cases: [
        [null, null],
        ["QUALITY_COMPARABLE", "QUALITY_COMPARABLE"],
        [undefined, undefined],
        ["FUTURE", undefined],
        [" QUALITY_COMPARABLE ", undefined],
        ["quality_comparable", undefined],
        [false, undefined],
      ],
    },
  ] as const) {
    for (const [value, expected] of cases) {
      const input = Object.freeze({
        total: 4,
        activeStudentsTotal: 8,
        filters: Object.freeze({
          q: " 正式搜索 ",
          [otherField]: other,
          ...(value === undefined ? {} : { [field]: value }),
        }),
        items: Object.freeze([
          {
            studentId: "unknown-results",
            overallOutcome: "FUTURE",
            engagementStatus: "FUTURE",
          },
        ]),
        data,
      });
      const before = structuredClone(input);
      const students = toAiLearningAnalyticsStudentsResponse(input);

      expect(students.filters[field]).toBe(expected);
      expect(students.filters[otherField]).toBe(other);
      expect(students.filters.q).toBe("正式搜索");
      expect(isValidPaginationTotal(students.total)).toBe(true);
      expect(isValidPaginationTotal(students.activeStudentsTotal)).toBe(true);
      expect(students.items).toHaveLength(1);
      expect(students.items[0].overallOutcome).toBeUndefined();
      expect(students.items[0].engagementStatus).toBeUndefined();
      expect(students.raw).toBe(input);
      expect(students.raw.data).toBe(data);
      expect(input).toStrictEqual(before);
    }
  }
  for (const filters of [undefined, null, false, "invalid", Object.freeze([])]) {
    const input = Object.freeze({
      ...(filters === undefined ? {} : { filters }),
      data,
    });
    const before = structuredClone(input);
    const students = toAiLearningAnalyticsStudentsResponse(input);

    expect(students.filters).toEqual({
      q: null,
      overallOutcome: undefined,
      engagementStatus: undefined,
    });
    expect(students.raw).toBe(input);
    expect(input).toStrictEqual(before);
  }
});

test("retired analytics fields stay outside normalized projections without changing current metrics or raw sources", () => {
  const overviewSource = Object.freeze({
    summary: Object.freeze({
      remainedCleanStudentTaskCount: 1,
      unchangedWithIssuesStudentTaskCount: 2,
      stableStudentTaskCount: 99,
    }),
    taskTrends: Object.freeze([
      Object.freeze({
        classroomTaskId: "task-current",
        remainedCleanStudentCount: 1,
        unchangedWithIssuesStudentCount: 2,
        stableStudentCount: 99,
      }),
    ]),
  });
  const studentsSource = Object.freeze({
    items: Object.freeze([
      Object.freeze({
        studentId: "student-current",
        studentName: "Current Student",
        remainedCleanTasksCount: 1,
        unchangedWithIssuesTasksCount: 2,
        stableTasksCount: 99,
        overallOutcome: "REGRESSED_OVERALL",
        engagementStatus: "QUALITY_COMPARABLE",
        growthTrend: "IMPROVING",
        postFeedbackRevisedTasksCount: 2,
        postFeedbackResubmittedTasksCount: 1,
      }),
      Object.freeze({
        studentId: "student-legacy-only",
        stableTasksCount: 99,
        growthTrend: "IMPROVING",
      }),
    ]),
  });
  const detailSource = Object.freeze({
    summary: Object.freeze({
      remainedCleanTasksCount: 1,
      unchangedWithIssuesTasksCount: 2,
      stableTasksCount: 99,
      overallOutcome: "NO_NET_CHANGE",
      engagementStatus: "QUALITY_COMPARABLE",
      growthTrend: "DECLINING",
    }),
    taskPoints: Object.freeze([
      Object.freeze({
        classroomTaskId: "task-current",
        detailedOutcome: "REMAINED_CLEAN",
        outcome: "REGRESSED",
        postFeedbackRevised: true,
        postFeedbackResubmitted: false,
      }),
      Object.freeze({
        classroomTaskId: "task-legacy-only",
        outcome: "IMPROVED",
      }),
    ]),
  });
  const overviewInput = overviewSource;
  const studentsInput = studentsSource;
  const detailInput = detailSource;
  const overviewBefore = structuredClone(overviewInput);
  const studentsBefore = structuredClone(studentsInput);
  const detailBefore = structuredClone(detailInput);
  const overview = toAiLearningAnalyticsOverviewResponse(overviewInput);
  const students = toAiLearningAnalyticsStudentsResponse(studentsInput);
  const detail = toAiLearningAnalyticsStudentDetailResponse(detailInput);

  expect(overview.summary).not.toHaveProperty("stableStudentTaskCount");
  expect(overview.summary).toMatchObject({
    remainedCleanStudentTaskCount: 1,
    unchangedWithIssuesStudentTaskCount: 2,
  });
  for (const trend of overview.taskTrends) {
    expect(trend).not.toHaveProperty("stableStudentCount");
  }
  expect(overview.taskTrends[0]).toMatchObject({
    classroomTaskId: "task-current",
    remainedCleanStudentCount: 1,
    unchangedWithIssuesStudentCount: 2,
  });
  for (const student of students.items) {
    expect(student).not.toHaveProperty("stableTasksCount");
    expect(student).not.toHaveProperty("growthTrend");
  }
  expect(students.items[0]).toMatchObject({
    studentId: "student-current",
    studentName: "Current Student",
    remainedCleanTasksCount: 1,
    unchangedWithIssuesTasksCount: 2,
    overallOutcome: "REGRESSED_OVERALL",
    engagementStatus: "QUALITY_COMPARABLE",
    postFeedbackRevisedTasksCount: 2,
    postFeedbackResubmittedTasksCount: 1,
  });
  expect(students.items[1]).toMatchObject({
    studentId: "student-legacy-only",
    remainedCleanTasksCount: 0,
    unchangedWithIssuesTasksCount: 0,
    overallOutcome: undefined,
    engagementStatus: undefined,
  });
  expect(detail.summary).not.toHaveProperty("stableTasksCount");
  expect(detail.summary).not.toHaveProperty("growthTrend");
  expect(detail.summary).toMatchObject({
    remainedCleanTasksCount: 1,
    unchangedWithIssuesTasksCount: 2,
    overallOutcome: "NO_NET_CHANGE",
    engagementStatus: "QUALITY_COMPARABLE",
  });
  for (const point of detail.taskPoints) {
    expect(point).not.toHaveProperty("outcome");
  }
  expect(detail.taskPoints[0]).toMatchObject({
    classroomTaskId: "task-current",
    detailedOutcome: "REMAINED_CLEAN",
    postFeedbackRevised: true,
    postFeedbackResubmitted: false,
  });
  expect(detail.taskPoints[1].detailedOutcome).toBeUndefined();

  expect(overview.raw).toBe(overviewSource);
  expect(students.raw).toBe(studentsSource);
  expect(detail.raw).toBe(detailSource);
  expect(overview.raw).toHaveProperty("summary.stableStudentTaskCount", 99);
  expect(overview.raw).toHaveProperty("taskTrends.0.stableStudentCount", 99);
  expect(students.raw).toHaveProperty("items.0.stableTasksCount", 99);
  expect(students.raw).toHaveProperty("items.0.growthTrend", "IMPROVING");
  expect(detail.raw).toHaveProperty("summary.stableTasksCount", 99);
  expect(detail.raw).toHaveProperty("summary.growthTrend", "DECLINING");
  expect(detail.raw).toHaveProperty("taskPoints.0.outcome", "REGRESSED");
  expect(overviewInput).toEqual(overviewBefore);
  expect(studentsInput).toEqual(studentsBefore);
  expect(detailInput).toEqual(detailBefore);
});

test("analytics adapters use formal root results, pagination and filters despite conflicting data", () => {
  const context = Object.freeze({
    classroomId: "root-classroom",
    classroomName: "根班级",
    courseId: "root-course",
    window: "30d",
    effectiveTaskCount: 2,
    excludedTaskIds: Object.freeze(["root-excluded-task"]),
  });
  const rootMethodology = Object.freeze({
    version: "AI_FEEDBACK_INTERVENTION_V1_2",
  });
  const data = Object.freeze({
    context: Object.freeze({
      classroomId: "ignored-classroom",
      window: "7d",
      effectiveTaskCount: 99,
    }),
    methodology: Object.freeze({ version: "UNKNOWN" }),
    summary: Object.freeze({
      activeStudentsCount: 99,
      submittedTasksCount: 99,
      averageIssueLoadDelta: -99,
    }),
    student: Object.freeze({
      studentId: "ignored-student",
      studentName: "嵌套学生",
    }),
    taskTrends: Object.freeze([
      Object.freeze({ classroomTaskId: "ignored-trend" }),
    ]),
    items: Object.freeze([Object.freeze({ studentId: "ignored-student" })]),
    taskPoints: Object.freeze([
      Object.freeze({ classroomTaskId: "ignored-point" }),
    ]),
    page: 9,
    limit: 1,
    total: 99,
    activeStudentsTotal: 100,
    filters: Object.freeze({
      q: "ignored",
      overallOutcome: "REGRESSED_OVERALL",
      engagementStatus: "NO_SUBMISSION",
    }),
  });
  const overviewInput = Object.freeze({
    context,
    methodology: rootMethodology,
    summary: Object.freeze({
      activeStudentsCount: 8,
      submittedStudentTaskCount: 3,
      aiDeliveryRate: 0,
      averageIssueLoadDelta: null,
    }),
    taskTrends: Object.freeze([
      Object.freeze({
        classroomTaskId: "root-trend",
        taskTitle: "正式任务",
        submittedStudentCount: 3,
        postFeedbackRevisionRate: 0,
      }),
    ]),
    data,
  });
  const studentsInput = Object.freeze({
    context,
    methodology: rootMethodology,
    page: 2,
    limit: 3,
    total: 4,
    activeStudentsTotal: 8,
    filters: Object.freeze({
      q: "正式",
      overallOutcome: "NO_NET_CHANGE",
      engagementStatus: "QUALITY_COMPARABLE",
    }),
    items: Object.freeze([
      Object.freeze({
        studentId: "root-student-2",
        studentName: "正式学生",
        studentNo: null,
        submittedTasksCount: 2,
        overallOutcome: "NO_NET_CHANGE",
        engagementStatus: "QUALITY_COMPARABLE",
      }),
      Object.freeze({ studentId: "root-student-1", studentName: "另一学生" }),
    ]),
    data,
  });
  const detailInput = Object.freeze({
    context,
    methodology: rootMethodology,
    student: Object.freeze({
      studentId: "root-student-2",
      studentName: "正式学生",
      studentNo: null,
    }),
    summary: Object.freeze({
      submittedTasksCount: 2,
      averageIssueLoadDelta: 0,
      overallOutcome: "NO_NET_CHANGE",
      engagementStatus: "QUALITY_COMPARABLE",
    }),
    taskPoints: Object.freeze([
      Object.freeze({
        classroomTaskId: "root-point",
        attemptsCount: 0,
        issueLoadDelta: null,
        latestRevision: null,
        hasNewerUncomparedRevision: true,
      }),
    ]),
    data,
  });
  const overviewBefore = structuredClone(overviewInput);
  const studentsBefore = structuredClone(studentsInput);
  const detailBefore = structuredClone(detailInput);
  const overview = toAiLearningAnalyticsOverviewResponse(overviewInput);
  const students = toAiLearningAnalyticsStudentsResponse(studentsInput);
  const detail = toAiLearningAnalyticsStudentDetailResponse(detailInput);

  expect(overview.summary).toMatchObject({
    activeStudentsCount: 8,
    submittedStudentTaskCount: 3,
    aiDeliveryRate: 0,
    averageIssueLoadDelta: null,
  });
  expect(overview.taskTrends).toMatchObject([
    {
      classroomTaskId: "root-trend",
      taskTitle: "正式任务",
      submittedStudentCount: 3,
      postFeedbackRevisionRate: 0,
    },
  ]);
  expect(students).toMatchObject({
    page: 2,
    limit: 3,
    total: 4,
    activeStudentsTotal: 8,
    filters: {
      q: "正式",
      overallOutcome: "NO_NET_CHANGE",
      engagementStatus: "QUALITY_COMPARABLE",
    },
  });
  expect(isValidPaginationTotal(students.total)).toBe(true);
  expect(isValidPaginationTotal(students.activeStudentsTotal)).toBe(true);
  expect(students.items.map((student) => student.studentId)).toEqual([
    "root-student-2",
    "root-student-1",
  ]);
  expect(students.items[0]).toMatchObject({
    studentName: "正式学生",
    studentNo: null,
    submittedTasksCount: 2,
    overallOutcome: "NO_NET_CHANGE",
    engagementStatus: "QUALITY_COMPARABLE",
  });
  expect(detail.student).toEqual({
    studentId: "root-student-2",
    studentName: "正式学生",
    studentNo: null,
  });
  expect(detail.summary).toMatchObject({
    submittedTasksCount: 2,
    averageIssueLoadDelta: 0,
    overallOutcome: "NO_NET_CHANGE",
    engagementStatus: "QUALITY_COMPARABLE",
  });
  expect(detail.taskPoints).toMatchObject([
    {
      classroomTaskId: "root-point",
      attemptsCount: 0,
      issueLoadDelta: null,
      latestRevision: null,
      hasNewerUncomparedRevision: true,
    },
  ]);
  for (const { response, input, before } of [
    { response: overview, input: overviewInput, before: overviewBefore },
    { response: students, input: studentsInput, before: studentsBefore },
    { response: detail, input: detailInput, before: detailBefore },
  ]) {
    expect(response.context).toMatchObject({
      classroomId: "root-classroom",
      classroomName: "根班级",
      courseId: "root-course",
      window: "30d",
      effectiveTaskCount: 2,
      excludedTaskIds: ["root-excluded-task"],
    });
    expect(response.methodology.version).toBe("AI_FEEDBACK_INTERVENTION_V1_2");
    expect(response.raw).toBe(input);
    expect(response.raw.data).toBe(data);
    expect(input).toStrictEqual(before);
  }
});

test("analytics student counts preserve zero, filtered empty results and empty pages with positive counts", () => {
  for (const counts of [
    { total: 0, activeStudentsTotal: 0 },
    { total: 0, activeStudentsTotal: 8 },
    { total: 4, activeStudentsTotal: 8 },
  ]) {
    const input = Object.freeze({
      ...counts,
      page: 2,
      limit: 3,
      items: Object.freeze([]),
      data: Object.freeze({ total: 99, activeStudentsTotal: 100 }),
      pagination: Object.freeze({ total: 77, activeStudentsTotal: 88 }),
    });
    const before = structuredClone(input);
    const students = toAiLearningAnalyticsStudentsResponse(input);

    expect(students.total).toBe(counts.total);
    expect(students.activeStudentsTotal).toBe(counts.activeStudentsTotal);
    expect(isValidPaginationTotal(students.total)).toBe(true);
    expect(isValidPaginationTotal(students.activeStudentsTotal)).toBe(true);
    expect(students.items).toEqual([]);
    expect(students.page).toBe(2);
    expect(students.limit).toBe(3);
    expect(students.raw).toBe(input);
    expect(input).toStrictEqual(before);
  }
});

test("analytics student count fields each reject invalid root values without rescuing them from old wrappers or another count", () => {
  const row = Object.freeze({
    studentId: "count-student",
    studentName: "计数学生",
    studentNo: null,
    submittedTasksCount: 0,
  });
  const data = Object.freeze({ total: 99, activeStudentsTotal: 100 });
  const pagination = Object.freeze({ total: 77, activeStudentsTotal: 88 });
  for (const { field, otherField, validCounts, expectedOther } of [
    {
      field: "total",
      otherField: "activeStudentsTotal",
      validCounts: { activeStudentsTotal: 8 },
      expectedOther: 8,
    },
    {
      field: "activeStudentsTotal",
      otherField: "total",
      validCounts: { total: 4 },
      expectedOther: 4,
    },
  ] as const) {
    for (const { value, expected } of [
      { value: undefined, expected: undefined },
      { value: null, expected: undefined },
      { value: "4", expected: undefined },
      { value: Number.NaN, expected: undefined },
      { value: Number.POSITIVE_INFINITY, expected: undefined },
      { value: Number.NEGATIVE_INFINITY, expected: undefined },
      { value: -1, expected: -1 },
      { value: 1.5, expected: 1.5 },
      { value: Number.MAX_SAFE_INTEGER + 1, expected: 9007199254740992 },
    ]) {
      const input = Object.freeze({
        ...validCounts,
        ...(value === undefined ? {} : { [field]: value }),
        page: 2,
        limit: 3,
        items: Object.freeze([row]),
        data,
        pagination,
      });
      const before = structuredClone(input);
      const students = toAiLearningAnalyticsStudentsResponse(input);

      expect(students[field]).toBe(expected);
      expect(isValidPaginationTotal(students[field])).toBe(false);
      expect(students[otherField]).toBe(expectedOther);
      expect(isValidPaginationTotal(students[otherField])).toBe(true);
      expect(students.items).toHaveLength(1);
      expect(students.items[0]).toMatchObject({
        studentId: "count-student",
        studentName: "计数学生",
        studentNo: null,
        submittedTasksCount: 0,
      });
      expect(students.items[0]).not.toHaveProperty("raw");
      expect(students.page).toBe(2);
      expect(students.limit).toBe(3);
      expect(students.raw).toBe(input);
      expect(students.raw.data).toBe(data);
      expect(students.raw.pagination).toBe(pagination);
      expect(input).toStrictEqual(before);
    }
  }
});

test("analytics adapters do not unwrap data-only responses or rescue empty and invalid root fields", () => {
  const data = Object.freeze({
    context: Object.freeze({ classroomId: "ignored-classroom", window: "7d" }),
    methodology: Object.freeze({ version: "AI_FEEDBACK_INTERVENTION_V1_2" }),
    summary: Object.freeze({
      activeStudentsCount: 7,
      submittedTasksCount: 6,
      averageIssueLoadDelta: 5,
    }),
    student: Object.freeze({
      studentId: "ignored-student",
      studentName: "嵌套学生",
    }),
    taskTrends: Object.freeze([
      Object.freeze({ classroomTaskId: "ignored-trend" }),
    ]),
    items: Object.freeze([Object.freeze({ studentId: "ignored-student" })]),
    taskPoints: Object.freeze([
      Object.freeze({ classroomTaskId: "ignored-point" }),
    ]),
    page: 9,
    limit: 1,
    total: 7,
    activeStudentsTotal: 10,
    filters: Object.freeze({
      q: "ignored",
      overallOutcome: "REGRESSED_OVERALL",
      engagementStatus: "QUALITY_COMPARABLE",
    }),
  });
  for (const { input, expectedCounts } of [
    {
      input: Object.freeze({ data }),
      expectedCounts: { total: undefined, activeStudentsTotal: undefined },
    },
    {
      input: Object.freeze({
        context: Object.freeze({}),
        methodology: Object.freeze({}),
        summary: Object.freeze({}),
        student: Object.freeze({}),
        taskTrends: Object.freeze([]),
        items: Object.freeze([]),
        taskPoints: Object.freeze([]),
        filters: Object.freeze({}),
        data,
      }),
      expectedCounts: { total: undefined, activeStudentsTotal: undefined },
    },
    {
      input: Object.freeze({
        context: null,
        methodology: false,
        summary: Object.freeze([]),
        student: "invalid",
        taskTrends: null,
        items: Object.freeze({}),
        taskPoints: false,
        page: "9",
        limit: null,
        total: Number.NaN,
        activeStudentsTotal: -1,
        filters: null,
        data,
      }),
      expectedCounts: { total: undefined, activeStudentsTotal: -1 },
    },
  ]) {
    const before = structuredClone(input);
    const overview = toAiLearningAnalyticsOverviewResponse(input);
    const students = toAiLearningAnalyticsStudentsResponse(input);
    const detail = toAiLearningAnalyticsStudentDetailResponse(input);

    expect(overview.summary).toMatchObject({
      activeStudentsCount: 0,
      averageIssueLoadDelta: null,
    });
    expect(overview.taskTrends).toEqual([]);
    expect(students).toMatchObject({
      page: 1,
      limit: 20,
      total: expectedCounts.total,
      activeStudentsTotal: expectedCounts.activeStudentsTotal,
      filters: {
        q: null,
        overallOutcome: undefined,
        engagementStatus: undefined,
      },
      items: [],
    });
    expect(isValidPaginationTotal(students.total)).toBe(false);
    expect(isValidPaginationTotal(students.activeStudentsTotal)).toBe(false);
    expect(detail.student).toEqual({
      studentId: "",
      studentName: "未知学生",
      studentNo: null,
    });
    expect(detail.summary).toMatchObject({
      submittedTasksCount: 0,
      averageIssueLoadDelta: null,
      overallOutcome: undefined,
      engagementStatus: undefined,
    });
    expect(detail.taskPoints).toEqual([]);
    for (const response of [overview, students, detail]) {
      expect(response.context).toMatchObject({
        classroomId: "",
        classroomName: "未命名班级",
        window: undefined,
        effectiveTaskCount: 0,
        excludedTaskIds: [],
      });
      expect(response.methodology.version).toBe("UNKNOWN");
      expect(response.raw).toBe(input);
      expect(response.raw.data).toBe(data);
    }
    expect(input).toStrictEqual(before);
  }
});
test("uncompared revision messaging distinguishes absence of a reference from uncertain timing", () => {
  const cases = [
    {
      point: { hasNewerUncomparedRevision: true, latestRevision: null },
      expected: "存在较新版本未纳入当前比较。",
    },
    {
      point: { hasNewerUncomparedRevision: false },
      expected: "未发现可确认的较新未纳入版本。",
    },
    {
      point: {
        hasNewerUncomparedRevision: null,
        baselineReview: null,
        comparisonReview: null,
        latestRevision: {
          submissionId: "known-latest",
          attemptNo: 1,
          contentRevision: 0,
          submittedAt: "2026-10-01T00:00:00.000Z",
          lastEditedAt: null,
          contentVersionAt: "2026-10-01T00:00:00.000Z",
          feedbackCompletedAt: null,
          provider: null,
          model: null,
        },
      },
      expected: "尚无比较基线，暂无法判断较新未纳入版本。",
    },
    {
      point: {
        hasNewerUncomparedRevision: null,
        baselineReview: { submissionId: "baseline" },
      },
      expected: "时间信息不足，无法确认是否存在较新未纳入版本。",
    },
  ];
  for (const { point: input, expected } of cases) {
    const point = toAiLearningAnalyticsStudentDetailResponse({
      taskPoints: [input],
    }).taskPoints[0];
    expect(
      getAiLearningAnalyticsUncomparedRevisionMessage(
        point.hasNewerUncomparedRevision,
        Boolean(point.baselineReview || point.comparisonReview),
      ),
    ).toBe(expected);
  }
});

test("all three API adapters accept V1.2 and retain their evidence summaries", () => {
  const overview = toAiLearningAnalyticsOverviewResponse({
    methodology,
    summary: {
      evidenceSummary: evidence,
      postFeedbackRevisedStudentTaskCount: 3,
    },
    taskTrends: [
      { evidenceSummary: evidence, postFeedbackRevisedStudentCount: 2 },
    ],
  });
  const students = toAiLearningAnalyticsStudentsResponse({
    methodology,
    items: [{ evidenceSummary: evidence, postFeedbackRevisedTasksCount: 1 }],
  });
  const detail = toAiLearningAnalyticsStudentDetailResponse({
    methodology,
    summary: { evidenceSummary: evidence, postFeedbackRevisedTasksCount: 1 },
  });
  for (const response of [overview, students, detail]) {
    expect(response.methodology.version).toBe("AI_FEEDBACK_INTERVENTION_V1_2");
    expect(
      getAiLearningAnalyticsMethodologyVersionLabel(
        response.methodology.version,
      ),
    ).toBe("V1.2");
  }
  for (const summary of [
    overview.summary,
    overview.taskTrends[0],
    students.items[0],
    detail.summary,
  ]) {
    expect(summary.evidenceSummary).toEqual(evidence);
  }
  expect(overview.summary.postFeedbackRevisedStudentTaskCount).toBe(3);
  expect(overview.taskTrends[0].postFeedbackRevisedStudentCount).toBe(2);
  expect(students.items[0].postFeedbackRevisedTasksCount).toBe(1);
  expect(detail.summary.postFeedbackRevisedTasksCount).toBe(1);
});

test("nullable metrics preserve unknown, real zero and small nonzero values at every level", () => {
  const fields = [
    "aiStudentCoverageRate",
    "aiTaskCoverageRate",
    "aiDeliveryRate",
    "postFeedbackResubmissionRate",
    "postFeedbackRevisionRate",
    "postFeedbackCodeChangeRate",
    "qualityComparableRate",
    "improvedRate",
    "remainedCleanRate",
    "unchangedWithIssuesRate",
    "regressedRate",
    "averageIssueLoadBefore",
    "averageIssueLoadAfter",
    "averageIssueLoadDelta",
  ];
  for (const value of [null, 0, 0.00000003, -0.00000003]) {
    const metrics = Object.fromEntries(fields.map((field) => [field, value]));
    const overview = toAiLearningAnalyticsOverviewResponse({
      summary: metrics,
      taskTrends: [metrics],
    });
    const students = toAiLearningAnalyticsStudentsResponse({
      items: [metrics],
    });
    const detail = toAiLearningAnalyticsStudentDetailResponse({
      summary: metrics,
    });
    for (const actual of [
      overview.summary,
      overview.taskTrends[0],
      students.items[0],
      detail.summary,
    ]) {
      for (const [key, actualValue] of Object.entries(actual)) {
        if (fields.includes(key)) expect(actualValue, key).toBe(value);
      }
    }
  }
  expect(
    toAiLearningAnalyticsOverviewResponse({}).summary.averageIssueLoadDelta,
  ).toBeNull();
  expect(
    toAiLearningAnalyticsStudentsResponse({ items: [{}] }).items[0]
      .postFeedbackRevisionRate,
  ).toBeNull();
});

test("task comparison projects safe endpoint metadata and distinguishes unknown from false", () => {
  const baseline = {
    submissionId: "before/作品",
    attemptNo: 2,
    contentRevision: 1,
    submittedAt: "2026-10-01T00:00:00.000Z",
    lastEditedAt: "2026-10-01T01:00:00.000Z",
    contentVersionAt: "2026-10-01T01:00:00.000Z",
    feedbackCompletedAt: "2026-10-01T02:00:00.000Z",
    provider: null,
    model: null,
  };
  const comparison = {
    ...baseline,
    submissionId: "after/作品",
    attemptNo: 1,
    contentRevision: 3,
    provider: "bailian",
    model: "historic-model",
  };
  const latest = {
    ...comparison,
    submissionId: "newest",
    attemptNo: 4,
    feedbackCompletedAt: null,
  };
  const point = toAiLearningAnalyticsStudentDetailResponse({
    taskPoints: [
      {
        baselineReview: {
          ...baseline,
          requests: [{ secret: "synthetic-private" }],
          codeText: "private-source",
        },
        comparisonReview: comparison,
        latestRevision: latest,
        hasNewerUncomparedRevision: true,
        postFeedbackRevised: true,
        postFeedbackResubmitted: false,
        comparisonWarnings: [
          "SOURCE_UNKNOWN",
          "MODEL_UNKNOWN",
          "EMPTY_FEEDBACK",
          "FUTURE",
        ],
      },
    ],
  }).taskPoints[0];
  expect(point.baselineReview).toEqual(baseline);
  expect(point.comparisonReview).toEqual(comparison);
  expect(point.latestRevision).toEqual(latest);
  expect(point.hasNewerUncomparedRevision).toBe(true);
  expect(point.postFeedbackRevised).toBe(true);
  expect(point.postFeedbackResubmitted).toBe(false);
  expect(point.comparisonWarnings).toEqual([
    "EMPTY_FEEDBACK",
    "SOURCE_UNKNOWN",
    "MODEL_UNKNOWN",
  ]);
  const uncertain = toAiLearningAnalyticsStudentDetailResponse({
    taskPoints: [{ hasNewerUncomparedRevision: null }],
  }).taskPoints[0];
  expect(uncertain.hasNewerUncomparedRevision).toBeNull();
  expect(uncertain.baselineReview).toBeNull();
  expect(uncertain.comparisonReview).toBeNull();
  expect(uncertain.latestRevision).toBeNull();
  for (const attemptNo of [undefined, null, 0, -1, 1.5, "2"]) {
    const legacy = toAiLearningAnalyticsStudentDetailResponse({
      taskPoints: [{ baselineReview: { submissionId: "legacy", attemptNo } }],
    }).taskPoints[0];
    expect(legacy.baselineReview?.attemptNo).toBeNull();
  }
  expect(
    toAiLearningAnalyticsStudentDetailResponse({
      taskPoints: [{ hasNewerUncomparedRevision: false }],
    }).taskPoints[0].hasNewerUncomparedRevision,
  ).toBe(false);
});

test("small signed deltas and percentages never masquerade as exact zero", () => {
  expect(formatAiLearningAnalyticsDelta(0.00000003)).toBe("+3e-8");
  expect(formatAiLearningAnalyticsDelta(-0.00000003)).toBe("-3e-8");
  expect(getAiLearningAnalyticsDeltaMeaning(0.00000003)).toBe("负荷下降");
  expect(getAiLearningAnalyticsDeltaMeaning(-0.00000003)).toBe("负荷上升");
  expect(formatAiLearningAnalyticsPercent(0.00000003)).toBe("<0.001%");
  expect(formatAiLearningAnalyticsPercent(0)).toBe("0%");
  expect(formatAiLearningAnalyticsDelta(0)).toBe("0");
  expect(formatAiLearningAnalyticsIssueLoad(null)).toBe("—");
  expect(formatAiLearningAnalyticsPercent(null)).toBe("—");
  expect(formatAiLearningAnalyticsDelta(null)).toBe("—");
});

test("zero events and complete revision produce no invented teaching extreme", () => {
  const task = toAiLearningAnalyticsOverviewResponse({
    taskTrends: [
      {
        classroomTaskId: "complete",
        aiDeliveredStudentCount: 5,
        postFeedbackRevisedStudentCount: 5,
        postFeedbackRevisionRate: 1,
        qualityComparableStudentCount: 2,
        improvedStudentCount: 0,
        regressedStudentCount: 0,
        improvedRate: 0,
      },
    ],
  }).taskTrends[0];
  expect(selectAiLearningAnalyticsTeachingAttention([task])).toEqual({
    lowestRevisionTask: null,
    mostRegressedTask: null,
    highestImprovedRateTask: null,
  });
  const needsReview = {
    ...task,
    classroomTaskId: "partial",
    postFeedbackRevisedStudentCount: 1,
    postFeedbackRevisionRate: 0.2,
    improvedStudentCount: 1,
    regressedStudentCount: 1,
    improvedRate: 0.5,
  };
  const selected = selectAiLearningAnalyticsTeachingAttention([
    task,
    needsReview,
  ]);
  expect(selected.lowestRevisionTask?.classroomTaskId).toBe("partial");
  expect(selected.mostRegressedTask?.classroomTaskId).toBe("partial");
  expect(selected.highestImprovedRateTask?.classroomTaskId).toBe("partial");
});

test("both review links preserve the actual submission and classroom context", () => {
  expect(
    buildAiLearningAnalyticsSubmissionHref(
      "before/作品",
      "class one",
      "task/two",
    ),
  ).toBe(
    "/teacher/submissions/before%2F%E4%BD%9C%E5%93%81?classroomId=class+one&classroomTaskId=task%2Ftwo",
  );
  expect(
    buildAiLearningAnalyticsSubmissionHref(
      "after/作品",
      "class one",
      "task/two",
    ),
  ).toBe(
    "/teacher/submissions/after%2F%E4%BD%9C%E5%93%81?classroomId=class+one&classroomTaskId=task%2Ftwo",
  );
});

test("revision stages replace resubmission stages and evidence notes retain overlapping counts", () => {
  expect(
    parseAiLearningAnalyticsEngagementStatus("AI_DELIVERED_WITHOUT_REVISION"),
  ).toBe("AI_DELIVERED_WITHOUT_REVISION");
  expect(
    parseAiLearningAnalyticsEngagementStatus("REVISED_WITHOUT_COMPARABLE"),
  ).toBe("REVISED_WITHOUT_COMPARABLE");
  expect(
    parseAiLearningAnalyticsEngagementStatus("RESUBMITTED_WITHOUT_COMPARABLE"),
  ).toBeUndefined();
  expect(getAiLearningAnalyticsEvidenceNotes(evidence)).toEqual([
    "来源或模型信息不完整的可对照样本 2",
    "已知模型不同的可对照样本 1",
    "存在已排除模拟评阅的样本 1",
  ]);
});
