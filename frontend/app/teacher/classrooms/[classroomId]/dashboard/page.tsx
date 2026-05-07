import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  getDashboardItems,
  toClassroomSummary,
  toDashboardResponse,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { safeGet, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type DashboardPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ includeClosedTasks?: string | string[] }>;
};

type UnknownRecord = Record<string, unknown>;

type TaskAiBreakdown = {
  succeeded: number;
  failed: number;
  pending: number;
  running: number;
  dead: number;
  notRequested: number;
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

const isQueryTrue = (value: string | string[] | undefined): boolean => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue === "true";
};

const getDashboardPath = (
  classroomId: string,
  includeClosedTasks: boolean,
): string => {
  const encodedClassroomId = encodeURIComponent(classroomId);
  const basePath = `classrooms/${encodedClassroomId}/dashboard`;
  return includeClosedTasks ? `${basePath}?includeClosedTasks=true` : basePath;
};

const getClosedTasksToggleHref = (
  classroomId: string,
  includeClosedTasks: boolean,
): string =>
  includeClosedTasks
    ? paths.teacher.classroomDashboard(classroomId)
    : `${paths.teacher.classroomDashboard(classroomId)}?includeClosedTasks=true`;

const toOptionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const toCount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return undefined;
};

const pickCount = (
  source: unknown,
  paths: readonly string[],
  fallback = 0,
): number => {
  for (const path of paths) {
    const candidate = toCount(safeGet<unknown>(source, path, undefined));
    if (typeof candidate === "number") {
      return candidate;
    }
  }
  return fallback;
};

const toTaskAiBreakdown = (item: UnknownRecord): TaskAiBreakdown => ({
  succeeded: pickCount(
    item,
    [
      "aiFeedback.succeeded",
      "aiFeedback.SUCCEEDED",
      "aiStatusBreakdown.SUCCEEDED",
    ],
    0,
  ),
  failed: pickCount(
    item,
    ["aiFeedback.failed", "aiFeedback.FAILED", "aiStatusBreakdown.FAILED"],
    0,
  ),
  pending: pickCount(
    item,
    ["aiFeedback.pending", "aiFeedback.PENDING", "aiStatusBreakdown.PENDING"],
    0,
  ),
  running: pickCount(
    item,
    ["aiFeedback.running", "aiFeedback.RUNNING", "aiStatusBreakdown.RUNNING"],
    0,
  ),
  dead: pickCount(
    item,
    ["aiFeedback.dead", "aiFeedback.DEAD", "aiStatusBreakdown.DEAD"],
    0,
  ),
  notRequested: pickCount(
    item,
    [
      "aiFeedback.notRequested",
      "aiFeedback.NOT_REQUESTED",
      "aiStatusBreakdown.NOT_REQUESTED",
    ],
    0,
  ),
});

const toTopTags = (
  item: UnknownRecord,
  limit = 3,
): Array<{ key: string; label: string; count?: number }> => {
  const rawTags = safeGet<unknown[]>(item, "topTags", []);
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const result: Array<{ key: string; label: string; count?: number }> = [];
  const seen = new Set<string>();

  rawTags.forEach((tagItem, index) => {
    if (result.length >= limit) {
      return;
    }

    const tagRecord =
      tagItem && typeof tagItem === "object" && !Array.isArray(tagItem)
        ? (tagItem as UnknownRecord)
        : undefined;
    const label =
      toOptionalText(tagRecord?.tag) ??
      toOptionalText(tagRecord?.name) ??
      toOptionalText(tagRecord?.label) ??
      toOptionalText(tagItem);

    if (!label) {
      return;
    }

    const normalized = label.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);

    const count = toCount(tagRecord?.count);
    result.push({
      key: `${normalized}-${index}`,
      label,
      count,
    });
  });

  return result;
};

type DashboardViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      dashboard: ReturnType<typeof toDashboardResponse>;
      dashboardItems: ReturnType<typeof getDashboardItems>;
      studentsCount: number;
      publishedTasksCount: number;
      lateStudentsTotal: number;
      includeClosedTasks: boolean;
    }
  | { mode: "error"; status: number; description: string };

