import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { buildProxyPath, fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  ExcludeTasksPanel,
  type ExcludeTasksPanelTask,
} from "./ExcludeTasksPanel";
import {
  toClassroomTasksResponse,
  toProcessAssessmentResponse,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parseEnum,
  parsePositiveInt,
  safeGet,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type ProcessAssessmentPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<ProcessAssessmentSearchParams>;
};

type ProcessAssessmentSearchParams = {
  window?: string | string[];
  page?: string | string[];
  excludedTaskIds?: string | string[];
} & Record<string, string | string[] | undefined>;

const SUPPORTED_REPORT_WINDOWS = ["24h", "7d", "30d", "all"] as const;
type ReportWindow = (typeof SUPPORTED_REPORT_WINDOWS)[number];
const DISPLAY_REPORT_WINDOWS = ["7d", "30d", "all"] as const;
type DisplayReportWindow = (typeof DISPLAY_REPORT_WINDOWS)[number];
const PROCESS_ASSESSMENT_PAGE_SIZE = 100;
const TASK_OPTION_PAGE_SIZE = 100;
const MAX_TASK_OPTION_PAGES = 20;
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
  iteratedTasksCount: number;
  aiTaskCoverageDisplay: string;
  aiTaskCoverageSecondaryText: string;
  avgWarnItemsDisplay: string;
  avgErrorItemsDisplay: string;
  aiRequestedCount: number;
  aiSucceededCount: number;
};
type SummaryMetricCard = {
  key: string;
  label: string;
  value: string;
};
type ProcessAssessmentTaskOption = {
  id: string;
  title: string;
  publishedAt?: string;
  status?: string;
  dueAt?: string;
};
type TaskOptionsLoadResult = {
  taskOptions: ProcessAssessmentTaskOption[];
  taskOptionsLoadError?: string;
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

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

const toMetricText = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
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
    const iteratedTasksCount = toFiniteNumber(safeGet(item, "iteratedTasksCount", undefined)) ?? 0;
    const aiRequestedTasksCount =
      toFiniteNumber(safeGet(item, "aiRequestedTasksCount", undefined)) ?? 0;
    const aiSucceededTasksCount =
      toFiniteNumber(safeGet(item, "aiSucceededTasksCount", undefined)) ?? 0;
    const avgWarnItems = toFiniteNumber(safeGet(item, "avgWarnItems", undefined));
    const avgErrorItems = toFiniteNumber(safeGet(item, "avgErrorItems", undefined));
    const aiTaskCoverageDisplay =
      publishedTasksCount !== null
        ? `${aiRequestedTasksCount}/${publishedTasksCount}`
        : `${aiRequestedTasksCount}`;
    const aiTaskCoverageSecondaryText = `成功任务 ${aiSucceededTasksCount}；总请求 ${aiRequestedCount} / 成功 ${aiSucceededCount}`;

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
      iteratedTasksCount,
      aiTaskCoverageDisplay,
      aiTaskCoverageSecondaryText,
      avgWarnItemsDisplay: toMetricText(avgWarnItems),
      avgErrorItemsDisplay: toMetricText(avgErrorItems),
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
      label: "平均任务覆盖率",
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

  const toPointText = (value: number) => toScoreText((value <= 1 ? value : value / 100) * 100);
  return `当前评价口径：任务覆盖率 ${toPointText(submittedTasksRate)} 分，提交迭代质量 ${toPointText(
    submissionsCount
  )} 分，AI 使用质量 ${toPointText(aiRequestQualityProxy)} 分，代码质量代理 ${toPointText(
    codeQualityProxy
  )} 分。`;
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

type ProcessAssessmentQueryState = {
  window: ReportWindow;
  page: number;
  excludedTaskIds: string[];
};

const parseExcludedTaskIds = (
  value: string | string[] | null | undefined,
): string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const taskId of rawValues
    .flatMap((rawValue) => rawValue.split(","))
    .map((rawValue) => rawValue.trim())
    .filter((rawValue) => rawValue.length > 0)) {
    if (!seen.has(taskId)) {
      seen.add(taskId);
      parsed.push(taskId);
    }
  }
  return parsed;
};

const toExcludedTaskIdsQueryValue = (
  excludedTaskIds: string[],
): string | undefined =>
  excludedTaskIds.length > 0 ? excludedTaskIds.join(",") : undefined;

const toSearchParamEntries = (
  query: ProcessAssessmentSearchParams,
): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) {
      continue;
    }
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      entries.push([key, value]);
    }
  }
  return entries;
};

const resolveQueryState = (
  query: Awaited<ProcessAssessmentPageProps["searchParams"]>,
): ProcessAssessmentQueryState => ({
  window: parseEnum(getSingleSearchParam(query.window), SUPPORTED_REPORT_WINDOWS, "all"),
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
  excludedTaskIds: parseExcludedTaskIds(query.excludedTaskIds),
});

