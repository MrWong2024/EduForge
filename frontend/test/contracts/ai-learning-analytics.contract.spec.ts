import { expect, test } from "@playwright/test";
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

test("retired analytics fields stay outside normalized projections without changing current metrics or raw sources", () => {
  const overviewSource = {
    summary: {
      remainedCleanStudentTaskCount: 1,
      unchangedWithIssuesStudentTaskCount: 2,
      stableStudentTaskCount: 99,
    },
    taskTrends: [
      {
        classroomTaskId: "task-current",
        remainedCleanStudentCount: 1,
        unchangedWithIssuesStudentCount: 2,
        stableStudentCount: 99,
      },
    ],
  };
  const studentsSource = {
    items: [
      {
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
      },
      {
        studentId: "student-legacy-only",
        stableTasksCount: 99,
        growthTrend: "IMPROVING",
      },
    ],
  };
  const detailSource = {
    summary: {
      remainedCleanTasksCount: 1,
      unchangedWithIssuesTasksCount: 2,
      stableTasksCount: 99,
      overallOutcome: "NO_NET_CHANGE",
      engagementStatus: "QUALITY_COMPARABLE",
      growthTrend: "DECLINING",
    },
    taskPoints: [
      {
        classroomTaskId: "task-current",
        detailedOutcome: "REMAINED_CLEAN",
        outcome: "REGRESSED",
        postFeedbackRevised: true,
        postFeedbackResubmitted: false,
      },
      { classroomTaskId: "task-legacy-only", outcome: "IMPROVED" },
    ],
  };
  const overviewInput = { data: overviewSource };
  const studentsInput = { data: studentsSource };
  const detailInput = { data: detailSource };
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
    overallOutcome: "INSUFFICIENT_DATA",
    engagementStatus: "NO_SUBMISSION",
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
  expect(detail.taskPoints[1].detailedOutcome).toBe("NOT_COMPARABLE");

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
