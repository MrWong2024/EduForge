import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toLearningTrajectoryResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  parseEnum,
  parsePositiveInt,
  safeGet,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type LearningTrajectoryPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
  searchParams: Promise<{
    window?: string | string[];
    page?: string | string[];
    limit?: string | string[];
    sort?: string | string[];
    order?: string | string[];
    includeAttempts?: string | string[];
    includeTagDetails?: string | string[];
  }>;
};

const TRAJECTORY_WINDOWS = ["24h", "7d", "30d"] as const;
const TRAJECTORY_SORT_FIELDS = ["latestAttemptAt", "attemptsCount", "errorRate", "notSubmitted"] as const;
const TRAJECTORY_SORT_ORDERS = ["asc", "desc"] as const;

type TrajectoryWindow = (typeof TRAJECTORY_WINDOWS)[number];
type TrajectorySortField = (typeof TRAJECTORY_SORT_FIELDS)[number];
type TrajectorySortOrder = (typeof TRAJECTORY_SORT_ORDERS)[number];

type TrajectoryQueryState = {
  window: TrajectoryWindow;
  page: number;
  limit: number;
  sort: TrajectorySortField;
  order: TrajectorySortOrder;
  includeAttempts: boolean;
  includeTagDetails: boolean;
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

const extractRawDetail = (error: FetchJsonError): string | undefined => {
  if (typeof error.data === "string" && error.data.trim()) {
    return error.data;
  }

  if (!error.data || typeof error.data !== "object") {
    return undefined;
  }

  const message =
    "message" in error.data && typeof (error.data as { message?: unknown }).message === "string"
      ? String((error.data as { message: string }).message)
      : "";
  const code =
    "code" in error.data && typeof (error.data as { code?: unknown }).code === "string"
      ? String((error.data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

const resolveQueryState = (
  query: Awaited<LearningTrajectoryPageProps["searchParams"]>
): TrajectoryQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), TRAJECTORY_WINDOWS, "7d"),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
  limit: parsePositiveInt(getSingleSearchParam(query.limit), 20, { min: 1, max: 50 }),
  sort: parseEnum(getSingleSearchParam(query.sort), TRAJECTORY_SORT_FIELDS, "latestAttemptAt"),
  order: parseEnum(getSingleSearchParam(query.order), TRAJECTORY_SORT_ORDERS, "desc"),
  includeAttempts: parseBool01(getSingleSearchParam(query.includeAttempts), false),
  includeTagDetails: parseBool01(getSingleSearchParam(query.includeTagDetails), false),
});

const toQueryRecord = (query: TrajectoryQueryState): Record<string, string> => ({
  window: query.window,
  page: String(query.page),
  limit: String(query.limit),
  sort: query.sort,
  order: query.order,
  includeAttempts: String(query.includeAttempts),
  includeTagDetails: String(query.includeTagDetails),
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

type TrajectoryViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toLearningTrajectoryResponse>;
      query: TrajectoryQueryState;
      hasPrev: boolean;
      hasNext: boolean;
    }
  | { mode: "error"; status: number; description: string };

export default async function LearningTrajectoryPage({
  params,
  searchParams,
}: LearningTrajectoryPageProps) {
  const { classroomId, classroomTaskId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const queryString = buildQueryString(toQueryRecord(queryState));

  let viewModel: TrajectoryViewModel = {
    mode: "error",
    status: 500,
    description: "加载学习轨迹失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/learning-trajectory?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    const data = toLearningTrajectoryResponse(payload);
    const hasPrev = queryState.page > 1;
    const hasNext =
      typeof data.total === "number"
        ? queryState.page * queryState.limit < data.total
        : data.items.length === queryState.limit;

    viewModel = {
      mode: "ready",
      data,
      query: queryState,
      hasPrev,
      hasNext,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问学习轨迹页面。",
        404: "学习轨迹功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载学习轨迹失败，请稍后重试。";

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="学习轨迹加载失败" description={viewModel.description} />
    );
  }

  const routePath = paths.teacher.classroomTaskTrajectory(classroomId, classroomTaskId);
  const queryRecord = toQueryRecord(viewModel.query);

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="学习轨迹"
        description={`班级 ${classroomId} | 课堂任务 ${classroomTaskId}`}
        actions={
          <Link href={paths.teacher.classroomTasks(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回任务列表
          </Link>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>窗口:</span>
            {TRAJECTORY_WINDOWS.map((windowValue) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue, page: "1" })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {windowValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>排序:</span>
            {TRAJECTORY_SORT_FIELDS.map((sortValue) => {
              const active = sortValue === viewModel.query.sort;
              return (
                <Link
                  key={sortValue}
                  href={buildHref(routePath, queryRecord, { sort: sortValue, page: "1" })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {sortValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>顺序:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                order: viewModel.query.order === "asc" ? "desc" : "asc",
                page: "1",
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.order.toUpperCase()}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>包含尝试详情:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeAttempts: String(!viewModel.query.includeAttempts),
                page: "1",
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeAttempts ? "开" : "关"}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>包含标签细节:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeTagDetails: String(!viewModel.query.includeTagDetails),
                page: "1",
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeTagDetails ? "开" : "关"}
            </Link>
          </div>
        </div>
      </section>

      {viewModel.data.items.length === 0 ? (
        <EmptyState title="暂无学习轨迹数据" description="当前查询条件下没有返回学生轨迹数据。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">学生 ID</th>
                <th className="px-4 py-3">尝试次数</th>
                <th className="px-4 py-3">最近尝试时间</th>
                <th className="px-4 py-3">最近 AI 状态</th>
                <th className="px-4 py-3">错误变化</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.data.items.map((item, index) => {
                const status = safeGet<unknown>(item, "latestAiFeedbackStatus", undefined);
                const displayStatus =
                  typeof status === "string" && status === "NOT_REQUESTED"
                    ? "NOT_REQUESTED（未请求，正常）"
                    : toDisplayText(status);

                return (
                  <tr key={String(safeGet(item, "studentId", `student-${index}`))} className="border-t border-zinc-100">
                    <td className="px-4 py-3">{toDisplayText(safeGet(item, "studentId", undefined))}</td>
                    <td className="px-4 py-3">{toDisplayText(safeGet(item, "attemptsCount", undefined))}</td>
                    <td className="px-4 py-3">
                      {toDisplayDate(safeGet<string | null>(item, "latestAttemptAt", null))}
                    </td>
                    <td className="px-4 py-3">{displayStatus}</td>
                    <td className="px-4 py-3">{toDisplayText(safeGet(item, "trend.errorDelta", undefined))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-4 text-sm">
        {viewModel.hasPrev ? (
          <Link
            href={buildHref(routePath, queryRecord, { page: String(viewModel.query.page - 1) })}
            className="text-blue-700 hover:underline"
          >
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}

        {viewModel.hasNext ? (
          <Link
            href={buildHref(routePath, queryRecord, { page: String(viewModel.query.page + 1) })}
            className="text-blue-700 hover:underline"
          >
            下一页
          </Link>
        ) : (
          <span className="text-zinc-400">下一页</span>
        )}
      </div>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始学习轨迹 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">{JSON.stringify(viewModel.data.raw, null, 2)}</pre>
      </details>
    </section>
  );
}
