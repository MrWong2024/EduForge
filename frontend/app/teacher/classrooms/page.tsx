import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { Tabs } from "@/components/blocks/Tabs";
import { CreateClassroomForm } from "@/components/teacher/CreateClassroomForm";
import { ClassroomLifecycleActions } from "@/components/teacher/ClassroomLifecycleActions";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  toClassroomListResponse,
  toCourseListResponse,
  type ClassroomStatus,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayText } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "班级列表",
};

const CLASSROOM_STATUS_VIEW_VALUES = ["active", "archived", "all"] as const;
type ClassroomStatusView = (typeof CLASSROOM_STATUS_VIEW_VALUES)[number];

const CLASSROOM_STATUS_VIEW_LABEL: Record<ClassroomStatusView, string> = {
  active: "进行中",
  archived: "已归档",
  all: "全部",
};

const CLASSROOM_STATUS_META: Record<
  ClassroomStatus,
  {
    label: string;
    hint: string;
    badgeClassName: string;
  }
> = {
  ACTIVE: {
    label: "进行中",
    hint: "可继续教学与任务发布。",
    badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  ARCHIVED: {
    label: "已归档",
    hint: "默认不出现在进行中列表。",
    badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-700",
  },
};

type TeacherClassroomsPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
    courseId?: string | string[];
    statusView?: string | string[];
  }>;
};

const getSingleSearchParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseStatusView = (value: string | undefined): ClassroomStatusView => {
  if (!value) {
    return "active";
  }
  const normalized = value.toLowerCase();
  return CLASSROOM_STATUS_VIEW_VALUES.includes(normalized as ClassroomStatusView)
    ? (normalized as ClassroomStatusView)
    : "active";
};

