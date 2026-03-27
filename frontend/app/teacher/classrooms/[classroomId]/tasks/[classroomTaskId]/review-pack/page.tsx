import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toReviewPackResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
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
const WINDOW_LABELS: Record<ReviewWindow, string> = {
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
};

type ReviewQueryState = {
  window: ReviewWindow;
  topK: number;
  examplesPerTag: number;
  includeStudentTiers: boolean;
  includeTeacherScript: boolean;
};

type OverviewMetricCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
};

type IssueDistributionItem = {
  key: string;
  label: string;
  count?: number;
};

type ExampleCardView = {
  key: string;
  category: string;
  feedback: string;
  suggestion?: string;
  context?: string;
  source?: string;
  attemptNo?: number;
};

type ScriptCardView = {
  key: string;
  minute: string;
  topic: string;
  talkingPoints: string[];
  focusHint?: string;
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

const toOptionalText = (value: unknown): string | undefined => {
  const text = toDisplayText(value, "").trim();
  return text ? text : undefined;
};

const pickText = (source: unknown, paths: readonly string[]): string | undefined => {
  for (const path of paths) {
    const text = toOptionalText(safeGet(source, path, undefined));
    if (text) {
      return text;
    }
  }
  return undefined;
};

const pickNumber = (source: unknown, paths: readonly string[]): number | undefined => {
  for (const path of paths) {
    const value = safeGet(source, path, undefined);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const toTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => toOptionalText(item))
      .filter((item): item is string => Boolean(item));
  }
  const single = toOptionalText(value);
  return single ? [single] : [];
};

const dedupeTexts = (texts: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const text of texts) {
    const normalized = text.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(text.trim());
  }

  return result;
};

const truncateText = (text: string, maxLength = 180): string => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
};

const toPercentNumber = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value <= 1 ? value * 100 : value;
};

const toPercentText = (value: number | undefined): string => {
  const percent = toPercentNumber(value);
  if (typeof percent !== "number") {
    return "—";
  }
  const digits = percent > 0 && percent < 10 ? 1 : 0;
  return `${percent.toFixed(digits)}%`;
};

const toIssueDistributionItems = (
  source: unknown[],
  labelPaths: readonly string[]
): IssueDistributionItem[] =>
  source
    .map((item, index) => {
      const label = pickText(item, labelPaths) ?? `未命名项 ${index + 1}`;
      const count = pickNumber(item, ["count", "total", "value"]);
      return {
        key: `${label}-${index}`,
        label,
        count,
      };
    })
    .filter((item) => item.label);

const toIssueDigest = (
  title: string,
  items: IssueDistributionItem[],
  emptyText: string
): string => {
  if (items.length === 0) {
    return `${title}：${emptyText}`;
  }

  const topText = items
    .slice(0, 3)
    .map((item) => `${item.label}${typeof item.count === "number" ? `（${item.count}）` : ""}`)
    .join("、");

  return `${title}：${topText}`;
};

const extractExampleSummary = (sample: unknown, group: unknown): string => {
  const summary = pickText(sample, [
    "message",
    "summary",
    "reason",
    "feedback.message",
    "feedbackSummary",
    "feedback.summary",
    "feedback.text",
  ]);
  if (summary) {
    return truncateText(summary);
  }

  const backup = pickText(group, ["summary", "reason"]);
  if (backup) {
    return truncateText(backup);
  }

  const type = pickText(sample, ["type", "feedback.type"]);
  const severity = pickText(sample, ["severity", "feedback.severity"]);
  const hint = [type ? `类型：${type}` : undefined, severity ? `严重程度：${severity}` : undefined]
    .filter((item): item is string => Boolean(item))
    .join("，");

  return hint
    ? `该样例未返回完整反馈文本，建议先围绕${hint}组织讲评。`
    : "该样例未返回完整反馈文本，建议结合问题归类进行讲评。";
};

const extractExampleSuggestion = (sample: unknown): string | undefined => {
  const suggestion = pickText(sample, [
    "suggestion",
    "feedback.suggestion",
    "recommendation",
    "how",
    "advice",
  ]);
  return suggestion ? truncateText(suggestion) : undefined;
};

const extractExampleContext = (sample: unknown, summary: string, suggestion?: string): string | undefined => {
  const context = pickText(sample, [
    "teachingHint",
    "context",
    "contextText",
    "reason",
    "feedbackSummary",
    "note",
    "comment",
  ]);
  if (!context) {
    return undefined;
  }

  const compact = truncateText(context);
  if (compact === summary || (suggestion && compact === suggestion)) {
    return undefined;
  }

  return compact;
};

