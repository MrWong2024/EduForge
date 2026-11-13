"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/blocks/EmptyState";
import { paths } from "@/lib/routes/paths";
import {
  getPublisherLabel,
  parsePositiveInt,
  toDisplayText,
} from "@/lib/ui/format";
import {
  type LearningTaskOption,
  type LearningTaskStatus,
} from "@/lib/api/types-teacher";
import {
  TASK_COURSE_LABELS,
  normalizeTaskCourseLabel,
  isUnclassifiedTaskCourseLabel,
  toTaskCourseLabelDisplayText,
} from "@/lib/learning-tasks/course-labels";
import {
  TASK_TEMPLATE_SCOPE_LABELS,
  TASK_TEMPLATE_SCOPES,
  toTaskTemplateVisibilityLabel,
  normalizeTaskTemplateScope,
  normalizeTaskTemplateVisibility,
  type TaskTemplateScope,
} from "@/lib/learning-tasks/template-visibility-scope";
import { sortTaskTemplatesByScope } from "@/lib/learning-tasks/template-list-sorting";
import { getRubricSummary } from "@/lib/learning-tasks/rubric";
import {
  TASK_DIFFICULTY_OPTIONS,
  getDifficultyLabel,
  parseDifficultyFilter,
} from "@/lib/learning-tasks/difficulty";
import { getTaskTemplateStatusLabel } from "@/lib/ui/status";

type LearningTaskFiltersProps = {
  tasks: LearningTaskOption[];
  currentUserId?: string;
  initialScope: TaskTemplateScope;
  initialStatus?: string;
  initialKnowledgeModule?: string;
  initialCourseLabel?: string;
  initialDifficultyFilter?: string;
  initialPage: number;
  initialLimit: number;
  total: number;
};

type TaskStatusFilter = "ALL" | LearningTaskStatus;

const STATUS_FILTER_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> =
  [
    { value: "ALL", label: "全部状态" },
    { value: "DRAFT", label: "草稿" },
    { value: "PUBLISHED", label: "已发布" },
    { value: "ARCHIVED", label: "已归档" },
  ];

const SCOPE_SORT_HINTS: Record<TaskTemplateScope, string> = {
  mine: "默认按最近更新时间排序（同时间按创建时间）。",
  shared: "默认优先展示已发布模板，其次按最近更新时间排序。",
  all: "默认优先展示我的模板；他人共享模板内优先已发布模板。",
};

const toStatusUpper = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const isKnownLearningTaskStatus = (
  value: string,
): value is LearningTaskStatus =>
  value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED";

const toStatusFilter = (value: string | undefined): TaskStatusFilter => {
  const normalized = toStatusUpper(value);
  if (
    normalized === "DRAFT" ||
    normalized === "PUBLISHED" ||
    normalized === "ARCHIVED"
  ) {
    return normalized;
  }
  return "ALL";
};

const getStatusHint = (status: unknown): string => {
  const normalized = toStatusUpper(status);
  if (normalized === "PUBLISHED") {
    return "可发布到班级";
  }
  if (normalized === "DRAFT" || normalized === "ARCHIVED") {
    return "通常不会出现在班级发布可选列表";
  }
  return "状态缺失或未知";
};

