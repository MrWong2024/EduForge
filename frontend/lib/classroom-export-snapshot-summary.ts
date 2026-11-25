import type { ExportSnapshotResponse } from "./api/types-teacher";
import { getFeedbackSeverityLabel, getFeedbackTypeLabel } from "./ui/feedback-options";
import { getFeedbackTagLabel } from "./ui/feedback-tags";
import { safeGet, toDisplayText } from "./ui/format";

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
});

const displayCount = (value: unknown): string =>
  toDisplayText(typeof value === "number" ? value : undefined);

const displayRatio = (value: unknown): string =>
  typeof value === "number" && value >= 0 && value <= 1
    ? percentFormatter.format(value)
    : "—";

const displayIssueList = (
  value: unknown,
  key: "tag" | "type" | "severity",
  getLabel: (value: unknown) => string,
): string => {
  if (!Array.isArray(value)) {
    return "—";
  }
  if (value.length === 0) {
    return "暂无统计条目";
  }

  return value.map((entry: unknown) => {
    const label = getLabel(safeGet(entry, key, undefined));
    const count = displayCount(safeGet(entry, "count", undefined));
    return `${label}（${count === "—" ? count : `${count} 次`}）`;
  }).join("、");
};

export const buildClassroomExportSnapshotSummary = (
  summary: ExportSnapshotResponse["summary"],
) => ({
  progress: {
    studentsCount: displayCount(safeGet(summary, "progress.studentsCount", undefined)),
    distinctStudentsSubmitted: displayCount(
      safeGet(summary, "progress.distinctStudentsSubmitted", undefined),
    ),
    submissionRate: displayRatio(safeGet(summary, "progress.submissionRate", undefined)),
  },
  aiHealth: {
    jobsTotal: displayCount(safeGet(summary, "aiHealth.jobs.total", undefined)),
    jobsSucceeded: displayCount(safeGet(summary, "aiHealth.jobs.succeeded", undefined)),
    successRate: displayRatio(safeGet(summary, "aiHealth.successRate", undefined)),
  },
  commonIssues: {
    topTags: displayIssueList(
      safeGet(summary, "commonIssues.topTags", undefined),
      "tag",
      getFeedbackTagLabel,
    ),
    topTypes: displayIssueList(
      safeGet(summary, "commonIssues.topTypes", undefined),
      "type",
      getFeedbackTypeLabel,
    ),
    topSeverities: displayIssueList(
      safeGet(summary, "commonIssues.topSeverities", undefined),
      "severity",
      getFeedbackSeverityLabel,
    ),
  },
  late: {
    lateStudentsCount: displayCount(safeGet(summary, "late.lateStudentsCount", undefined)),
    lateSubmissionsCount: displayCount(
      safeGet(summary, "late.lateSubmissionsCount", undefined),
    ),
  },
});