const toExampleCards = (source: unknown[]): ExampleCardView[] => {
  const cards: ExampleCardView[] = [];

  source.forEach((group, groupIndex) => {
    const groupTag = pickText(group, ["tag", "name", "label", "value"]);
    const samples = safeGet<unknown[]>(group, "samples", []);
    const groupSource = pickText(group, ["source"]);

    if (samples.length === 0) {
      const summary = extractExampleSummary(group, group);
      cards.push({
        key: `example-${groupIndex}-0`,
        category: groupTag ? `标签：${groupTag}` : "问题归类：待补充",
        feedback: summary,
        suggestion: extractExampleSuggestion(group),
        context: extractExampleContext(group, summary),
        source: groupSource,
      });
      return;
    }

    samples.forEach((sample, sampleIndex) => {
      const tags = dedupeTexts([
        ...toTextList(groupTag),
        ...toTextList(safeGet(sample, "tag", undefined)),
        ...toTextList(safeGet(sample, "tags", [])),
        ...toTextList(safeGet(sample, "labels", [])),
      ]);
      const type = pickText(sample, ["type", "feedback.type", "issueType"]);
      const severity = pickText(sample, ["severity", "feedback.severity", "level"]);
      const sourceText = pickText(sample, ["source", "feedback.source"]) ?? groupSource;
      const summary = extractExampleSummary(sample, group);
      const suggestion = extractExampleSuggestion(sample);
      const context = extractExampleContext(sample, summary, suggestion);
      const categoryParts = [
        tags.length > 0 ? `标签：${tags.join(" / ")}` : undefined,
        type ? `类型：${type}` : undefined,
        severity ? `严重程度：${severity}` : undefined,
        sourceText ? `来源：${sourceText}` : undefined,
      ].filter((part): part is string => Boolean(part));

      cards.push({
        key: `example-${groupIndex}-${sampleIndex}`,
        category: categoryParts.length > 0 ? categoryParts.join(" ｜ ") : "问题归类：待补充",
        feedback: summary,
        suggestion,
        context,
        source: sourceText,
        attemptNo: pickNumber(sample, ["attemptNo"]),
      });
    });
  });

  return cards;
};

const toTalkingPoints = (source: unknown): string[] => {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((point) => {
      if (typeof point === "string") {
        return toOptionalText(point);
      }
      if (point && typeof point === "object") {
        return pickText(point, ["point", "content", "text", "summary"]);
      }
      return undefined;
    })
    .filter((point): point is string => Boolean(point));
};

const toScriptCards = (source: unknown[]): ScriptCardView[] =>
  source.map((item, index) => ({
    key: pickText(item, ["id", "minute", "topic"]) ?? `script-${index}`,
    minute: pickText(item, ["minute", "time", "phase"]) ?? "时间未标注",
    topic: pickText(item, ["topic", "title"]) ?? "讲评主题待补充",
    talkingPoints: toTalkingPoints(safeGet(item, "talkingPoints", [])),
    focusHint: pickText(item, ["focus", "objective", "goal", "note"]),
  }));

