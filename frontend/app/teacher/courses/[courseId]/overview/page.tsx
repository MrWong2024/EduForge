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

type CourseOverviewQueryState = {
  window: (typeof WINDOWS)[number];
  sort: (typeof SORT_FIELDS)[number];
  order: (typeof SORT_ORDERS)[number];
  page: number;
  limit: number;
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

  return (
    <section className="space-y-4">
      <PageHeader
        title={toDisplayText(course?.name, "课程总览")}
        description={`课程代码: ${toDisplayText(course?.code)} | 学期: ${toDisplayText(course?.term)} | 课程分类: ${toTaskCourseLabelDisplayText(course?.courseLabel)} | 生成时间: ${toDisplayDate(viewModel.data.generatedAt)}`}
        actions={
          <div className="flex items-center gap-3 text-sm">
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
              班级列表
            </Link>
            <Link
              href={`${paths.teacher.classrooms}?courseId=${encodeURIComponent(courseId)}`}
              className="text-blue-700 hover:underline"
            >
              基于该课程创建班级
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <div className="flex flex-wrap items-center gap-4">
          <p>窗口：{viewModel.query.window}</p>
          <p>排序：{viewModel.query.sort}</p>
          <p>方向：{viewModel.query.order}</p>
          <p>页码：{viewModel.query.page}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {WINDOWS.map((windowValue) => (
            <Link
              key={windowValue}
              href={buildHref({ window: windowValue, page: 1 })}
              className={
                windowValue === viewModel.query.window
                  ? "rounded bg-zinc-900 px-2 py-1 text-xs text-white"
                  : "rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-500"
              }
            >
              {windowValue}
            </Link>
          ))}
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
                <th className="px-4 py-3">AI pending</th>
                <th className="px-4 py-3">AI failed</th>
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
