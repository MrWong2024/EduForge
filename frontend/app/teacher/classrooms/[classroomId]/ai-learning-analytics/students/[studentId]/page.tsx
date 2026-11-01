import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiLearningAnalyticsStudentIssueLoadComparisonChart } from "@/components/teacher/AiLearningAnalyticsCharts";
import { AiLearningAnalyticsEvidenceNotes } from "@/components/teacher/AiLearningAnalyticsSummary";
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
  type AiLearningAnalyticsReviewEndpoint,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS,
  AI_LEARNING_ANALYTICS_WINDOW_LABELS,
  AI_LEARNING_ANALYTICS_WARNING_LABELS,
  buildAiLearningAnalyticsSubmissionHref,
  formatAiLearningAnalyticsPercent,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  getAiLearningAnalyticsDeltaMeaning,
  resolveAiLearningAnalyticsQueryState,
  toAiLearningAnalyticsExcludedTaskIdsQueryValue,
  withAiLearningAnalyticsStudentSectionHash,
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
    q: queryState.q,
    overallOutcome: queryState.overallOutcome,
    engagementStatus: queryState.engagementStatus,
  });
  const pathname = paths.teacher.classroomAiLearningAnalytics(classroomId);
  return withAiLearningAnalyticsStudentSectionHash(
    query ? `${pathname}?${query}` : pathname,
  );
};

const toBooleanText = (value: boolean): string => (value ? "是" : "否");

const formatNullableIssueLoad = (value: number | null): string =>
  value === null ? "—" : formatAiLearningAnalyticsIssueLoad(value);

const formatComparableDelta = (
  value: number | null,
  comparableCount: number,
): string =>
  comparableCount > 0 && value !== null
    ? `${formatAiLearningAnalyticsDelta(value)}（${getAiLearningAnalyticsDeltaMeaning(value)}）`
    : "—";

