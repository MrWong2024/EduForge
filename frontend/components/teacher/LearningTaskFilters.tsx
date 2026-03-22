"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/blocks/EmptyState";
import { paths } from "@/lib/routes/paths";
import { toDisplayText } from "@/lib/ui/format";
import { type LearningTaskOption, type LearningTaskStatus } from "@/lib/api/types-teacher";

type LearningTaskFiltersProps = {
  tasks: LearningTaskOption[];
  initialStatus?: string;
  initialKnowledgeModule?: string;
  initialStage?: string;
};

type TaskStatusFilter = "ALL" | LearningTaskStatus;
type StageFilter = "ALL" | "1" | "2" | "3" | "4";

type RubricSummary = {
  configured: boolean;
  dimensionCount: number;
  hasNotes: boolean;
};

const STATUS_FILTER_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> = [
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

const toStatusUpper = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const toStatusFilter = (value: string | undefined): TaskStatusFilter => {
  const normalized = toStatusUpper(value);
  if (normalized === "DRAFT" || normalized === "PUBLISHED" || normalized === "ARCHIVED") {
    return normalized;
  }
  return "ALL";
};

const toStageFilter = (value: string | undefined): StageFilter => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "1" || normalized === "2" || normalized === "3" || normalized === "4") {
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

const summarizeRubric = (rubric: Record<string, unknown> | undefined): RubricSummary => {
  if (!rubric || Object.keys(rubric).length === 0) {
    return {
      configured: false,
      dimensionCount: 0,
      hasNotes: false,
    };
  }

  const dimensionsRaw = rubric.dimensions;
  const dimensions =
    dimensionsRaw && typeof dimensionsRaw === "object" && !Array.isArray(dimensionsRaw)
      ? (dimensionsRaw as Record<string, unknown>)
      : undefined;
  const dimensionCount = dimensions
    ? Object.values(dimensions).filter((value) => typeof value === "number" && Number.isFinite(value)).length
    : 0;
  const hasNotes = typeof rubric.notes === "string" && rubric.notes.trim().length > 0;

  return {
    configured: true,
    dimensionCount,
    hasNotes,
  };
};

export function LearningTaskFilters({
  tasks,
  initialStatus,
  initialKnowledgeModule,
  initialStage,
}: LearningTaskFiltersProps) {
  const knowledgeModuleOptions = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const task of tasks) {
      const moduleValue =
        typeof task.knowledgeModule === "string" ? task.knowledgeModule.trim() : "";
      if (moduleValue) {
        moduleSet.add(moduleValue);
      }
    }
    return [...moduleSet].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [tasks]);

  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>(
    toStatusFilter(initialStatus)
  );
  const [knowledgeModuleFilter, setKnowledgeModuleFilter] = useState<string>(() => {
    const normalized = typeof initialKnowledgeModule === "string" ? initialKnowledgeModule.trim() : "";
    if (!normalized) {
      return "";
    }
    return knowledgeModuleOptions.includes(normalized) ? normalized : "";
  });
  const [stageFilter, setStageFilter] = useState<StageFilter>(toStageFilter(initialStage));

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (statusFilter !== "ALL" && toStatusUpper(task.status) !== statusFilter) {
          return false;
        }

        if (knowledgeModuleFilter) {
          const moduleValue =
            typeof task.knowledgeModule === "string" ? task.knowledgeModule.trim() : "";
          if (moduleValue !== knowledgeModuleFilter) {
            return false;
          }
        }

        if (stageFilter !== "ALL") {
          const stageValue =
            typeof task.stage === "number" && Number.isFinite(task.stage)
              ? String(task.stage)
              : "";
          if (stageValue !== stageFilter) {
            return false;
          }
        }

        return true;
      }),
    [tasks, statusFilter, knowledgeModuleFilter, stageFilter]
  );

  const hasActiveFilters =
    statusFilter !== "ALL" || Boolean(knowledgeModuleFilter) || stageFilter !== "ALL";

  const handleResetFilters = () => {
    setStatusFilter("ALL");
    setKnowledgeModuleFilter("");
    setStageFilter("ALL");
  };

  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">模板筛选</h2>
        <p className="mt-1 text-sm text-zinc-600">
          本地筛选，切换后即时生效；优先挑选 `PUBLISHED` 模板用于班级发布。
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">状态</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaskStatusFilter)}
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
              onChange={(event) => setKnowledgeModuleFilter(event.target.value)}
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
              onChange={(event) => setStageFilter(event.target.value as StageFilter)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {STAGE_FILTER_OPTIONS.map((option) => (
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
          当前显示 {filteredTasks.length} / {tasks.length} 条模板
        </p>
      </section>

      {tasks.length === 0 ? (
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
              <Link href={paths.teacher.classrooms} className="text-sm text-blue-700 hover:underline">
                去班级列表
              </Link>
            </div>
          }
        />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="当前筛选条件下没有匹配模板"
          description="可重置筛选，或继续创建新模板。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                清空筛选
              </button>
              <Link href="#create-learning-task-form" className="text-sm text-blue-700 hover:underline">
                继续创建模板
              </Link>
            </div>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-[1100px] w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[19%]" />
              <col className="w-[38%]" />
              <col className="w-[9%]" />
              <col className="w-[6%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead className="bg-zinc-50 text-left text-xs font-semibold tracking-wide text-zinc-700">
              <tr>
                <th className="px-4 py-3">标题</th>
                <th className="px-4 py-3">描述</th>
                <th className="px-4 py-3">知识模块</th>
                <th className="px-4 py-3">阶段</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">评分配置</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task, index) => {
                const statusUpper = toStatusUpper(task.status);
                const rubricSummary = summarizeRubric(task.rubric);
                const titleText = toDisplayText(task.title, "未命名模板");
                const descriptionText = toDisplayText(task.description);
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

                return (
                  <tr
                    key={task.id ?? `learning-task-filtered-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <p className="max-h-[3rem] overflow-hidden break-words text-sm font-semibold leading-6 text-zinc-900">
                        {titleText}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p
                        className="max-h-[4.5rem] overflow-hidden break-words text-sm leading-6 text-zinc-700"
                        title={descriptionText}
                      >
                        {descriptionText}
                      </p>
                    </td>
                    <td className="px-4 py-3 break-words text-zinc-700">{toDisplayText(task.knowledgeModule)}</td>
                    <td className="px-4 py-3 text-center font-medium text-zinc-900">{toDisplayText(task.stage)}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass}`}
                        >
                          {toDisplayText(task.status)}
                        </span>
                        <p className="text-xs leading-5 text-zinc-500">{getStatusHint(task.status)}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${rubricBadgeClass}`}
                        >
                          {rubricSummary.configured ? "已配置" : "未配置"}
                        </span>
                        <p className="text-xs leading-5 text-zinc-500">{rubricHint}</p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {task.id ? (
                        <Link href={paths.teacher.taskEdit(task.id)} className="text-blue-700 hover:underline">
                          编辑
                        </Link>
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

      {hasActiveFilters ? (
        <p className="text-xs text-zinc-500">
          已启用筛选条件。若要查看全部模板，请点击“重置筛选”。
        </p>
      ) : null}
    </section>
  );
}
