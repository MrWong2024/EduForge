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
const DETAIL_PREVIEW_LIMIT = 30;

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
type WeeklyDetailColumn = {
  key: string;
  label: string;
};

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  taskId: "任务ID",
  classroomTaskId: "课堂任务ID",
  title: "任务标题",
  name: "名称",
  studentsCount: "学生数",
  publishedClassroomTasks: "已发布任务数",
  dueClassroomTasks: "已截止任务数",
  distinctStudentsSubmitted: "有提交学生数",
  submissionRate: "提交率",
  lateSubmissionsCount: "迟交次数",
  lateStudentsCount: "迟交学生数",
  aiSuccessRate: "AI 成功率",
  aiPendingJobs: "AI 待处理",
  aiFailedJobs: "AI 失败",
  total: "总数",
  succeeded: "成功",
  failed: "失败",
  dead: "终止",
  pending: "排队中",
  running: "处理中",
  successRate: "成功率",
  rateLimitRatio: "限流占比",
  timeoutRatio: "超时占比",
  notSubmittedStudentsCount: "未提交学生数",
  sampleStudentIds: "风险学生样本",
  tag: "标签",
  code: "错误码",
  count: "次数",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  dueAt: "截止时间",
  publishedAt: "发布时间",
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

const toFriendlyFieldLabel = (field: string): string => {
  const mapped = FIELD_LABELS[field];
  if (mapped) {
    return mapped;
  }
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
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

const shouldRenderAsPercent = (field: string): boolean => {
  const normalized = field.toLowerCase();
  return (
    normalized.includes("rate") ||
    normalized.includes("ratio") ||
    normalized.includes("percent")
  );
};

const toDetailCellText = (field: string, value: unknown): string => {
  if (!hasMeaningfulValue(value)) {
    return "—";
  }
  if (shouldRenderAsPercent(field)) {
    return toPercentText(value);
  }
  if (field.endsWith("At")) {
    const iso =
      typeof value === "string" || typeof value === "number" ? String(value) : null;
    return toDisplayDate(iso);
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    const texts = value
      .map((item) => toDisplayText(item, "").trim())
      .filter((item) => item.length > 0);
    if (texts.length === 0) {
      return "—";
    }
    const preview = texts.slice(0, 3).join("、");
    return texts.length > 3 ? `${preview} 等 ${texts.length} 项` : preview;
  }
  if (typeof value === "object") {
    const compact = JSON.stringify(value);
    return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  }
  return toDisplayText(value, "—");
};

const resolveDetailColumns = (rows: UnknownRecord[]): WeeklyDetailColumn[] => {
  if (rows.length === 0) {
    return [];
  }

  const preferredOrder = [
    "title",
    "name",
    "classroomTaskId",
    "taskId",
    "studentsCount",
    "distinctStudentsSubmitted",
    "submissionRate",
    "aiSuccessRate",
    "aiPendingJobs",
    "aiFailedJobs",
    "lateSubmissionsCount",
    "lateStudentsCount",
    "dueAt",
    "publishedAt",
    "createdAt",
    "updatedAt",
  ];

  const availableKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      availableKeys.add(key);
    }
  }

  const selected = preferredOrder.filter((key) => availableKeys.has(key));
  if (selected.length === 0) {
    selected.push(...Object.keys(rows[0]).slice(0, 6));
  } else if (selected.length < 6) {
    const additional = Object.keys(rows[0])
      .filter((key) => !selected.includes(key))
      .slice(0, 6 - selected.length);
    selected.push(...additional);
  }

  return selected.slice(0, 8).map((key) => ({
    key,
    label: toFriendlyFieldLabel(key),
  }));
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
  const detailRows = asRecordArray(viewModel.data.items);
  const detailColumns = resolveDetailColumns(detailRows);
  const detailRowsPreview = detailRows.slice(0, DETAIL_PREVIEW_LIMIT);
  const generatedAtText = toDisplayDate(safeGet(rawRecord, "generatedAt", undefined));
  const compatibilityHint =
    !DISPLAY_REPORT_WINDOWS.includes(viewModel.window as DisplayReportWindow)
      ? "（旧链接兼容）"
      : "";
  const hasData =
    summaryCards.length > 0 || overviewGroups.length > 0 || detailRows.length > 0;

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

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">周报明细</h2>
              <p className="text-xs text-zinc-500">
                {detailRows.length > DETAIL_PREVIEW_LIMIT
                  ? `已展示前 ${DETAIL_PREVIEW_LIMIT} 条，共 ${detailRows.length} 条`
                  : `共 ${detailRows.length} 条`}
              </p>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              明细用于辅助定位本窗口内的课堂表现变化，字段已做友好化与比率格式化展示。
            </p>

            {detailRows.length > 0 && detailColumns.length > 0 ? (
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-zinc-50 text-left text-zinc-600">
                    <tr>
                      {detailColumns.map((column) => (
                        <th key={column.key} className="px-4 py-3">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRowsPreview.map((row, index) => (
                      <tr
                        key={String(row.id ?? row.classroomTaskId ?? row.taskId ?? index)}
                        className="border-t border-zinc-100 align-top"
                      >
                        {detailColumns.map((column) => (
                          <td key={`${index}-${column.key}`} className="px-4 py-3">
                            {toDetailCellText(column.key, row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3">
                <EmptyState title="暂无周报明细" description="当前窗口下未返回可展示的明细条目。" />
              </div>
            )}
          </section>
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
