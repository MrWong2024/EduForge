import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toClassroomListResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { toDisplayText } from "@/lib/ui/format";

type TeacherClassroomsPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    limit?: string | string[];
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

const extractRawDetail = (error: FetchJsonError): string | undefined => {
  if (typeof error.data === "string" && error.data.trim()) {
    return error.data;
  }

  if (!error.data || typeof error.data !== "object") {
    return undefined;
  }

  const message =
    "message" in error.data && typeof (error.data as { message?: unknown }).message === "string"
      ? String((error.data as { message: string }).message)
      : "";
  const code =
    "code" in error.data && typeof (error.data as { code?: unknown }).code === "string"
      ? String((error.data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

type ClassroomsViewModel =
  | {
      mode: "ready";
      items: ReturnType<typeof toClassroomListResponse>["items"];
      page: number;
      limit: number;
      hasPrev: boolean;
      hasNext: boolean;
    }
  | { mode: "error"; status: number; description: string };

export default async function TeacherClassroomsPage({ searchParams }: TeacherClassroomsPageProps) {
  const query = await searchParams;
  const page = parsePositiveInt(getSingleSearchParam(query.page), 1);
  const limit = Math.min(parsePositiveInt(getSingleSearchParam(query.limit), 20), 100);
  const requestQuery = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  let viewModel: ClassroomsViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(`classrooms?${requestQuery.toString()}`, {
      origin,
      cache: "no-store",
    });
    const list = toClassroomListResponse(payload);
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
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问班级列表。",
        404: "班级列表功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载班级列表失败，请稍后重试。";
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

  return (
    <section>
      <PageHeader title="班级" description={`第 ${viewModel.page} 页，每页 ${viewModel.limit} 条`} />

      {viewModel.items.length === 0 ? (
        <EmptyState title="暂无班级数据" description="当前账号下没有可访问班级。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">班级名称</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">课程 ID</th>
                <th className="px-4 py-3">加入码</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.items.map((item, index) => {
                const classroomId = item.id;
                return (
                  <tr key={classroomId ?? `classroom-${index}`} className="border-t border-zinc-100">
                    <td className="px-4 py-3">{toDisplayText(item.name, "未命名班级")}</td>
                    <td className="px-4 py-3">{toDisplayText(item.status)}</td>
                    <td className="px-4 py-3">{toDisplayText(item.courseId)}</td>
                    <td className="px-4 py-3">{toDisplayText(item.joinCode)}</td>
                    <td className="px-4 py-3">
                      {classroomId ? (
                        <Link
                          href={paths.teacher.classroomDashboard(classroomId)}
                          className="text-blue-700 hover:underline"
                        >
                          进入班级
                        </Link>
                      ) : (
                        <span className="text-zinc-500">缺少班级 ID</span>
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
            href={`${paths.teacher.classrooms}?page=${viewModel.page - 1}&limit=${viewModel.limit}`}
            className="text-blue-700 hover:underline"
          >
            上一页
          </Link>
        ) : (
          <span className="text-zinc-400">上一页</span>
        )}

        {viewModel.hasNext ? (
          <Link
            href={`${paths.teacher.classrooms}?page=${viewModel.page + 1}&limit=${viewModel.limit}`}
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