const buildOverviewMetricCards = (
  overview: unknown,
  window: ReviewWindow,
  examplesCount: number,
  exampleGroupCount: number
): OverviewMetricCard[] => {
  const studentsCount = pickNumber(overview, ["studentsCount", "studentCount", "totalStudents"]);
  const submittedStudentsCount = pickNumber(overview, [
    "submittedStudentsCount",
    "submittedCount",
    "submissionsCount",
  ]);
  const submissionRateRaw = pickNumber(overview, ["submissionRate", "submitRate"]);
  const submissionRateComputed =
    submissionRateRaw ??
    (typeof studentsCount === "number" && studentsCount > 0 && typeof submittedStudentsCount === "number"
      ? submittedStudentsCount / studentsCount
      : undefined);

  const ai = safeGet<unknown>(overview, "ai", {});
  const aiJobsTotal = pickNumber(ai, ["jobsTotal", "totalJobs", "jobs"]);
  const aiSuccessRateRaw = pickNumber(ai, ["successRate", "aiSuccessRate"]);
  const aiSuccessPercent = toPercentNumber(aiSuccessRateRaw);
  const aiSucceededEstimate =
    typeof aiSuccessPercent === "number" && typeof aiJobsTotal === "number"
      ? Math.round((aiSuccessPercent / 100) * aiJobsTotal)
      : undefined;

  const lateSubmissionsCount = pickNumber(overview, ["lateSubmissionsCount", "lateCount"]);
  const lateStudentsCount = pickNumber(overview, ["lateStudentsCount", "lateStudentCount"]);

  const attemptZero = pickNumber(overview, ["attemptsDistribution.0"]);
  const attemptOne = pickNumber(overview, ["attemptsDistribution.1"]);
  const attemptTwo = pickNumber(overview, ["attemptsDistribution.2"]);
  const attemptThreePlus = pickNumber(overview, ["attemptsDistribution.3plus", "attemptsDistribution.3+"]);
  const hasAttemptDistribution = [attemptZero, attemptOne, attemptTwo, attemptThreePlus].some(
    (value) => typeof value === "number"
  );

  return [
    {
      key: "coverage",
      title: "提交覆盖",
      value: `${typeof submittedStudentsCount === "number" ? submittedStudentsCount : "—"} / ${typeof studentsCount === "number" ? studentsCount : "—"}`,
      detail:
        typeof submissionRateComputed === "number"
          ? `提交率 ${toPercentText(submissionRateComputed)}（${WINDOW_LABELS[window]}）`
          : `提交率 —（${WINDOW_LABELS[window]}）`,
    },
    {
      key: "ai",
      title: "AI 反馈成功率",
      value: toPercentText(aiSuccessRateRaw),
      detail:
        typeof aiJobsTotal === "number"
          ? `成功约 ${typeof aiSucceededEstimate === "number" ? aiSucceededEstimate : "—"} / 总 jobs ${aiJobsTotal}`
          : "总 jobs：—",
    },
    {
      key: "late",
      title: "逾期情况",
      value: `${typeof lateSubmissionsCount === "number" ? lateSubmissionsCount : "—"} 次逾期提交`,
      detail: `涉及 ${typeof lateStudentsCount === "number" ? lateStudentsCount : "—"} 名学生`,
    },
    {
      key: "examples",
      title: "典型样例",
      value: `${examplesCount} 条`,
      detail: `${exampleGroupCount} 个问题标签分组`,
    },
    {
      key: "attempts",
      title: "尝试分布",
      value: hasAttemptDistribution
        ? `0次：${typeof attemptZero === "number" ? attemptZero : "—"} 人`
        : "—",
      detail: hasAttemptDistribution
        ? `1次：${typeof attemptOne === "number" ? attemptOne : "—"}｜2次：${typeof attemptTwo === "number" ? attemptTwo : "—"}｜3+次：${typeof attemptThreePlus === "number" ? attemptThreePlus : "—"}`
        : "暂无尝试分布数据",
    },
  ];
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
      const summary =
        error.status === 403
          ? "无权限访问课堂复盘页面。"
          : getCommonErrorSummary(error.status, "加载课堂复盘");

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
  const topTagItems = toIssueDistributionItems(topTags, ["tag", "name", "label", "value"]);
  const topTypeItems = toIssueDistributionItems(topTypes, ["type", "name", "label", "value"]);
  const topSeverityItems = toIssueDistributionItems(topSeverities, ["severity", "level", "name", "value"]);
  const exampleCards = toExampleCards(viewModel.data.examples);
  const scriptCards = toScriptCards(viewModel.data.teacherScript);
  const overviewMetricCards = buildOverviewMetricCards(
    viewModel.data.overview,
    viewModel.query.window,
    exampleCards.length,
    viewModel.data.examples.length
  );
  const firstAction = viewModel.data.actionItems[0];
  const firstActionTitle = pickText(firstAction, ["title", "action", "summary"]);
  const firstActionHow = pickText(firstAction, ["how", "suggestion", "recommendation"]);
  const summaryHighlights = [
    toIssueDigest("高频问题标签", topTagItems, "暂无明显集中标签"),
    toIssueDigest("高频问题类型", topTypeItems, "暂无明显集中类型"),
    toIssueDigest("严重程度分布", topSeverityItems, "暂无严重程度分布数据"),
    firstActionTitle
      ? `建议优先讲评：${firstActionTitle}${firstActionHow ? `（讲评方式：${firstActionHow}）` : ""}`
      : "建议优先讲评：当前暂无行动建议，可先从高频问题标签切入。",
    exampleCards.length > 0 ? `可直接引用 ${exampleCards.length} 条典型样例进行课堂讲评。` : "当前未返回典型样例。",
  ];
  const allSectionsEmpty =
    viewModel.data.actionItems.length === 0 &&
    topTagItems.length === 0 &&
    topTypeItems.length === 0 &&
    topSeverityItems.length === 0 &&
    exampleCards.length === 0 &&
    scriptCards.length === 0;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="课堂复盘包"
        description="先看课堂总览，再按行动建议、高频问题、典型样例组织课堂讲评。"
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              返回任务列表
            </Link>
            <Link
              href={paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              提交管理
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选条件</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>统计窗口:</span>
            {REVIEW_WINDOWS.map((windowValue) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {windowValue}（{WINDOW_LABELS[windowValue]}）
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span>展示条数:</span>
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
            <span>每类样例数:</span>
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

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">课堂总览</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {overviewMetricCards.map((card) => (
            <article key={card.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-medium text-zinc-600">{card.title}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-900">{card.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{card.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        隐私提示：复盘样例不包含敏感字段（如 codeText / prompt / apiKey）。
      </p>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">课堂结论 / 本次复盘摘要</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
          {summaryHighlights.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      </section>

      {allSectionsEmpty ? (
        <EmptyState title="暂无课堂复盘数据" description="当前查询条件下没有返回可展示的复盘内容。" />
      ) : (
        <>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">行动建议</h2>
            <p className="mt-1 text-xs text-zinc-500">建议按优先级逐条讲评，先覆盖人数最多的问题。</p>
            {viewModel.data.actionItems.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
                {viewModel.data.actionItems.slice(0, 5).map((item, index) => (
                  <li key={String(safeGet(item, "title", `action-${index}`))}>
                    <p className="font-medium text-zinc-900">{toDisplayText(safeGet(item, "title", undefined))}</p>
                    <p>原因：{toDisplayText(safeGet(item, "why", undefined), "—")}</p>
                    <p>讲评方式：{toDisplayText(safeGet(item, "how", undefined), "—")}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">暂无行动建议，可先参考下方高频问题组织讲评。</p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">高频问题概览</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-medium text-zinc-600">高频问题标签</p>
                {topTagItems.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {topTagItems.slice(0, viewModel.query.topK).map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-zinc-500">{typeof item.count === "number" ? item.count : "—"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-zinc-600">暂无标签数据。</p>
                )}
              </div>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-medium text-zinc-600">高频问题类型</p>
                {topTypeItems.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {topTypeItems.slice(0, viewModel.query.topK).map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-zinc-500">{typeof item.count === "number" ? item.count : "—"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-zinc-600">暂无类型数据。</p>
                )}
              </div>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-medium text-zinc-600">严重程度分布</p>
                {topSeverityItems.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {topSeverityItems.slice(0, viewModel.query.topK).map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-zinc-500">{typeof item.count === "number" ? item.count : "—"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-zinc-600">暂无严重程度数据。</p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">典型样例</h2>
            {exampleCards.length > 0 ? (
              <div className="mt-2 space-y-3">
                {exampleCards.slice(0, 10).map((item, index) => (
                  <article key={item.key} className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-zinc-900">样例 {index + 1}</p>
                      <p className="text-xs text-zinc-500">{typeof item.attemptNo === "number" ? `尝试次数：${item.attemptNo}` : "尝试次数：—"}</p>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">问题归类：{item.category}</p>
                    <p className="mt-2">
                      <span className="font-medium text-zinc-900">反馈摘要：</span>
                      {item.feedback}
                    </p>
                    {item.suggestion ? (
                      <p className="mt-1">
                        <span className="font-medium text-zinc-900">修改建议：</span>
                        {item.suggestion}
                      </p>
                    ) : null}
                    {item.context ? (
                      <p className="mt-1">
                        <span className="font-medium text-zinc-900">讲评提示：</span>
                        {item.context}
                      </p>
                    ) : null}
                    {item.source ? <p className="mt-1 text-xs text-zinc-500">来源：{item.source}</p> : null}
                  </article>
                ))}
                {exampleCards.length > 10 ? (
                  <p className="text-xs text-zinc-500">已展示前 10 条样例，可通过筛选条件缩小范围。</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">暂无典型样例。</p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">教学脚本</h2>
            {scriptCards.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
                {scriptCards.map((item) => {
                  const previewPoints = item.talkingPoints.slice(0, 3);
                  const remainingPoints = item.talkingPoints.slice(3);

                  return (
                    <li key={item.key}>
                      <p className="font-medium text-zinc-900">
                        {item.minute} · {item.topic}
                      </p>
                      {previewPoints.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {previewPoints.map((point, pointIndex) => (
                            <li key={`${item.key}-${pointIndex}`}>{point}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1">暂无讲评要点。</p>
                      )}
                      {remainingPoints.length > 0 ? (
                        <details className="mt-1 rounded border border-zinc-200 bg-zinc-50 p-2">
                          <summary className="cursor-pointer text-xs text-zinc-600">
                            展开更多讲评要点（+{remainingPoints.length}）
                          </summary>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {remainingPoints.map((point, pointIndex) => (
                              <li key={`${item.key}-more-${pointIndex}`}>{point}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {item.focusHint ? <p className="mt-1 text-xs text-zinc-500">讲评提示：{item.focusHint}</p> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">未提供教学脚本，建议先按行动建议与高频问题组织讲评。</p>
            )}
          </section>
        </>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700">查看原始数据（调试用）</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-600">{JSON.stringify(viewModel.data.raw, null, 2)}</pre>
      </details>
    </section>
  );
}
