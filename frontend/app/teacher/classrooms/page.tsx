import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { CreateClassroomForm } from "@/components/teacher/CreateClassroomForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toClassroomListResponse, toCourseListResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayText } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "班级列表",
};

type TeacherClassroomsPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
    courseId?: string | string[];
  }>;
};

const getSingleSearchParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
    }
  | { mode: "error"; status: number; description: string };

export default async function TeacherClassroomsPage({ searchParams }: TeacherClassroomsPageProps) {
  const query = await searchParams;
  const page = parsePositiveInt(getSingleSearchParam(query.page), 1);
  const limit = Math.min(parsePositiveInt(getSingleSearchParam(query.limit), 20), 100);
  const selectedCourseId = getSingleSearchParam(query.courseId)?.trim() || undefined;
  const requestQuery = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (selectedCourseId) {
    requestQuery.set("courseId", selectedCourseId);
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

  return (
    <section className="space-y-4">
      <PageHeader title="班级" description={`第 ${viewModel.page} 页，每页 ${viewModel.limit} 条`} />

      <CreateClassroomForm courses={viewModel.courses} initialCourseId={viewModel.selectedCourseId} />

      {viewModel.items.length === 0 ? (
        <EmptyState
          title="还没有班级"
          description="先选择课程并创建班级，再发布课堂任务。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="#create-classroom-form"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
              >
                创建班级
              </Link>
              <Link href={paths.teacher.courses} className="text-sm text-blue-700 hover:underline">
                去课程列表
              </Link>
            </div>
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
                return (
                  <tr key={classroomId ?? `classroom-${index}`} className="border-t border-zinc-100">
                    <td className="px-4 py-3">{toDisplayText(item.name, "未命名班级")}</td>
                    <td className="px-4 py-3">{toDisplayText(item.status)}</td>
                    <td className="px-4 py-3">{courseName ?? "未知课程"}</td>
                    <td className="px-4 py-3">{toDisplayText(item.joinCode)}</td>
                    <td className="px-4 py-3">
                      {classroomId ? (
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
            href={buildClassroomListHref(viewModel.page - 1, viewModel.limit, viewModel.selectedCourseId)}
            className="text-blue-700 hover:underline"
          >
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}

        {viewModel.hasNext ? (
          <Link
            href={buildClassroomListHref(viewModel.page + 1, viewModel.limit, viewModel.selectedCourseId)}
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
  courseId?: string
): string => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (courseId) {
    query.set("courseId", courseId);
  }
  return `${paths.teacher.classrooms}?${query.toString()}`;
};
