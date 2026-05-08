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

type LearningTaskFiltersProps = {
  tasks: LearningTaskOption[];
  currentUserId?: string;
  initialScope: TaskTemplateScope;
  initialStatus?: string;
  initialKnowledgeModule?: string;
  initialStage?: string;
  initialCourseLabel?: string;
  initialPage: number;
  initialLimit: number;
  total?: number;
};

type TaskStatusFilter = "ALL" | LearningTaskStatus;
type StageFilter = "ALL" | "1" | "2" | "3" | "4";

type RubricSummary = {
  configured: boolean;
  dimensionCount: number;
  hasNotes: boolean;
};

const STATUS_FILTER_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> =
  [
    { value: "ALL", label: "全部状态" },
    { value: "DRAFT", label: "DRAFT（草稿）" },
    { value: "PUBLISHED", label: "PUBLISHED（已发布）" },
    { value: "ARCHIVED", label: "ARCHIVED（已归档）" },
  ];

const STAGE_FILTER_OPTIONS: Array<{ value: StageFilter; label: string }> = [
  { value: "ALL", label: "全部阶段" },
  { value: "1", label: "阶段 1" },
  { value: "2", label: "阶段 2" },
  { value: "3", label: "阶段 3" },
  { value: "4", label: "阶段 4" },
];

