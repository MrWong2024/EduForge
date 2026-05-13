import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditClassroomForm } from "@/components/teacher/EditClassroomForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toClassroomDetailResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayText } from "@/lib/ui/format";

type EditClassroomPageProps = {
  params: Promise<{ classroomId: string }>;
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

type EditClassroomViewModel =
  | {
      mode: "ready";
      classroomId: string;
      classroom: ReturnType<typeof toClassroomDetailResponse>;
    }
  | { mode: "error"; status: number; description: string };

const getClassroomLoadSummary = (status: number): string => {
  if (status === 403) {
    return "无权限编辑该班级。";
  }
  if (status === 404) {
    return "班级不存在或功能未启用/不可用。";
  }
  return getCommonErrorSummary(status, "加载班级详情");
};

export default async function EditClassroomPage({ params }: EditClassroomPageProps) {
  const { classroomId } = await params;

  let viewModel: EditClassroomViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级详情失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
      origin,
      cache: "no-store",
    });
    viewModel = {
      mode: "ready",
      classroomId,
      classroom: toClassroomDetailResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getClassroomLoadSummary(error.status), detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="班级编辑页加载失败" description={viewModel.description} />
    );
  }

  const resolvedClassroomId = viewModel.classroom.id?.trim() || viewModel.classroomId;

  return (
    <section className="space-y-4">
      <PageHeader
        title="编辑班级"
        description={`班级：${toDisplayText(viewModel.classroom.name, "未命名班级")}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
            <Link
              href={paths.teacher.classroomDashboard(resolvedClassroomId)}
              className="text-blue-700 hover:underline"
            >
              班级看板
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页用于维护班级基础信息。</p>
        <p className="mt-1">
          修改班级信息不会影响班级成员、课堂任务和历史提交；归档、删除等低频操作请在班级列表的“更多”菜单中处理。
        </p>
      </section>

      <EditClassroomForm classroomId={resolvedClassroomId} initialClassroom={viewModel.classroom} />
    </section>
  );
}