const buildWindowHref = (
  classroomId: string,
  windowValue: DisplayReportWindow,
  excludedTaskIds: string[],
): string => {
  const query = buildQueryString({
    window: windowValue,
    page: 1,
    excludedTaskIds: toExcludedTaskIdsQueryValue(excludedTaskIds),
  });
  const basePath = paths.teacher.classroomProcessAssessment(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

const buildPageHref = (
  classroomId: string,
  windowValue: ReportWindow,
  page: number,
  excludedTaskIds: string[],
): string => {
  const query = buildQueryString({
    window: windowValue,
    page,
    excludedTaskIds: toExcludedTaskIdsQueryValue(excludedTaskIds),
  });
  const basePath = paths.teacher.classroomProcessAssessment(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

const extractClassroomTaskRecords = (payload: unknown): UnknownRecord[] => {
  if (Array.isArray(payload)) {
    return asRecordArray(payload);
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(safeGet(record, "data", undefined));
  const source = Object.keys(dataRecord).length > 0 ? dataRecord : record;
  const candidateItems =
    safeGet<unknown>(source, "items", undefined) ??
    safeGet<unknown>(source, "data", undefined);
  return asRecordArray(candidateItems);
};

const toTaskOptionsFromPayload = (
  payload: unknown,
): ProcessAssessmentTaskOption[] => {
  const taskList = toClassroomTasksResponse(payload);
  const rawItems = extractClassroomTaskRecords(payload);
  const taskOptions: ProcessAssessmentTaskOption[] = [];
  taskList.items.forEach((task, index) => {
    const rawItem = rawItems[index] ?? {};
    const taskRecord = asRecord(safeGet(rawItem, "task", undefined));
    const id =
      task.classroomTaskId ??
      toOptionalString(rawItem.classroomTaskId) ??
      toOptionalString(rawItem.id);
    if (!id) {
      return;
    }

    const publishedAt =
      toOptionalString(rawItem.publishedAt) ??
      toOptionalString(taskRecord.publishedAt);
    const status = task.status ?? toOptionalString(rawItem.status);
    const dueAt = task.dueAt ?? toOptionalString(rawItem.dueAt);
    taskOptions.push({
      id,
      title:
        task.title ??
        toOptionalString(taskRecord.title) ??
        toOptionalString(rawItem.title) ??
        "未命名任务",
      ...(publishedAt ? { publishedAt } : {}),
      ...(status ? { status } : {}),
      ...(dueAt ? { dueAt } : {}),
    });
  });
  return taskOptions;
};

const fetchAllClassroomTaskOptions = async (
  classroomId: string,
  origin: string,
): Promise<ProcessAssessmentTaskOption[]> => {
  const taskOptions: ProcessAssessmentTaskOption[] = [];
  const seenTaskIds = new Set<string>();
  let page = 1;
  let total: number | undefined;

  while (page <= MAX_TASK_OPTION_PAGES) {
    const query = buildQueryString({
      page,
      limit: TASK_OPTION_PAGE_SIZE,
    });
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks?${query}`,
      {
        origin,
        cache: "no-store",
      },
    );
    const taskList = toClassroomTasksResponse(payload);
    const pageTaskOptions = toTaskOptionsFromPayload(payload);
    let addedCount = 0;
    for (const taskOption of pageTaskOptions) {
      if (!seenTaskIds.has(taskOption.id)) {
        seenTaskIds.add(taskOption.id);
        taskOptions.push(taskOption);
        addedCount += 1;
      }
    }

    total = typeof taskList.total === "number" ? taskList.total : total;
    if (typeof total === "number" && taskOptions.length >= total) {
      break;
    }
    if (pageTaskOptions.length < TASK_OPTION_PAGE_SIZE || addedCount === 0) {
      break;
    }
    page += 1;
  }

  return taskOptions;
};

const toTaskOptionMeta = (taskOption: ProcessAssessmentTaskOption): string => {
  const items = [
    `发布时间：${toDisplayDate(taskOption.publishedAt)}`,
    `截止：${toDisplayDate(taskOption.dueAt)}`,
    `状态：${toDisplayText(taskOption.status)}`,
  ];
  return items.join(" · ");
};

type ProcessAssessmentViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toProcessAssessmentResponse>;
      window: ReportWindow;
      excludedTaskIds: string[];
      taskOptions: ProcessAssessmentTaskOption[];
      taskOptionsLoadError?: string;
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
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const currentQueryEntries = toSearchParamEntries(rawQuery);
  const queryString = buildQueryString({
    window: queryState.window,
    page: String(queryState.page),
    limit: String(PROCESS_ASSESSMENT_PAGE_SIZE),
    excludedTaskIds: toExcludedTaskIdsQueryValue(queryState.excludedTaskIds),
  });
  const csvBasePath = buildProxyPath(
    `classrooms/${encodeURIComponent(classroomId)}/process-assessment.csv`
  );
  const csvQuery = buildQueryString({
    window: queryState.window,
    excludedTaskIds: toExcludedTaskIdsQueryValue(queryState.excludedTaskIds),
  });
  const csvHref = csvQuery ? `${csvBasePath}?${csvQuery}` : csvBasePath;

  let viewModel: ProcessAssessmentViewModel = {
    mode: "error",
    status: 500,
    description: "加载过程性评价失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const taskOptionsPromise: Promise<TaskOptionsLoadResult> =
      fetchAllClassroomTaskOptions(classroomId, origin)
        .then((taskOptions) => ({ taskOptions }))
        .catch(() => ({
          taskOptions: [],
          taskOptionsLoadError:
            "排除任务列表加载失败，当前成绩仍按 URL 中的排除参数计算。",
        }));
    const [payload, taskOptionsResult] = await Promise.all([
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/process-assessment?${queryString}`,
        {
          origin,
          cache: "no-store",
        },
      ),
      taskOptionsPromise,
    ]);

    viewModel = {
      mode: "ready",
      data: toProcessAssessmentResponse(payload),
      window: queryState.window,
      excludedTaskIds: queryState.excludedTaskIds,
      taskOptions: taskOptionsResult.taskOptions,
      taskOptionsLoadError: taskOptionsResult.taskOptionsLoadError,
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
  const displayedStudentsCount = rows.length;
  const totalStudentsCount =
    typeof viewModel.data.total === "number" ? viewModel.data.total : displayedStudentsCount;
  const currentPageSource =
    typeof viewModel.data.page === "number" && viewModel.data.page > 0
      ? viewModel.data.page
      : queryState.page;
  const totalPages = Math.max(1, Math.ceil(totalStudentsCount / PROCESS_ASSESSMENT_PAGE_SIZE));
  const currentPage = Math.min(currentPageSource, totalPages);
  const showPagination = totalStudentsCount > PROCESS_ASSESSMENT_PAGE_SIZE;
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;
  const excludedTaskPanelTasks: ExcludeTasksPanelTask[] =
    viewModel.taskOptions.map((taskOption) => ({
      id: taskOption.id,
      title: taskOption.title,
      publishedAt: taskOption.publishedAt ?? null,
      metaText: toTaskOptionMeta(taskOption),
    }));

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
                  href={buildWindowHref(
                    classroomId,
                    windowValue,
                    viewModel.excludedTaskIds,
                  )}
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

      <details
        open={viewModel.excludedTaskIds.length > 0}
        className="rounded-lg border border-zinc-200 bg-white p-4 text-sm"
      >
        <summary className="cursor-pointer font-medium text-zinc-900">
          排除任务（临时计算）
        </summary>
        <ExcludeTasksPanel
          classroomId={classroomId}
          window={viewModel.window}
          initialExcludedTaskIds={viewModel.excludedTaskIds}
          tasks={excludedTaskPanelTasks}
          initialQueryEntries={currentQueryEntries}
          taskOptionsLoadError={viewModel.taskOptionsLoadError}
          currentPathname={paths.teacher.classroomProcessAssessment(classroomId)}
        />
      </details>

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
          表格展示当前窗口内过程性评价明细；超过 100 人时可翻页查看，完整结果可通过 CSV 导出。
        </p>
        {rubricSummaryText ? (
          <p className="mt-2 text-xs text-zinc-500">{rubricSummaryText}</p>
        ) : null}
        <div className="mt-2 text-sm text-zinc-600">
          共 {totalStudentsCount} 名学生，当前显示 {displayedStudentsCount} 名
        </div>

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
                  <th className="w-28 px-3 py-2.5 text-right">迭代任务数</th>
                  <th className="w-44 px-3 py-2.5">AI 覆盖任务数</th>
                  <th className="w-28 px-3 py-2.5 text-right">平均警告项</th>
                  <th className="w-28 px-3 py-2.5 text-right">平均错误项</th>
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
                    <td className="px-3 py-2.5 text-right text-zinc-800">
                      {row.iteratedTasksCount}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-zinc-900">{row.aiTaskCoverageDisplay}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {row.aiTaskCoverageSecondaryText}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-800">
                      {row.avgWarnItemsDisplay}
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-800">
                      {row.avgErrorItemsDisplay}
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

        {showPagination ? (
          <div className="mt-3 flex items-center gap-4 text-sm">
            <span className="text-zinc-600">
              第 {currentPage} / {totalPages} 页
            </span>

            {hasPrev ? (
              <Link
                href={buildPageHref(
                  classroomId,
                  viewModel.window,
                  currentPage - 1,
                  viewModel.excludedTaskIds,
                )}
                className="text-blue-700 hover:underline"
              >
                上一页
              </Link>
            ) : (
              <span className="text-zinc-400">上一页</span>
            )}

            {hasNext ? (
              <Link
                href={buildPageHref(
                  classroomId,
                  viewModel.window,
                  currentPage + 1,
                  viewModel.excludedTaskIds,
                )}
                className="text-blue-700 hover:underline"
              >
                下一页
              </Link>
            ) : (
              <span className="text-zinc-400">下一页</span>
            )}
          </div>
        ) : null}
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