const SCOPE_SORT_HINTS: Record<TaskTemplateScope, string> = {
  mine: "默认按最近更新时间排序（同时间按创建时间）。",
  shared: "默认优先展示 PUBLISHED 模板，其次按最近更新时间排序。",
  all: "默认优先展示我的模板；他人共享模板内优先 PUBLISHED。",
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

const toStageFilter = (value: string | undefined): StageFilter => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized === "1" ||
    normalized === "2" ||
    normalized === "3" ||
    normalized === "4"
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

const summarizeRubric = (
  rubric: Record<string, unknown> | undefined,
): RubricSummary => {
  if (!rubric || Object.keys(rubric).length === 0) {
    return {
      configured: false,
      dimensionCount: 0,
      hasNotes: false,
    };
  }

  const dimensionsRaw = rubric.dimensions;
  const dimensions =
    dimensionsRaw &&
    typeof dimensionsRaw === "object" &&
    !Array.isArray(dimensionsRaw)
      ? (dimensionsRaw as Record<string, unknown>)
      : undefined;
  const dimensionCount = dimensions
    ? Object.values(dimensions).filter(
        (value) => typeof value === "number" && Number.isFinite(value),
      ).length
    : 0;
  const hasNotes =
    typeof rubric.notes === "string" && rubric.notes.trim().length > 0;

  return {
    configured: true,
    dimensionCount,
    hasNotes,
  };
};

export function LearningTaskFilters({
  tasks,
  currentUserId,
  initialScope,
  initialStatus,
  initialKnowledgeModule,
  initialStage,
  initialCourseLabel,
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
  const stageFilter = toStageFilter(searchParams.get("stage") ?? initialStage);
  const courseLabelFilter =
    normalizeTaskCourseLabel(
      searchParams.get("courseLabel") ?? initialCourseLabel,
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
  const totalCount =
    typeof total === "number" && total >= 0 ? total : tasks.length;
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
    const currentQuery = searchParams.toString();
    return currentQuery ? `${pathname}?${currentQuery}` : pathname;
  }, [pathname, searchParams]);

  const buildTaskEditHref = (taskId: string): string => {
    const params = new URLSearchParams();
    params.set("returnTo", currentTaskListUrl);
    return `${paths.teacher.taskEdit(taskId)}?${params.toString()}`;
  };

  const replaceSearchQuery = (updater: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
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

  const setStageFilterAndSync = (nextValue: StageFilter) => {
    replaceSearchQuery((params) => {
      if (nextValue === "ALL") {
        params.delete("stage");
      } else {
        params.set("stage", nextValue);
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
      params.delete("stage");
      params.delete("courseLabel");
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
    stageFilter !== "ALL" ||
    Boolean(courseLabelFilter);

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
          筛选条件会写入 URL 并触发后端实时查询；筛选变化后自动回到第一页。
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
            <span className="mb-1 block text-zinc-700">阶段</span>
            <select
              value={stageFilter}
              onChange={(event) =>
                setStageFilterAndSync(event.target.value as StageFilter)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {STAGE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
                href="#create-learning-task-form"
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
                href="#create-learning-task-form"
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
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-[1360px] w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[28%]" />
              <col className="w-[8%]" />
              <col className="w-[6%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead className="bg-zinc-50 text-left text-xs font-semibold tracking-wide text-zinc-700">
              <tr>
                <th className="px-4 py-3">标题</th>
                <th className="px-4 py-3">描述</th>
                <th className="px-4 py-3">知识模块</th>
                <th className="px-4 py-3">阶段</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">可见性</th>
                <th className="px-4 py-3">课程分类</th>
                <th className="px-4 py-3">评分配置</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task, index) => {
                const statusUpper = toStatusUpper(task.status);
                const rubricSummary = summarizeRubric(task.rubric);
                const titleText = toDisplayText(task.title, "未命名模板");
                const descriptionText = toDisplayText(task.description);
                const taskId = task.id;
                const rubricHint = rubricSummary.configured
                  ? rubricSummary.dimensionCount > 0 || rubricSummary.hasNotes
                    ? `${rubricSummary.dimensionCount > 0 ? `${rubricSummary.dimensionCount} 个维度` : "未识别维度"}${rubricSummary.hasNotes ? "，含评分说明" : ""}`
                    : "已配置（自定义结构）"
                  : "未配置";
                const statusBadgeClass =
                  statusUpper === "PUBLISHED"
                    ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                    : statusUpper === "DRAFT"
                      ? "border-amber-200 bg-amber-100 text-amber-700"
                      : statusUpper === "ARCHIVED"
                        ? "border-zinc-300 bg-zinc-200 text-zinc-700"
                        : "border-zinc-200 bg-zinc-100 text-zinc-700";
                const rubricBadgeClass = rubricSummary.configured
                  ? "border-sky-200 bg-sky-100 text-sky-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700";
                const visibility = normalizeTaskTemplateVisibility(
                  task.visibility,
                );
                const visibilityBadgeClass =
                  visibility === "PRIVATE"
                    ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                    : "border-emerald-200 bg-emerald-100 text-emerald-700";
                const isKnownStatus = isKnownLearningTaskStatus(statusUpper);
                const isOwner = Boolean(
                  currentUserId &&
                  task.createdById &&
                  task.createdById === currentUserId,
                );
                const canEditTask =
                  isKnownStatus && isOwner && statusUpper !== "ARCHIVED";
                const publisherLabel = getPublisherLabel(
                  task.publisher,
                  currentUserId,
                );

                return (
                  <tr
                    key={task.id ?? `learning-task-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="max-h-[3rem] overflow-hidden break-words text-sm font-semibold leading-6 text-zinc-900">
                          {titleText}
                        </p>
                        {publisherLabel ? (
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            {publisherLabel}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p
                        className="max-h-[4.5rem] overflow-hidden break-words text-sm leading-6 text-zinc-700"
                        title={descriptionText}
                      >
                        {descriptionText}
                      </p>
                    </td>
                    <td className="px-4 py-3 break-words text-zinc-700">
                      {toDisplayText(task.knowledgeModule)}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-zinc-900">
                      {toDisplayText(task.stage)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass}`}
                        >
                          {toDisplayText(task.status)}
                        </span>
                        <p className="text-xs leading-5 text-zinc-500">
                          {getStatusHint(task.status)}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${visibilityBadgeClass}`}
                      >
                        {toTaskTemplateVisibilityLabel(task.visibility)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${
                          isUnclassifiedTaskCourseLabel(task.courseLabel)
                            ? "border-zinc-200 bg-zinc-100 text-zinc-700"
                            : "border-indigo-200 bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {toTaskCourseLabelDisplayText(task.courseLabel)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${rubricBadgeClass}`}
                        >
                          {rubricSummary.configured ? "已配置" : "未配置"}
                        </span>
                        <p className="text-xs leading-5 text-zinc-500">
                          {rubricHint}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {taskId ? (
                        <div className="flex flex-col items-start gap-1">
                          <Link
                            href={buildTaskEditHref(taskId)}
                            className="text-blue-700 hover:underline"
                          >
                            {canEditTask ? "编辑" : "查看"}
                          </Link>
                          {isOwner && statusUpper === "ARCHIVED" ? (
                            <p className="text-xs text-zinc-500">
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
