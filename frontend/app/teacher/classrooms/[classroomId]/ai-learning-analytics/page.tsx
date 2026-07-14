import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import {
  AiLearningAnalyticsComparableOutcomeChart,
  AiLearningAnalyticsTaskIssueLoadComparisonChart,
} from "@/components/teacher/AiLearningAnalyticsCharts";
import {
  AiLearningAnalyticsMethodologyPanel,
  AiLearningAnalyticsMetricGuide,
} from "@/components/teacher/AiLearningAnalyticsMethodology";
import {
  AiLearningAnalyticsSummary,
  AiLearningAnalyticsTeachingAttention,
} from "@/components/teacher/AiLearningAnalyticsSummary";
import {
  AiLearningAnalyticsStudentsTable,
  AiLearningAnalyticsTaskTable,
} from "@/components/teacher/AiLearningAnalyticsTables";
import { AiLearningAnalyticsStudentFilters } from "@/components/teacher/AiLearningAnalyticsStudentFilters";
import {
  TaskExclusionPanel,
  type TaskExclusionPanelTask,
} from "@/components/teacher/TaskExclusionPanel";
import {
  loadAllClassroomTaskOptions,
  type ClassroomTaskOption,
} from "@/lib/api/classroom-task-options";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toAiLearningAnalyticsOverviewResponse,
  toAiLearningAnalyticsStudentsResponse,
  type AiLearningAnalyticsOverviewResponse,
  type AiLearningAnalyticsEngagementStatus,
  type AiLearningAnalyticsOverallOutcome,
  type AiLearningAnalyticsStudentsResponse,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DISPLAY_WINDOWS,
  AI_LEARNING_ANALYTICS_WINDOW_LABELS,
  resolveAiLearningAnalyticsQueryState,
  toAiLearningAnalyticsExcludedTaskIdsQueryValue,
  toAiLearningAnalyticsSearchParamEntries,
  type AiLearningAnalyticsSearchParams,
} from "@/lib/ai-learning-analytics";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { buildQueryString, toDisplayDate, toDisplayText } from "@/lib/ui/format";

const STUDENT_PAGE_SIZE = 100;

type AiLearningAnalyticsPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<AiLearningAnalyticsSearchParams>;
};

type PresentedError = {
  status: number;
  description: string;
};

type StudentListState =
  | { mode: "ready"; data: AiLearningAnalyticsStudentsResponse }
  | { mode: "error"; error: PresentedError };

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }
  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

const presentError = (
  error: unknown,
  scene: string,
  notFoundSummary?: string,
): PresentedError => {
  if (error instanceof FetchJsonError) {
    const detail = extractRawDetail(error);
    const summary =
      error.status === 404 && notFoundSummary
        ? notFoundSummary
        : error.status === 403
          ? `无权限${scene}。`
          : getCommonErrorSummary(error.status, scene);
    return {
      status: error.status,
      description: buildErrorDescription(summary, detail),
    };
  }

  return {
    status: 500,
    description: `${scene}失败，请稍后重试。`,
  };
};

const buildClassAnalyticsHref = (
  classroomId: string,
  params: {
    window: AiLearningAnalyticsOverviewResponse["context"]["window"];
    excludedTaskIds: string[];
    page: number;
    q?: string;
    overallOutcome?: AiLearningAnalyticsOverallOutcome;
    engagementStatus?: AiLearningAnalyticsEngagementStatus;
  },
): string => {
  const query = buildQueryString({
    window: params.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      params.excludedTaskIds,
    ),
    page: params.page,
    q: params.q,
    overallOutcome: params.overallOutcome,
    engagementStatus: params.engagementStatus,
  });
  const pathname = paths.teacher.classroomAiLearningAnalytics(classroomId);
  return query ? `${pathname}?${query}` : pathname;
};

const toTaskOptionMeta = (taskOption: ClassroomTaskOption): string =>
  [
    `发布时间：${toDisplayDate(taskOption.publishedAt)}`,
    `截止：${toDisplayDate(taskOption.dueAt)}`,
    `状态：${toDisplayText(taskOption.status)}`,
  ].join(" · ");

