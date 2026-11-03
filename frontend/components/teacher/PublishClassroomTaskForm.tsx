"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription } from "@/lib/api/error-presenter";
import {
  type LearningTaskOption,
  toPublishableTaskTemplateListResponse,
  toSubmitTaskResponse,
  type PublishClassroomTaskRequest,
} from "@/lib/api/types-teacher";
import {
  TASK_COURSE_LABELS,
  TASK_COURSE_LABEL_UNCLASSIFIED,
  toTaskCourseLabelDisplayText,
} from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";
import { getCandidateRubricSummary } from "@/lib/learning-tasks/rubric";
import {
  TASK_DIFFICULTY_OPTIONS,
  getDifficultyLabel,
  parseDifficultyFilter,
} from "@/lib/learning-tasks/difficulty";
import { buildQueryString, getPublisherLabel } from "@/lib/ui/format";
import { getTaskTemplateStatusLabel } from "@/lib/ui/status";

type PublishClassroomTaskFormProps = {
  classroomId: string;
  currentUserId?: string;
  availableTasks: LearningTaskOption[];
  initialAvailableTasksTotal?: number;
  initialAvailableTasksPage?: number;
  initialAvailableTasksLimit?: number;
  initialCourseLabelFilter?: string;
  initialOnlyMineFilter: boolean;
  initialKnowledgeModuleFilter?: string;
  initialDifficultyFilter?: string;
};

type PublishErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const extractRawDetail = (data: unknown): string | undefined => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const message =
    "message" in data &&
    typeof (data as { message?: unknown }).message === "string"
      ? String((data as { message: string }).message)
      : "";
  const code =
    "code" in data && typeof (data as { code?: unknown }).code === "string"
      ? String((data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const toDisplayText = (value: unknown, fallback = "—"): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
};

const toDescriptionSnippet = (value: unknown, maxLength = 90): string => {
  if (typeof value !== "string") {
    return "—";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "—";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
};

const toIsoDateTime = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

export function PublishClassroomTaskForm({
  classroomId,
  currentUserId,
  availableTasks,
  initialAvailableTasksTotal,
  initialAvailableTasksPage,
  initialAvailableTasksLimit,
  initialCourseLabelFilter,
  initialOnlyMineFilter,
  initialKnowledgeModuleFilter,
  initialDifficultyFilter,
}: PublishClassroomTaskFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isFilterPending, startFilterTransition] = useTransition();
  const initialDifficulty = parseDifficultyFilter(initialDifficultyFilter) ?? "";

  const [taskId, setTaskId] = useState<string>("");
  const [courseLabelFilter, setCourseLabelFilter] = useState<string>(
    initialCourseLabelFilter ?? "",
  );
  const [onlyMine, setOnlyMine] = useState<boolean>(initialOnlyMineFilter);
  const [knowledgeModuleFilter, setKnowledgeModuleFilter] = useState<string>(
    initialKnowledgeModuleFilter ?? "",
  );
  const [difficultyFilter, setDifficultyFilter] = useState(initialDifficulty);
  const [dueAt, setDueAt] = useState<string>("");
  const [isDueAtPickerActive, setIsDueAtPickerActive] = useState(false);
  const [allowLate, setAllowLate] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<PublishErrorState | null>(null);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [loadedTasks, setLoadedTasks] =
    useState<LearningTaskOption[]>(availableTasks);
  const [loadedTotal, setLoadedTotal] = useState<number>(
    typeof initialAvailableTasksTotal === "number"
      ? initialAvailableTasksTotal
      : availableTasks.length,
  );
  const [loadedPage, setLoadedPage] = useState<number>(
    typeof initialAvailableTasksPage === "number" &&
      initialAvailableTasksPage > 0
      ? initialAvailableTasksPage
      : 1,
  );
  const [loadedLimit, setLoadedLimit] = useState<number>(
    typeof initialAvailableTasksLimit === "number" &&
      initialAvailableTasksLimit > 0
      ? initialAvailableTasksLimit
      : 50,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreEpochRef = useRef(0);
  const [previousFilterProps, setPreviousFilterProps] = useState({
    initialCourseLabelFilter,
    initialOnlyMineFilter,
    initialKnowledgeModuleFilter,
    initialDifficulty,
  });
  const [previousTaskProps, setPreviousTaskProps] = useState({
    availableTasks,
    initialAvailableTasksTotal,
    initialAvailableTasksPage,
    initialAvailableTasksLimit,
  });

  const filterPropsChanged =
    previousFilterProps.initialCourseLabelFilter !== initialCourseLabelFilter ||
    previousFilterProps.initialOnlyMineFilter !== initialOnlyMineFilter ||
    previousFilterProps.initialKnowledgeModuleFilter !==
      initialKnowledgeModuleFilter ||
    previousFilterProps.initialDifficulty !== initialDifficulty;

  if (filterPropsChanged) {
    setPreviousFilterProps({
      initialCourseLabelFilter,
      initialOnlyMineFilter,
      initialKnowledgeModuleFilter,
      initialDifficulty,
    });
    setTaskId("");
  }

  if (
    filterPropsChanged ||
    previousTaskProps.availableTasks !== availableTasks ||
    !Object.is(previousTaskProps.initialAvailableTasksTotal, initialAvailableTasksTotal) ||
    !Object.is(previousTaskProps.initialAvailableTasksPage, initialAvailableTasksPage) ||
    !Object.is(previousTaskProps.initialAvailableTasksLimit, initialAvailableTasksLimit)
  ) {
    setPreviousTaskProps({
      availableTasks,
      initialAvailableTasksTotal,
      initialAvailableTasksPage,
      initialAvailableTasksLimit,
    });
    setCourseLabelFilter(initialCourseLabelFilter ?? "");
    setOnlyMine(initialOnlyMineFilter);
    setKnowledgeModuleFilter(initialKnowledgeModuleFilter ?? "");
    setDifficultyFilter(initialDifficulty);
    setLoadedTasks(availableTasks);
    setLoadedTotal(
      typeof initialAvailableTasksTotal === "number"
        ? initialAvailableTasksTotal
        : availableTasks.length,
    );
    setLoadedPage(
      typeof initialAvailableTasksPage === "number" &&
        initialAvailableTasksPage > 0
        ? initialAvailableTasksPage
        : 1,
    );
    setLoadedLimit(
      typeof initialAvailableTasksLimit === "number" &&
        initialAvailableTasksLimit > 0
        ? initialAvailableTasksLimit
        : 50,
    );
    setLoadMoreError(null);
    setIsLoadingMore(false);
  }

  useLayoutEffect(() => {
    loadMoreEpochRef.current += 1;
  }, [
    availableTasks,
    initialAvailableTasksTotal,
    initialAvailableTasksPage,
    initialAvailableTasksLimit,
    initialCourseLabelFilter,
    initialOnlyMineFilter,
    initialKnowledgeModuleFilter,
    initialDifficulty,
  ]);

  const selectedTask = useMemo(
    () => loadedTasks.find((task) => task.id === taskId),
    [loadedTasks, taskId],
  );
  const selectedRubricSummary = useMemo(
    () => getCandidateRubricSummary(selectedTask?.rubric),
    [selectedTask],
  );
  const selectedPublisherLabel = useMemo(
    () => getPublisherLabel(selectedTask?.publisher, currentUserId),
    [currentUserId, selectedTask],
  );

  const courseLabelOptions = useMemo(() => {
    if (
      courseLabelFilter &&
      !TASK_COURSE_LABELS.includes(
        courseLabelFilter as (typeof TASK_COURSE_LABELS)[number],
      )
    ) {
      return [
        TASK_COURSE_LABEL_UNCLASSIFIED,
        courseLabelFilter,
        ...TASK_COURSE_LABELS.filter(
          (label) => label !== TASK_COURSE_LABEL_UNCLASSIFIED,
        ),
      ];
    }
    return [...TASK_COURSE_LABELS];
  }, [courseLabelFilter]);

  const knowledgeModuleOptions = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const task of loadedTasks) {
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
  }, [loadedTasks, knowledgeModuleFilter]);

  if (taskId && !loadedTasks.some((task) => task.id === taskId)) {
    setTaskId("");
  }

  const isRefreshingCandidates =
    isFilterPending ||
    courseLabelFilter !== (initialCourseLabelFilter ?? "") ||
    onlyMine !== initialOnlyMineFilter ||
    knowledgeModuleFilter !== (initialKnowledgeModuleFilter ?? "") ||
    difficultyFilter !== initialDifficulty;

  const invalidateCandidateSelection = () => {
    setTaskId("");
    loadMoreEpochRef.current += 1;
    setIsLoadingMore(false);
    setLoadMoreError(null);
  };

  const replaceSearchQuery = (updater: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("stage");
    updater(params);
    const difficultyValues = params.getAll("difficulty");
    const difficulty = parseDifficultyFilter(
      difficultyValues.length === 1 ? difficultyValues[0] : undefined,
    );
    if (difficulty) {
      params.set("difficulty", difficulty);
    } else {
      params.delete("difficulty");
    }
    params.delete("page");
    const nextQuery = params.toString();
    startFilterTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    });
  };

  const setCourseLabelFilterAndSync = (nextValue: string) => {
    if (isFilterPending || isSubmitting) {
      return;
    }
    if (nextValue !== courseLabelFilter) {
      invalidateCandidateSelection();
    }
    setCourseLabelFilter(nextValue);
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("courseLabel", nextValue);
      } else {
        params.delete("courseLabel");
      }
    });
  };

  const setOnlyMineAndSync = (nextValue: boolean) => {
    if (isFilterPending || isSubmitting) {
      return;
    }
    if (nextValue !== onlyMine) {
      invalidateCandidateSelection();
    }
    setOnlyMine(nextValue);
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("onlyMine", "true");
      } else {
        params.delete("onlyMine");
      }
    });
  };

  const setKnowledgeModuleFilterAndSync = (nextValue: string) => {
    if (isFilterPending || isSubmitting) {
      return;
    }
    if (nextValue !== knowledgeModuleFilter) {
      invalidateCandidateSelection();
    }
    setKnowledgeModuleFilter(nextValue);
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("knowledgeModule", nextValue);
      } else {
        params.delete("knowledgeModule");
      }
    });
  };

  const setDifficultyFilterAndSync = (value: string) => {
    if (isFilterPending || isSubmitting) {
      return;
    }
    const nextValue = parseDifficultyFilter(value) ?? "";
    if (nextValue !== difficultyFilter) {
      invalidateCandidateSelection();
    }
    setDifficultyFilter(nextValue);
    replaceSearchQuery((params) => {
      if (nextValue) {
        params.set("difficulty", nextValue);
      } else {
        params.delete("difficulty");
      }
    });
  };

  const resetFilters = () => {
    if (isFilterPending || isSubmitting) {
      return;
    }
    invalidateCandidateSelection();
    setCourseLabelFilter("");
    setOnlyMine(false);
    setKnowledgeModuleFilter("");
    setDifficultyFilter("");
    replaceSearchQuery((params) => {
      params.delete("courseLabel");
      params.delete("onlyMine");
      params.delete("knowledgeModule");
      params.delete("difficulty");
    });
  };

  const hasActiveQueryFilters =
    Boolean(courseLabelFilter) ||
    onlyMine ||
    Boolean(knowledgeModuleFilter) ||
    Boolean(difficultyFilter);
  const hasMoreTasks = loadedTasks.length < loadedTotal;
  const dueAtInputType =
    dueAt || isDueAtPickerActive ? "datetime-local" : "text";

  const handleLoadMore = async () => {
    if (
      isSubmitting ||
      isRefreshingCandidates ||
      isLoadingMore ||
      !hasMoreTasks
    ) {
      return;
    }

    const nextPage = loadedPage + 1;
    const query = buildQueryString({
      page: nextPage,
      limit: loadedLimit,
      courseLabel: courseLabelFilter || undefined,
      onlyMine: onlyMine ? "true" : undefined,
      knowledgeModule: knowledgeModuleFilter || undefined,
      difficulty: parseDifficultyFilter(difficultyFilter),
    });

    setIsLoadingMore(true);
    setLoadMoreError(null);
    const requestEpoch = loadMoreEpochRef.current;

    try {
      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/publishable-task-templates?${query}`,
      );
      const response = toPublishableTaskTemplateListResponse(payload);
      const nextItems = response.items;
      if (requestEpoch !== loadMoreEpochRef.current) {
        return;
      }

      setLoadedTasks((previous) => {
        if (requestEpoch !== loadMoreEpochRef.current) {
          return previous;
        }
        const seenIds = new Set(
          previous
            .map((task) => (typeof task.id === "string" ? task.id.trim() : ""))
            .filter((id) => id.length > 0),
        );
        const merged = [...previous];

        for (const item of nextItems) {
          const itemId = typeof item.id === "string" ? item.id.trim() : "";
          if (itemId && seenIds.has(itemId)) {
            continue;
          }
          if (itemId) {
            seenIds.add(itemId);
          }
          merged.push(item);
        }

        return merged;
      });

      setLoadedPage(
        typeof response.page === "number" && response.page > 0
          ? response.page
          : nextPage,
      );
      if (typeof response.limit === "number" && response.limit > 0) {
        setLoadedLimit(response.limit);
      }
      if (typeof response.total === "number" && response.total >= 0) {
        setLoadedTotal(response.total);
      }
    } catch (error) {
      if (requestEpoch !== loadMoreEpochRef.current) {
        return;
      }
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          403: "无权限加载更多候选模板。",
          404: "候选模板暂不可用或不存在。",
        };
        const summary =
          summaryByStatus[error.status] ?? "加载更多候选模板失败，请稍后重试。";
        setLoadMoreError(buildErrorDescription(summary, detail));
      } else {
        setLoadMoreError("加载更多候选模板失败，请稍后重试。");
      }
    } finally {
      if (requestEpoch === loadMoreEpochRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  const selectTask = (nextTaskId: string) => {
    if (isSubmitting || isRefreshingCandidates) {
      return;
    }
    setTaskId(
      loadedTasks.some((task) => task.id === nextTaskId) ? nextTaskId : "",
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isRefreshingCandidates) {
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);
    setCreatedTaskId(null);

    try {
      const publishTaskId = taskId.trim();
      if (
        !publishTaskId ||
        !loadedTasks.some((task) => task.id === publishTaskId)
      ) {
        setTaskId("");
        setErrorState({
          summary: "请先选择一个已发布任务模板。",
        });
        return;
      }

      const dueAtIso = toIsoDateTime(dueAt);

      const settings: NonNullable<PublishClassroomTaskRequest["settings"]> = {
        allowLate,
      };

      const body: PublishClassroomTaskRequest = {
        taskId: publishTaskId,
        settings,
      };
      if (dueAtIso) {
        body.dueAt = dueAtIso;
      }

      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const response = toSubmitTaskResponse(payload);
      setCreatedTaskId(response.id ?? null);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理任务。",
          404: "任务发布功能未启用、不可用或资源不存在。",
        };
        const summary =
          summaryByStatus[error.status] ?? "发布任务失败，请稍后重试。";

        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "发布任务失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      id="publish-task-form"
      className="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900"
    >
      <h2 className="text-base font-semibold text-zinc-900">发布任务到班级</h2>
      <p className="mt-1 text-sm text-zinc-600">
        当前仅支持选择已有任务模板并发布到本班；此处不创建或编辑任务模板。
      </p>
      <p className="mt-1 text-sm text-zinc-600">
        候选池按当前班级与筛选条件实时检索，默认包含你自己的模板与可见共享模板。
      </p>
      <p className="mt-1 text-sm text-zinc-600">
        候选中已排除本班已布置的模板，并优先显示课程匹配的模板。
      </p>
      <p className="mt-2 text-sm text-zinc-600">
        没有合适模板？
        <Link
          href={paths.teacher.tasksFromClassroom(classroomId)}
          className="ml-1 text-blue-700 hover:underline"
        >
          先去创建任务模板
        </Link>
      </p>
      {!isRefreshingCandidates && loadedTasks.length === 0 ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {hasActiveQueryFilters ? (
            <>
              当前筛选条件下没有匹配的可发布模板。可先
              <button
                type="button"
                onClick={resetFilters}
                disabled={isFilterPending || isSubmitting}
                className="mx-1 text-blue-700 underline"
              >
                重置筛选
              </button>
              ，或前往
              <Link
                href={paths.teacher.tasksFromClassroom(classroomId)}
                className="mx-1 underline"
              >
                任务模板页
              </Link>
              调整模板信息后再发布。
            </>
          ) : (
            <>
              当前班级暂无新的可发布模板。可前往
              <Link
                href={paths.teacher.tasksFromClassroom(classroomId)}
                className="mx-1 underline"
              >
                任务模板页
              </Link>
              创建并发布模板后，再回到本页发布到班级。
            </>
          )}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-sm font-medium text-zinc-900">
            模板筛选（实时查询）
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            调整课程分类、任务难度、仅看我的模板或知识模块后，将重新检索候选模板。
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">课程分类</span>
              <select
                value={courseLabelFilter}
                disabled={isFilterPending || isSubmitting}
                onChange={(event) =>
                  setCourseLabelFilterAndSync(event.target.value)
                }
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                <option value="">全部课程分类</option>
                {courseLabelOptions.map((option) => (
                  <option key={option} value={option}>
                    {toTaskCourseLabelDisplayText(option)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">知识模块</span>
              <select
                value={knowledgeModuleFilter}
                disabled={isFilterPending || isSubmitting}
                onChange={(event) =>
                  setKnowledgeModuleFilterAndSync(event.target.value)
                }
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                <option value="">全部模块</option>
                {knowledgeModuleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">任务难度</span>
              <select
                value={difficultyFilter}
                disabled={isFilterPending || isSubmitting}
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

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">模板范围</span>
              <span className="flex h-[42px] items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  disabled={isFilterPending || isSubmitting}
                  onChange={(event) => setOnlyMineAndSync(event.target.checked)}
                />
                仅看我的模板
              </span>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                disabled={isFilterPending || isSubmitting}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                重置筛选
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {isRefreshingCandidates
              ? "正在更新候选模板，请稍候。"
              : `当前已显示 ${loadedTasks.length} / ${loadedTotal} 个候选模板`}
          </p>
        </section>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">选择任务模板</span>
          <select
            value={taskId}
            disabled={isSubmitting || isRefreshingCandidates}
            onChange={(event) => selectTask(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            <option value="">
              {loadedTasks.length === 0
                ? "当前筛选下无可选模板"
                : "请选择已发布任务"}
            </option>
            {loadedTasks.map((task) => (
              <option key={task.id ?? task.title} value={task.id}>
                {task.title ?? "未命名任务"} |{" "}
                {toDisplayText(task.knowledgeModule)} | 难度：
                {getDifficultyLabel(task.difficulty)}
              </option>
            ))}
          </select>
        </label>

        {loadedTasks.length > 0 ? (
          <section className="rounded-md border border-zinc-200 bg-white p-3">
            <p className="text-sm font-medium text-zinc-900">模板候选列表</p>
            <p className="mt-1 text-xs text-zinc-600">
              点击“选择此模板”可快速回填到发布表单。
            </p>
            <ul className="mt-3 space-y-2">
              {loadedTasks.map((task, index) => {
                const rubricSummary = getCandidateRubricSummary(task.rubric);
                const isActive = task.id && task.id === taskId;
                const publisherLabel = getPublisherLabel(
                  task.publisher,
                  currentUserId,
                );
                return (
                  <li
                    key={task.id ?? `candidate-${index}`}
                    className={`rounded-md border p-3 ${
                      isActive
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 text-sm font-medium text-zinc-900">
                            {toDisplayText(task.title, "未命名任务")}
                          </p>
                          {publisherLabel ? (
                            <span className="inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                              {publisherLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={
                          !task.id || isSubmitting || isRefreshingCandidates
                        }
                        onClick={() => selectTask(task.id ?? "")}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isActive ? "已选中" : "选择此模板"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      模块：{toDisplayText(task.knowledgeModule)} | 评阅标准：
                      {rubricSummary}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-500">
                      任务难度：{getDifficultyLabel(task.difficulty)}
                    </p>
                    <p className="mt-2 text-xs text-zinc-600">
                      描述摘要：{toDescriptionSnippet(task.description)}
                    </p>
                  </li>
                );
              })}
            </ul>
            {loadMoreError ? (
              <p className="mt-3 text-xs text-rose-700">{loadMoreError}</p>
            ) : null}
            {hasMoreTasks ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  当前已显示 {loadedTasks.length} / {loadedTotal} 个候选模板
                </p>
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={
                    isSubmitting || isRefreshingCandidates || isLoadingMore
                  }
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMore ? "加载中..." : "加载更多"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedTask ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
            <p className="font-medium text-zinc-900">已选任务模板摘要</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <p>
                <span className="text-zinc-500">标题：</span>
                {toDisplayText(selectedTask.title)}
              </p>
              {selectedPublisherLabel ? (
                <p>
                  <span className="text-zinc-500">模板发布者：</span>
                  {selectedPublisherLabel}
                </p>
              ) : null}
              <p>
                <span className="text-zinc-500">状态：</span>
                {getTaskTemplateStatusLabel(selectedTask.status)}
              </p>
              <p>
                <span className="text-zinc-500">评阅标准：</span>
                {selectedRubricSummary}
              </p>
              <p>
                <span className="text-zinc-500">模块：</span>
                {toDisplayText(selectedTask.knowledgeModule)}
              </p>
              <p className="min-w-0 whitespace-pre-wrap break-words">
                <span className="text-zinc-500">任务难度：</span>
                {getDifficultyLabel(selectedTask.difficulty)}
              </p>
              <div className="md:col-span-2">
                <p className="mb-1 text-zinc-500">描述：</p>
                <div className="max-h-48 overflow-auto rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-700 whitespace-pre-wrap break-words">
                  {toDisplayText(selectedTask.description)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            请选择一个已发布任务模板后再提交发布。
          </p>
        )}

        <div className="grid gap-4">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">截止时间</span>
            <input
              type={dueAtInputType}
              placeholder="YYYY/MM/DD HH:mm"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              onFocus={() => setIsDueAtPickerActive(true)}
              onBlur={() => setIsDueAtPickerActive(Boolean(dueAt))}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

        <p className="text-xs text-zinc-600">
          学生或教师可在提交详情主动申请 AI 反馈。外部 AI
          是否允许使用仍由具体学习任务规定。
        </p>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={allowLate}
            onChange={(event) => setAllowLate(event.target.checked)}
          />
          允许迟交
        </label>

        <button
          type="submit"
          disabled={isSubmitting || isRefreshingCandidates || !selectedTask}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "发布中..." : "发布任务"}
        </button>
      </form>

      {createdTaskId ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p>任务发布成功。</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Link
              href={paths.teacher.classroomTaskDetail(
                classroomId,
                createdTaskId,
              )}
              className="text-emerald-800 underline"
            >
              查看任务详情
            </Link>
          </div>
        </div>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="发布任务失败"
            description={buildErrorDescription(
              errorState.summary,
              errorState.detail,
            )}
          />
        </div>
      ) : null}
    </section>
  );
}
