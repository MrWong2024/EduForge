import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toWeeklyReportResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parseEnum,
  safeGet,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type WeeklyReportPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
};

const SUPPORTED_REPORT_WINDOWS = ["24h", "7d", "30d", "all"] as const;
type ReportWindow = (typeof SUPPORTED_REPORT_WINDOWS)[number];
const DISPLAY_REPORT_WINDOWS = ["7d", "30d", "all"] as const;
type DisplayReportWindow = (typeof DISPLAY_REPORT_WINDOWS)[number];
const REPORT_WINDOW_LABELS: Record<ReportWindow, string> = {
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部",
};

type UnknownRecord = Record<string, unknown>;
type MetricKind = "number" | "percent";
type WeeklyMetricCard = {
  key: string;
  label: string;
  value: string;
};
type WeeklyOverviewGroup = {
  key: string;
  title: string;
  rows: Array<{ label: string; value: string }>;
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(asRecord(value)).length > 0;
  }
  return true;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toPercentText = (value: unknown): string => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return "—";
  }
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

const pickValue = (sources: UnknownRecord[], paths: string[]): unknown => {
  for (const source of sources) {
    for (const path of paths) {
      const value = safeGet(source, path, undefined);
      if (hasMeaningfulValue(value)) {
        return value;
      }
    }
  }
  return undefined;
};

const formatMetricValue = (value: unknown, kind: MetricKind): string => {
  if (!hasMeaningfulValue(value)) {
    return "—";
  }
  if (kind === "percent") {
    return toPercentText(value);
  }
  const numeric = toFiniteNumber(value);
  return numeric === null ? toDisplayText(value, "—") : toDisplayText(numeric, "—");
};

const toTopListText = (
  records: UnknownRecord[],
  keyField: "tag" | "code",
  fallbackLabel: string
): string => {
  if (records.length === 0) {
    return "—";
  }
  return records
    .slice(0, 5)
    .map((record, index) => {
      const key = toDisplayText(record[keyField], `${fallbackLabel}${index + 1}`);
      const count = toDisplayText(record.count, "0");
      return `${key}（${count}）`;
    })
    .join("、");
};

const toRiskSampleText = (value: unknown): string => {
  if (!Array.isArray(value) || value.length === 0) {
    return "—";
  }
  const ids = value
    .map((item) => toDisplayText(item, "").trim())
    .filter((item) => item.length > 0);
  if (ids.length === 0) {
    return "—";
  }
  const preview = ids.slice(0, 5).join("、");
  return ids.length > 5 ? `${preview} 等 ${ids.length} 人` : preview;
};

const toSummaryCards = (sources: UnknownRecord[]): WeeklyMetricCard[] => {
  const definitions: Array<{
    key: string;
    label: string;
    kind: MetricKind;
    paths: string[];
  }> = [
    {
      key: "studentsCount",
      label: "学生总数",
      kind: "number",
      paths: ["studentsCount", "summary.studentsCount", "progress.studentsCount"],
    },
    {
      key: "publishedClassroomTasks",
      label: "已发布任务数",
      kind: "number",
      paths: [
        "publishedClassroomTasks",
        "summary.publishedClassroomTasks",
        "progress.publishedClassroomTasks",
      ],
    },
    {
      key: "distinctStudentsSubmitted",
      label: "有提交学生数",
      kind: "number",
      paths: [
        "distinctStudentsSubmitted",
        "summary.distinctStudentsSubmitted",
        "progress.distinctStudentsSubmitted",
      ],
    },
    {
      key: "submissionRate",
      label: "提交率",
      kind: "percent",
      paths: ["submissionRate", "summary.submissionRate", "progress.submissionRate"],
    },
    {
      key: "aiSuccessRate",
      label: "AI 成功率",
      kind: "percent",
      paths: ["aiSuccessRate", "summary.aiSuccessRate", "aiHealth.successRate"],
    },
    {
      key: "notSubmittedStudentsCount",
      label: "未提交学生数",
      kind: "number",
      paths: [
        "notSubmittedStudentsCount",
        "summary.notSubmittedStudentsCount",
        "atRisk.notSubmittedStudentsCount",
      ],
    },
  ];

  return definitions
    .map((definition) => {
      const value = pickValue(sources, definition.paths);
      if (!hasMeaningfulValue(value)) {
        return null;
      }
      return {
        key: definition.key,
        label: definition.label,
        value: formatMetricValue(value, definition.kind),
      } satisfies WeeklyMetricCard;
    })
    .filter((card): card is WeeklyMetricCard => Boolean(card));
};

