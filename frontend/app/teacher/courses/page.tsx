import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { CreateCourseForm } from "@/components/teacher/CreateCourseForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toCourseListResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { getSingleSearchParam, parsePositiveInt, toDisplayText } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "课程列表",
};

type TeacherCoursesPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
  }>;
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
    }
  | { mode: "error"; status: number; description: string };

export default async function TeacherCoursesPage({ searchParams }: TeacherCoursesPageProps) {
  const query = await searchParams;
  const page = parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1, max: 100 });
  const limit = parsePositiveInt(getSingleSearchParam(query.limit), 20, { min: 1, max: 100 });

  let viewModel: CoursesViewModel = {
    mode: "error",
    status: 500,
    description: "加载课程列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(`courses?page=${page}&limit=${limit}`, {
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

  return (
    <section className="space-y-4">
      <PageHeader
        title="课程"
        description={`第 ${viewModel.page} 页，每页 ${viewModel.limit} 条`}
        actions={
          <Link href={paths.teacher.classrooms} className="text-sm text-blue-700 hover:underline">
            去班级列表
          </Link>
        }
      />

      <CreateCourseForm />

      {viewModel.items.length === 0 ? (
        <EmptyState
          title="还没有课程"
          description="先创建一门课程，再基于课程创建班级。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="#create-course-form"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
              >
                创建课程
              </Link>
              <Link href={paths.teacher.classrooms} className="text-sm text-blue-700 hover:underline">
                去班级列表
              </Link>
            </div>
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
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.items.map((course, index) => (
                <tr key={course.id ?? `course-${index}`} className="border-t border-zinc-100">
                  <td className="px-4 py-3">{toDisplayText(course.code)}</td>
                  <td className="px-4 py-3">{toDisplayText(course.name)}</td>
                  <td className="px-4 py-3">{toDisplayText(course.term)}</td>
                  <td className="px-4 py-3">{toDisplayText(course.status)}</td>
                  <td className="px-4 py-3">
                    {course.id ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={paths.teacher.courseOverview(course.id)}
                          className="text-blue-700 hover:underline"
                        >
                          课程总览
                        </Link>
                        <Link
                          href={`${paths.teacher.classrooms}?courseId=${encodeURIComponent(course.id)}`}
                          className="text-blue-700 hover:underline"
                        >
                          班级列表
                        </Link>
                      </div>
                    ) : (
                      <span className="text-zinc-500">缺少课程标识</span>
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
          <Link href={`${paths.teacher.courses}?page=${viewModel.page - 1}&limit=${viewModel.limit}`} className="text-blue-700 hover:underline">
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}
        {viewModel.hasNext ? (
          <Link href={`${paths.teacher.courses}?page=${viewModel.page + 1}&limit=${viewModel.limit}`} className="text-blue-700 hover:underline">
            下一页
          </Link>
        ) : (
          <span className="text-zinc-400">下一页</span>
        )}
      </div>
    </section>
  );
}
