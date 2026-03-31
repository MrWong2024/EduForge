import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getDashboardItems, toClassroomSummary, toDashboardResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { safeGet, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type DashboardPageProps = {
  params: Promise<{ classroomId: string }>;
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

const pickCount = (source: unknown, paths: readonly string[], fallback = 0): number => {
  for (const path of paths) {
    const candidate = toCount(safeGet<unknown>(source, path, undefined));
    if (typeof candidate === "number") {
      return candidate;
    }
  }
  return fallback;
};

const toTaskAiBreakdown = (item: UnknownRecord): TaskAiBreakdown => ({
  succeeded: pickCount(item, ["aiFeedback.succeeded", "aiFeedback.SUCCEEDED", "aiStatusBreakdown.SUCCEEDED"], 0),
  failed: pickCount(item, ["aiFeedback.failed", "aiFeedback.FAILED", "aiStatusBreakdown.FAILED"], 0),
  pending: pickCount(item, ["aiFeedback.pending", "aiFeedback.PENDING", "aiStatusBreakdown.PENDING"], 0),
  running: pickCount(item, ["aiFeedback.running", "aiFeedback.RUNNING", "aiStatusBreakdown.RUNNING"], 0),
  dead: pickCount(item, ["aiFeedback.dead", "aiFeedback.DEAD", "aiStatusBreakdown.DEAD"], 0),
  notRequested: pickCount(
    item,
    ["aiFeedback.notRequested", "aiFeedback.NOT_REQUESTED", "aiStatusBreakdown.NOT_REQUESTED"],
    0
  ),
});

const toTopTags = (item: UnknownRecord, limit = 3): Array<{ key: string; label: string; count?: number }> => {
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
    }
  | { mode: "error"; status: number; description: string };

export default async function ClassroomDashboardPage({ params }: DashboardPageProps) {
  const { classroomId } = await params;
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
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}/dashboard`, {
        origin,
        cache: "no-store",
      }),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const dashboard = toDashboardResponse(dashboardPayload);
    const dashboardItems = getDashboardItems(dashboard);
    const studentsCount = pickCount(dashboard, ["summary.studentsCount", "studentsCount"], 0);
    const publishedTasksCount = pickCount(
      dashboard,
      ["summary.publishedTasksCount", "publishedTasksCount"],
      dashboardItems.length
    );
    const lateStudentsTotal = pickCount(dashboard, ["summary.lateStudentsTotal", "lateStudentsTotal"], 0);

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      dashboard,
      dashboardItems,
      studentsCount,
      publishedTasksCount,
      lateStudentsTotal,
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
      <ErrorState status={viewModel.status} title="班级看板加载失败" description={viewModel.description} />
    );
  }

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title={`${toDisplayText(viewModel.classroomName, "班级")}看板`}
        description="查看班级任务提交进度、AI 处理概况与高频问题方向。"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              任务列表
            </Link>
            <Link href={paths.teacher.classroomMembers(classroomId)} className="text-blue-700 hover:underline">
              成员管理
            </Link>
            <Link href={paths.teacher.classroomWeeklyReport(classroomId)} className="text-blue-700 hover:underline">
              班级周报
            </Link>
            <Link href={paths.teacher.classroomProcessAssessment(classroomId)} className="text-blue-700 hover:underline">
              过程性评价
            </Link>
            <Link href={paths.teacher.classroomExportSnapshot(classroomId)} className="text-blue-700 hover:underline">
              教学快照
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">班级概览</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">班级人数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{viewModel.studentsCount}</p>
          </article>
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">已发布任务数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{viewModel.publishedTasksCount}</p>
          </article>
          <article className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">逾期学生数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{viewModel.lateStudentsTotal}</p>
          </article>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">任务进展明细</h2>
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
                    toOptionalText(item.classroomTaskId) ?? toOptionalText(item.id) ?? undefined;
                  const submittedStudentsCount = pickCount(item, ["distinctStudentsSubmitted"], 0);
                  const submissionsCount = pickCount(item, ["submissionsCount"], 0);
                  const lateDistinctStudentsCount = pickCount(item, ["lateDistinctStudentsCount"], 0);
                  const lateSubmissionsCount = pickCount(item, ["lateSubmissionsCount"], 0);
                  const aiBreakdown = toTaskAiBreakdown(item);
                  const topTags = toTopTags(item);

                  return (
                    <tr key={String(classroomTaskId ?? `task-${index}`)} className="border-t border-zinc-100 align-top">
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {toDisplayText(item.title ?? item.name, "未命名任务")}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {toDisplayDate(safeGet<string | null>(item, "dueAt", null))}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        <p>
                          {submittedStudentsCount} / {viewModel.studentsCount}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          提交 {submissionsCount} 次 · 逾期学生 {lateDistinctStudentsCount} 人 · 逾期提交{" "}
                          {lateSubmissionsCount} 次
                        </p>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        <p>成功 {aiBreakdown.succeeded} / 失败 {aiBreakdown.failed} / 排队 {aiBreakdown.pending}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          处理中 {aiBreakdown.running} / 终止 {aiBreakdown.dead} / 未请求 {aiBreakdown.notRequested}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {topTags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {topTags.map((tag) => (
                              <span
                                key={tag.key}
                                className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700"
                              >
                                {tag.label}
                                {typeof tag.count === "number" ? ` (${tag.count})` : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">暂无标签</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {classroomTaskId ? (
                          <div className="flex flex-wrap gap-2 text-xs">
                            <Link
                              href={paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)}
                              className="text-blue-700 hover:underline"
                            >
                              提交记录
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskReviewPack(classroomId, classroomTaskId)}
                              className="text-blue-700 hover:underline"
                            >
                              课堂复盘
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskAiMetrics(classroomId, classroomTaskId)}
                              className="text-blue-700 hover:underline"
                            >
                              AI 指标
                            </Link>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">缺少任务标识</span>
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
            description="当前班级还没有可展示的任务概览，请先发布课堂任务。"
            actions={
              <Link href={paths.teacher.classroomTasks(classroomId)} className="text-sm text-blue-700 hover:underline">
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
