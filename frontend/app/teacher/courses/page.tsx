import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { Tabs } from "@/components/blocks/Tabs";
import { CreateCourseForm } from "@/components/teacher/CreateCourseForm";
import { CourseLifecycleActions } from "@/components/teacher/CourseLifecycleActions";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  toCourseListResponse,
  type CourseStatus,
} from "@/lib/api/types-teacher";
import {
  isUnclassifiedTaskCourseLabel,
  toTaskCourseLabelDisplayText,
} from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { getSingleSearchParam, parsePositiveInt, toDisplayText } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "课程列表",
};

const COURSE_STATUS_VIEW_VALUES = ["active", "archived", "all"] as const;
type CourseStatusView = (typeof COURSE_STATUS_VIEW_VALUES)[number];

const COURSE_STATUS_VIEW_LABEL: Record<CourseStatusView, string> = {
  active: "进行中",
  archived: "已归档",
  all: "全部",
};

const COURSE_STATUS_META: Record<
  CourseStatus,
  {
    label: string;
    hint: string;
    badgeClassName: string;
  }
> = {
  ACTIVE: {
    label: "进行中",
    hint: "可继续用于创建班级与教学安排。",
    badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  ARCHIVED: {
    label: "已归档",
    hint: "默认不出现在进行中列表。",
    badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
};

type TeacherCoursesPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
    statusView?: string | string[];
  }>;
};

const parseStatusView = (value: string | undefined): CourseStatusView => {
  if (!value) {
    return "active";
  }
  const normalized = value.toLowerCase();
  return COURSE_STATUS_VIEW_VALUES.includes(normalized as CourseStatusView)
    ? (normalized as CourseStatusView)
    : "active";
};

