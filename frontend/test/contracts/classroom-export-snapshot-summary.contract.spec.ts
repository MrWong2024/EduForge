import { expect, test } from "@playwright/test";
import { toExportSnapshotResponse } from "../../lib/api/types-teacher";
import { buildClassroomExportSnapshotSummary } from "../../lib/classroom-export-snapshot-summary";

test("snapshot preview displays the nested progress, AI, issues and late summaries", () => {
  const { summary } = toExportSnapshotResponse({
    summary: {
      progress: { studentsCount: 8, distinctStudentsSubmitted: 4, submissionRate: 0.5 },
      aiHealth: { jobs: { total: 6, succeeded: 3 }, successRate: 0.5 },
      commonIssues: {
        topTags: [{ tag: "readability", count: 2 }, { tag: "style", count: 1 }],
        topTypes: [{ type: "SYNTAX", count: 2 }],
        topSeverities: [{ severity: "WARN", count: 3 }],
      },
      late: { lateStudentsCount: 2, lateSubmissionsCount: 3 },
    },
  });

  expect(buildClassroomExportSnapshotSummary(summary)).toEqual({
    progress: { studentsCount: "8", distinctStudentsSubmitted: "4", submissionRate: "50%" },
    aiHealth: { jobsTotal: "6", jobsSucceeded: "3", successRate: "50%" },
    commonIssues: {
      topTags: "readability - 可读性（2 次）、style - 代码风格（1 次）",
      topTypes: "SYNTAX - 语法（2 次）",
      topSeverities: "WARN - 警告（3 次）",
    },
    late: { lateStudentsCount: "2", lateSubmissionsCount: "3" },
  });
});

test("snapshot preview displays numeric zeros and describes explicitly empty issue lists", () => {
  const { summary } = toExportSnapshotResponse({
    summary: {
      progress: { studentsCount: 0, distinctStudentsSubmitted: 0, submissionRate: 0 },
      aiHealth: { jobs: { total: 0, succeeded: 0 }, successRate: 0 },
      commonIssues: { topTags: [], topTypes: [], topSeverities: [] },
      late: { lateStudentsCount: 0, lateSubmissionsCount: 0 },
    },
  });

  expect(buildClassroomExportSnapshotSummary(summary)).toEqual({
    progress: { studentsCount: "0", distinctStudentsSubmitted: "0", submissionRate: "0%" },
    aiHealth: { jobsTotal: "0", jobsSucceeded: "0", successRate: "0%" },
    commonIssues: {
      topTags: "暂无统计条目",
      topTypes: "暂无统计条目",
      topSeverities: "暂无统计条目",
    },
    late: { lateStudentsCount: "0", lateSubmissionsCount: "0" },
  });
});

test("snapshot preview distinguishes missing fields from measured zeros or empty lists", () => {
  const { summary } = toExportSnapshotResponse({
    summary: {
      progress: { studentsCount: 0, submissionRate: null },
      aiHealth: { jobs: { total: 0 } },
      commonIssues: {
        topTags: [{ tag: "readability" }],
        topTypes: [],
      },
      late: { lateSubmissionsCount: 0 },
    },
  });

  expect(buildClassroomExportSnapshotSummary(summary)).toEqual({
    progress: { studentsCount: "0", distinctStudentsSubmitted: "—", submissionRate: "—" },
    aiHealth: { jobsTotal: "0", jobsSucceeded: "—", successRate: "—" },
    commonIssues: {
      topTags: "readability - 可读性（—）",
      topTypes: "暂无统计条目",
      topSeverities: "—",
    },
    late: { lateStudentsCount: "—", lateSubmissionsCount: "0" },
  });
});
