import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditCourseForm } from "@/components/teacher/EditCourseForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toCourseDetailResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayText } from "@/lib/ui/format";

type EditCoursePageProps = {
  params: Promise<{ courseId: string }>;
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

type EditCourseViewModel =
  | {
      mode: "ready";
      courseId: string;
      course: ReturnType<typeof toCourseDetailResponse>;
    }
  | { mode: "error"; status: number; description: string };

const getCourseLoadSummary = (status: number): string => {
  if (status === 403) {
    return "无权限编辑该课程。";
  }
  if (status === 404) {
    return "课程不存在或功能未启用/不可用。";
  }
  return getCommonErrorSummary(status, "加载课程详情");
};

export default async function EditCoursePage({ params }: EditCoursePageProps) {
  const { courseId } = await params;

  let viewModel: EditCourseViewModel = {
    mode: "error",
    status: 500,
    description: "加载课程详情失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(`courses/${encodeURIComponent(courseId)}`, {
      origin,
      cache: "no-store",
    });
    viewModel = {
      mode: "ready",
      courseId,
      course: toCourseDetailResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getCourseLoadSummary(error.status), detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="课程编辑页加载失败" description={viewModel.description} />
    );
  }

  const resolvedCourseId = viewModel.course.id?.trim() || viewModel.courseId;

  return (
    <section className="space-y-4">
      <PageHeader
        title="编辑课程"
        description={`课程：${toDisplayText(viewModel.course.name, "未命名课程")} | 代码：${toDisplayText(
          viewModel.course.code
        )}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.courses} className="text-blue-700 hover:underline">
              返回课程列表
            </Link>
            <Link href={paths.teacher.courseOverview(resolvedCourseId)} className="text-blue-700 hover:underline">
              课程总览
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页仅用于维护课程基础信息（课程代码、名称、学期、课程分类）。</p>
        <p className="mt-1">课程总览页仍以展示统计信息为主，不承担编辑职责。</p>
      </section>

      <EditCourseForm courseId={resolvedCourseId} initialCourse={viewModel.course} />
    </section>
  );
}

