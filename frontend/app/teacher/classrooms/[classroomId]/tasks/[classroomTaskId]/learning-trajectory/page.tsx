import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toLearningTrajectoryResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
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

const TRAJECTORY_WINDOWS = ["24h", "7d", "30d", "all"] as const;
const TRAJECTORY_DISPLAY_WINDOWS = ["all", "7d"] as const;
const TRAJECTORY_SORT_FIELDS = ["latestAttemptAt", "attemptsCount", "errorRate", "notSubmitted"] as const;
const TRAJECTORY_SORT_ORDERS = ["asc", "desc"] as const;
const LEARNING_TRAJECTORY_PAGE_SIZE = 100;

type TrajectoryWindow = (typeof TRAJECTORY_WINDOWS)[number];
type TrajectoryDisplayWindow = (typeof TRAJECTORY_DISPLAY_WINDOWS)[number];
type TrajectorySortField = (typeof TRAJECTORY_SORT_FIELDS)[number];
type TrajectorySortOrder = (typeof TRAJECTORY_SORT_ORDERS)[number];
const TRAJECTORY_WINDOW_LABELS: Record<TrajectoryWindow, string> = {
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部",
};

const TRAJECTORY_SORT_FIELD_LABELS: Record<TrajectorySortField, string> = {
  latestAttemptAt: "最近提交时间",
  attemptsCount: "提交次数",
  errorRate: "错误率",
  notSubmitted: "未提交优先",
};

const TRAJECTORY_SORT_ORDER_LABELS: Record<TrajectorySortOrder, string> = {
  asc: "升序",
  desc: "降序",
};

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

const resolveQueryState = (
  query: Awaited<LearningTrajectoryPageProps["searchParams"]>
): TrajectoryQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), TRAJECTORY_WINDOWS, "all"),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
  limit: parsePositiveInt(getSingleSearchParam(query.limit), LEARNING_TRAJECTORY_PAGE_SIZE, {
    min: 1,
    max: LEARNING_TRAJECTORY_PAGE_SIZE,
  }),
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
    }
  | { mode: "error"; status: number; description: string };

type TrajectoryItem = ReturnType<typeof toLearningTrajectoryResponse>["items"][number];

const pickText = (...candidates: unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

const toStudentDisplayName = (item: TrajectoryItem): string => {
  const name = pickText(item.student?.name, item.studentName, safeGet(item.raw, "name", undefined));
  if (name) {
    return name;
  }

  const studentNo = pickText(
    item.student?.studentNo,
    safeGet(item.raw, "studentNo", undefined),
    safeGet(item.raw, "student.studentNo", undefined)
  );
  if (studentNo) {
    return `学号：${studentNo}`;
  }

  const email = pickText(
    item.student?.email,
    safeGet(item.raw, "email", undefined),
    safeGet(item.raw, "student.email", undefined)
  );
  if (email) {
    return email;
  }

  return "未知学生";
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const toErrorDeltaDisplay = (item: TrajectoryItem): string => {
  const delta = toFiniteNumber(safeGet(item.trend, "errorDelta", undefined));
  if (delta === null) {
    return "—";
  }
  if (delta > 0) {
    return `+${delta}（增加）`;
  }
  if (delta < 0) {
    return `${delta}（减少）`;
  }
  return "0（无变化）";
};

const toTagSummary = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return "无";
  }

  const parts = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const tag = pickText(record.tag);
      if (!tag) {
        return null;
      }
      const count = toFiniteNumber(record.count);
      return count === null ? tag : `${tag}(${count})`;
    })
    .filter((text): text is string => Boolean(text));

  if (parts.length === 0) {
    return "无";
  }
  return parts.join("、");
};

const toAttemptLabel = (attempt: Record<string, unknown>, index: number): string => {
  const attemptNo = toFiniteNumber(safeGet(attempt, "attemptNo", undefined));
  if (attemptNo === null) {
    return `尝试 ${index + 1}`;
  }
  return `第 ${attemptNo} 次`;
};