export function LearningTaskFilters({
  tasks,
  currentUserId,
  initialScope,
  initialStatus,
  initialKnowledgeModule,
  initialCourseLabel,
  initialDifficultyFilter,
  initialPage,
  initialLimit,
  total,
}: LearningTaskFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentScope =
    normalizeTaskTemplateScope(searchParams.get("scope") ?? initialScope) ??
    initialScope;
  const statusFilter = toStatusFilter(
    searchParams.get("status") ?? initialStatus,
  );
  const courseLabelFilter =
    normalizeTaskCourseLabel(
      searchParams.get("courseLabel") ?? initialCourseLabel,
    ) ?? "";
  const difficultyValues = searchParams.getAll("difficulty");
  const difficultyFilter =
    parseDifficultyFilter(
      difficultyValues.length === 0
        ? initialDifficultyFilter
        : difficultyValues.length === 1
          ? difficultyValues[0]
          : difficultyValues,
    ) ?? "";
  const knowledgeModuleFilter = useMemo(() => {
    const value =
      searchParams.get("knowledgeModule") ?? initialKnowledgeModule ?? "";
    return value.trim();
  }, [searchParams, initialKnowledgeModule]);
  const currentPage = parsePositiveInt(
    searchParams.get("page") ?? String(initialPage),
    initialPage,
    { min: 1 },
  );

  const limit = initialLimit > 0 ? initialLimit : 20;
  const totalCount = total;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const previousPage =
    currentPage > totalPages ? totalPages : Math.max(1, currentPage - 1);
  const nextPage = currentPage + 1;

  const knowledgeModuleOptions = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const task of tasks) {
      const moduleValue =
        typeof task.knowledgeModule === "string"
          ? task.knowledgeModule.trim()
          : "";
      if (moduleValue) {
        moduleSet.add(moduleValue);
      }
    }
    if (knowledgeModuleFilter) {
      moduleSet.add(knowledgeModuleFilter);
    }
    return [...moduleSet].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
  }, [tasks, knowledgeModuleFilter]);

  const currentTaskListUrl = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("stage");
    if (difficultyFilter) {
      params.set("difficulty", difficultyFilter);
    } else {
      params.delete("difficulty");
    }
    const currentQuery = params.toString();
    return currentQuery ? `${pathname}?${currentQuery}` : pathname;
  }, [pathname, searchParams, difficultyFilter]);

  const buildTaskEditHref = (taskId: string): string => {
    const params = new URLSearchParams();
    params.set("returnTo", currentTaskListUrl);
    return `${paths.teacher.taskEdit(taskId)}?${params.toString()}`;
  };

  const replaceSearchQuery = (updater: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("stage");
    if (difficultyFilter) {
      params.set("difficulty", difficultyFilter);
    } else {
      params.delete("difficulty");
    }
    updater(params);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  };

  const setScopeAndSync = (nextScope: TaskTemplateScope) => {
    replaceSearchQuery((params) => {
      params.set("scope", nextScope);
      params.set("page", "1");
    });
  };

  const setCourseLabelFilterAndSync = (nextValue: string) => {
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("courseLabel", nextValue);
      } else {
        params.delete("courseLabel");
      }
      params.set("page", "1");
    });
  };

  const setStatusFilterAndSync = (nextValue: TaskStatusFilter) => {
    replaceSearchQuery((params) => {
      if (nextValue === "ALL") {
        params.delete("status");
      } else {
        params.set("status", nextValue);
      }
      params.set("page", "1");
    });
  };

  const setKnowledgeModuleFilterAndSync = (nextValue: string) => {
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("knowledgeModule", nextValue);
      } else {
        params.delete("knowledgeModule");
      }
      params.set("page", "1");
    });
  };

  const setDifficultyFilterAndSync = (nextValue: string) => {
    replaceSearchQuery((params) => {
      const difficulty = parseDifficultyFilter(nextValue);
      if (difficulty) {
        params.set("difficulty", difficulty);
      } else {
        params.delete("difficulty");
      }
      params.set("page", "1");
    });
  };

  const goToPage = (page: number) => {
    replaceSearchQuery((params) => {
      params.set("page", String(Math.max(1, page)));
    });
  };

  const handleResetFilters = () => {
    replaceSearchQuery((params) => {
      params.delete("status");
      params.delete("knowledgeModule");
      params.delete("courseLabel");
      params.delete("difficulty");
      params.set("page", "1");
    });
  };

  const sortedTasks = useMemo(
    () =>
      sortTaskTemplatesByScope(tasks, {
        scope: currentScope,
        currentUserId,
      }),
    [tasks, currentScope, currentUserId],
  );

  const hasActiveFilters =
    statusFilter !== "ALL" ||
    Boolean(knowledgeModuleFilter) ||
    Boolean(courseLabelFilter) ||
    Boolean(difficultyFilter);

  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          {TASK_TEMPLATE_SCOPES.map((scope) => {
            const isActive = currentScope === scope;
            return (
              <button
                key={scope}
                type="button"
                onClick={() => setScopeAndSync(scope)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  isActive
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {TASK_TEMPLATE_SCOPE_LABELS[scope]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          当前视图：{TASK_TEMPLATE_SCOPE_LABELS[currentScope]}
          。共享只影响可见性，不改变作者编辑或发布权限。
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {SCOPE_SORT_HINTS[currentScope]}
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">模板筛选</h2>
        <p className="mt-1 text-sm text-zinc-600">
          调整筛选条件后将重新查询，并自动回到第一页。
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-5">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">状态</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilterAndSync(event.target.value as TaskStatusFilter)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">知识模块</span>
            <select
              value={knowledgeModuleFilter}
              onChange={(event) =>
                setKnowledgeModuleFilterAndSync(event.target.value)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              <option value="">全部模块</option>
              {knowledgeModuleOptions.map((moduleValue) => (
                <option key={moduleValue} value={moduleValue}>
                  {moduleValue}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">课程分类</span>
            <select
              value={courseLabelFilter}
              onChange={(event) =>
                setCourseLabelFilterAndSync(event.target.value)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              <option value="">全部分类</option>
              {TASK_COURSE_LABELS.map((courseLabelOption) => (
                <option key={courseLabelOption} value={courseLabelOption}>
                  {courseLabelOption}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">任务难度</span>
            <select
              value={difficultyFilter}
              onChange={(event) =>
                setDifficultyFilterAndSync(event.target.value)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              <option value="">全部难度</option>
              {TASK_DIFFICULTY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleResetFilters}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              重置筛选
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          当前页显示 {sortedTasks.length} 条，共 {totalCount} 条模板
        </p>
      </section>

      {sortedTasks.length === 0 && totalCount === 0 && !hasActiveFilters ? (
        <EmptyState
          title="还没有任务模板"
          description="先创建第一个任务模板，之后可在班级任务页选择模板并发布到班级。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`${currentTaskListUrl}#create-learning-task-form`}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
              >
                创建任务模板
              </Link>
              <Link
                href={paths.teacher.classrooms}
                className="text-sm text-blue-700 hover:underline"
              >
                去班级列表
              </Link>
            </div>
          }
        />
      ) : sortedTasks.length === 0 && hasActiveFilters ? (
        <EmptyState
          title="当前筛选条件下没有匹配模板"
          description="可重置筛选，或调整筛选条件后重试。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                清空筛选
              </button>
              <Link
                href={`${currentTaskListUrl}#create-learning-task-form`}
                className="text-sm text-blue-700 hover:underline"
              >
                继续创建模板
              </Link>
            </div>
          }
        />
      ) : sortedTasks.length === 0 ? (
        <EmptyState
          title="当前页没有模板数据"
          description="可以返回上一页，或调整筛选条件后重试。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {canGoPrevious ? (
                <button
                  type="button"
                  onClick={() => goToPage(previousPage)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  返回上一页
                </button>
              ) : null}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  清空筛选
                </button>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="min-w-0 rounded-lg border border-zinc-200 bg-white">
          <table
            role="table"
            aria-label="任务模板列表"
            className="block w-full table-fixed border-collapse text-sm lg:table"
          >
            <colgroup className="hidden lg:table-column-group">
              <col />
              <col className="w-[11rem]" />
              <col className="w-[9rem]" />
              <col className="w-[9rem]" />
              <col className="w-[7rem]" />
            </colgroup>
            <thead
              role="rowgroup"
              className="sr-only bg-zinc-50 text-left text-xs font-semibold tracking-wide text-zinc-700 lg:not-sr-only lg:table-header-group"
            >
              <tr role="row">
                <th role="columnheader" scope="col" className="px-3 py-3">
                  任务
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3">
                  分类
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3">
                  状态
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3">
                  评阅标准
                </th>
                <th role="columnheader" scope="col" className="px-3 py-3">
                  操作
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="block lg:table-row-group">
              {sortedTasks.map((task, index) => {
                const statusUpper = toStatusUpper(task.status);
                const rubricSummary = getRubricSummary(task.rubric);
                const titleText = toDisplayText(task.title, "未命名模板");
                const descriptionText = toDisplayText(task.description);
                const taskId = task.id;
                const statusBadgeClass =
                  statusUpper === "PUBLISHED"
                    ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                    : statusUpper === "DRAFT"
                      ? "border-amber-200 bg-amber-100 text-amber-700"
                      : statusUpper === "ARCHIVED"
                        ? "border-zinc-300 bg-zinc-200 text-zinc-700"
                        : "border-zinc-200 bg-zinc-100 text-zinc-700";
                const rubricBadgeClass = rubricSummary === "已填写"
                  ? "border-sky-200 bg-sky-100 text-sky-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700";
                const visibility = normalizeTaskTemplateVisibility(
                  task.visibility,
                );
                const visibilityBadgeClass =
                  visibility === "PRIVATE"
                    ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                    : visibility === "SHARED"
                      ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                      : "border-zinc-200 bg-zinc-100 text-zinc-700";
                const isKnownStatus = isKnownLearningTaskStatus(statusUpper);
                const isOwner = Boolean(
                  currentUserId &&
                  task.createdById &&
                  task.createdById === currentUserId,
                );
                const canEditTask =
                  isKnownStatus &&
                  isOwner &&
                  statusUpper !== "ARCHIVED" &&
                  visibility !== undefined;
                const publisherLabel = getPublisherLabel(
                  task.publisher,
                  currentUserId,
                );

                return (
                  <tr
                    role="row"
                    key={task.id ?? `learning-task-${index}`}
                    className="grid min-w-0 grid-cols-2 gap-4 border-t border-zinc-100 px-4 py-5 align-top [overflow-wrap:anywhere] sm:grid-cols-4 lg:table-row lg:p-0"
                  >
                    <td
                      role="cell"
                      className="col-span-full block min-w-0 lg:table-cell lg:px-3 lg:py-4"
                    >
                      <div className="space-y-2">
                        <p className="break-words text-sm font-semibold leading-6 text-zinc-900">
                          {titleText}
                        </p>
                        {publisherLabel ? (
                          <span className="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            {publisherLabel}
                          </span>
                        ) : null}
                        <p
                          className="max-h-[4.5rem] overflow-hidden break-words text-sm leading-6 text-zinc-700"
                          title={descriptionText}
                        >
                          {descriptionText}
                        </p>
                      </div>
                    </td>
                    <td
                      role="cell"
                      className="block min-w-0 lg:table-cell lg:px-3 lg:py-4"
                    >
                      <p
                        aria-hidden="true"
                        className="mb-2 text-xs font-semibold text-zinc-500 lg:hidden"
                      >
                        分类
                      </p>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">课程分类</p>
                          <span
                            className={`inline-flex max-w-full rounded border px-2 py-0.5 text-xs font-medium ${
                              isUnclassifiedTaskCourseLabel(task.courseLabel)
                                ? "border-zinc-200 bg-zinc-100 text-zinc-700"
                                : "border-indigo-200 bg-indigo-100 text-indigo-700"
                            }`}
                          >
                            {toTaskCourseLabelDisplayText(task.courseLabel)}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">知识模块</p>
                          <p className="text-zinc-700">
                            {toDisplayText(task.knowledgeModule)}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">任务难度</p>
                          <p className="whitespace-pre-wrap break-words text-zinc-700">
                            {getDifficultyLabel(task.difficulty)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td
                      role="cell"
                      className="block min-w-0 lg:table-cell lg:px-3 lg:py-4"
                    >
                      <p
                        aria-hidden="true"
                        className="mb-2 text-xs font-semibold text-zinc-500 lg:hidden"
                      >
                        状态
                      </p>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex max-w-full rounded border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass}`}
                          >
                            {getTaskTemplateStatusLabel(task.status)}
                          </span>
                          <p className="text-xs leading-5 text-zinc-500">
                            {getStatusHint(task.status)}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">可见性</p>
                          <span
                            className={`inline-flex max-w-full rounded border px-2 py-0.5 text-xs font-semibold ${visibilityBadgeClass}`}
                          >
                            {toTaskTemplateVisibilityLabel(task.visibility)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td
                      role="cell"
                      className="block min-w-0 lg:table-cell lg:px-3 lg:py-4"
                    >
                      <p
                        aria-hidden="true"
                        className="mb-2 text-xs font-semibold text-zinc-500 lg:hidden"
                      >
                        评阅标准
                      </p>
                      <div className="space-y-1">
                        <span
                          className={`inline-flex max-w-full rounded border px-2 py-0.5 text-xs font-semibold ${rubricBadgeClass}`}
                        >
                          {rubricSummary}
                        </span>
                      </div>
                    </td>
                    <td
                      role="cell"
                      className="block min-w-0 lg:table-cell lg:px-3 lg:py-4"
                    >
                      <p
                        aria-hidden="true"
                        className="mb-2 text-xs font-semibold text-zinc-500 lg:hidden"
                      >
                        操作
                      </p>
                      {taskId ? (
                        <div className="flex flex-col items-start gap-1">
                          <Link
                            href={buildTaskEditHref(taskId)}
                            className="whitespace-nowrap text-blue-700 hover:underline"
                          >
                            {canEditTask ? "编辑" : "查看"}
                          </Link>
                          {isOwner && statusUpper === "ARCHIVED" ? (
                            <p className="text-xs leading-5 text-zinc-500">
                              已归档，仅可查看
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-500">缺少模板标识</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(totalPages > 1 || currentPage > 1) && totalCount > 0 ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-zinc-600">
              第 {currentPage} / {totalPages} 页，共 {totalCount} 条
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(previousPage)}
                disabled={!canGoPrevious}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                onClick={() => goToPage(nextPage)}
                disabled={!canGoNext}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {hasActiveFilters ? (
        <p className="text-xs text-zinc-500">
          已启用筛选条件。若要查看全部模板，请点击“重置筛选”。
        </p>
      ) : null}
    </section>
  );
}
