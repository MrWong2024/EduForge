import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import {
  AiLearningAnalyticsClassDeltaChart,
  AiLearningAnalyticsRatesChart,
} from "@/components/teacher/AiLearningAnalyticsCharts";
import {
  AiLearningAnalyticsMethodologyPanel,
  AiLearningAnalyticsMetricGuide,
} from "@/components/teacher/AiLearningAnalyticsMethodology";
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
  type AiLearningAnalyticsStudentsResponse,
  type AiLearningAnalyticsTaskTrend,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DISPLAY_WINDOWS,
  AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS,
  AI_LEARNING_ANALYTICS_WINDOW_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
  getAiLearningAnalyticsDeltaMeaning,
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
  },
): string => {
  const query = buildQueryString({
    window: params.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      params.excludedTaskIds,
    ),
    page: params.page,
  });
  const pathname = paths.teacher.classroomAiLearningAnalytics(classroomId);
  return query ? `${pathname}?${query}` : pathname;
};

const buildStudentDetailHref = (
  classroomId: string,
  studentId: string,
  params: {
    window: AiLearningAnalyticsOverviewResponse["context"]["window"];
    excludedTaskIds: string[];
    page: number;
  },
): string => {
  const query = buildQueryString({
    window: params.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      params.excludedTaskIds,
    ),
    page: params.page,
  });
  const pathname = paths.teacher.classroomAiLearningAnalyticsStudent(
    classroomId,
    studentId,
  );
  return query ? `${pathname}?${query}` : pathname;
};

const toTaskOptionMeta = (taskOption: ClassroomTaskOption): string =>
  [
    `发布时间：${toDisplayDate(taskOption.publishedAt)}`,
    `截止：${toDisplayDate(taskOption.dueAt)}`,
    `状态：${toDisplayText(taskOption.status)}`,
  ].join(" · ");

const formatComparableDelta = (
  value: number,
  comparableCount: number,
): string =>
  comparableCount > 0
    ? `${formatAiLearningAnalyticsDelta(value)}（${getAiLearningAnalyticsDeltaMeaning(value)}）`
    : "—";

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
      description: "摘要和任务明细仍保留；问题负荷变化曲线不会伪造为持平。",
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

