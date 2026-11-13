import type { CourseOverviewItem } from "@/lib/api/types-teacher";

const isValidRatio = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const toCourseOverviewPercentText = (value: unknown): string => {
  if (!isValidRatio(value)) {
    return "—";
  }

  const percent = value * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

const averageRatio = (values: readonly unknown[]): number | undefined => {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (isValidRatio(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : undefined;
};

export const averageOverallSubmissionCoverage = (
  items: readonly Pick<CourseOverviewItem, "overallSubmissionCoverage">[],
): number | undefined =>
  averageRatio(items.map((item) => item.overallSubmissionCoverage));

export const averageAiSuccessRate = (
  items: readonly Pick<CourseOverviewItem, "aiSuccessRate">[],
): number | undefined => averageRatio(items.map((item) => item.aiSuccessRate));
