import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toAiMetricsResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  parseEnum,
  safeGet,
  toDisplayText,
} from "@/lib/ui/format";

type AiMetricsPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
  searchParams: Promise<{
    window?: string | string[];
    includeTags?: string | string[];
  }>;
};

const AI_WINDOWS = ["1h", "24h", "7d"] as const;
type AiWindow = (typeof AI_WINDOWS)[number];
const AI_WINDOW_LABELS: Record<AiWindow, string> = {
  "1h": "近1小时",
  "24h": "近24小时",
  "7d": "近7天",
};

type AiMetricsQueryState = {
  window: AiWindow;
  includeTags: boolean;
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

const resolveQueryState = (
  query: Awaited<AiMetricsPageProps["searchParams"]>
): AiMetricsQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), AI_WINDOWS, "24h"),
  includeTags: parseBool01(getSingleSearchParam(query.includeTags), true),
});

const toQueryRecord = (query: AiMetricsQueryState): Record<string, string> => ({
  window: query.window,
  includeTags: String(query.includeTags),
});

const buildHref = (
  basePath: string,
  currentParams: Record<string, string>,
  nextParams: Partial<Record<string, string | undefined>>
): string => {
  const merged = new URLSearchParams(currentParams);
  for (const [key, value] of Object.entries(nextParams)) {
    if (!value) {
      merged.delete(key);
      continue;
    }
    merged.set(key, value);
  }
  const query = merged.toString();
  return query ? `${basePath}?${query}` : basePath;
};

const toPercent = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
};

type AiMetricsViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toAiMetricsResponse>;
      query: AiMetricsQueryState;
    }
  | { mode: "error"; status: number; description: string };

export default async function AiMetricsPage({ params, searchParams }: AiMetricsPageProps) {
  const { classroomId, classroomTaskId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const queryString = buildQueryString(toQueryRecord(queryState));

  let viewModel: AiMetricsViewModel = {
    mode: "error",
    status: 500,
    description: "加载 AI 指标失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/ai-metrics?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toAiMetricsResponse(payload),
      query: queryState,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问 AI 指标页面。"
          : getCommonErrorSummary(error.status, "加载 AI 指标");

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return <ErrorState status={viewModel.status} title="AI 指标加载失败" description={viewModel.description} />;
  }

  const routePath = paths.teacher.classroomTaskAiMetrics(classroomId, classroomTaskId);
  const queryRecord = toQueryRecord(viewModel.query);
  const summary = viewModel.data.summary;
  const statusEntries = Object.entries(viewModel.data.statusBreakdown);
  const tags = viewModel.data.tags;
  const hasCoreData = statusEntries.length > 0 || viewModel.data.errors.length > 0;
  const avgLatencyMs = safeGet<unknown>(summary, "avgLatencyMs", null);
  const hasAvgLatency = typeof avgLatencyMs === "number" && Number.isFinite(avgLatencyMs);

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="AI 指标"
        description="查看当前课堂任务的 AI 处理质量与状态分布。"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={paths.teacher.classroomDashboard(classroomId)}
              className="text-blue-700 hover:underline"
            >
              班级看板
            </Link>
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              返回任务列表
            </Link>
            <Link
              href={paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              提交管理
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选条件</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>统计窗口:</span>
            {AI_WINDOWS.map((windowValue) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {windowValue}（{AI_WINDOW_LABELS[windowValue]}）
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>标签统计:</span>
            <Link
              href={buildHref(routePath, queryRecord, { includeTags: String(!viewModel.query.includeTags) })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeTags ? "开" : "关"}
            </Link>
          </div>
        </div>
      </section>

      {!hasCoreData ? (
        <EmptyState title="暂无 AI 指标数据" description="当前窗口下尚未返回可展示的 AI 指标。" />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">总任务数</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{toDisplayText(safeGet(summary, "jobs.total", undefined))}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">成功率</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{toPercent(safeGet(summary, "successRate", undefined))}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">AI 平均重试次数</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{toDisplayText(safeGet(summary, "avgAttempts", undefined))}</p>
        </div>
        {hasAvgLatency ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs text-zinc-500">平均耗时 (ms)</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{toDisplayText(avgLatencyMs)}</p>
          </div>
        ) : null}
      </div>
      {!hasAvgLatency ? <p className="text-xs text-zinc-500">平均耗时指标当前暂未采集。</p> : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">状态分布</h2>
        {statusEntries.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {statusEntries.map(([status, value]) => (
              <li key={status}>
                {getAiStatusLabel(status)}: {toDisplayText(value)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">暂无状态分布数据。</p>
        )}
      </section>

      {viewModel.query.includeTags ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Top Tags</h2>
          {tags.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
              {tags.map((item, index) => (
                <li key={String(safeGet(item, "tag", `tag-${index}`))}>
                  {toDisplayText(safeGet(item, "tag", undefined))}: {toDisplayText(safeGet(item, "count", undefined))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">暂无标签统计。</p>
          )}
        </section>
      ) : null}

      {viewModel.data.errors.length > 0 ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">错误分布</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {viewModel.data.errors.map((item, index) => (
              <li key={String(safeGet(item, "code", `error-${index}`))}>
                {toDisplayText(safeGet(item, "code", undefined))}: {toDisplayText(safeGet(item, "count", undefined))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始 AI 指标 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">{JSON.stringify(viewModel.data.raw, null, 2)}</pre>
      </details>
    </section>
  );
}
