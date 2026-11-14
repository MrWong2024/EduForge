import type {
  DashboardResponse,
  TeacherDashboardTaskItem,
} from "@/lib/api/types-teacher";
import { safeGet, toDisplayText } from "@/lib/ui/format";

type UnknownRecord = Record<string, unknown>;

const toOptionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const toCount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return undefined;
};

const toTopTags = (
  item: TeacherDashboardTaskItem,
): Array<{ key: string; label: string; count?: number }> => {
  const rawTags = safeGet<unknown[]>(item, "topTags", []);
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const result: Array<{ key: string; label: string; count?: number }> = [];
  const seen = new Set<string>();

  rawTags.forEach((tagItem, index) => {
    if (result.length >= 3) {
      return;
    }

    const tagRecord =
      tagItem && typeof tagItem === "object" && !Array.isArray(tagItem)
        ? (tagItem as UnknownRecord)
        : undefined;
    const label = toOptionalText(tagRecord?.tag);
    if (!label) {
      return;
    }

    const normalized = label.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);

    result.push({
      key: `${normalized}-${index}`,
      label,
      count: toCount(tagRecord?.count),
    });
  });

  return result;
};

export const getTeacherDashboardSummary = (
  dashboard: DashboardResponse,
  taskCount: number,
) => ({
  studentsCount:
    toCount(safeGet<unknown>(dashboard, "summary.studentsCount", undefined)) ??
    0,
  publishedTasksCount:
    toCount(
      safeGet<unknown>(dashboard, "summary.publishedTasksCount", undefined),
    ) ?? taskCount,
  lateStudentsTotal:
    toCount(
      safeGet<unknown>(dashboard, "summary.lateStudentsTotal", undefined),
    ) ?? 0,
});

export const getTeacherDashboardTaskDisplay = (
  item: TeacherDashboardTaskItem,
) => ({
  classroomTaskId: toOptionalText(item.classroomTaskId),
  title: toDisplayText(item.title, "未命名任务"),
  submittedStudentsCount: toCount(item.distinctStudentsSubmitted) ?? 0,
  submissionsCount: toCount(item.submissionsCount) ?? 0,
  lateDistinctStudentsCount: toCount(item.lateDistinctStudentsCount) ?? 0,
  lateSubmissionsCount: toCount(item.lateSubmissionsCount) ?? 0,
  aiBreakdown: {
    succeeded:
      toCount(safeGet<unknown>(item, "aiFeedback.succeeded", undefined)) ?? 0,
    failed:
      toCount(safeGet<unknown>(item, "aiFeedback.failed", undefined)) ?? 0,
    pending:
      toCount(safeGet<unknown>(item, "aiFeedback.pending", undefined)) ?? 0,
    running:
      toCount(safeGet<unknown>(item, "aiFeedback.running", undefined)) ?? 0,
    dead:
      toCount(safeGet<unknown>(item, "aiFeedback.dead", undefined)) ?? 0,
    unknown:
      toCount(safeGet<unknown>(item, "aiFeedback.unknown", undefined)) ?? 0,
    notRequested:
      toCount(safeGet<unknown>(item, "aiFeedback.notRequested", undefined)) ??
      0,
  },
  topTags: toTopTags(item),
});
