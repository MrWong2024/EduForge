import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { buildProxyPath, fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toProcessAssessmentResponse } from "@/lib/api/types-teacher";
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

type ProcessAssessmentPageProps = {
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
type ProcessAssessmentTableRow = {
  key: string;
  studentDisplayName: string;
  studentSecondaryText: string;
  progressDisplay: string;
  progressSecondaryText: string;
  progressRate: number | null;
  scoreDisplay: string;
  scoreValue: number | null;
  riskDisplay: string;
  riskTone: "high" | "medium" | "low" | "unknown";
  riskRaw: string;
  issueSummaryDisplay: string;
  issueSummaryTitle?: string;
  aiRequestedCount: number;
  aiSucceededCount: number;
};
type SummaryMetricCard = {
  key: string;
  label: string;
  value: string;
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

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

const toPercentText = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  const percent = value <= 1 ? value * 100 : value;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

const toScoreText = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
};

const toRiskLabel = (
  value: unknown
): { label: string; tone: ProcessAssessmentTableRow["riskTone"]; raw: string } => {
  const risk = toDisplayText(value, "").toUpperCase();
  if (risk === "HIGH") {
    return { label: "高风险", tone: "high", raw: "HIGH" };
  }
  if (risk === "MEDIUM") {
    return { label: "中风险", tone: "medium", raw: "MEDIUM" };
  }
  if (risk === "LOW") {
    return { label: "低风险", tone: "low", raw: "LOW" };
  }
  return { label: "未评估", tone: "unknown", raw: risk };
};

const toTopTagsSummary = (value: unknown): string => {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  const tags = value
    .map((item) => asRecord(item))
    .map((item) => {
      const tag = toDisplayText(item.tag, "").trim();
      const count = toFiniteNumber(item.count);
      if (!tag) {
        return "";
      }
      if (count === null) {
        return tag;
      }
      return `${tag} (${count})`;
    })
    .filter((item) => item.length > 0);

  if (tags.length === 0) {
    return "";
  }

  const preview = tags.slice(0, 3).join("、");
  return tags.length > 3 ? `${preview} 等 ${tags.length} 项` : preview;
};

const toCompactText = (value: string, maxLength = 120): { text: string; title?: string } => {
  const normalized = value.trim();
  if (!normalized) {
    return { text: "—" };
  }
  if (normalized.length <= maxLength) {
    return { text: normalized };
  }
  return {
    text: `${normalized.slice(0, maxLength)}...`,
    title: normalized,
  };
};

const toProcessAssessmentTableRows = (items: UnknownRecord[]): ProcessAssessmentTableRow[] =>
  items.map((item, index) => {
    const studentName = toDisplayText(
      safeGet(item, "studentName", undefined) ?? safeGet(item, "name", undefined),
      ""
    ).trim();
    const studentNo = toDisplayText(safeGet(item, "studentNo", undefined), "").trim();
    const studentId = toDisplayText(safeGet(item, "studentId", undefined), "").trim();
    const studentDisplayName = studentName || "未知学生";
    const studentSecondaryText = studentNo ? `学号：${studentNo}` : "";

    const submittedTasksRate = toFiniteNumber(safeGet(item, "submittedTasksRate", undefined));
    const progressFallbackRate = toFiniteNumber(
      safeGet(item, "completionRate", undefined) ?? safeGet(item, "progress", undefined)
    );
    const progressRate = submittedTasksRate ?? progressFallbackRate;
    const submittedTasksCount = toFiniteNumber(safeGet(item, "submittedTasksCount", undefined));
    const publishedTasksCount = toFiniteNumber(safeGet(item, "publishedTasksCount", undefined));
    const progressSecondaryText =
      submittedTasksCount !== null && publishedTasksCount !== null
        ? `${submittedTasksCount}/${publishedTasksCount} 个任务有提交`
        : "—";
    const scoreValue = toFiniteNumber(safeGet(item, "score", undefined));

    const risk = toRiskLabel(safeGet(item, "riskLevel", undefined) ?? safeGet(item, "risk", undefined));
    const comment = toDisplayText(
      safeGet(item, "comment", undefined) ?? safeGet(item, "note", undefined),
      ""
    ).trim();
    const tagSummary = toTopTagsSummary(safeGet(item, "topTags", undefined));
    const issueSummaryRaw = comment || tagSummary || "";
    const issueSummary = toCompactText(issueSummaryRaw);

    const aiRequestedCount = toFiniteNumber(safeGet(item, "aiRequestedCount", undefined)) ?? 0;
    const aiSucceededCount = toFiniteNumber(safeGet(item, "aiSucceededCount", undefined)) ?? 0;

    return {
      key: String(studentId || safeGet(item, "id", undefined) || index),
      studentDisplayName,
      studentSecondaryText,
      progressDisplay: toPercentText(progressRate),
      progressSecondaryText,
      progressRate,
      scoreDisplay: toScoreText(scoreValue),
      scoreValue,
      riskDisplay: risk.label,
      riskTone: risk.tone,
      riskRaw: risk.raw,
      issueSummaryDisplay: issueSummary.text,
      issueSummaryTitle: issueSummary.title,
      aiRequestedCount,
      aiSucceededCount,
    };
  });

const toSummaryCards = (rows: ProcessAssessmentTableRow[]): SummaryMetricCard[] => {
  const totalStudents = rows.length;
  const highRiskCount = rows.filter((row) => row.riskRaw === "HIGH").length;

  const progressRateValues = rows
    .map((row) => row.progressRate)
    .filter((value): value is number => value !== null);
  const averageProgressRate =
    progressRateValues.length > 0
      ? progressRateValues.reduce((sum, value) => sum + value, 0) / progressRateValues.length
      : null;

  const aiRequestedTotal = rows.reduce((sum, row) => sum + row.aiRequestedCount, 0);
  const aiSucceededTotal = rows.reduce((sum, row) => sum + row.aiSucceededCount, 0);
  const aiSuccessRate = aiRequestedTotal > 0 ? aiSucceededTotal / aiRequestedTotal : null;
  const scoreValues = rows
    .map((row) => row.scoreValue)
    .filter((value): value is number => value !== null);
  const averageScore =
    scoreValues.length > 0
      ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length
      : null;

  return [
    { key: "totalStudents", label: "学生人数", value: `${totalStudents}` },
    { key: "highRiskCount", label: "高风险学生数", value: `${highRiskCount}` },
    {
      key: "averageProgressRate",
      label: "平均任务提交率",
      value: toPercentText(averageProgressRate),
    },
    { key: "averageScore", label: "平均得分", value: toScoreText(averageScore) },
    { key: "aiSuccessRate", label: "AI 请求成功率", value: toPercentText(aiSuccessRate) },
  ];
};

const toRubricSummaryText = (raw: UnknownRecord): string | null => {
  const rubric = asRecord(safeGet(raw, "rubric", undefined));
  const submittedTasksRate = toFiniteNumber(rubric.submittedTasksRate);
  const submissionsCount = toFiniteNumber(rubric.submissionsCount);
  const aiRequestQualityProxy = toFiniteNumber(rubric.aiRequestQualityProxy);
  const codeQualityProxy = toFiniteNumber(rubric.codeQualityProxy);

  if (
    submittedTasksRate === null ||
    submissionsCount === null ||
    aiRequestQualityProxy === null ||
    codeQualityProxy === null
  ) {
    return null;
  }

  const toWeightPercent = (value: number) => toPercentText(value <= 1 ? value : value / 100);
  return `当前评价口径：任务提交率 ${toWeightPercent(submittedTasksRate)}，提交次数 ${toWeightPercent(
    submissionsCount
  )}，AI 请求质量代理 ${toWeightPercent(aiRequestQualityProxy)}，代码质量代理 ${toWeightPercent(
    codeQualityProxy
  )}。`;
};

const riskToneClassNameMap: Record<ProcessAssessmentTableRow["riskTone"], string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  unknown: "bg-zinc-100 text-zinc-700 ring-zinc-200",
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
  const window = parseEnum(getSingleSearchParam(query.window), SUPPORTED_REPORT_WINDOWS, "all");
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
      const summary =
        error.status === 403
          ? "无权限访问过程性评价页面。"
          : getCommonErrorSummary(error.status, "加载过程性评价");

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

  const rows = toProcessAssessmentTableRows(viewModel.data.items);
  const summaryCards = toSummaryCards(rows);
  const generatedAtValue = safeGet(viewModel.data.raw, "generatedAt", undefined);
  const generatedAt =
    typeof generatedAtValue === "string" || typeof generatedAtValue === "number"
      ? toDisplayDate(String(generatedAtValue))
      : "—";
  const compatibilityHint =
    !DISPLAY_REPORT_WINDOWS.includes(viewModel.window as DisplayReportWindow)
      ? "（旧链接兼容）"
      : "";
  const rubricSummaryText = toRubricSummaryText(asRecord(viewModel.data.raw));

  return (
    <section className="space-y-4">
      <PageHeader
        title="过程性评价"
        description={`统计窗口：${REPORT_WINDOW_LABELS[viewModel.window]}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
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
            <Link href={paths.teacher.classroomWeeklyReport(classroomId)} className="text-blue-700 hover:underline">
              班级周报
            </Link>
            <Link href={paths.teacher.classroomExportSnapshot(classroomId)} className="text-blue-700 hover:underline">
              教学快照
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
        <p className="mt-1.5 text-[11px] text-zinc-400">统计生成于：{generatedAt}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">过程性评价摘要</h2>
        <p className="mt-1 text-xs text-zinc-500">以下指标基于当前窗口与当前返回明细聚合。</p>
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <article key={card.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
              <p className="text-[11px] text-zinc-500">{card.label}</p>
              <p className="mt-1 text-base font-semibold text-zinc-900">{card.value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">过程性评价明细</h2>
        <p className="mt-1 text-xs text-zinc-500">
          表格展示当前窗口内过程性评价明细；如需完整结果，请使用上方 CSV 导出。
        </p>
        {rubricSummaryText ? (
          <p className="mt-2 text-xs text-zinc-500">{rubricSummaryText}</p>
        ) : null}

        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="暂无过程性评价数据" description="当前窗口下未返回可展示条目。" />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className="w-14 px-3 py-2.5 text-center">序号</th>
                  <th className="w-56 px-3 py-2.5">学生</th>
                  <th className="w-44 px-3 py-2.5">进度</th>
                  <th className="w-24 px-3 py-2.5 text-right">得分</th>
                  <th className="w-28 px-3 py-2.5">风险</th>
                  <th className="px-3 py-2.5">问题摘要</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2.5 text-center text-zinc-700">{index + 1}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-zinc-900">{row.studentDisplayName}</p>
                      {row.studentSecondaryText ? (
                        <p className="mt-0.5 text-[11px] text-zinc-500">{row.studentSecondaryText}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-base font-semibold text-zinc-900">{row.progressDisplay}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{row.progressSecondaryText}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-base font-semibold text-zinc-900">
                      {row.scoreDisplay}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${riskToneClassNameMap[row.riskTone]}`}
                      >
                        {row.riskDisplay}
                      </span>
                    </td>
                    <td
                      className="max-w-xl whitespace-pre-wrap break-words px-3 py-2.5 text-zinc-700"
                      title={row.issueSummaryTitle}
                    >
                      {row.issueSummaryDisplay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
