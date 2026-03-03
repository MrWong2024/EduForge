import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toReviewPackResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  parseEnum,
  parsePositiveInt,
  safeGet,
  toDisplayText,
} from "@/lib/ui/format";

type ReviewPackPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
  searchParams: Promise<{
    window?: string | string[];
    topK?: string | string[];
    examplesPerTag?: string | string[];
    includeStudentTiers?: string | string[];
    includeTeacherScript?: string | string[];
  }>;
};

const REVIEW_WINDOWS = ["24h", "7d", "30d"] as const;
type ReviewWindow = (typeof REVIEW_WINDOWS)[number];

type ReviewQueryState = {
  window: ReviewWindow;
  topK: number;
  examplesPerTag: number;
  includeStudentTiers: boolean;
  includeTeacherScript: boolean;
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
  query: Awaited<ReviewPackPageProps["searchParams"]>
): ReviewQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), REVIEW_WINDOWS, "7d"),
  topK: parsePositiveInt(getSingleSearchParam(query.topK), 10, { min: 1, max: 30 }),
  examplesPerTag: parsePositiveInt(getSingleSearchParam(query.examplesPerTag), 2, {
    min: 1,
    max: 5,
  }),
  includeStudentTiers: parseBool01(getSingleSearchParam(query.includeStudentTiers), false),
  includeTeacherScript: parseBool01(getSingleSearchParam(query.includeTeacherScript), true),
});

const toQueryRecord = (query: ReviewQueryState): Record<string, string> => ({
  window: query.window,
  topK: String(query.topK),
  examplesPerTag: String(query.examplesPerTag),
  includeStudentTiers: String(query.includeStudentTiers),
  includeTeacherScript: String(query.includeTeacherScript),
});

const buildHref = (
  basePath: string,
  currentParams: Record<string, string>,
  nextParams: Partial<Record<string, string | undefined>>
): string => {
  const merged = new URLSearchParams(currentParams);
  for (const [key, value] of Object.entries(nextParams)) {
    if (!value) {
      merged.delete(key);
      continue;
    }
    merged.set(key, value);
  }
  const query = merged.toString();
  return query ? `${basePath}?${query}` : basePath;
};

type ReviewPackViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toReviewPackResponse>;
      query: ReviewQueryState;
    }
  | { mode: "error"; status: number; description: string };

export default async function ReviewPackPage({ params, searchParams }: ReviewPackPageProps) {
  const { classroomId, classroomTaskId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const queryString = buildQueryString(toQueryRecord(queryState));

  let viewModel: ReviewPackViewModel = {
    mode: "error",
    status: 500,
    description: "加载课堂复盘失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/review-pack?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toReviewPackResponse(payload),
      query: queryState,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问课堂复盘页面。",
        404: "课堂复盘功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载课堂复盘失败，请稍后重试。";

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return <ErrorState status={viewModel.status} title="课堂复盘加载失败" description={viewModel.description} />;
  }

  const routePath = paths.teacher.classroomTaskReviewPack(classroomId, classroomTaskId);
  const queryRecord = toQueryRecord(viewModel.query);
  const topTags = safeGet<unknown[]>(viewModel.data.commonIssues, "topTags", []);
  const topTypes = safeGet<unknown[]>(viewModel.data.commonIssues, "topTypes", []);
  const topSeverities = safeGet<unknown[]>(viewModel.data.commonIssues, "topSeverities", []);
  const hasContent =
    viewModel.data.actionItems.length > 0 ||
    viewModel.data.examples.length > 0 ||
    topTags.length > 0 ||
    topTypes.length > 0 ||
    topSeverities.length > 0;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="课堂复盘"
        description={`班级 ${classroomId} | 课堂任务 ${classroomTaskId}`}
        actions={
          <Link href={paths.teacher.classroomTasks(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回任务列表
          </Link>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>窗口:</span>
            {REVIEW_WINDOWS.map((windowValue) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {windowValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>TopK:</span>
            {[5, 10, 20, 30].map((value) => {
              const active = value === viewModel.query.topK;
              return (
                <Link
                  key={value}
                  href={buildHref(routePath, queryRecord, { topK: String(value) })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {value}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>每标签样例数:</span>
            {[1, 2, 3, 5].map((value) => {
              const active = value === viewModel.query.examplesPerTag;
              return (
                <Link
                  key={value}
                  href={buildHref(routePath, queryRecord, { examplesPerTag: String(value) })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {value}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>学生分层:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeStudentTiers: String(!viewModel.query.includeStudentTiers),
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeStudentTiers ? "开" : "关"}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>教学脚本:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeTeacherScript: String(!viewModel.query.includeTeacherScript),
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeTeacherScript ? "开" : "关"}
            </Link>
          </div>
        </div>
      </section>

      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        隐私提示：复盘样例不包含敏感字段（如 codeText / prompt / apiKey）。
      </p>

      {!hasContent ? (
        <EmptyState title="暂无课堂复盘数据" description="当前查询条件下没有返回复盘数据。" />
      ) : (
        <>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">行动建议</h2>
            {viewModel.data.actionItems.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
                {viewModel.data.actionItems.slice(0, 5).map((item, index) => (
                  <li key={String(safeGet(item, "title", `action-${index}`))}>
                    <p className="font-medium text-zinc-900">{toDisplayText(safeGet(item, "title", undefined))}</p>
                    <p>原因：{toDisplayText(safeGet(item, "why", undefined), "—")}</p>
                    <p>建议：{toDisplayText(safeGet(item, "how", undefined), "—")}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">暂无行动建议。</p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">共性问题</h2>
            <div className="mt-2 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-zinc-500">Top Tags</p>
                {topTags.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                    {topTags.map((item, index) => (
                      <li key={String(safeGet(item, "tag", `tag-${index}`))}>
                        {toDisplayText(safeGet(item, "tag", undefined))}: {toDisplayText(safeGet(item, "count", undefined))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">暂无标签数据。</p>
                )}
              </div>

              <div>
                <p className="text-xs text-zinc-500">Top Types</p>
                {topTypes.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                    {topTypes.map((item, index) => (
                      <li key={String(safeGet(item, "type", `type-${index}`))}>
                        {toDisplayText(safeGet(item, "type", undefined))}: {toDisplayText(safeGet(item, "count", undefined))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">暂无类型数据。</p>
                )}
              </div>

              <div>
                <p className="text-xs text-zinc-500">Top Severities</p>
                {topSeverities.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                    {topSeverities.map((item, index) => (
                      <li key={String(safeGet(item, "severity", `severity-${index}`))}>
                        {toDisplayText(safeGet(item, "severity", undefined))}: {toDisplayText(safeGet(item, "count", undefined))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">暂无严重级别数据。</p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">教学脚本</h2>
            {viewModel.data.teacherScript.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
                {viewModel.data.teacherScript.map((item, index) => (
                  <li key={String(safeGet(item, "minute", `script-${index}`))}>
                    <p className="font-medium text-zinc-900">
                      {toDisplayText(safeGet(item, "minute", undefined))} · {toDisplayText(safeGet(item, "topic", undefined))}
                    </p>
                    <p>{toDisplayText(safeGet(item, "talkingPoints.0", undefined), "—")}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">未提供教学脚本。</p>
            )}
          </section>
        </>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始课堂复盘 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">{JSON.stringify(viewModel.data.raw, null, 2)}</pre>
      </details>
    </section>
  );
}