function StudentTaskPointsTable({
  taskPoints,
  classroomId,
}: {
  taskPoints: AiLearningAnalyticsTaskPoint[];
  classroomId: string;
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
            <th className="px-3 py-2.5 text-center">可用反馈交付</th>
            <th className="px-3 py-2.5 text-center">反馈后新增提交</th>
            <th className="px-3 py-2.5 text-center">反馈后作品更新</th>
            <th className="px-3 py-2.5 text-center">代码变化</th>
            <th className="px-3 py-2.5 text-center">反馈可对照</th>
            <th className="px-3 py-2.5 text-center">
              反馈条目负荷 before → after
            </th>
            <th className="px-3 py-2.5 text-center">差值</th>
            <th className="px-3 py-2.5">结果</th>
            <th className="px-3 py-2.5">比较版本与证据</th>
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
                task.postFeedbackRevised,
                task.postFeedbackCodeChanged,
                task.qualityComparable,
              ].map((value, valueIndex) => (
                <td
                  key={`${task.classroomTaskId}-boolean-${valueIndex}`}
                  className="px-3 py-2.5 text-center text-zinc-800"
                >
                  {!value &&
                  valueIndex >= 2 &&
                  valueIndex <= 4 &&
                  task.comparisonWarnings.includes("TIME_UNKNOWN")
                    ? "尚未确认"
                    : toBooleanText(value)}
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
                {
                  AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS[
                    task.detailedOutcome
                  ]
                }
              </td>
              <td className="min-w-80 px-3 py-2.5 text-zinc-700">
                <ReviewEndpoint
                  label="介入基线"
                  review={task.baselineReview}
                  classroomId={classroomId}
                  classroomTaskId={task.classroomTaskId}
                />
                <ReviewEndpoint
                  label="比较终点"
                  review={task.comparisonReview}
                  classroomId={classroomId}
                  classroomTaskId={task.classroomTaskId}
                />
                <ReviewEndpoint
                  label="最新现存版本"
                  review={task.latestRevision}
                  classroomId={classroomId}
                  classroomTaskId={task.classroomTaskId}
                />
                <p className="mt-2 text-xs text-amber-900">
                  {task.hasNewerUncomparedRevision === true
                    ? "存在较新版本未纳入当前比较。"
                    : task.hasNewerUncomparedRevision === null
                      ? "最新版本时序未知，无法确认是否有更新未纳入。"
                      : "未发现可确认的较新未纳入版本。"}
                </p>
                {task.comparisonWarnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-amber-900">
                    {AI_LEARNING_ANALYTICS_WARNING_LABELS[warning]}
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewEndpoint({
  label,
  review,
  classroomId,
  classroomTaskId,
}: {
  label: string;
  review: AiLearningAnalyticsReviewEndpoint | null;
  classroomId: string;
  classroomTaskId: string;
}) {
  if (!review)
    return <p className="mt-2 text-xs">{label}：未知或暂无可用端点</p>;
  return (
    <details className="mt-2 text-xs leading-5">
      <summary>
        {label}：第 {review.attemptNo ?? "未知"} 次提交，revision{" "}
        {review.contentRevision ?? "未知"}
      </summary>
      <Link
        className="text-blue-700 hover:underline"
        href={buildAiLearningAnalyticsSubmissionHref(
          review.submissionId,
          classroomId,
          classroomTaskId,
        )}
      >
        查看该作品
      </Link>
      <p>提交时间：{toDisplayDate(review.submittedAt)}</p>
      <p>最近编辑：{toDisplayDate(review.lastEditedAt)}</p>
      <p>内容形成：{toDisplayDate(review.contentVersionAt)}</p>
      <p>反馈完成：{toDisplayDate(review.feedbackCompletedAt)}</p>
      <p>
        来源：
        {review.provider === "stub"
          ? "模拟评阅（排除）"
          : review.provider === "bailian"
            ? "Bailian"
            : "未知来源，仅作记录对照"}
        ；模型：{review.model ?? "未知"}
      </p>
    </details>
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
  const backToAnalyticsHref = buildBackToAnalyticsHref(classroomId, queryState);

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
    ["可用反馈交付任务数", summary.aiDeliveredTasksCount],
    ["反馈后重提任务数", summary.postFeedbackResubmittedTasksCount],
    ["反馈后作品更新任务数", summary.postFeedbackRevisedTasksCount],
    ["代码变化任务数", summary.postFeedbackCodeChangedTasksCount],
    ["反馈可对照任务数", summary.qualityComparableTasksCount],
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
        <p className="mt-2 text-xs text-zinc-600">
          作品更新率{" "}
          {formatAiLearningAnalyticsPercent(summary.postFeedbackRevisionRate)}
          ；可对照任务 {summary.qualityComparableTasksCount} / 可用反馈交付任务{" "}
          {summary.aiDeliveredTasksCount}，结果仅代表可对照子集。
        </p>
        <AiLearningAnalyticsEvidenceNotes evidence={summary.evidenceSummary} />
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
            <dt className="text-xs text-zinc-500">反馈参与阶段</dt>
            <dd className="mt-0.5 font-medium text-zinc-900">
              {
                AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_LABELS[
                  summary.engagementStatus
                ]
              }
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">总体结果</dt>
            <dd className="mt-0.5 font-medium text-zinc-900">
              {
                AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_LABELS[
                  summary.overallOutcome
                ]
              }
            </dd>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              {hasComparableTasks
                ? `基于 ${summary.qualityComparableTasksCount} 个可比任务`
                : "暂无反馈可对照任务"}
            </p>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">四类精细结果任务数</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              负荷下降 {summary.improvedTasksCount} · 前后均无 ERROR/WARN{" "}
              {summary.remainedCleanTasksCount} · 非零负荷持平{" "}
              {summary.unchangedWithIssuesTasksCount} · 负荷上升{" "}
              {summary.regressedTasksCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">
              平均反馈条目负荷 before → after
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              {hasComparableTasks
                ? `${formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadBefore)} → ${formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadAfter)}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">平均反馈条目负荷差值</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">
              {formatComparableDelta(
                summary.averageIssueLoadDelta,
                summary.qualityComparableTasksCount,
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          总体结果按当前范围内全部可比任务的反馈条目负荷净变化计算，不按任务发布时间做趋势回归，也不是能力成长或退步结论。
          {summary.overallOutcome === "NO_NET_CHANGE"
            ? "“净变化为零”可能由负荷下降和负荷上升相互抵消。"
            : ""}
        </p>
      </section>

      {hasComparablePoints ? (
        <AiLearningAnalyticsStudentIssueLoadComparisonChart
          taskPoints={taskPoints}
        />
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            个人各任务 AI 反馈前后问题对比
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            该图比较同一课堂任务内 AI
            反馈前后的反馈条目负荷，不代表不同任务之间的成绩或能力成长曲线。
          </p>
          <div className="mt-3">
            <EmptyState
              title="当前学生暂无可比较的介入前后任务"
              description="摘要和全任务明细仍保留；不可对照任务不会被绘制为 0。"
            />
          </div>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">全任务明细</h2>
        <p className="mt-1 text-xs text-zinc-500">
          覆盖当前有效任务，包括无提交和不可对照任务；布尔值使用“是 /
          否”明确表达。
        </p>
        <div className="mt-3">
          <StudentTaskPointsTable
            taskPoints={taskPoints}
            classroomId={classroomId}
          />
        </div>
      </section>

      {process.env.NODE_ENV !== "production" ? (
        <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-zinc-800">
            查看原始学生分析 JSON
          </summary>
          <pre className="mt-3 overflow-auto text-xs text-zinc-700">
            {JSON.stringify(detail.raw, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
