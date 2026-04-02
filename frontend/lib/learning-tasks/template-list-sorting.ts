import type { LearningTaskOption } from "@/lib/api/types-teacher";
import type { TaskTemplateScope } from "@/lib/learning-tasks/template-visibility-scope";

type SortTasksByScopeOptions = {
  scope: TaskTemplateScope;
  currentUserId?: string;
};

const toTimestamp = (value: string | undefined): number => {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const toStatusUpper = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const isPublishedTask = (task: LearningTaskOption): boolean =>
  toStatusUpper(task.status) === "PUBLISHED";

const isOwnerTask = (
  task: LearningTaskOption,
  currentUserId: string | undefined
): boolean => {
  if (!currentUserId) {
    return true;
  }
  if (!task.createdById) {
    return true;
  }
  return task.createdById === currentUserId;
};

const compareByUpdatedThenCreatedDesc = (
  left: LearningTaskOption,
  right: LearningTaskOption
): number => {
  const leftUpdated = toTimestamp(left.updatedAt ?? left.createdAt);
  const rightUpdated = toTimestamp(right.updatedAt ?? right.createdAt);
  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }

  const leftCreated = toTimestamp(left.createdAt);
  const rightCreated = toTimestamp(right.createdAt);
  if (leftCreated !== rightCreated) {
    return rightCreated - leftCreated;
  }

  const leftTitle = (left.title ?? "").trim();
  const rightTitle = (right.title ?? "").trim();
  if (leftTitle !== rightTitle) {
    return leftTitle.localeCompare(rightTitle, "zh-CN");
  }

  return (left.id ?? "").localeCompare(right.id ?? "");
};

const compareSharedPool = (left: LearningTaskOption, right: LearningTaskOption): number => {
  const leftPublishedRank = isPublishedTask(left) ? 0 : 1;
  const rightPublishedRank = isPublishedTask(right) ? 0 : 1;
  if (leftPublishedRank !== rightPublishedRank) {
    return leftPublishedRank - rightPublishedRank;
  }
  return compareByUpdatedThenCreatedDesc(left, right);
};

const compareAllScope = (
  left: LearningTaskOption,
  right: LearningTaskOption,
  currentUserId: string | undefined
): number => {
  const leftOwnerRank = isOwnerTask(left, currentUserId) ? 0 : 1;
  const rightOwnerRank = isOwnerTask(right, currentUserId) ? 0 : 1;
  if (leftOwnerRank !== rightOwnerRank) {
    return leftOwnerRank - rightOwnerRank;
  }

  if (leftOwnerRank === 0) {
    return compareByUpdatedThenCreatedDesc(left, right);
  }
  return compareSharedPool(left, right);
};

export const sortTaskTemplatesByScope = (
  tasks: LearningTaskOption[],
  options: SortTasksByScopeOptions
): LearningTaskOption[] => {
  const sorted = [...tasks];

  if (options.scope === "mine") {
    return sorted.sort((left, right) =>
      compareByUpdatedThenCreatedDesc(left, right)
    );
  }

  if (options.scope === "shared") {
    return sorted.sort((left, right) => compareSharedPool(left, right));
  }

  return sorted.sort((left, right) =>
    compareAllScope(left, right, options.currentUserId)
  );
};
