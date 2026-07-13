import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiLearningAnalyticsStudentDeltaChart } from "@/components/teacher/AiLearningAnalyticsCharts";
import {
  AiLearningAnalyticsMethodologyPanel,
  AiLearningAnalyticsMetricGuide,
} from "@/components/teacher/AiLearningAnalyticsMethodology";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toAiLearningAnalyticsStudentDetailResponse,
  type AiLearningAnalyticsTaskPoint,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS,
  AI_LEARNING_ANALYTICS_OUTCOME_LABELS,
  AI_LEARNING_ANALYTICS_WINDOW_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  getAiLearningAnalyticsDeltaMeaning,
  resolveAiLearningAnalyticsQueryState,
  toAiLearningAnalyticsExcludedTaskIdsQueryValue,
  type AiLearningAnalyticsSearchParams,
} from "@/lib/ai-learning-analytics";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { buildQueryString, toDisplayDate } from "@/lib/ui/format";

type AiLearningAnalyticsStudentPageProps = {
  params: Promise<{ classroomId: string; studentId: string }>;
  searchParams: Promise<AiLearningAnalyticsSearchParams>;
};

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }
  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

const buildBackToAnalyticsHref = (
  classroomId: string,
  queryState: ReturnType<typeof resolveAiLearningAnalyticsQueryState>,
): string => {
  const query = buildQueryString({
    window: queryState.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      queryState.excludedTaskIds,
    ),
    page: queryState.page,
  });
  const pathname = paths.teacher.classroomAiLearningAnalytics(classroomId);
  return query ? `${pathname}?${query}` : pathname;
};

const toBooleanText = (value: boolean): string => (value ? "是" : "否");

const formatNullableIssueLoad = (value: number | null): string =>
  value === null ? "—" : formatAiLearningAnalyticsIssueLoad(value);

const formatComparableDelta = (
  value: number,
  comparableCount: number,
): string =>
  comparableCount > 0
    ? `${formatAiLearningAnalyticsDelta(value)}（${getAiLearningAnalyticsDeltaMeaning(value)}）`
    : "—";

