import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toExportSnapshotResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  parseEnum,
  parsePositiveInt,
  toDisplayText,
} from "@/lib/ui/format";

type SnapshotExportPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{
    window?: string | string[];
    includePerTask?: string | string[];
    limitStudents?: string | string[];
    limitAssessment?: string | string[];
  }>;
};

const SNAPSHOT_WINDOWS = ["24h", "7d", "30d"] as const;
type SnapshotWindow = (typeof SNAPSHOT_WINDOWS)[number];

type SnapshotQueryState = {
  window: SnapshotWindow;
  includePerTask: boolean;
  limitStudents: number;
  limitAssessment: number;
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

const resolveQueryState = (
  query: Awaited<SnapshotExportPageProps["searchParams"]>
): SnapshotQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), SNAPSHOT_WINDOWS, "7d"),
  includePerTask: parseBool01(getSingleSearchParam(query.includePerTask), true),
  limitStudents: parsePositiveInt(getSingleSearchParam(query.limitStudents), 50, {
    min: 1,
    max: 200,
  }),
  limitAssessment: parsePositiveInt(getSingleSearchParam(query.limitAssessment), 200, {
    min: 1,
    max: 1000,
  }),
});

const toQueryRecord = (query: SnapshotQueryState): Record<string, string> => ({
  window: query.window,
  includePerTask: String(query.includePerTask),
  limitStudents: String(query.limitStudents),
  limitAssessment: String(query.limitAssessment),
});

const buildHref = (
  classroomId: string,
  current: Record<string, string>,
  next: Partial<Record<string, string | undefined>>
): string => {
  const merged = new URLSearchParams(current);
  for (const [key, value] of Object.entries(next)) {
    if (!value) {
      merged.delete(key);
      continue;
    }
    merged.set(key, value);
  }
  const query = merged.toString();
  const basePath = paths.teacher.classroomExportSnapshot(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

type SnapshotViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toExportSnapshotResponse>;
      query: SnapshotQueryState;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function SnapshotExportPage({
  params,
  searchParams,
}: SnapshotExportPageProps) {
  const { classroomId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const queryString = buildQueryString(toQueryRecord(queryState));

  let viewModel: SnapshotViewModel = {
    mode: "error",
    status: 500,
    description: "加载教学快照失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/export/snapshot?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toExportSnapshotResponse(payload),
      query: queryState,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问教学快照导出页面。",
        404: "教学快照导出功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载教学快照失败，请稍后重试。";

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="教学快照加载失败" description={viewModel.description} />
    );
  }

  const queryRecord = toQueryRecord(viewModel.query);
  const summaryEntries = Object.entries(viewModel.data.summary);
  const hasData = Object.keys(viewModel.data.raw).length > 0;

  return (
    <section className="space-y-4">
      <PageHeader
        title="教学快照导出"
        description={`班级 ID: ${classroomId}`}
        actions={
          <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回班级看板
          </Link>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">导出参数</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>窗口:</span>
            {SNAPSHOT_WINDOWS.map((windowValue) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(classroomId, queryRecord, { window: windowValue })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {windowValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>包含每任务明细:</span>
            <Link
              href={buildHref(classroomId, queryRecord, {
                includePerTask: String(!viewModel.query.includePerTask),
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includePerTask ? "开" : "关"}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>学生上限:</span>
            {[50, 100, 200].map((limitValue) => {
              const active = limitValue === viewModel.query.limitStudents;
              return (
                <Link
                  key={limitValue}
                  href={buildHref(classroomId, queryRecord, { limitStudents: String(limitValue) })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {limitValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>评价上限:</span>
            {[200, 500, 1000].map((limitValue) => {
              const active = limitValue === viewModel.query.limitAssessment;
              return (
                <Link
                  key={limitValue}
                  href={buildHref(classroomId, queryRecord, { limitAssessment: String(limitValue) })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {limitValue}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {viewModel.data.notes.length > 0 ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">体积保护提示 / 截断说明</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {viewModel.data.notes.map((note, index) => (
              <li key={`${note}-${index}`}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasData ? (
        <EmptyState title="暂无快照数据" description="当前参数下未返回可展示快照内容。" />
      ) : (
        <>
          {summaryEntries.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">快照摘要</h2>
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

        </>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始快照 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