const toStatusFilter = (statusView: CourseStatusView): CourseStatus | undefined => {
  if (statusView === "active") {
    return "ACTIVE";
  }
  if (statusView === "archived") {
    return "ARCHIVED";
  }
  return undefined;
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

type CoursesViewModel =
  | {
      mode: "ready";
      items: ReturnType<typeof toCourseListResponse>["items"];
      page: number;
      limit: number;
      hasPrev: boolean;
      hasNext: boolean;
      statusView: CourseStatusView;
    }
  | { mode: "error"; status: number; description: string };

export default async function TeacherCoursesPage({ searchParams }: TeacherCoursesPageProps) {
  const query = await searchParams;
  const page = parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1, max: 100 });
  const limit = parsePositiveInt(getSingleSearchParam(query.limit), 20, { min: 1, max: 100 });
  const statusView = parseStatusView(getSingleSearchParam(query.statusView));
  const statusFilter = toStatusFilter(statusView);

  const requestQuery = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (statusFilter) {
    requestQuery.set("status", statusFilter);
  }

  let viewModel: CoursesViewModel = {
    mode: "error",
    status: 500,
    description: "加载课程列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(`courses?${requestQuery.toString()}`, {
      origin,
      cache: "no-store",
    });
    const response = toCourseListResponse(payload);
    const total = response.total;
    const hasPrev = page > 1;
    const hasNext = typeof total === "number" ? page * limit < total : response.items.length === limit;
    viewModel = {
      mode: "ready",
      items: response.items,
      page,
      limit,
      hasPrev,
      hasNext,
      statusView,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问课程列表。"
          : getCommonErrorSummary(error.status, "加载课程列表");
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="课程列表加载失败" description={viewModel.description} />
    );
  }

  const tabItems = [
    {
      label: "进行中",
      href: buildCourseListHref(1, viewModel.limit, "active"),
    },
    {
      label: "已归档",
      href: buildCourseListHref(1, viewModel.limit, "archived"),
    },
    {
      label: "全部",
      href: buildCourseListHref(1, viewModel.limit, "all"),
    },
  ];

  const activeTabHref = buildCourseListHref(1, viewModel.limit, viewModel.statusView);
  const emptyStateTitle =
    viewModel.statusView === "archived"
      ? "暂无已归档课程"
      : viewModel.statusView === "active"
        ? "还没有进行中课程"
        : "还没有课程";
  const emptyStateDescription =
    viewModel.statusView === "archived"
      ? "归档后的课程会显示在这里。"
      : "可使用上方“创建课程”表单创建首门课程，再基于课程创建班级。";
  const archivedEmptyActionHref = buildCourseListHref(1, viewModel.limit, "active");

  return (
    <section className="space-y-4">
      <PageHeader
        title="课程"
        description={`当前视图：${COURSE_STATUS_VIEW_LABEL[viewModel.statusView]} · 第 ${viewModel.page} 页，每页 ${viewModel.limit} 条`}
        actions={
          <Link href={paths.teacher.classrooms} className="text-sm text-blue-700 hover:underline">
            去班级列表
          </Link>
        }
      />

      <Tabs items={tabItems} activeHref={activeTabHref} />

      <CreateCourseForm />

      {viewModel.items.length === 0 ? (
        <EmptyState
          title={emptyStateTitle}
          description={emptyStateDescription}
          actions={
            viewModel.statusView === "archived" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={archivedEmptyActionHref}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  查看进行中课程
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">课程代码</th>
                <th className="px-4 py-3">课程名称</th>
                <th className="px-4 py-3">学期</th>
                <th className="px-4 py-3">课程分类</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.items.map((course, index) => {
                const courseId = course.id;
                const statusMeta = course.status ? COURSE_STATUS_META[course.status] : undefined;

                return (
                  <tr key={courseId ?? `course-${index}`} className="border-t border-zinc-100">
                    <td className="px-4 py-3">{toDisplayText(course.code)}</td>
                    <td className="px-4 py-3">{toDisplayText(course.name)}</td>
                    <td className="px-4 py-3">{toDisplayText(course.term)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${
                          isUnclassifiedTaskCourseLabel(course.courseLabel)
                            ? "border-zinc-200 bg-zinc-100 text-zinc-700"
                            : "border-indigo-200 bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {toTaskCourseLabelDisplayText(course.courseLabel)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {statusMeta ? (
                        <div className="space-y-1">
                          <span
                            className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusMeta.badgeClassName}`}
                          >
                            {statusMeta.label}
                          </span>
                          <p className="text-xs text-zinc-500">{statusMeta.hint}</p>
                        </div>
                      ) : (
                        <span className="text-zinc-500">{toDisplayText(course.status)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {courseId ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <Link
                              href={paths.teacher.courseEdit(courseId)}
                              className="text-blue-700 hover:underline"
                            >
                              编辑
                            </Link>
                            <Link
                              href={paths.teacher.courseOverview(courseId)}
                              className="text-blue-700 hover:underline"
                            >
                              课程总览
                            </Link>
                            <Link
                              href={`${paths.teacher.classrooms}?courseId=${encodeURIComponent(courseId)}`}
                              className="text-blue-700 hover:underline"
                            >
                              班级列表
                            </Link>
                          </div>

                          <CourseLifecycleActions courseId={courseId} status={course.status} />
                        </div>
                      ) : (
                        <span className="text-zinc-500">缺少课程标识</span>
                      )}
                    </td>
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
            href={buildCourseListHref(viewModel.page - 1, viewModel.limit, viewModel.statusView)}
            className="text-blue-700 hover:underline"
          >
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}
        {viewModel.hasNext ? (
          <Link
            href={buildCourseListHref(viewModel.page + 1, viewModel.limit, viewModel.statusView)}
            className="text-blue-700 hover:underline"
          >
            下一页
          </Link>
        ) : (
          <span className="text-zinc-400">下一页</span>
        )}
      </div>
    </section>
  );
}

const buildCourseListHref = (
  page: number,
  limit: number,
  statusView: CourseStatusView
): string => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    statusView,
  });
  return `${paths.teacher.courses}?${query.toString()}`;
};
