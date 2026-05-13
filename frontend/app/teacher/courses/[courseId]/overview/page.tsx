import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toCourseOverviewResponse } from "@/lib/api/types-teacher";
import { toTaskCourseLabelDisplayText } from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parseEnum,
  parsePositiveInt,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type CourseOverviewPageProps = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{
    window?: string | string[];
    sort?: string | string[];
    order?: string | string[];
    page?: string | string[];
    limit?: string | string[];
  }>;
};

const DISPLAY_WINDOWS = ["all", "7d"] as const;
const OVERVIEW_WINDOWS = ["1h", "24h", "7d", "all"] as const;
const SORT_FIELDS = [
  "studentsCount",
  "overallSubmissionCoverage",
  "submissionRate",
  "aiSuccessRate",
  "pendingJobs",
  "failedJobs",
] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
const COURSE_OVERVIEW_PAGE_SIZE = 100;

type CourseOverviewWindow = (typeof OVERVIEW_WINDOWS)[number];
type CourseOverviewDisplayWindow = (typeof DISPLAY_WINDOWS)[number];

const WINDOW_LABELS: Record<CourseOverviewWindow, string> = {
  "1h": "近 1 小时",
  "24h": "近 24 小时",
  "7d": "近 7 天",
  all: "全部",
};

const SORT_FIELD_LABELS: Record<(typeof SORT_FIELDS)[number], string> = {
  studentsCount: "学生数",
  overallSubmissionCoverage: "任务完成度",
  submissionRate: "学生触达率",
  aiSuccessRate: "AI 成功率",
  pendingJobs: "AI 待处理",
  failedJobs: "AI 失败",
};

const SORT_ORDER_LABELS: Record<(typeof SORT_ORDERS)[number], string> = {
  desc: "从高到低",
  asc: "从低到高",
};

type CourseOverviewQueryState = {
  window: CourseOverviewWindow;
  sort: (typeof SORT_FIELDS)[number];
  order: (typeof SORT_ORDERS)[number];
  page: number;
  limit: number;
};

type CourseOverviewSummary = {
  classroomsTotal: number;
  classroomsInPage: number;
  averageOverallSubmissionCoverageInPage?: number;
  averageAiSuccessRateInPage?: number;
};

const resolveQueryState = (
  query: Awaited<CourseOverviewPageProps["searchParams"]>
): CourseOverviewQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), OVERVIEW_WINDOWS, "all"),
  sort: parseEnum(getSingleSearchParam(query.sort), SORT_FIELDS, "overallSubmissionCoverage"),
  order: parseEnum(getSingleSearchParam(query.order), SORT_ORDERS, "desc"),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1, max: 100 }),
  limit: parsePositiveInt(getSingleSearchParam(query.limit), COURSE_OVERVIEW_PAGE_SIZE, {
    min: 1,
    max: COURSE_OVERVIEW_PAGE_SIZE,
  }),
});

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }
  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

const toPercentNumber = (value: number | null | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value <= 1 ? value * 100 : value;
};

const toPercentText = (value: number | null | undefined): string => {
  const percent = toPercentNumber(value);
  if (typeof percent !== "number") {
    return "—";
  }
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

const buildOverviewSummary = (
  data: ReturnType<typeof toCourseOverviewResponse>
): CourseOverviewSummary => {
  const items = data.items;
  const classroomsInPage = items.length;
  let overallSubmissionCoverageSum = 0;
  let overallSubmissionCoverageCount = 0;
  let aiSuccessRateSum = 0;
  let aiSuccessRateCount = 0;

  for (const item of items) {
    const overallSubmissionCoverage = toPercentNumber(item.overallSubmissionCoverage);
    if (typeof overallSubmissionCoverage === "number") {
      overallSubmissionCoverageSum += overallSubmissionCoverage;
      overallSubmissionCoverageCount += 1;
    }

    const aiSuccessRate = toPercentNumber(item.aiSuccessRate);
    if (typeof aiSuccessRate === "number") {
      aiSuccessRateSum += aiSuccessRate;
      aiSuccessRateCount += 1;
    }
  }

  return {
    classroomsTotal: typeof data.total === "number" ? data.total : items.length,
    classroomsInPage,
    averageOverallSubmissionCoverageInPage:
      overallSubmissionCoverageCount > 0
        ? overallSubmissionCoverageSum / overallSubmissionCoverageCount
        : undefined,
    averageAiSuccessRateInPage:
      aiSuccessRateCount > 0 ? aiSuccessRateSum / aiSuccessRateCount : undefined,
  };
};

type CourseOverviewViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toCourseOverviewResponse>;
      query: CourseOverviewQueryState;
      currentPage: number;
      totalClassrooms: number;
      totalPages: number;
      showPagination: boolean;
      hasPrev: boolean;
      hasNext: boolean;
    }
  | { mode: "error"; status: number; description: string };