const toOverviewGroups = (
  sources: UnknownRecord[],
  rawRecord: UnknownRecord
): WeeklyOverviewGroup[] => {
  const topTags = asRecordArray(safeGet(rawRecord, "topTags", undefined));
  const aiErrors = asRecordArray(safeGet(rawRecord, "aiHealth.errors", undefined));

  const progressGroupRows = [
    {
      label: "已截止任务数",
      value: formatMetricValue(
        pickValue(sources, [
          "dueClassroomTasks",
          "summary.dueClassroomTasks",
          "progress.dueClassroomTasks",
        ]),
        "number"
      ),
    },
    {
      label: "迟交次数",
      value: formatMetricValue(
        pickValue(sources, [
          "lateSubmissionsCount",
          "summary.lateSubmissionsCount",
          "progress.lateSubmissionsCount",
        ]),
        "number"
      ),
    },
    {
      label: "迟交学生数",
      value: formatMetricValue(
        pickValue(sources, [
          "lateStudentsCount",
          "summary.lateStudentsCount",
          "progress.lateStudentsCount",
        ]),
        "number"
      ),
    },
  ].filter((row) => row.value !== "—");

  const aiGroupRows = [
    {
      label: "AI 任务总数",
      value: formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.total", "jobs.total", "total"]),
        "number"
      ),
    },
    {
      label: "成功 / 失败",
      value: `${formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.succeeded", "jobs.succeeded", "succeeded"]),
        "number"
      )} / ${formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.failed", "jobs.failed", "failed"]),
        "number"
      )}`,
    },
    {
      label: "排队中 / 处理中",
      value: `${formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.pending", "jobs.pending", "pending"]),
        "number"
      )} / ${formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.running", "jobs.running", "running"]),
        "number"
      )}`,
    },
    {
      label: "终止任务数",
      value: formatMetricValue(
        pickValue(sources, ["aiHealth.jobs.dead", "jobs.dead", "dead"]),
        "number"
      ),
    },
    {
      label: "限流占比",
      value: formatMetricValue(
        pickValue(sources, ["aiHealth.rateLimitRatio", "rateLimitRatio"]),
        "percent"
      ),
    },
    {
      label: "超时占比",
      value: formatMetricValue(
        pickValue(sources, ["aiHealth.timeoutRatio", "timeoutRatio"]),
        "percent"
      ),
    },
  ].filter((row) => row.value !== "—");

  const riskGroupRows = [
    {
      label: "风险学生样本",
      value: toRiskSampleText(pickValue(sources, ["atRisk.sampleStudentIds", "sampleStudentIds"])),
    },
    {
      label: "高频标签",
      value: toTopListText(topTags, "tag", "标签"),
    },
    {
      label: "高频错误码",
      value: toTopListText(aiErrors, "code", "错误"),
    },
  ].filter((row) => row.value !== "—");

  return [
    {
      key: "progress",
      title: "学习进度概览",
      rows: progressGroupRows,
    },
    {
      key: "aiHealth",
      title: "AI 运行概览",
      rows: aiGroupRows,
    },
    {
      key: "risk",
      title: "风险与问题概览",
      rows: riskGroupRows,
    },
  ].filter((group) => group.rows.length > 0);
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

const buildWindowHref = (classroomId: string, windowValue: DisplayReportWindow): string => {
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
  const window = parseEnum(getSingleSearchParam(query.window), SUPPORTED_REPORT_WINDOWS, "all");
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
      const summary =
        error.status === 403
          ? "无权限访问班级周报。"
          : getCommonErrorSummary(error.status, "加载班级周报");

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

  const rawRecord = asRecord(viewModel.data.raw);
  const sources: UnknownRecord[] = [
    asRecord(viewModel.data.summary),
    asRecord(viewModel.data.overview),
    rawRecord,
  ];
  const summaryCards = toSummaryCards(sources);
  const overviewGroups = toOverviewGroups(sources, rawRecord);
  const generatedAtText = toDisplayDate(safeGet(rawRecord, "generatedAt", undefined));
  const compatibilityHint =
    !DISPLAY_REPORT_WINDOWS.includes(viewModel.window as DisplayReportWindow)
      ? "（旧链接兼容）"
      : "";
  const hasData = summaryCards.length > 0 || overviewGroups.length > 0;

  return (
    <section className="space-y-4">
      <PageHeader
        title="班级周报"
        description={`统计窗口：${REPORT_WINDOW_LABELS[viewModel.window]}`}
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-blue-700 hover:underline">
              返回班级看板
            </Link>
            <Link href={paths.teacher.classroomProcessAssessment(classroomId)} className="text-blue-700 hover:underline">
              过程性评价
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>统计窗口:</span>
            {DISPLAY_REPORT_WINDOWS.map((windowValue) => {
              const isActive = windowValue === viewModel.window;
              return (
                <Link
                  key={windowValue}
                  href={buildWindowHref(classroomId, windowValue)}
                  className={isActive ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {REPORT_WINDOW_LABELS[windowValue]}
                </Link>
              );
            })}
            <span className="text-zinc-500">
              当前：{REPORT_WINDOW_LABELS[viewModel.window]}
              {compatibilityHint}
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">统计生成于：{generatedAtText}</p>
      </section>

      {!hasData ? (
        <EmptyState title="暂无周报数据" description="当前窗口下未返回周报可展示内容。" />
      ) : (
        <>
          {summaryCards.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">周报摘要</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {summaryCards.map((card) => (
                  <article key={card.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs text-zinc-500">{card.label}</p>
                    <p className="mt-1 text-lg font-semibold text-zinc-900">{card.value}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {overviewGroups.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">周报概览</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {overviewGroups.map((group) => (
                  <article key={group.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-medium text-zinc-600">{group.title}</p>
                    <dl className="mt-2 space-y-1 text-sm text-zinc-700">
                      {group.rows.map((row) => (
                        <div key={`${group.key}-${row.label}`} className="flex items-start justify-between gap-2">
                          <dt className="text-zinc-600">{row.label}</dt>
                          <dd className="text-right font-medium text-zinc-800">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
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
