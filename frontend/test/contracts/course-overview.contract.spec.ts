import { expect, test } from "@playwright/test";
import { toCourseOverviewResponse } from "../../lib/api/types-teacher";
import { buildCourseOverviewSummary, formatCourseOverviewRatio } from "../../lib/course-overview";

const singleClassroomCases = [
  { ratio: 0.005, display: "0.5%" },
  { ratio: 0.01, display: "1%" },
  { ratio: 1, display: "100%" },
  { ratio: 0, display: "0%" },
];

for (const { ratio, display } of singleClassroomCases) {
  test(`course overview shows ${display} in both the detail row and single-classroom summary`, () => {
    const data = toCourseOverviewResponse({
      items: [{ overallSubmissionCoverage: ratio, ai: { aiSuccessRate: ratio } }],
    });
    const [row] = data.items;
    const summary = buildCourseOverviewSummary(data);

    expect(formatCourseOverviewRatio(row.overallSubmissionCoverage)).toBe(display);
    expect(formatCourseOverviewRatio(row.aiSuccessRate)).toBe(display);
    expect(summary.averageOverallSubmissionCoverageInPage).toBe(ratio);
    expect(summary.averageAiSuccessRateInPage).toBe(ratio);
    expect(formatCourseOverviewRatio(summary.averageOverallSubmissionCoverageInPage)).toBe(display);
    expect(formatCourseOverviewRatio(summary.averageAiSuccessRateInPage)).toBe(display);
  });
}

test("course overview excludes missing ratios and includes zero in each current-page average", () => {
  const data = toCourseOverviewResponse({
    total: 9,
    items: [
      { overallSubmissionCoverage: 0.02, ai: { aiSuccessRate: 0.01 } },
      { overallSubmissionCoverage: 0, ai: { aiSuccessRate: 0 } },
      { ai: { aiSuccessRate: null } },
    ],
  });
  const summary = buildCourseOverviewSummary(data);

  expect(summary.classroomsTotal).toBe(9);
  expect(summary.classroomsInPage).toBe(3);
  expect(summary.averageOverallSubmissionCoverageInPage).toBe(0.01);
  expect(summary.averageAiSuccessRateInPage).toBe(0.005);
  expect(formatCourseOverviewRatio(summary.averageOverallSubmissionCoverageInPage)).toBe("1%");
  expect(formatCourseOverviewRatio(summary.averageAiSuccessRateInPage)).toBe("0.5%");
});

test("course overview uses a dash for absent samples in the detail rows and summary", () => {
  const data = toCourseOverviewResponse({
    items: [{ ai: { aiSuccessRate: null } }, { ai: { aiSuccessRate: null } }],
  });
  const summary = buildCourseOverviewSummary(data);

  for (const row of data.items) {
    expect(formatCourseOverviewRatio(row.overallSubmissionCoverage)).toBe("—");
    expect(formatCourseOverviewRatio(row.aiSuccessRate)).toBe("—");
  }
  expect(formatCourseOverviewRatio(summary.averageOverallSubmissionCoverageInPage)).toBe("—");
  expect(formatCourseOverviewRatio(summary.averageAiSuccessRateInPage)).toBe("—");
});

test("course overview uses a dash for an empty page", () => {
  const summary = buildCourseOverviewSummary(toCourseOverviewResponse({ items: [] }));

  expect(formatCourseOverviewRatio(summary.averageOverallSubmissionCoverageInPage)).toBe("—");
  expect(formatCourseOverviewRatio(summary.averageAiSuccessRateInPage)).toBe("—");
});