export default async function CourseOverviewPage({ params, searchParams }: CourseOverviewPageProps) {
  const { courseId } = await params;
  const query = resolveQueryState(await searchParams);
  const queryString = buildQueryString({
    window: query.window,
    sort: query.sort,
    order: query.order,
    page: query.page,
    limit: query.limit,
  });

  let viewModel: CourseOverviewViewModel = {
    mode: "error",
    status: 500,
    description: "加载课程总览失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `courses/${encodeURIComponent(courseId)}/overview?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );
    const data = toCourseOverviewResponse(payload);
    const totalClassrooms = typeof data.total === "number" ? data.total : data.items.length;
    const responseLimit =
      typeof data.limit === "number" && Number.isFinite(data.limit) && data.limit > 0
        ? Math.floor(data.limit)
        : query.limit;
    const responsePage =
      typeof data.page === "number" && Number.isFinite(data.page) && data.page > 0
        ? Math.floor(data.page)
        : query.page;
    const totalPages = Math.max(1, Math.ceil(totalClassrooms / responseLimit));
    const currentPage = Math.min(responsePage, totalPages);
    const showPagination = totalClassrooms > responseLimit;
    const hasPrev = showPagination && currentPage > 1;
    const hasNext = showPagination && currentPage < totalPages;
    viewModel = {
      mode: "ready",
      data,
      query,
      currentPage,
      totalClassrooms,
      totalPages,
      showPagination,
      hasPrev,
      hasNext,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问课程总览。"
          : getCommonErrorSummary(error.status, "加载课程总览");
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
        title="课程总览加载失败"
        description={viewModel.description}
      />
    );
  }

  const course = viewModel.data.course;
  const summary = buildOverviewSummary(viewModel.data);
  const buildHref = (next: Partial<CourseOverviewQueryState>): string => {
    const merged = { ...viewModel.query, ...next };
    return `${paths.teacher.courseOverview(courseId)}?${buildQueryString({
      window: merged.window,
      sort: merged.sort,
      order: merged.order,
      page: merged.page,
      limit: merged.limit,
    })}`;
  };

  const windowItems = DISPLAY_WINDOWS.map((windowValue: CourseOverviewDisplayWindow) => ({
    value: windowValue,
    label: WINDOW_LABELS[windowValue],
    href: buildHref({ window: windowValue, page: 1 }),
  }));

  const sortItems = SORT_FIELDS.map((sortField) => ({
    value: sortField,
    label: SORT_FIELD_LABELS[sortField],
    href: buildHref({ sort: sortField, page: 1 }),
  }));

  const toggledOrder = viewModel.query.order === "asc" ? "desc" : "asc";

  return (
    <section className="space-y-4">
      <PageHeader
        title={toDisplayText(course?.name, "课程总览")}
        description={`课程代码：${toDisplayText(course?.code)} · 学期：${toDisplayText(course?.term)} · 课程分类：${toTaskCourseLabelDisplayText(course?.courseLabel)}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={`${paths.teacher.classrooms}?courseId=${encodeURIComponent(courseId)}`}
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700"
            >
              基于该课程创建班级
            </Link>
            <Link href={paths.teacher.courses} className="text-blue-700 hover:underline">
              返回课程列表
            </Link>
            <Link
              href={paths.teacher.courseEdit(courseId)}
              className="text-blue-700 hover:underline"
            >
              编辑课程
            </Link>
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              查看全部班级
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>统计窗口:</span>
            {windowItems.map((item) => {
              const active = item.value === viewModel.query.window;
              return (
                <Link
                  key={item.value}
                  href={item.href}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {item.label}
                </Link>
              );
            })}
            <span className="text-zinc-500">
              当前：{WINDOW_LABELS[viewModel.query.window]}
              {!DISPLAY_WINDOWS.includes(viewModel.query.window as CourseOverviewDisplayWindow)
                ? "（旧链接兼容）"
                : ""}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span>明细排序:</span>
            {sortItems.map((item) => {
              const active = item.value === viewModel.query.sort;
              return (
                <Link
                  key={item.value}
                  href={item.href}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>顺序:</span>
            <Link
              href={buildHref({
                order: toggledOrder,
                page: 1,
              })}
              className="text-blue-700 hover:underline"
            >
              {SORT_ORDER_LABELS[viewModel.query.order]}
            </Link>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">统计生成于：{toDisplayDate(viewModel.data.generatedAt)}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm font-medium text-zinc-900">课程摘要</p>
        <p className="mt-1 text-xs text-zinc-500">
          班级总数来自 overview `total`。其余指标均基于当前页班级明细聚合，避免误读为全课程总量。
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">班级总数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.classroomsTotal)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页班级数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.classroomsInPage)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页平均任务完成度</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toPercentText(summary.averageOverallSubmissionCoverageInPage)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页平均 AI 成功率</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toPercentText(summary.averageAiSuccessRateInPage)}
            </p>
          </div>
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        任务完成度表示当前窗口内该班全部已发布课堂任务的整体提交覆盖度；学生触达率表示至少提交过一次的学生占比；无 AI 活动时 AI 成功率显示为 —。
      </p>

      <p className="text-sm text-zinc-600">
        共 {viewModel.totalClassrooms} 个班级，当前显示 {viewModel.data.items.length} 个
      </p>

      {viewModel.data.items.length === 0 ? (
        <EmptyState title="当前课程暂无班级统计" description="该课程在当前窗口没有可展示数据。" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className="px-4 py-3">班级</th>
                  <th className="px-4 py-3">学生数</th>
                  <th className="px-4 py-3">任务完成度</th>
                  <th className="px-4 py-3">学生触达率</th>
                  <th className="px-4 py-3">AI 成功率</th>
                  <th className="px-4 py-3">AI 待处理</th>
                  <th className="px-4 py-3">AI 失败</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {viewModel.data.items.map((item, index) => (
                  <tr key={item.classroomId ?? `classroom-${index}`} className="border-t border-zinc-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900">{toDisplayText(item.name, "未命名班级")}</p>
                    </td>
                    <td className="px-4 py-3">{toDisplayText(item.studentsCount)}</td>
                    <td className="px-4 py-3">{toPercentText(item.overallSubmissionCoverage)}</td>
                    <td className="px-4 py-3">{toPercentText(item.submissionRate)}</td>
                    <td className="px-4 py-3">{toPercentText(item.aiSuccessRate)}</td>
                    <td className="px-4 py-3">{toDisplayText(item.aiPendingJobs)}</td>
                    <td className="px-4 py-3">{toDisplayText(item.aiFailedJobs)}</td>
                    <td className="px-4 py-3">
                      {item.classroomId ? (
                        <Link
                          href={paths.teacher.classroomDashboard(item.classroomId)}
                          className="text-blue-700 hover:underline"
                        >
                          进入班级
                        </Link>
                      ) : (
                        <span className="text-zinc-500">缺少班级标识</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewModel.showPagination ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600">
            第 {viewModel.currentPage} / {viewModel.totalPages} 页
          </span>
          {viewModel.hasPrev ? (
            <Link href={buildHref({ page: viewModel.currentPage - 1 })} className="text-blue-700 hover:underline">
              上一页
            </Link>
          ) : (
            <span className="text-zinc-400">上一页</span>
          )}
          {viewModel.hasNext ? (
            <Link href={buildHref({ page: viewModel.currentPage + 1 })} className="text-blue-700 hover:underline">
              下一页
            </Link>
          ) : (
            <span className="text-zinc-400">下一页</span>
          )}
        </div>
      ) : null}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