function StudentTaskPointsTable({
  taskPoints,
}: {
  taskPoints: AiLearningAnalyticsTaskPoint[];
}) {
  if (taskPoints.length === 0) {
    return (
      <EmptyState
        title="当前统计范围内暂无有效课堂任务"
        description="学生摘要仍可查看，但当前没有任务明细。"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[1540px] border-collapse text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="px-3 py-2.5">任务</th>
            <th className="px-3 py-2.5">发布时间</th>
            <th className="px-3 py-2.5 text-center">提交次数</th>
            <th className="px-3 py-2.5 text-center">请求 EduForge AI 反馈</th>
            <th className="px-3 py-2.5 text-center">成功交付 AI 反馈</th>
            <th className="px-3 py-2.5 text-center">反馈后重提</th>
            <th className="px-3 py-2.5 text-center">代码变化</th>
            <th className="px-3 py-2.5 text-center">质量可比</th>
            <th className="px-3 py-2.5 text-center">问题负荷 before → after</th>
            <th className="px-3 py-2.5 text-center">差值</th>
            <th className="px-3 py-2.5">结果</th>
          </tr>
        </thead>
        <tbody>
          {taskPoints.map((task, index) => (
            <tr
              key={task.classroomTaskId || `student-task-point-${index}`}
              className="border-t border-zinc-100 align-top"
            >
              <td className="max-w-72 px-3 py-2.5">
                <p
                  className="truncate font-medium text-zinc-900"
                  title={task.taskTitle}
                >
                  {task.taskTitle}
                </p>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">
                {toDisplayDate(task.publishedAt)}
              </td>
              <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                {task.attemptsCount}
              </td>
              {[
                task.aiRequested,
                task.aiDelivered,
                task.postFeedbackResubmitted,
                task.postFeedbackCodeChanged,
                task.qualityComparable,
              ].map((value, valueIndex) => (
                <td
                  key={`${task.classroomTaskId}-boolean-${valueIndex}`}
                  className="px-3 py-2.5 text-center text-zinc-800"
                >
                  {toBooleanText(value)}
                </td>
              ))}
              <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                {formatNullableIssueLoad(task.issueLoadBefore)} →{" "}
                {formatNullableIssueLoad(task.issueLoadAfter)}
              </td>
              <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                {task.issueLoadDelta === null
                  ? "—"
                  : formatAiLearningAnalyticsDelta(task.issueLoadDelta)}
              </td>
              <td className="px-3 py-2.5 text-zinc-800">
                {AI_LEARNING_ANALYTICS_OUTCOME_LABELS[task.outcome]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AiLearningAnalyticsStudentPage({
  params,
  searchParams,
}: AiLearningAnalyticsStudentPageProps) {
  const { classroomId, studentId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveAiLearningAnalyticsQueryState(rawQuery);
  const backendQuery = buildQueryString({
    window: queryState.window,
    excludedTaskIds: toAiLearningAnalyticsExcludedTaskIdsQueryValue(
      queryState.excludedTaskIds,
    ),
  });
  const backToAnalyticsHref = buildBackToAnalyticsHref(
    classroomId,
    queryState,
  );

  let payload: unknown;
  try {
    const origin = await getRequestOrigin();
    payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/ai-learning-analytics/students/${encodeURIComponent(studentId)}?${backendQuery}`,
      { origin, cache: "no-store" },
    );
  } catch (error) {
    const status = error instanceof FetchJsonError ? error.status : 500;
    const detail =
      error instanceof FetchJsonError ? extractRawDetail(error) : undefined;
    const summary =
      status === 404
        ? "学生不存在或无权访问。"
        : status === 403
          ? "无权限访问该学生分析详情。"
          : getCommonErrorSummary(status, "加载学生分析详情");
    return (
      <section className="space-y-4">
        <PageHeader
          title="学生分析详情"
          description={`统计窗口：${AI_LEARNING_ANALYTICS_WINDOW_LABELS[queryState.window]}`}
          actions={
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                href={backToAnalyticsHref}
                className="text-blue-700 hover:underline"
              >
                返回班级分析
              </Link>
              <Link
                href={paths.teacher.classroomDashboard(classroomId)}
                className="text-blue-700 hover:underline"
              >
                返回班级看板
              </Link>
            </div>
          }
        />
        <ErrorState
          status={status}
          title="学生分析详情加载失败"
          description={buildErrorDescription(summary, detail)}
        />
      </section>
    );
  }

  const detail = toAiLearningAnalyticsStudentDetailResponse(payload);
  const { context, student, summary, taskPoints } = detail;
  const hasComparableTasks = summary.qualityComparableTasksCount > 0;
  const hasComparablePoints = taskPoints.some(
    (task) => task.qualityComparable && task.issueLoadDelta !== null,
  );
  const headerDescription = [
    student.studentNo ? `学号：${student.studentNo}` : "学号未设置",
    `班级：${context.classroomName}`,
    `统计窗口：${AI_LEARNING_ANALYTICS_WINDOW_LABELS[context.window]}`,
  ].join(" · ");
  const primaryMetrics = [
    ["已提交任务数", summary.submittedTasksCount],
    ["AI 反馈请求任务数", summary.aiRequestedTasksCount],
    ["AI 反馈交付任务数", summary.aiDeliveredTasksCount],
    ["反馈后重提任务数", summary.postFeedbackResubmittedTasksCount],
    ["代码变化任务数", summary.postFeedbackCodeChangedTasksCount],
    ["质量可比任务数", summary.qualityComparableTasksCount],
  ] as const;

  return (
    <section className="space-y-4">
      <PageHeader
        title={student.studentName}
        description={headerDescription}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={backToAnalyticsHref}
              className="text-blue-700 hover:underline"
            >
              返回班级分析
            </Link>
            <Link
              href={paths.teacher.classroomDashboard(classroomId)}
              className="text-blue-700 hover:underline"
            >
              返回班级看板
            </Link>
          </div>
        }
      />

      <AiLearningAnalyticsMethodologyPanel methodology={detail.methodology} />

      <AiLearningAnalyticsMetricGuide variant="student" />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">学生分析摘要</h2>
        <p className="mt-1 text-xs text-zinc-500">
          以下指标直接来自学生详情接口，不由任务表重新汇总。
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {primaryMetrics.map(([label, value]) => (
            <article
              key={label}
              className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
            >
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                {value}
              </p>
            </article>
          ))}
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-md border border-zinc-200 px-3 py-2.5 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs text-zinc-500">改善 / 持平 / 恶化任务数</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              {summary.improvedTasksCount} / {summary.stableTasksCount} /{" "}
              {summary.regressedTasksCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">平均问题负荷 before → after</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              {hasComparableTasks
                ? `${formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadBefore)} → ${formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadAfter)}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">平均问题负荷差值</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              {formatComparableDelta(
                summary.averageIssueLoadDelta,
                summary.qualityComparableTasksCount,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">介入变化趋势</dt>
            <dd className="mt-0.5 font-medium text-zinc-900">
              {AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS[summary.growthTrend]}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          个人 AI 反馈前后问题变化
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          每个点表示该学生在一个课堂任务中的 AI
          反馈前后问题负荷差值；不可比较的任务不绘制为 0。
        </p>
        <div className="mt-3">
          {hasComparablePoints ? (
            <AiLearningAnalyticsStudentDeltaChart taskPoints={taskPoints} />
          ) : (
            <EmptyState
              title="当前学生暂无可比较的介入前后任务"
              description="摘要和全任务明细仍保留；不可比较任务不会被绘制为 0。"
            />
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">全任务明细</h2>
        <p className="mt-1 text-xs text-zinc-500">
          覆盖当前有效任务，包括无提交和不可比较任务；布尔值使用“是 / 否”明确表达。
        </p>
        <div className="mt-3">
          <StudentTaskPointsTable taskPoints={taskPoints} />
        </div>
      </section>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始学生分析 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(detail.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
