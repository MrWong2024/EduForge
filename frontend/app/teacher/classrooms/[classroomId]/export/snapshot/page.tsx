import Link from "next/link";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toExportSnapshotResponse } from "@/lib/api/types-teacher";
import {
  buildSnapshotApiPath,
  buildSnapshotHref,
  resolveSnapshotQuery,
  SNAPSHOT_WINDOWS,
  type SnapshotQueryState,
  type SnapshotSearchParams,
} from "@/lib/classroom-export-snapshot-query";
import { buildClassroomExportSnapshotSummary } from "@/lib/classroom-export-snapshot-summary";
import { paths } from "@/lib/routes/paths";
import { toDisplayText } from "@/lib/ui/format";
import { getCommonErrorSummary } from "@/lib/ui/status";

type SnapshotExportPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<SnapshotSearchParams>;
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
  const queryState = resolveSnapshotQuery(await searchParams);

  let viewModel: SnapshotViewModel = {
    mode: "error",
    status: 500,
    description: "加载教学快照预检数据失败，请稍后重试。",
  };

  try {
    const payload = await fetchJson<unknown>(
      buildSnapshotApiPath(classroomId, queryState),
      {
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
      const summary =
        error.status === 403
          ? "无权限访问教学快照预检页面。"
          : getCommonErrorSummary(error.status, "加载教学快照预检");

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
        title="教学快照预检加载失败"
        description={viewModel.description}
      />
    );
  }

  const query = viewModel.query;
  const metaEntries = Object.entries(viewModel.data.meta).filter(([key]) => key !== "notes");
  const hasData = Object.keys(viewModel.data.raw).length > 0;
  const { progress, aiHealth, commonIssues, late } =
    buildClassroomExportSnapshotSummary(viewModel.data.summary);
  const summaryCards = [
    {
      title: "班级进度",
      metrics: [
        ["班级人数", progress.studentsCount],
        ["已提交人数", progress.distinctStudentsSubmitted],
        ["提交率", progress.submissionRate],
      ],
    },
    {
      title: "AI 运行",
      metrics: [
        ["AI 作业总数", aiHealth.jobsTotal],
        ["成功数", aiHealth.jobsSucceeded],
        ["成功率", aiHealth.successRate],
      ],
    },
    {
      title: "常见问题",
      metrics: [
        ["标签", commonIssues.topTags],
        ["类型", commonIssues.topTypes],
        ["严重程度", commonIssues.topSeverities],
      ],
    },
    {
      title: "迟交",
      metrics: [
        ["迟交人数", late.lateStudentsCount],
        ["迟交次数", late.lateSubmissionsCount],
      ],
    },
  ];

  return (
    <section className="space-y-4">
      <PageHeader
        title="教学快照预检（内部）"
        description="用于导出前核对窗口、体积限制与快照摘要，不作为教师高频操作页。"
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-blue-700 hover:underline">
              返回班级看板
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页用于教学快照导出前预检与内部诊断。若出现截断提示，请先调整参数后再执行正式导出流程。</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">预检参数</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>窗口:</span>
            {SNAPSHOT_WINDOWS.map((windowValue) => {
              const active = windowValue === query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildSnapshotHref(classroomId, query, { window: windowValue })}
                  aria-current={active ? "page" : undefined}
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
              href={buildSnapshotHref(classroomId, query, {
                includePerTask: !query.includePerTask,
              })}
              className="text-blue-700 hover:underline"
            >
              {query.includePerTask ? "开" : "关"}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>学生上限: 当前 {query.limitStudents}</span>
            {[50, 100, 200].map((limitValue) => {
              const active = limitValue === query.limitStudents;
              return (
                <Link
                  key={limitValue}
                  href={buildSnapshotHref(classroomId, query, { limitStudents: limitValue })}
                  aria-current={active ? "page" : undefined}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {limitValue}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>评价上限: 当前 {query.limitAssessment}</span>
            {[200, 500, 1000].map((limitValue) => {
              const active = limitValue === query.limitAssessment;
              return (
                <Link
                  key={limitValue}
                  href={buildSnapshotHref(classroomId, query, { limitAssessment: limitValue })}
                  aria-current={active ? "page" : undefined}
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
          <p className="font-semibold">体积保护与截断提示</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {viewModel.data.notes.map((note, index) => (
              <li key={`${note}-${index}`}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasData ? (
        <EmptyState title="暂无快照预检数据" description="当前参数下未返回可展示快照内容。" />
      ) : (
        <>
          {metaEntries.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">快照元信息（预检）</h2>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {metaEntries.map(([key, value]) => (
                  <div key={key} className="rounded border border-zinc-200 p-3 text-sm">
                    <p className="text-zinc-500">{key}</p>
                    <p className="mt-1 font-medium text-zinc-900">{toDisplayText(value)}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">快照预检摘要</h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {summaryCards.map(({ title, metrics }) => (
                <section key={title} className="rounded border border-zinc-200 p-3 text-sm">
                  <h3 className="font-semibold text-zinc-900">{title}</h3>
                  <dl className="mt-2 space-y-1">
                    {metrics.map(([label, value]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-x-3">
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="font-medium text-zinc-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </section>
        </>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始快照数据（调试/核对用）
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
