import type { CourseOverviewResponse } from "./api/types-teacher";

type CourseOverviewSummary = {
  classroomsTotal: number;
  classroomsInPage: number;
  averageOverallSubmissionCoverageInPage?: number;
  averageAiSuccessRateInPage?: number;
};

const isRatio = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export const formatCourseOverviewRatio = (ratio: number | null | undefined): string => {
  if (!isRatio(ratio)) {
    return "—";
  }

  const percent = ratio * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

export const buildCourseOverviewSummary = (
  { items, total }: CourseOverviewResponse,
): CourseOverviewSummary => {
  let overallSubmissionCoverageSum = 0;
  let overallSubmissionCoverageCount = 0;
  let aiSuccessRateSum = 0;
  let aiSuccessRateCount = 0;

  for (const { overallSubmissionCoverage, aiSuccessRate } of items) {
    if (isRatio(overallSubmissionCoverage)) {
      overallSubmissionCoverageSum += overallSubmissionCoverage;
      overallSubmissionCoverageCount += 1;
    }

    if (isRatio(aiSuccessRate)) {
      aiSuccessRateSum += aiSuccessRate;
      aiSuccessRateCount += 1;
    }
  }

  return {
    classroomsTotal: typeof total === "number" ? total : items.length,
    classroomsInPage: items.length,
    averageOverallSubmissionCoverageInPage:
      overallSubmissionCoverageCount > 0
        ? overallSubmissionCoverageSum / overallSubmissionCoverageCount
        : undefined,
    averageAiSuccessRateInPage:
      aiSuccessRateCount > 0 ? aiSuccessRateSum / aiSuccessRateCount : undefined,
  };
};
