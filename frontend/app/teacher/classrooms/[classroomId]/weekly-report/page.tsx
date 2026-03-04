import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toWeeklyReportResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { buildQueryString, getSingleSearchParam, parseEnum, toDisplayText } from "@/lib/ui/format";

type WeeklyReportPageProps = {
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
  const basePath = paths.teacher.classroomWeeklyReport(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

type WeeklyReportViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toWeeklyReportResponse>;
      window: ReportWindow;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function WeeklyReportPage({ params, searchParams }: WeeklyReportPageProps) {
  const { classroomId } = await params;
  const query = await searchParams;
  const window = parseEnum(getSingleSearchParam(query.window), REPORT_WINDOWS, "7d");
  const queryString = buildQueryString({ window });

  let viewModel: WeeklyReportViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级周报失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/weekly-report?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toWeeklyReportResponse(payload),
      window,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问班级周报。",
        404: "班级周报功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载班级周报失败，请稍后重试。";

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="班级周报加载失败" description={viewModel.description} />
    );
  }

  const summaryEntries = Object.entries(viewModel.data.summary);
  const overviewEntries = Object.entries(viewModel.data.overview);
  const hasData =
    summaryEntries.length > 0 || overviewEntries.length > 0 || viewModel.data.items.length > 0;

  return (
    <section className="space-y-4">
      <PageHeader
        title="班级周报"
        description={`班级 ID: ${classroomId} | 窗口: ${viewModel.window}`}
        actions={
          <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回班级看板
          </Link>
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

      {!hasData ? (
        <EmptyState title="暂无周报数据" description="当前窗口下未返回周报可展示内容。" />
      ) : (
        <>
          {summaryEntries.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">周报摘要</h2>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {summaryEntries.map(([key, value]) => (
                  <div key={key} className="rounded border border-zinc-200 p-3 text-sm">
                    <p className="text-zinc-500">{key}</p>
                    <p className="mt-1 font-medium text-zinc-900">{toDisplayText(value)}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {overviewEntries.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">周报概览</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                {overviewEntries.map(([key, value]) => (
                  <li key={key}>
                    {key}: {toDisplayText(value)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {viewModel.data.items.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">明细条目（最小展示）</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                {viewModel.data.items.slice(0, 10).map((item, index) => (
                  <li key={String(item.id ?? item.classroomTaskId ?? index)}>
                    {toDisplayText(item.title ?? item.name, "未命名条目")}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始周报 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
