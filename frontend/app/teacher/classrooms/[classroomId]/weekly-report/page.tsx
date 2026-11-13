import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toClassroomSummary, toWeeklyReportResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getAiFailureReasonLabel, getCommonErrorSummary } from "@/lib/ui/status";
import { getFeedbackTagLabel } from "@/lib/ui/feedback-tags";
import {
  buildQueryString,
  getSingleSearchParam,
  parseEnum,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type WeeklyReportPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
};

const SUPPORTED_REPORT_WINDOWS = ["7d", "30d", "all"] as const;
type ReportWindow = (typeof SUPPORTED_REPORT_WINDOWS)[number];
const REPORT_WINDOW_LABELS: Record<ReportWindow, string> = {
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
  const percent = numeric * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
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
      const key = keyField === "tag"
        ? getFeedbackTagLabel(record[keyField])
        : getAiFailureReasonLabel(record[keyField]);
      const count = toDisplayText(record.count, "0");
      return `${key === "—" ? `${fallbackLabel}${index + 1}` : key}（${count}）`;
    })
    .join("、");
};

const toSummaryCards = (data: ReturnType<typeof toWeeklyReportResponse>): WeeklyMetricCard[] => {
  const definitions: Array<{
    key: string;
    label: string;
    kind: MetricKind;
    value: unknown;
  }> = [
    {
      key: "studentsCount",
      label: "学生总数",
      kind: "number",
      value: data.progress.studentsCount,
    },
    {
      key: "publishedClassroomTasks",
      label: "已发布任务数",
      kind: "number",
      value: data.progress.publishedClassroomTasks,
    },
    {
      key: "distinctStudentsSubmitted",
      label: "有提交学生数",
      kind: "number",
      value: data.progress.distinctStudentsSubmitted,
    },
    {
      key: "submissionRate",
      label: "提交率",
      kind: "percent",
      value: data.progress.submissionRate,
    },
    {
      key: "aiSuccessRate",
      label: "AI 成功率",
      kind: "percent",
      value: data.aiHealth.successRate,
    },
    {
      key: "notSubmittedStudentsCount",
      label: "未提交学生数",
      kind: "number",
      value: data.atRisk.notSubmittedStudentsCount,
    },
  ];

  return definitions
    .map((definition) => {
      const value = definition.value;
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
  data: ReturnType<typeof toWeeklyReportResponse>
): WeeklyOverviewGroup[] => {
  const topTags = data.topTags;
  const aiErrors = asRecordArray(data.aiHealth.errors);
  const jobs = asRecord(data.aiHealth.jobs);

  const progressGroupRows = [
    {
      label: "已截止任务数",
      value: formatMetricValue(
        data.progress.dueClassroomTasks,
        "number"
      ),
    },
    {
      label: "迟交次数",
      value: formatMetricValue(
        data.progress.lateSubmissionsCount,
        "number"
      ),
    },
    {
      label: "迟交学生数",
      value: formatMetricValue(
        data.progress.lateStudentsCount,
        "number"
      ),
    },
  ].filter((row) => row.value !== "—");

  const aiGroupRows = [
    {
      label: "AI 任务总数",
      value: formatMetricValue(
        jobs.total,
        "number"
      ),
    },
    {
      label: "成功 / 失败",
      value: `${formatMetricValue(
        jobs.succeeded,
        "number"
      )} / ${formatMetricValue(
        jobs.failed,
        "number"
      )}`,
    },
    {
      label: "排队中 / 处理中",
      value: `${formatMetricValue(
        jobs.pending,
        "number"
      )} / ${formatMetricValue(
        jobs.running,
        "number"
      )}`,
    },
    {
      label: "终止任务数",
      value: formatMetricValue(
        jobs.dead,
        "number"
      ),
    },
    {
      label: "限流占比",
      value: formatMetricValue(
        data.aiHealth.rateLimitRatio,
        "percent"
      ),
    },
    {
      label: "超时占比",
      value: formatMetricValue(
        data.aiHealth.timeoutRatio,
        "percent"
      ),
    },
  ].filter((row) => row.value !== "—");

  const riskGroupRows = [
    {
      label: "高频标签",
      value: toTopListText(topTags, "tag", "标签"),
    },
    {
      label: "高频失败原因",
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

  const classroomName = toClassroomSummary(viewModel.data.classroom).name;
  const summaryCards = toSummaryCards(viewModel.data);
  const overviewGroups = toOverviewGroups(viewModel.data);
  const generatedAtText = toDisplayDate(viewModel.data.generatedAt);
  const hasData = summaryCards.length > 0 || overviewGroups.length > 0;

  return (
    <section className="space-y-4">
      <PageHeader
        title="班级周报"
        description={`班级：${classroomName ?? "班级名称暂不可用"} · 统计窗口：${REPORT_WINDOW_LABELS[viewModel.window]}`}
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
            {SUPPORTED_REPORT_WINDOWS.map((windowValue) => {
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

    </section>
  );
}
