import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  getDashboardAiBreakdown,
  getDashboardItems,
  toClassroomSummary,
  toDashboardResponse,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { safeGet, toDisplayText } from "@/lib/ui/format";

type DashboardPageProps = {
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

type DashboardViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      dashboard: ReturnType<typeof toDashboardResponse>;
      dashboardItems: ReturnType<typeof getDashboardItems>;
      aiBreakdown: ReturnType<typeof getDashboardAiBreakdown>;
      riskStudentCount: number | string;
      completionRate: number | string;
    }
  | { mode: "error"; status: number; description: string };

export default async function ClassroomDashboardPage({ params }: DashboardPageProps) {
  const { classroomId } = await params;
  let viewModel: DashboardViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级看板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, dashboardPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}/dashboard`, {
        origin,
        cache: "no-store",
      }),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const dashboard = toDashboardResponse(dashboardPayload);
    const dashboardItems = getDashboardItems(dashboard);
    const aiBreakdown = getDashboardAiBreakdown(dashboard);
    const riskStudentCount = safeGet<number | string>(dashboard, "riskStudentCount", "—");
    const completionRate = safeGet<number | string>(dashboard, "completionRate", "—");
    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      dashboard,
      dashboardItems,
      aiBreakdown,
      riskStudentCount,
      completionRate,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问该班级看板。",
        404: "看板功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载班级看板失败，请稍后重试。";
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="班级看板加载失败" description={viewModel.description} />
    );
  }

  return (
    <section>
      <PageHeader
        title={`${toDisplayText(viewModel.classroomName, "班级")}看板`}
        description={`班级 ID: ${classroomId}`}
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              进入任务列表
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">任务概览数量</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{viewModel.dashboardItems.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">风险学生数</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{toDisplayText(viewModel.riskStudentCount)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">完成率</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{toDisplayText(viewModel.completionRate)}</p>
        </div>
      </div>

      {viewModel.dashboardItems.length > 0 ? (
        <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">任务标题</th>
                <th className="px-4 py-3">课堂任务 ID</th>
                <th className="px-4 py-3">AI 状态</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.dashboardItems.map((item, index) => (
                <tr key={String(item.classroomTaskId ?? item.id ?? index)} className="border-t border-zinc-100">
                  <td className="px-4 py-3">{toDisplayText(item.title ?? item.name, "未命名任务")}</td>
                  <td className="px-4 py-3">{toDisplayText(item.classroomTaskId ?? item.id ?? item.taskId)}</td>
                  <td className="px-4 py-3">
                    {toDisplayText(item.aiStatus ?? item.aiFeedbackStatus, "暂无数据")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="暂无看板任务数据" description="当前看板未返回任务概览数据。" />
      )}

      <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">AI 状态摘要</h2>
        {Object.keys(viewModel.aiBreakdown).length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {Object.entries(viewModel.aiBreakdown).map(([status, count]) => (
              <li key={status}>
                {status}: {toDisplayText(count)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">暂无 AI 状态分布数据。</p>
        )}
      </section>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始看板 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.dashboard, null, 2)}
        </pre>
      </details>
    </section>
  );
}
