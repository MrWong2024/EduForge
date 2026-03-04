import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { buildProxyPath, fetchJson, FetchJsonError } from "@/lib/api/client";
import { toProcessAssessmentResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { buildQueryString, getSingleSearchParam, parseEnum, safeGet, toDisplayText } from "@/lib/ui/format";

type ProcessAssessmentPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
};

const REPORT_WINDOWS = ["24h", "7d", "30d"] as const;
type ReportWindow = (typeof REPORT_WINDOWS)[number];

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

const buildWindowHref = (classroomId: string, windowValue: ReportWindow): string => {
  const query = buildQueryString({ window: windowValue });
  const basePath = paths.teacher.classroomProcessAssessment(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

type ProcessAssessmentViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toProcessAssessmentResponse>;
      window: ReportWindow;
      csvHref: string;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function ProcessAssessmentPage({
  params,
  searchParams,
}: ProcessAssessmentPageProps) {
  const { classroomId } = await params;
  const query = await searchParams;
  const window = parseEnum(getSingleSearchParam(query.window), REPORT_WINDOWS, "7d");
  const queryString = buildQueryString({ window });
  const csvBasePath = buildProxyPath(
    `classrooms/${encodeURIComponent(classroomId)}/process-assessment.csv`
  );
  const csvHref = queryString ? `${csvBasePath}?${queryString}` : csvBasePath;

  let viewModel: ProcessAssessmentViewModel = {
    mode: "error",
    status: 500,
    description: "加载过程性评价失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/process-assessment?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toProcessAssessmentResponse(payload),
      window,
      csvHref,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问过程性评价页面。",
        404: "过程性评价功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载过程性评价失败，请稍后重试。";

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
        title="过程性评价加载失败"
        description={viewModel.description}
      />
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="过程性评价"
        description={`班级 ID: ${classroomId} | 窗口: ${viewModel.window}`}
        actions={
          <div className="flex items-center gap-3 text-sm">
            <a
              href={viewModel.csvHref}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-blue-700 hover:underline"
            >
              下载 CSV
            </a>
            <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-blue-700 hover:underline">
              返回班级看板
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">时间窗口</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {REPORT_WINDOWS.map((windowValue) => {
            const isActive = windowValue === viewModel.window;
            return (
              <Link
                key={windowValue}
                href={buildWindowHref(classroomId, windowValue)}
                className={isActive ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
              >
                {windowValue}
              </Link>
            );
          })}
        </div>
      </section>

      {viewModel.data.items.length === 0 ? (
        <EmptyState title="暂无过程性评价数据" description="当前窗口下未返回可展示条目。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">序号</th>
                <th className="px-4 py-3">学生</th>
                <th className="px-4 py-3">进度</th>
                <th className="px-4 py-3">风险</th>
                <th className="px-4 py-3">备注</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.data.items.map((row, index) => (
                <tr key={String(row.id ?? row.studentId ?? index)} className="border-t border-zinc-100 align-top">
                  <td className="px-4 py-3">{index + 1}</td>
                  <td className="px-4 py-3">
                    {toDisplayText(
                      safeGet(row, "studentName", undefined) ??
                        safeGet(row, "studentId", undefined) ??
                        safeGet(row, "name", undefined),
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {toDisplayText(
                      safeGet(row, "progress", undefined) ?? safeGet(row, "completionRate", undefined),
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {toDisplayText(
                      safeGet(row, "riskLevel", undefined) ?? safeGet(row, "risk", undefined),
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {toDisplayText(
                      safeGet(row, "comment", undefined) ?? safeGet(row, "note", undefined),
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始过程性评价 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
