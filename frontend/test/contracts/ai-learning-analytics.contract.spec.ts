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