export default async function ClassroomDashboardPage({
  params,
  searchParams,
}: DashboardPageProps) {
  const { classroomId } = await params;
  const resolvedSearchParams = await searchParams;
  const includeClosedTasks = isQueryTrue(
    resolvedSearchParams.includeClosedTasks,
  );
  let viewModel: DashboardViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级看板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, dashboardPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(getDashboardPath(classroomId, includeClosedTasks), {
        origin,
        cache: "no-store",
      }),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const dashboard = toDashboardResponse(dashboardPayload);
    const dashboardItems = getDashboardItems(dashboard);
    const studentsCount = pickCount(
      dashboard,
      ["summary.studentsCount", "studentsCount"],
      0,
    );
    const publishedTasksCount = pickCount(
      dashboard,
      ["summary.publishedTasksCount", "publishedTasksCount"],
      dashboardItems.length,
    );
    const lateStudentsTotal = pickCount(
      dashboard,
      ["summary.lateStudentsTotal", "lateStudentsTotal"],
      0,
    );

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      dashboard,
      dashboardItems,
      studentsCount,
      publishedTasksCount,
      lateStudentsTotal,
      includeClosedTasks,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问该班级看板。"
          : getCommonErrorSummary(error.status, "加载班级看板");
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState
        status={viewModel.status}
        title="班级看板加载失败"
        description={viewModel.description}
      />
    );
  }

  const archiveSuggestion = viewModel.dashboard.archiveSuggestion;
  const shouldShowArchiveSuggestion = archiveSuggestion?.suggested === true;
  const archiveSuggestionMessage =
    archiveSuggestion?.message ??
    "该班级近期无活跃任务和学生提交，可考虑归档。";

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title={`${toDisplayText(viewModel.classroomName, "班级")}看板`}
        description="查看班级任务提交进度、AI 处理概况与高频问题方向。"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={paths.teacher.classrooms}
              className="text-blue-700 hover:underline"
            >
              返回班级列表
            </Link>
            <Link
              href={paths.teacher.classroomTasks(classroomId)}
              className="text-blue-700 hover:underline"
            >
              任务列表
            </Link>
            <Link
              href={paths.teacher.classroomMembers(classroomId)}
              className="text-blue-700 hover:underline"
            >
              成员管理
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
        }
      />

      {shouldShowArchiveSuggestion ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium">建议归档</p>
              <p className="mt-1">{archiveSuggestionMessage}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
                <span>
                  最近提交：
                  {archiveSuggestion?.lastSubmissionAt
                    ? toDisplayDate(archiveSuggestion.lastSubmissionAt)
                    : "暂无"}
                </span>
                {typeof archiveSuggestion?.inactiveDays === "number" ? (
                  <span>
                    已连续 {archiveSuggestion.inactiveDays} 天无近期活动
                  </span>
                ) : null}
              </div>
            </div>
            <Link
              href={paths.teacher.classroomEdit(classroomId)}
              className="inline-flex w-fit items-center rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              去管理
            </Link>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">班级概览</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">班级人数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {viewModel.studentsCount}
            </p>
          </article>
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">已发布任务数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {viewModel.publishedTasksCount}
            </p>
          </article>
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">逾期学生数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {viewModel.lateStudentsTotal}
            </p>
          </article>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              任务进展明细
            </h2>
            {viewModel.includeClosedTasks ? (
              <p className="mt-1 text-xs text-slate-500">
                当前统计含已关闭任务。
              </p>
            ) : null}
          </div>
          <Link
            href={getClosedTasksToggleHref(
              classroomId,
              viewModel.includeClosedTasks,
            )}
            role="switch"
            aria-checked={viewModel.includeClosedTasks}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <span
              className={`relative h-5 w-9 rounded-full border transition ${
                viewModel.includeClosedTasks
                  ? "border-blue-300 bg-blue-600"
                  : "border-zinc-300 bg-zinc-100"
              }`}
              aria-hidden="true"
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition ${
                  viewModel.includeClosedTasks ? "left-4" : "left-0.5"
                }`}
              />
            </span>
            显示已关闭任务
          </Link>
        </div>
        {viewModel.dashboardItems.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[1080px] border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className="px-4 py-3">任务标题</th>
                  <th className="px-4 py-3">截止时间</th>
                  <th className="px-4 py-3">提交进度</th>
                  <th className="px-4 py-3">AI 处理概况</th>
                  <th className="px-4 py-3">高频标签</th>
                  <th className="px-4 py-3">快捷入口</th>
                </tr>
              </thead>
              <tbody>
                {viewModel.dashboardItems.map((item, index) => {
                  const classroomTaskId =
                    toOptionalText(item.classroomTaskId) ??
                    toOptionalText(item.id) ??
                    undefined;
                  const submittedStudentsCount = pickCount(
                    item,
                    ["distinctStudentsSubmitted"],
                    0,
                  );
                  const submissionsCount = pickCount(
                    item,
                    ["submissionsCount"],
                    0,
                  );
                  const lateDistinctStudentsCount = pickCount(
                    item,
                    ["lateDistinctStudentsCount"],
                    0,
                  );
                  const lateSubmissionsCount = pickCount(
                    item,
                    ["lateSubmissionsCount"],
                    0,
                  );
                  const aiBreakdown = toTaskAiBreakdown(item);
                  const topTags = toTopTags(item);
                  const classroomTaskStatus = toOptionalText(
                    item.classroomTaskStatus,
                  );
                  const isClosedTask = classroomTaskStatus === "CLOSED";

                  return (
                    <tr
                      key={String(classroomTaskId ?? `task-${index}`)}
                      className={`border-t border-zinc-100 align-top ${
                        isClosedTask ? "bg-slate-50/70" : ""
                      }`}
                    >
                      <td
                        className={`px-4 py-3 font-medium ${
                          isClosedTask ? "text-slate-600" : "text-zinc-900"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {toDisplayText(
                              item.title ?? item.name,
                              "未命名任务",
                            )}
                          </span>
                          {isClosedTask ? (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                              已关闭
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td
                        className={`px-4 py-3 ${isClosedTask ? "text-slate-600" : "text-zinc-700"}`}
                      >
                        {toDisplayDate(
                          safeGet<string | null>(item, "dueAt", null),
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 ${isClosedTask ? "text-slate-600" : "text-zinc-700"}`}
                      >
                        <p>
                          {submittedStudentsCount} / {viewModel.studentsCount}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          提交 {submissionsCount} 次 · 逾期学生{" "}
                          {lateDistinctStudentsCount} 人 · 逾期提交{" "}
                          {lateSubmissionsCount} 次
                        </p>
                      </td>
                      <td
                        className={`px-4 py-3 ${isClosedTask ? "text-slate-600" : "text-zinc-700"}`}
                      >
                        <p>
                          成功 {aiBreakdown.succeeded} / 失败{" "}
                          {aiBreakdown.failed} / 排队 {aiBreakdown.pending}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          处理中 {aiBreakdown.running} / 终止 {aiBreakdown.dead}{" "}
                          / 未请求 {aiBreakdown.notRequested}
                        </p>
                      </td>
                      <td
                        className={`px-4 py-3 ${isClosedTask ? "text-slate-600" : "text-zinc-700"}`}
                      >
                        {topTags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {topTags.map((tag) => (
                              <span
                                key={tag.key}
                                className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700"
                              >
                                {tag.label}
                                {typeof tag.count === "number"
                                  ? ` (${tag.count})`
                                  : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            暂无标签
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {classroomTaskId ? (
                          <div className="flex flex-wrap gap-2 text-xs">
                            <Link
                              href={paths.teacher.classroomTaskSubmissions(
                                classroomId,
                                classroomTaskId,
                              )}
                              className="text-blue-700 hover:underline"
                            >
                              提交记录
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskReviewPack(
                                classroomId,
                                classroomTaskId,
                              )}
                              className="text-blue-700 hover:underline"
                            >
                              课堂复盘
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskAiMetrics(
                                classroomId,
                                classroomTaskId,
                              )}
                              className="text-blue-700 hover:underline"
                            >
                              AI 指标
                            </Link>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            缺少任务标识
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="暂无看板任务数据"
            description={
              viewModel.includeClosedTasks
                ? "当前班级还没有可展示的任务概览，请先发布课堂任务。"
                : "当前班级暂无进行中的课堂任务；如需复盘已关闭任务，可打开“显示已关闭任务”。"
            }
            actions={
              <Link
                href={paths.teacher.classroomTasks(classroomId)}
                className="text-sm text-blue-700 hover:underline"
              >
                去任务列表发布任务
              </Link>
            }
          />
        )}
      </section>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始数据（调试用）
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.dashboard, null, 2)}
        </pre>
      </details>
    </section>
  );
}