const getScopeNotice = (
  overview: AiLearningAnalyticsOverviewResponse,
): { title: string; description: string } | null => {
  const { context, summary } = overview;
  if (context.effectiveTaskCount === 0) {
    return {
      title: "当前统计范围内暂无有效课堂任务",
      description: "可切换统计窗口或清空任务排除条件后再查看。",
    };
  }
  if (summary.activeStudentsCount === 0) {
    return {
      title: "当前班级暂无有效学生",
      description: "分析学生范围仅包含当前 ACTIVE 学生。",
    };
  }
  if (summary.submittedStudentTaskCount === 0) {
    return {
      title: "当前范围暂无学生提交",
      description: "任务仍会出现在任务明细中，但暂时没有学生 × 课堂任务提交样本。",
    };
  }
  if (summary.aiRequestedStudentTaskCount === 0) {
    return {
      title: "当前范围暂无 EduForge AI 反馈请求",
      description: "已有提交，但尚无对应的 EduForge AI Feedback job。",
    };
  }
  if (summary.aiDeliveredStudentTaskCount === 0) {
    return {
      title: "当前范围暂无成功交付的 AI 反馈",
      description: "已有反馈请求，但尚无 SUCCEEDED AI job 可用于观察后续行为。",
    };
  }
  if (summary.qualityComparableStudentTaskCount === 0) {
    return {
      title: "当前范围暂无可比较的介入前后样本",
      description: "摘要和任务明细仍保留；问题负荷对比图不会伪造为持平。",
    };
  }
  return null;
};

function HeaderActions({ classroomId }: { classroomId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link
        href={paths.teacher.classroomDashboard(classroomId)}
        className="text-blue-700 hover:underline"
      >
        返回班级看板
      </Link>
      <Link
        href={paths.teacher.classroomWeeklyReport(classroomId)}
        className="text-blue-700 hover:underline"
      >
        班级周报
      </Link>
      <Link
        href={paths.teacher.classroomProcessAssessment(classroomId)}
        className="text-blue-700 hover:underline"
      >
        过程性评价
      </Link>
    </div>
  );
}