function SummarySection({
  overview,
}: {
  overview: AiLearningAnalyticsOverviewResponse;
}) {
  const { summary } = overview;
  const hasComparableSamples = summary.qualityComparableStudentTaskCount > 0;
  const primaryMetrics = [
    {
      key: "activeStudents",
      label: "ACTIVE 学生数",
      value: `${summary.activeStudentsCount}`,
      secondary: "仅统计当前有效成员",
    },
    {
      key: "studentCoverage",
      label: "AI 反馈学生覆盖率",
      value: formatAiLearningAnalyticsPercent(summary.aiStudentCoverageRate),
      secondary: "至少一个任务存在 EduForge AI 反馈请求的学生",
    },
    {
      key: "taskCoverage",
      label: "AI 反馈任务覆盖率",
      value: formatAiLearningAnalyticsPercent(summary.aiTaskCoverageRate),
      secondary: `${summary.aiRequestedStudentTaskCount} / ${summary.submittedStudentTaskCount} 个已提交 student-task`,
    },
    {
      key: "resubmission",
      label: "反馈后重提率",
      value: formatAiLearningAnalyticsPercent(
        summary.postFeedbackResubmissionRate,
      ),
      secondary: `${summary.postFeedbackResubmittedStudentTaskCount} / ${summary.aiDeliveredStudentTaskCount} 个已交付 student-task`,
    },
    {
      key: "comparable",
      label: "质量可比样本数",
      value: `${summary.qualityComparableStudentTaskCount}`,
      secondary: "仅介入前后两次提交均有成功 AI 分析的 student-task",
    },
    {
      key: "improved",
      label: "可比样本改善率",
      value: formatAiLearningAnalyticsPercent(summary.improvedRate),
      secondary: `${summary.improvedStudentTaskCount} / ${summary.qualityComparableStudentTaskCount} 个质量可比样本`,
    },
  ];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">班级分析摘要</h2>
      <p className="mt-1 text-xs text-zinc-500">
        以下汇总直接来自总览接口，不由当前学生分页结果重新计算。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {primaryMetrics.map((metric) => (
          <article
            key={metric.key}
            className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
          >
            <p className="text-xs text-zinc-500">{metric.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
              {metric.value}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              {metric.secondary}
            </p>
          </article>
        ))}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-md border border-zinc-200 px-3 py-2.5 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <dt className="text-xs text-zinc-500">AI 反馈交付率</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
            {formatAiLearningAnalyticsPercent(summary.aiDeliveryRate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">
            首次反馈后重提代码变化率
          </dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
            {formatAiLearningAnalyticsPercent(
              summary.postFeedbackCodeChangeRate,
            )}
          </dd>
          <p className="mt-1 text-[11px] leading-5 text-zinc-500">
            比较首次成功获得 AI
            反馈的提交与反馈完成后的第一次后续提交。
          </p>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">平均问题负荷 before</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
            {hasComparableSamples
              ? formatAiLearningAnalyticsIssueLoad(
                  summary.averageIssueLoadBefore,
                )
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">平均问题负荷 after</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
            {hasComparableSamples
              ? formatAiLearningAnalyticsIssueLoad(
                  summary.averageIssueLoadAfter,
                )
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">平均差值</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
            {formatComparableDelta(
              summary.averageIssueLoadDelta,
              summary.qualityComparableStudentTaskCount,
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function TaskTrendsTable({ taskTrends }: { taskTrends: AiLearningAnalyticsTaskTrend[] }) {
  if (taskTrends.length === 0) {
    return (
      <EmptyState
        title="当前统计范围内暂无有效课堂任务"
        description="任务排除和统计窗口共同决定当前有效任务范围。"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[1680px] border-collapse text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="px-3 py-2.5">任务</th>
            <th className="px-3 py-2.5 text-center">提交学生</th>
            <th className="px-3 py-2.5 text-center">AI 反馈请求</th>
            <th className="px-3 py-2.5 text-center">AI 反馈交付</th>
            <th className="px-3 py-2.5 text-center">反馈后重提</th>
            <th className="px-3 py-2.5 text-center">代码变化</th>
            <th className="px-3 py-2.5 text-center">质量可比</th>
            <th className="px-3 py-2.5 text-center">改善 / 持平 / 恶化</th>
            <th className="px-3 py-2.5 text-center">反馈后重提率</th>
            <th className="px-3 py-2.5 text-center">质量可比率</th>
            <th className="px-3 py-2.5 text-center">可比样本改善率</th>
            <th className="px-3 py-2.5 text-center">平均问题负荷</th>
            <th className="px-3 py-2.5 text-center">平均差值</th>
          </tr>
        </thead>
        <tbody>
          {taskTrends.map((task, index) => {
            const hasComparable = task.qualityComparableStudentCount > 0;
            return (
              <tr
                key={task.classroomTaskId || `task-trend-${index}`}
                className="border-t border-zinc-100 align-top"
              >
                <td className="max-w-72 px-3 py-2.5">
                  <p
                    className="truncate font-medium text-zinc-900"
                    title={task.taskTitle}
                  >
                    {task.taskTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    发布时间：{toDisplayDate(task.publishedAt)}
                  </p>
                </td>
                {[
                  task.submittedStudentCount,
                  task.aiRequestedStudentCount,
                  task.aiDeliveredStudentCount,
                  task.postFeedbackResubmittedStudentCount,
                  task.postFeedbackCodeChangedStudentCount,
                  task.qualityComparableStudentCount,
                ].map((value, valueIndex) => (
                  <td
                    key={`${task.classroomTaskId}-count-${valueIndex}`}
                    className="px-3 py-2.5 text-center tabular-nums text-zinc-800"
                  >
                    {value}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {task.improvedStudentCount} / {task.stableStudentCount} /{" "}
                  {task.regressedStudentCount}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {task.aiDeliveredStudentCount > 0
                    ? formatAiLearningAnalyticsPercent(
                        task.postFeedbackResubmissionRate,
                      )
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {task.aiDeliveredStudentCount > 0
                    ? formatAiLearningAnalyticsPercent(
                        task.qualityComparableRate,
                      )
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {hasComparable
                    ? formatAiLearningAnalyticsPercent(task.improvedRate)
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {hasComparable
                    ? `${formatAiLearningAnalyticsIssueLoad(task.averageIssueLoadBefore)} → ${formatAiLearningAnalyticsIssueLoad(task.averageIssueLoadAfter)}`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                  {formatComparableDelta(
                    task.averageIssueLoadDelta,
                    task.qualityComparableStudentCount,
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const currentQueryEntries = toAiLearningAnalyticsSearchParamEntries(rawQuery);
  const sharedQuery = {
    window: queryState.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      queryState.excludedTaskIds,
    ),
  };
  const overviewQuery = buildQueryString(sharedQuery);
  const studentsQuery = buildQueryString({
    ...sharedQuery,
    page: queryState.page,
    limit: STUDENT_PAGE_SIZE,
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
  const summary = overview.summary;
  const courseDescription = [
    context.courseName,
    context.courseCode ? `课程代码：${context.courseCode}` : null,
    context.courseTerm ? `学期：${context.courseTerm}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const scopeNotice = getScopeNotice(overview);
  const hasComparableSamples = summary.qualityComparableStudentTaskCount > 0;

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

      <SummarySection overview={overview} />

      {scopeNotice ? (
        <EmptyState
          title={scopeNotice.title}
          description={scopeNotice.description}
        />
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          班级反馈介入变化趋势
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          横轴严格使用后端返回的课堂任务顺序；数值明细可在下方任务表中核对。
        </p>
        <div className="mt-3 space-y-3">
          {hasComparableSamples ? (
            <AiLearningAnalyticsClassDeltaChart
              taskTrends={overview.taskTrends}
            />
          ) : (
            <EmptyState
              title="暂无可比较的问题负荷变化曲线"
              description="质量可比样本数为 0，未将后端零值绘制为真实持平点。"
            />
          )}
          {overview.taskTrends.length > 0 ? (
            <AiLearningAnalyticsRatesChart taskTrends={overview.taskTrends} />
          ) : null}
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
          <TaskTrendsTable taskTrends={overview.taskTrends} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">学生分析列表</h2>
        <p className="mt-1 text-xs text-zinc-500">
          仅展示当前班级 ACTIVE 学生；每页最多 {STUDENT_PAGE_SIZE}
          名，不进行前端排序、搜索或排名。
        </p>
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
            const totalPages = Math.max(
              1,
              Math.ceil(students.total / STUDENT_PAGE_SIZE),
            );
            const showPagination = students.total > STUDENT_PAGE_SIZE;
            const isCurrentPageEmpty =
              students.total > 0 && students.items.length === 0;
            return (
              <>
                <p className="mt-3 text-sm text-zinc-600">
                  共 {students.total} 名学生，当前显示 {students.items.length} 名
                </p>
                {students.items.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState
                      title={
                        isCurrentPageEmpty
                          ? "当前页暂无学生分析数据"
                          : "当前班级暂无有效学生"
                      }
                      description={
                        isCurrentPageEmpty
                          ? "可返回上一页继续查看。"
                          : "学生分析列表仅覆盖 ACTIVE 学生。"
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
                    <table className="w-full min-w-[1500px] border-collapse text-sm">
                      <thead className="bg-zinc-50 text-left text-zinc-600">
                        <tr>
                          <th className="px-3 py-2.5">学生</th>
                          <th className="px-3 py-2.5 text-center">已提交任务</th>
                          <th className="px-3 py-2.5 text-center">
                            AI 反馈请求 / 交付
                          </th>
                          <th className="px-3 py-2.5 text-center">反馈后重提</th>
                          <th className="px-3 py-2.5 text-center">代码变化</th>
                          <th className="px-3 py-2.5 text-center">质量可比</th>
                          <th className="px-3 py-2.5 text-center">改善 / 持平 / 恶化</th>
                          <th className="px-3 py-2.5 text-center">平均问题负荷差值</th>
                          <th className="px-3 py-2.5">介入变化趋势</th>
                          <th className="px-3 py-2.5">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.items.map((student, index) => (
                          <tr
                            key={student.studentId || `student-${index}`}
                            className="border-t border-zinc-100 align-top"
                          >
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-zinc-900">
                                {student.studentName}
                              </p>
                              <p className="mt-0.5 text-[11px] text-zinc-500">
                                {student.studentNo
                                  ? `学号：${student.studentNo}`
                                  : "学号未设置"}
                              </p>
                            </td>
                            {[
                              student.submittedTasksCount,
                              `${student.aiRequestedTasksCount} / ${student.aiDeliveredTasksCount}`,
                              student.postFeedbackResubmittedTasksCount,
                              student.postFeedbackCodeChangedTasksCount,
                              student.qualityComparableTasksCount,
                              `${student.improvedTasksCount} / ${student.stableTasksCount} / ${student.regressedTasksCount}`,
                            ].map((value, valueIndex) => (
                              <td
                                key={`${student.studentId}-metric-${valueIndex}`}
                                className="px-3 py-2.5 text-center tabular-nums text-zinc-800"
                              >
                                {value}
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                              {formatComparableDelta(
                                student.averageIssueLoadDelta,
                                student.qualityComparableTasksCount,
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-zinc-800">
                              {
                                AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS[
                                  student.growthTrend
                                ]
                              }
                            </td>
                            <td className="px-3 py-2.5">
                              {student.studentId ? (
                                <Link
                                  href={buildStudentDetailHref(
                                    classroomId,
                                    student.studentId,
                                    {
                                      window: context.window,
                                      excludedTaskIds:
                                        queryState.excludedTaskIds,
                                      page: students.page,
                                    },
                                  )}
                                  className="text-blue-700 hover:underline"
                                >
                                  查看详情
                                </Link>
                              ) : (
                                <span className="text-zinc-400">暂不可用</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
    </section>
  );
}