const toAttemptFeedbackSummary = (attempt: Record<string, unknown>): string => {
  const totalFeedbackCount = toFiniteNumber(safeGet(attempt, "feedbackCount", undefined)) ?? 0;
  const errorCount = toFiniteNumber(
    safeGet(attempt, "feedbackSummary.severityBreakdown.ERROR", undefined)
  );
  const aiSummaryCount = toFiniteNumber(safeGet(attempt, "feedbackSummary.totalItems", undefined));
  const pieces: string[] = [];
  pieces.push(`总反馈 ${totalFeedbackCount}`);
  if (errorCount !== null) {
    pieces.push(`错误 ${errorCount}`);
  }
  if (aiSummaryCount !== null) {
    pieces.push(`AI摘要 ${aiSummaryCount}`);
  }
  return pieces.join("，");
};

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

    viewModel = {
      mode: "ready",
      data,
      query: queryState,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问学习轨迹页面。"
          : getCommonErrorSummary(error.status, "加载学习轨迹");

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
  const displayedStudentsCount = viewModel.data.items.length;
  const totalStudentsCount =
    typeof viewModel.data.total === "number" ? viewModel.data.total : displayedStudentsCount;
  const currentLimit =
    typeof viewModel.data.limit === "number" && viewModel.data.limit > 0
      ? viewModel.data.limit
      : viewModel.query.limit;
  const totalPages = Math.max(1, Math.ceil(totalStudentsCount / currentLimit));
  const currentPageSource =
    typeof viewModel.data.page === "number" && viewModel.data.page > 0
      ? viewModel.data.page
      : viewModel.query.page;
  const currentPage = Math.min(currentPageSource, totalPages);
  const showPagination = totalStudentsCount > currentLimit;
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="学习轨迹"
        description={`查看学生尝试趋势与当前窗口 AI 状态变化（${TRAJECTORY_WINDOW_LABELS[viewModel.query.window]}）。`}
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
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>窗口:</span>
            {TRAJECTORY_DISPLAY_WINDOWS.map((windowValue: TrajectoryDisplayWindow) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue, page: "1" })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {TRAJECTORY_WINDOW_LABELS[windowValue]}
                </Link>
              );
            })}
            <span className="text-zinc-500">当前：{TRAJECTORY_WINDOW_LABELS[viewModel.query.window]}</span>
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
                  {TRAJECTORY_SORT_FIELD_LABELS[sortValue]}
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
              {TRAJECTORY_SORT_ORDER_LABELS[viewModel.query.order]}
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

      <div className="text-sm text-zinc-600">
        共 {totalStudentsCount} 名学生，当前显示 {displayedStudentsCount} 名
      </div>

      {viewModel.data.items.length === 0 ? (
        <EmptyState title="暂无学习轨迹数据" description="当前查询条件下没有返回学生轨迹数据。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">学生</th>
                <th className="px-4 py-3">尝试次数</th>
                <th className="px-4 py-3">最近尝试时间</th>
                <th className="px-4 py-3">最近 AI 状态</th>
                <th className="px-4 py-3">错误数变化（最近 vs 首次）</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.data.items.map((item, index) => {
                const status = item.latestAiFeedbackStatus;
                const displayStatus =
                  typeof status === "string" ? getAiStatusLabel(status) : toDisplayText(status);
                const studentDisplayName = toStudentDisplayName(item);
                const studentKey = item.studentId ?? item.student?.id ?? `student-${index}`;
                const showExpandedDetail =
                  viewModel.query.includeAttempts || viewModel.query.includeTagDetails;
                const attempts = Array.isArray(item.attempts) ? item.attempts : [];
                const firstTagsSummary = toTagSummary(safeGet(item.trend, "topTagsFirst", undefined));
                const latestTagsSummary = toTagSummary(safeGet(item.trend, "topTagsLatest", undefined));

                return (
                  [
                    <tr key={`${String(studentKey)}-summary`} className="border-t border-zinc-100">
                      <td className="px-4 py-3">{studentDisplayName}</td>
                      <td className="px-4 py-3">{toDisplayText(item.attemptsCount)}</td>
                      <td className="px-4 py-3">{toDisplayDate(item.latestAttemptAt ?? null)}</td>
                      <td className="px-4 py-3">{displayStatus}</td>
                      <td className="px-4 py-3">{toErrorDeltaDisplay(item)}</td>
                    </tr>,
                    showExpandedDetail ? (
                      <tr key={`${String(studentKey)}-details`} className="border-t border-zinc-100 bg-zinc-50/40">
                        <td colSpan={5} className="px-4 pb-3 pt-2">
                          <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-700">
                            {viewModel.query.includeAttempts ? (
                              <section className="space-y-1">
                                <p className="font-medium text-zinc-800">尝试详情</p>
                                {attempts.length === 0 ? (
                                  <p>当前无尝试详情数据。</p>
                                ) : (
                                  <ul className="space-y-1">
                                    {attempts.map((attempt, attemptIndex) => {
                                      const attemptRecord =
                                        attempt && typeof attempt === "object"
                                          ? (attempt as Record<string, unknown>)
                                          : {};
                                      const attemptStatusRaw = safeGet(
                                        attemptRecord,
                                        "aiFeedbackStatus",
                                        undefined
                                      );
                                      const attemptStatus =
                                        typeof attemptStatusRaw === "string"
                                          ? getAiStatusLabel(attemptStatusRaw)
                                          : toDisplayText(attemptStatusRaw);
                                      const isLate = safeGet(attemptRecord, "isLate", undefined) === true;
                                      const attemptTime =
                                        safeGet(attemptRecord, "createdAt", undefined) ??
                                        safeGet(attemptRecord, "submittedAt", null);

                                      return (
                                        <li key={`${String(studentKey)}-attempt-${attemptIndex}`}>
                                          {toAttemptLabel(attemptRecord, attemptIndex)} · 提交时间{" "}
                                          {toDisplayDate(attemptTime)} · AI{" "}
                                          {attemptStatus} · {isLate ? "迟交" : "按时"} ·{" "}
                                          {toAttemptFeedbackSummary(attemptRecord)}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </section>
                            ) : null}

                            {viewModel.query.includeTagDetails ? (
                              <section className="space-y-1">
                                <p className="font-medium text-zinc-800">标签细节</p>
                                <p>首次标签：{firstTagsSummary}</p>
                                <p>最近标签：{latestTagsSummary}</p>
                              </section>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPagination ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600">
            第 {currentPage} / {totalPages} 页
          </span>

          {hasPrev ? (
            <Link
              href={buildHref(routePath, queryRecord, { page: String(currentPage - 1) })}
              className="text-blue-700 hover:underline"
            >
              上一页
            </Link>
          ) : (
            <span className="text-zinc-400">上一页</span>
          )}

          {hasNext ? (
            <Link
              href={buildHref(routePath, queryRecord, { page: String(currentPage + 1) })}
              className="text-blue-700 hover:underline"
            >
              下一页
            </Link>
          ) : (
            <span className="text-zinc-400">下一页</span>
          )}
        </div>
      ) : null}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始学习轨迹 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">{JSON.stringify(viewModel.data.raw, null, 2)}</pre>
      </details>
    </section>
  );
}