export default async function AiLearningAnalyticsPage({
  params,
  searchParams,
}: AiLearningAnalyticsPageProps) {
  const { classroomId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveAiLearningAnalyticsQueryState(rawQuery);
  const excludedTaskIdsQueryValue =
    toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      queryState.excludedTaskIds,
    );
  const currentQueryEntries = toAiLearningAnalyticsSearchParamEntries({
    window: queryState.window,
    page: String(queryState.page),
    excludedTaskIds: excludedTaskIdsQueryValue,
    q: queryState.q,
    overallOutcome: queryState.overallOutcome,
    engagementStatus: queryState.engagementStatus,
  });
  const sharedQuery = {
    window: queryState.window,
    excludedTaskIds: excludedTaskIdsQueryValue,
  };
  const overviewQuery = buildQueryString(sharedQuery);
  const studentsQuery = buildQueryString({
    ...sharedQuery,
    page: queryState.page,
    limit: STUDENT_PAGE_SIZE,
    q: queryState.q,
    overallOutcome: queryState.overallOutcome,
    engagementStatus: queryState.engagementStatus,
  });
  const origin = await getRequestOrigin();
  const [overviewResult, studentsResult, taskOptionsResult] =
    await Promise.allSettled([
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/ai-learning-analytics?${overviewQuery}`,
        { origin, cache: "no-store" },
      ),
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/ai-learning-analytics/students?${studentsQuery}`,
        { origin, cache: "no-store" },
      ),
      loadAllClassroomTaskOptions({ classroomId, origin }),
    ]);

  if (overviewResult.status === "rejected") {
    const error = presentError(
      overviewResult.reason,
      "加载 AI 反馈介入成效分析",
      "班级不存在或无权访问。",
    );
    return (
      <section className="space-y-4">
        <PageHeader
          title="AI 反馈介入成效分析"
          description={`当前统计窗口：${AI_LEARNING_ANALYTICS_WINDOW_LABELS[queryState.window]}`}
          actions={<HeaderActions classroomId={classroomId} />}
        />
        <ErrorState
          status={error.status}
          title="AI 反馈介入成效分析加载失败"
          description={error.description}
        />
      </section>
    );
  }

  const overview = toAiLearningAnalyticsOverviewResponse(overviewResult.value);
  const studentListState: StudentListState =
    studentsResult.status === "fulfilled"
      ? {
          mode: "ready",
          data: toAiLearningAnalyticsStudentsResponse(studentsResult.value),
        }
      : {
          mode: "error",
          error: presentError(studentsResult.reason, "加载学生分析列表"),
        };
  const taskOptions =
    taskOptionsResult.status === "fulfilled" ? taskOptionsResult.value : [];
  const taskOptionsLoadError =
    taskOptionsResult.status === "rejected"
      ? buildErrorDescription(
          "排除任务列表加载失败；分析主体仍按 URL 中的排除参数计算。",
          taskOptionsResult.reason instanceof FetchJsonError
            ? extractRawDetail(taskOptionsResult.reason)
            : undefined,
        )
      : undefined;
  const taskExclusionPanelTasks: TaskExclusionPanelTask[] = taskOptions.map(
    (taskOption) => ({
      id: taskOption.id,
      title: taskOption.title,
      publishedAt: taskOption.publishedAt ?? null,
      metaText: toTaskOptionMeta(taskOption),
    }),
  );
  const context = overview.context;
  const courseDescription = [
    context.courseName,
    context.courseCode ? `课程代码：${context.courseCode}` : null,
    context.courseTerm ? `学期：${context.courseTerm}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const scopeNotice = getScopeNotice(overview);

  return (
    <section className="space-y-4">
      <PageHeader
        title="AI 反馈介入成效分析"
        description={`${courseDescription || "课程信息未设置"} · 班级：${context.classroomName} · 统计窗口：${AI_LEARNING_ANALYTICS_WINDOW_LABELS[context.window]}`}
        actions={<HeaderActions classroomId={classroomId} />}
      />

      <AiLearningAnalyticsMethodologyPanel methodology={overview.methodology} />

      <AiLearningAnalyticsMetricGuide variant="class" />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-medium text-zinc-900">统计窗口筛选</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {AI_LEARNING_ANALYTICS_DISPLAY_WINDOWS.map((windowValue) => (
            <Link
              key={windowValue}
              href={buildClassAnalyticsHref(classroomId, {
                window: windowValue,
                excludedTaskIds: queryState.excludedTaskIds,
                page: 1,
                q: queryState.q,
                overallOutcome: queryState.overallOutcome,
                engagementStatus: queryState.engagementStatus,
              })}
              className={
                windowValue === context.window
                  ? "font-semibold text-blue-700"
                  : "text-blue-700 hover:underline"
              }
            >
              {AI_LEARNING_ANALYTICS_WINDOW_LABELS[windowValue]}
            </Link>
          ))}
          <span className="text-zinc-500">
            当前：{AI_LEARNING_ANALYTICS_WINDOW_LABELS[context.window]}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          统计窗口按课堂任务发布时间筛选；任务纳入后，该任务下的完整提交链参与分析。
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          统计生成于：{toDisplayDate(context.generatedAt)}
        </p>
      </section>

      <details
        open={queryState.excludedTaskIds.length > 0}
        className="rounded-lg border border-zinc-200 bg-white p-4 text-sm"
      >
        <summary className="cursor-pointer font-medium text-zinc-900">
          临时排除课堂任务
        </summary>
        <TaskExclusionPanel
          mode="ai-learning-analytics"
          classroomId={classroomId}
          window={context.window}
          initialExcludedTaskIds={queryState.excludedTaskIds}
          tasks={taskExclusionPanelTasks}
          initialQueryEntries={currentQueryEntries}
          taskOptionsLoadError={taskOptionsLoadError}
          currentPathname={paths.teacher.classroomAiLearningAnalytics(
            classroomId,
          )}
        />
      </details>

      <AiLearningAnalyticsSummary overview={overview} />

      {scopeNotice ? (
        <EmptyState
          title={scopeNotice.title}
          description={scopeNotice.description}
        />
      ) : null}

      <AiLearningAnalyticsTeachingAttention
        taskTrends={overview.taskTrends}
      />

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          课堂任务对比分析
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          按后端返回的任务顺序逐行对比，不把不同课堂任务连接成连续时间序列。
        </p>
        <div className="mt-3 space-y-3">
          {overview.taskTrends.length > 0 ? (
            <>
              <AiLearningAnalyticsTaskIssueLoadComparisonChart
                taskTrends={overview.taskTrends}
              />
              <AiLearningAnalyticsComparableOutcomeChart
                taskTrends={overview.taskTrends}
              />
            </>
          ) : (
            <EmptyState
              title="当前统计范围内暂无有效课堂任务"
              description="任务排除和统计窗口共同决定当前有效任务范围。"
            />
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          课堂任务分析明细
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          覆盖当前有效任务，包括零提交任务；“—”表示没有对应分母或质量可比样本。
        </p>
        <div className="mt-3">
          <AiLearningAnalyticsTaskTable taskTrends={overview.taskTrends} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">学生分析列表</h2>
        <p className="mt-1 text-xs text-zinc-500">
          仅展示当前班级 ACTIVE 学生；每页最多 {STUDENT_PAGE_SIZE}
          名，不进行前端排序或排名。
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          “总体变化”由后端按当前范围内全部可比任务的问题负荷净变化给出，不是时间序列回归，也不是能力成长或退步结论。
        </p>
        <AiLearningAnalyticsStudentFilters
          classroomId={classroomId}
          window={context.window}
          excludedTaskIds={queryState.excludedTaskIds}
          q={queryState.q}
          overallOutcome={queryState.overallOutcome}
          engagementStatus={queryState.engagementStatus}
        />
        {studentListState.mode === "error" ? (
          <div className="mt-3">
            <ErrorState
              status={studentListState.error.status}
              title="学生分析列表加载失败"
              description={studentListState.error.description}
            />
          </div>
        ) : (
          (() => {
            const students = studentListState.data;
            const hasAppliedFilters =
              students.filters.q !== null ||
              students.filters.overallOutcome !== null ||
              students.filters.engagementStatus !== null;
            const totalPages = Math.max(
              1,
              Math.ceil(students.total / students.limit),
            );
            const showPagination = students.total > students.limit;
            const isCurrentPageEmpty =
              students.total > 0 &&
              students.items.length === 0 &&
              students.page > 1;
            const clearFiltersHref = buildClassAnalyticsHref(classroomId, {
              window: context.window,
              excludedTaskIds: queryState.excludedTaskIds,
              page: 1,
            });
            const firstPageHref = buildClassAnalyticsHref(classroomId, {
              window: context.window,
              excludedTaskIds: queryState.excludedTaskIds,
              page: 1,
              q: students.filters.q ?? undefined,
              overallOutcome: students.filters.overallOutcome ?? undefined,
              engagementStatus: students.filters.engagementStatus ?? undefined,
            });
            return (
              <>
                <p className="mt-3 text-sm text-zinc-600">
                  {hasAppliedFilters ? (
                    <>
                      共 {students.activeStudentsTotal} 名 ACTIVE 学生，筛选命中{" "}
                      {students.total} 名，当前显示 {students.items.length} 名。
                    </>
                  ) : (
                    <>
                      共 {students.activeStudentsTotal} 名 ACTIVE 学生，当前显示{" "}
                      {students.items.length} 名。
                    </>
                  )}
                </p>
                {students.items.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState
                      title={
                        students.activeStudentsTotal === 0
                          ? "当前班级暂无 ACTIVE 学生"
                          : students.total === 0
                            ? "没有学生符合当前搜索和筛选条件"
                            : "当前分页无数据"
                      }
                      description={
                        students.activeStudentsTotal === 0
                          ? "学生分析列表仅覆盖当前 ACTIVE 学生。"
                          : students.total === 0
                            ? "可清空或调整学生搜索与筛选条件后重试。"
                            : "可返回第 1 页继续查看。"
                      }
                      actions={
                        students.activeStudentsTotal > 0 &&
                        students.total === 0 ? (
                          <Link
                            href={clearFiltersHref}
                            className="text-blue-700 hover:underline"
                          >
                            清空筛选
                          </Link>
                        ) : isCurrentPageEmpty ? (
                          <Link
                            href={firstPageHref}
                            className="text-blue-700 hover:underline"
                          >
                            返回第 1 页
                          </Link>
                        ) : null
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-3">
                    <AiLearningAnalyticsStudentsTable
                      students={students.items}
                      classroomId={classroomId}
                      window={context.window}
                      excludedTaskIds={queryState.excludedTaskIds}
                      page={students.page}
                      q={students.filters.q ?? undefined}
                      overallOutcome={
                        students.filters.overallOutcome ?? undefined
                      }
                      engagementStatus={
                        students.filters.engagementStatus ?? undefined
                      }
                    />
                  </div>
                )}

                {showPagination ? (
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="text-zinc-600">
                      第 {students.page} / {totalPages} 页
                    </span>
                    {students.page > 1 ? (
                      <Link
                        href={buildClassAnalyticsHref(classroomId, {
                          window: context.window,
                          excludedTaskIds: queryState.excludedTaskIds,
                          page: students.page - 1,
                          q: students.filters.q ?? undefined,
                          overallOutcome:
                            students.filters.overallOutcome ?? undefined,
                          engagementStatus:
                            students.filters.engagementStatus ?? undefined,
                        })}
                        className="text-blue-700 hover:underline"
                      >
                        上一页
                      </Link>
                    ) : (
                      <span className="text-zinc-400">上一页</span>
                    )}
                    {students.page < totalPages ? (
                      <Link
                        href={buildClassAnalyticsHref(classroomId, {
                          window: context.window,
                          excludedTaskIds: queryState.excludedTaskIds,
                          page: students.page + 1,
                          q: students.filters.q ?? undefined,
                          overallOutcome:
                            students.filters.overallOutcome ?? undefined,
                          engagementStatus:
                            students.filters.engagementStatus ?? undefined,
                        })}
                        className="text-blue-700 hover:underline"
                      >
                        下一页
                      </Link>
                    ) : (
                      <span className="text-zinc-400">下一页</span>
                    )}
                  </div>
                ) : null}
              </>
            );
          })()
        )}
      </section>

      {process.env.NODE_ENV !== "production" ? (
        <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-zinc-800">
            查看原始 AI 反馈介入成效分析 JSON
          </summary>
          <pre className="mt-3 overflow-auto text-xs text-zinc-700">
            {JSON.stringify(
              {
                overview: overview.raw,
                students:
                  studentListState.mode === "ready"
                    ? studentListState.data.raw
                    : { error: studentListState.error.description },
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
