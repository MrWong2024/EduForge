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

const WINDOWS = ["1h", "24h", "7d"] as const;
const SORT_FIELDS = [
  "studentsCount",
  "submissionRate",
  "aiSuccessRate",
  "pendingJobs",
  "failedJobs",
] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

const WINDOW_LABELS: Record<(typeof WINDOWS)[number], string> = {
  "1h": "近 1 小时",
  "24h": "近 24 小时",
  "7d": "近 7 天",
};

const SORT_FIELD_LABELS: Record<(typeof SORT_FIELDS)[number], string> = {
  studentsCount: "学生数",
  submissionRate: "提交率",
  aiSuccessRate: "AI 成功率",
  pendingJobs: "AI 待处理",
  failedJobs: "AI 失败",
};

const SORT_ORDER_LABELS: Record<(typeof SORT_ORDERS)[number], string> = {
  desc: "从高到低",
  asc: "从低到高",
};

type CourseOverviewQueryState = {
  window: (typeof WINDOWS)[number];
  sort: (typeof SORT_FIELDS)[number];
  order: (typeof SORT_ORDERS)[number];
  page: number;
  limit: number;
};

type CourseOverviewSummary = {
  classroomsTotal: number;
  studentsTotalInPage: number;
  classroomsWithSubmissionInPage: number;
  aiPendingJobsTotalInPage: number;
  aiFailedJobsTotalInPage: number;
};

const resolveQueryState = (
  query: Awaited<CourseOverviewPageProps["searchParams"]>
): CourseOverviewQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), WINDOWS, "7d"),
  sort: parseEnum(getSingleSearchParam(query.sort), SORT_FIELDS, "aiSuccessRate"),
  order: parseEnum(getSingleSearchParam(query.order), SORT_ORDERS, "desc"),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1, max: 100 }),
  limit: parsePositiveInt(getSingleSearchParam(query.limit), 20, { min: 1, max: 50 }),
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

const asSafeNumber = (value?: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const buildOverviewSummary = (
  data: ReturnType<typeof toCourseOverviewResponse>
): CourseOverviewSummary => {
  const items = data.items;
  const studentsTotalInPage = items.reduce(
    (accumulator, item) => accumulator + asSafeNumber(item.studentsCount),
    0
  );
  const classroomsWithSubmissionInPage = items.reduce((accumulator, item) => {
    const hasSubmittedStudents = asSafeNumber(item.distinctStudentsSubmitted) > 0;
    const hasSubmissionRate = asSafeNumber(item.submissionRate) > 0;
    return hasSubmittedStudents || hasSubmissionRate ? accumulator + 1 : accumulator;
  }, 0);
  const aiPendingJobsTotalInPage = items.reduce(
    (accumulator, item) => accumulator + asSafeNumber(item.aiPendingJobs),
    0
  );
  const aiFailedJobsTotalInPage = items.reduce(
    (accumulator, item) => accumulator + asSafeNumber(item.aiFailedJobs),
    0
  );

  return {
    classroomsTotal: typeof data.total === "number" ? data.total : items.length,
    studentsTotalInPage,
    classroomsWithSubmissionInPage,
    aiPendingJobsTotalInPage,
    aiFailedJobsTotalInPage,
  };
};

type CourseOverviewViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toCourseOverviewResponse>;
      query: CourseOverviewQueryState;
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
    const total = data.total;
    const hasPrev = query.page > 1;
    const hasNext =
      typeof total === "number"
        ? query.page * query.limit < total
        : data.items.length === query.limit;
    viewModel = {
      mode: "ready",
      data,
      query,
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

  const windowItems = WINDOWS.map((windowValue) => ({
    value: windowValue,
    label: WINDOW_LABELS[windowValue],
    href: buildHref({ window: windowValue, page: 1 }),
  }));

  const sortItems = SORT_FIELDS.map((sortField) => ({
    value: sortField,
    label: SORT_FIELD_LABELS[sortField],
    href: buildHref({ sort: sortField, page: 1 }),
  }));

  const orderItems = SORT_ORDERS.map((orderValue) => ({
    value: orderValue,
    label: SORT_ORDER_LABELS[orderValue],
    href: buildHref({ order: orderValue, page: 1 }),
  }));

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

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-zinc-500">统计窗口</p>
          {windowItems.map((item) => (
            <Link
              key={item.value}
              href={item.href}
              className={
                item.value === viewModel.query.window
                  ? "rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white"
                  : "rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-500"
              }
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-zinc-500">明细排序</p>
          {sortItems.map((item) => (
            <Link
              key={item.value}
              href={item.href}
              className={
                item.value === viewModel.query.sort
                  ? "rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white"
                  : "rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-500"
              }
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">排序方向</p>
            {orderItems.map((item) => (
              <Link
                key={item.value}
                href={item.href}
                className={
                  item.value === viewModel.query.order
                    ? "rounded bg-zinc-900 px-2.5 py-1 text-white"
                    : "rounded border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:border-zinc-500"
                }
              >
                {item.label}
              </Link>
            ))}
          </div>
          <p>统计生成于：{toDisplayDate(viewModel.data.generatedAt)}</p>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm font-medium text-zinc-900">课程摘要</p>
        <p className="mt-1 text-xs text-zinc-500">
          班级总数来自 overview `total`。其余指标基于当前页班级明细聚合。
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">班级总数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.classroomsTotal)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页学生总数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.studentsTotalInPage)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页有提交班级数</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.classroomsWithSubmissionInPage)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页 AI 待处理总量</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.aiPendingJobsTotalInPage)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前页 AI 失败总量</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {toDisplayText(summary.aiFailedJobsTotalInPage)}
            </p>
          </div>
        </div>
      </section>

      {viewModel.data.items.length === 0 ? (
        <EmptyState title="当前课程暂无班级统计" description="该课程在当前窗口没有可展示数据。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">班级</th>
                <th className="px-4 py-3">学生数</th>
                <th className="px-4 py-3">提交率</th>
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
                  <td className="px-4 py-3">{toDisplayText(item.submissionRate)}</td>
                  <td className="px-4 py-3">{toDisplayText(item.aiSuccessRate)}</td>
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
      )}

      <div className="flex items-center gap-4 text-sm">
        {viewModel.hasPrev ? (
          <Link href={buildHref({ page: viewModel.query.page - 1 })} className="text-blue-700 hover:underline">
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}
        {viewModel.hasNext ? (
          <Link href={buildHref({ page: viewModel.query.page + 1 })} className="text-blue-700 hover:underline">
            下一页
          </Link>
        ) : (
          <span className="text-zinc-400">下一页</span>
        )}
      </div>
    </section>
  );
}
