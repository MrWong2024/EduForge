"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { paths } from "@/lib/routes/paths";

export type ExcludeTasksPanelTask = {
  id: string;
  title: string;
  publishedAt?: string | null;
  metaText: string;
};

type SearchParamEntry = readonly [string, string];

type ExcludeTasksPanelProps = {
  classroomId: string;
  window: string;
  initialExcludedTaskIds: string[];
  tasks: ExcludeTasksPanelTask[];
  initialQueryEntries: SearchParamEntry[];
  taskOptionsLoadError?: string;
  currentPathname?: string;
};

const normalizeTaskIds = (taskIds: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTaskId of taskIds) {
    const taskId = rawTaskId.trim();
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    normalized.push(taskId);
  }

  return normalized;
};

const haveSameTaskIds = (left: string[], right: string[]): boolean => {
  const normalizedLeft = normalizeTaskIds(left);
  const normalizedRight = normalizeTaskIds(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  const rightSet = new Set(normalizedRight);
  return normalizedLeft.every((taskId) => rightSet.has(taskId));
};

export function ExcludeTasksPanel({
  classroomId,
  window: reportWindow,
  initialExcludedTaskIds,
  tasks,
  initialQueryEntries,
  taskOptionsLoadError,
  currentPathname,
}: ExcludeTasksPanelProps) {
  const router = useRouter();
  const routerPathname = usePathname();
  const pathname =
    currentPathname ??
    routerPathname ??
    paths.teacher.classroomProcessAssessment(classroomId);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"apply" | "clear" | null>(
    null,
  );
  const normalizedInitialExcludedTaskIds = useMemo(
    () => normalizeTaskIds(initialExcludedTaskIds),
    [initialExcludedTaskIds],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    normalizedInitialExcludedTaskIds,
  );

  useEffect(() => {
    setSelectedIds(normalizedInitialExcludedTaskIds);
  }, [normalizedInitialExcludedTaskIds]);

  useEffect(() => {
    if (!isPending) {
      setPendingAction(null);
    }
  }, [isPending]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const taskIdSet = useMemo(
    () => new Set(tasks.map((task) => task.id)),
    [tasks],
  );
  const hiddenSelectedTaskIds = useMemo(
    () => selectedIds.filter((taskId) => !taskIdSet.has(taskId)),
    [selectedIds, taskIdSet],
  );
  const hasSelectionChanged = !haveSameTaskIds(
    selectedIds,
    normalizedInitialExcludedTaskIds,
  );
  const isApplyDisabled = isPending || !hasSelectionChanged;
  const isClearDisabled =
    isPending ||
    (selectedIds.length === 0 && normalizedInitialExcludedTaskIds.length === 0);

  const buildNextHref = (nextSelectedIds: string[]) => {
    const params = new URLSearchParams();
    for (const [key, value] of initialQueryEntries) {
      params.append(key, value);
    }

    params.set("window", reportWindow);
    params.set("page", "1");
    params.delete("excludedTaskIds");
    for (const taskId of normalizeTaskIds(nextSelectedIds)) {
      params.append("excludedTaskIds", taskId);
    }

    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const toggleTask = (taskId: string) => {
    setSelectedIds((previous) =>
      previous.includes(taskId)
        ? previous.filter((selectedTaskId) => selectedTaskId !== taskId)
        : [...previous, taskId],
    );
  };

  const applySelectedTasks = () => {
    if (isApplyDisabled) {
      return;
    }

    const nextHref = buildNextHref(selectedIds);
    setPendingAction("apply");
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  const clearSelectedTasks = () => {
    if (isClearDisabled) {
      return;
    }

    setSelectedIds([]);
    const nextHref = buildNextHref([]);
    setPendingAction("clear");
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-zinc-600">
        勾选后点击应用，当前页面与 CSV 将按排除后的任务范围重新计算；这只是临时查询条件，不会保存偏好，不会修改课堂任务或成绩数据。
      </p>
      <p className="text-xs text-zinc-500">
        {normalizedInitialExcludedTaskIds.length > 0
          ? `已排除 ${normalizedInitialExcludedTaskIds.length} 个任务，当前成绩与 CSV 均按排除后任务范围计算。`
          : "未排除任务，当前成绩按统计窗口内全部任务计算。"}
        {hasSelectionChanged
          ? ` 当前已选 ${selectedIds.length} 个任务，点击应用后生效。`
          : ""}
      </p>
      {taskOptionsLoadError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {taskOptionsLoadError}
        </p>
      ) : null}
      {hiddenSelectedTaskIds.length > 0 ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          有 {hiddenSelectedTaskIds.length}{" "}
          个已选任务未在当前任务列表中显示；它们仍会保留在本次页面与 CSV 查询参数中。
        </p>
      ) : null}

      {tasks.length === 0 ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-500">
          {taskOptionsLoadError
            ? "当前无法展示可选任务；页面仍会按 URL 中的排除参数计算。"
            : "暂无可排除任务。"}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-200">
          {tasks.map((task) => (
            <label
              key={task.id}
              className="flex gap-3 border-b border-zinc-100 px-3 py-2.5 last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selectedIdSet.has(task.id)}
                onChange={() => toggleTask(task.id)}
                className="mt-1 h-4 w-4 rounded border-zinc-300"
              />
              <span className="min-w-0">
                <span className="block break-words font-medium text-zinc-900">
                  {task.title}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {task.metaText}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={applySelectedTasks}
          disabled={isApplyDisabled}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400 disabled:hover:bg-zinc-400"
        >
          {isPending && pendingAction === "apply" ? "应用中..." : "应用排除任务"}
        </button>
        <button
          type="button"
          onClick={clearSelectedTasks}
          disabled={isClearDisabled}
          className="text-sm text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-zinc-400 disabled:no-underline"
        >
          {isPending && pendingAction === "clear" ? "清空中..." : "清空排除"}
        </button>
      </div>
    </div>
  );
}