const toStatusFilter = (statusView: ClassroomStatusView): ClassroomStatus | undefined => {
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

type ClassroomsViewModel =
  | {
      mode: "ready";
      items: ReturnType<typeof toClassroomListResponse>["items"];
      page: number;
      limit: number;
      hasPrev: boolean;
      hasNext: boolean;
      selectedCourseId?: string;
      courses: ReturnType<typeof toCourseListResponse>["items"];
      statusView: ClassroomStatusView;
    }
  | { mode: "error"; status: number; description: string };

export default async function TeacherClassroomsPage({ searchParams }: TeacherClassroomsPageProps) {
  const query = await searchParams;
  const page = parsePositiveInt(getSingleSearchParam(query.page), 1);
  const limit = Math.min(parsePositiveInt(getSingleSearchParam(query.limit), 20), 100);
  const selectedCourseId = getSingleSearchParam(query.courseId)?.trim() || undefined;
  const statusView = parseStatusView(getSingleSearchParam(query.statusView));
  const statusFilter = toStatusFilter(statusView);

  const requestQuery = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (selectedCourseId) {
    requestQuery.set("courseId", selectedCourseId);
  }
  if (statusFilter) {
    requestQuery.set("status", statusFilter);
  }

  let viewModel: ClassroomsViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomsPayload, coursesPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms?${requestQuery.toString()}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>("courses?page=1&limit=100", {
        origin,
        cache: "no-store",
      }),
    ]);

    const list = toClassroomListResponse(classroomsPayload);
    const courses = toCourseListResponse(coursesPayload).items;
    const items = list.items;
    const total = list.total;
    const hasPrev = page > 1;
    const hasNext = typeof total === "number" ? page * limit < total : items.length === limit;
    viewModel = {
      mode: "ready",
      items,
      page,
      limit,
      hasPrev,
      hasNext,
      selectedCourseId,
      courses,
      statusView,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问班级列表。"
          : getCommonErrorSummary(error.status, "加载班级列表");
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="班级列表加载失败" description={viewModel.description} />
    );
  }

  const courseNameMap = new Map(
    viewModel.courses
      .filter((course) => course.id)
      .map((course) => [course.id as string, toDisplayText(course.name, "未命名课程")])
  );

  const tabItems = [
    {
      label: "进行中",
      href: buildClassroomListHref(1, viewModel.limit, viewModel.selectedCourseId, "active"),
    },
    {
      label: "已归档",
      href: buildClassroomListHref(1, viewModel.limit, viewModel.selectedCourseId, "archived"),
    },
    {
      label: "全部",
      href: buildClassroomListHref(1, viewModel.limit, viewModel.selectedCourseId, "all"),
    },
  ];

  const activeTabHref = buildClassroomListHref(
    1,
    viewModel.limit,
    viewModel.selectedCourseId,
    viewModel.statusView
  );
  const emptyStateTitle =
    viewModel.statusView === "archived"
      ? "暂无已归档班级"
      : viewModel.statusView === "active"
        ? "还没有进行中班级"
        : "还没有班级";
  const emptyStateDescription =
    viewModel.statusView === "archived"
      ? "归档后的班级会显示在这里。"
      : "可使用上方“创建班级”表单创建首个班级，再发布课堂任务。";
  const archivedEmptyActionHref = buildClassroomListHref(
    1,
    viewModel.limit,
    viewModel.selectedCourseId,
    "active"
  );

  return (
    <section className="space-y-4">
      <PageHeader
        title="班级"
        description={`当前视图：${CLASSROOM_STATUS_VIEW_LABEL[viewModel.statusView]} · 第 ${viewModel.page} 页，每页 ${viewModel.limit} 条`}
      />

      <Tabs items={tabItems} activeHref={activeTabHref} />

      <CreateClassroomForm courses={viewModel.courses} initialCourseId={viewModel.selectedCourseId} />

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
                  查看进行中班级
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
                <th className="px-4 py-3">班级名称</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">所属课程</th>
                <th className="px-4 py-3">加入码</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.items.map((item, index) => {
                const classroomId = item.id;
                const courseName = item.courseId ? courseNameMap.get(item.courseId) : undefined;
                const statusMeta =
                  item.status && (item.status === "ACTIVE" || item.status === "ARCHIVED")
                    ? CLASSROOM_STATUS_META[item.status]
                    : undefined;

                return (
                  <tr key={classroomId ?? `classroom-${index}`} className="border-t border-zinc-100">
                    <td className="px-4 py-3">{toDisplayText(item.name, "未命名班级")}</td>
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
                        <span className="text-zinc-500">{toDisplayText(item.status)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{courseName ?? "未知课程"}</td>
                    <td className="px-4 py-3">{toDisplayText(item.joinCode)}</td>
                    <td className="px-4 py-3 align-top">
                      {classroomId ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <Link
                              href={paths.teacher.classroomDashboard(classroomId)}
                              className="text-blue-700 hover:underline"
                            >
                              进入班级
                            </Link>
                            <Link
                              href={paths.teacher.classroomEdit(classroomId)}
                              className="text-blue-700 hover:underline"
                            >
                              编辑班级
                            </Link>
                          </div>

                          <ClassroomLifecycleActions classroomId={classroomId} status={item.status} />
                        </div>
                      ) : (
                        <span className="text-zinc-500">缺少班级标识</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 text-sm">
        {viewModel.hasPrev ? (
          <Link
            href={buildClassroomListHref(
              viewModel.page - 1,
              viewModel.limit,
              viewModel.selectedCourseId,
              viewModel.statusView
            )}
            className="text-blue-700 hover:underline"
          >
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}

        {viewModel.hasNext ? (
          <Link
            href={buildClassroomListHref(
              viewModel.page + 1,
              viewModel.limit,
              viewModel.selectedCourseId,
              viewModel.statusView
            )}
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

const buildClassroomListHref = (
  page: number,
  limit: number,
  courseId: string | undefined,
  statusView: ClassroomStatusView
): string => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    statusView,
  });
  if (courseId) {
    query.set("courseId", courseId);
  }
  return `${paths.teacher.classrooms}?${query.toString()}`;
};
