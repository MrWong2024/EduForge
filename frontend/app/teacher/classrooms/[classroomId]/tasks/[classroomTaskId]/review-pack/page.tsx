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
  }>;
};

const REVIEW_WINDOWS = ["24h", "7d", "30d", "all"] as const;
const DISPLAY_REVIEW_WINDOWS = ["all", "7d"] as const;
type ReviewWindow = (typeof REVIEW_WINDOWS)[number];
type DisplayReviewWindow = (typeof DISPLAY_REVIEW_WINDOWS)[number];
const WINDOW_LABELS: Record<ReviewWindow, string> = {
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部",
};

type ReviewQueryState = {
  window: ReviewWindow;
  topK: number;
  examplesPerTag: number;
};

type AttemptDistributionItem = {
  key: string;
  label: string;
  count?: number;
};

type OverviewMetricCard = {
  key: string;
  title: string;
  value?: string;
  detail?: string;
  distributionItems?: AttemptDistributionItem[];
};

type IssueDistributionItem = {
  key: string;
  label: string;
  count?: number;
};

type ExampleCardView = {
  key: string;
  feedbackId?: string;
  submissionId?: string;
  primaryTag: string;
  matchedTags: string[];
  severity?: string;
  issueType?: string;
  message: string;
  suggestion?: string;
  source?: string;
  attemptNo?: number;
};

const STUDENT_TIER_PREVIEW_COUNT = 6;

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
  window: parseEnum(getSingleSearchParam(query.window), REVIEW_WINDOWS, "all"),
  topK: parsePositiveInt(getSingleSearchParam(query.topK), 10, { min: 1, max: 30 }),
  examplesPerTag: parsePositiveInt(getSingleSearchParam(query.examplesPerTag), 2, {
    min: 1,
    max: 5,
  }),
});

const toQueryRecord = (query: ReviewQueryState): Record<string, string> => ({
  window: query.window,
  topK: String(query.topK),
  examplesPerTag: String(query.examplesPerTag),
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

const buildSubmissionDetailHref = (
  submissionId: string | undefined,
  classroomId: string,
  classroomTaskId: string
): string | undefined => {
  if (!submissionId) {
    return undefined;
  }
  const query = buildQueryString({ classroomId, classroomTaskId });
  return `${paths.teacher.submissionDetail(submissionId)}?${query}`;
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
  const candidateValues: unknown[] = paths.map((path) => safeGet<unknown>(source, path, undefined));

  for (const value of candidateValues) {
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

const toExampleCards = (
  source: ReturnType<typeof toReviewPackResponse>["examples"]
): ExampleCardView[] =>
  source.map((item, index) => {
    const primaryTag = toOptionalText(item.primaryTag) ?? "未分类";
    const matchedTags = dedupeTexts([...toTextList(item.matchedTags), ...toTextList(item.tags)]).filter(
      (tag) => tag !== primaryTag
    );
    const feedbackId = toOptionalText(item.feedbackId);
    const submissionId = toOptionalText(item.submissionId);
    const suggestion = toOptionalText(item.suggestion);
    const key = feedbackId ?? submissionId ?? `example-${index + 1}`;

    return {
      key,
      feedbackId,
      submissionId,
      primaryTag,
      matchedTags,
      severity: toOptionalText(item.severity),
      issueType: toOptionalText(item.type),
      message: truncateText(toOptionalText(item.message) ?? "该样例未返回完整反馈文本。"),
      suggestion: suggestion ? truncateText(suggestion) : undefined,
      source: toOptionalText(item.source),
      attemptNo: typeof item.attemptNo === "number" ? item.attemptNo : undefined,
    };
  });

type StudentTierCardView = {
  key: string;
  title: string;
  description: string;
  students: Array<{
    key: string;
    studentId: string;
    studentName: string;
    studentNo?: string;
    attemptsCount?: number;
    latestErrorCount?: number;
    latestAiStatus?: string;
  }>;
};

type StudentTierStudentView = StudentTierCardView["students"][number];

const toStudentTierCard = (
  source: ReturnType<typeof toReviewPackResponse>["studentTiers"],
  key: "good" | "watch" | "notSubmitted",
  title: string,
  description: string
): StudentTierCardView => {
  const rows = source[key] ?? [];
  const students = rows.map((item, index) => {
    const studentId = toOptionalText(item.studentId) ?? `unknown-${key}-${index + 1}`;
    const studentName = toOptionalText(item.studentName) ?? "未知学生";
    const studentNo = toOptionalText(item.studentNo);
    return {
      key: `${key}-${studentId}-${index}`,
      studentId,
      studentName,
      studentNo,
      attemptsCount: typeof item.attemptsCount === "number" ? item.attemptsCount : undefined,
      latestErrorCount: typeof item.latestErrorCount === "number" ? item.latestErrorCount : undefined,
      latestAiStatus: toOptionalText(item.latestAiFeedbackStatus),
    };
  });

  return { key, title, description, students };
};

const buildStudentTierCards = (
  studentTiers: ReturnType<typeof toReviewPackResponse>["studentTiers"]
): StudentTierCardView[] => [
  toStudentTierCard(studentTiers, "good", "稳定完成", "完成情况较好，可作为正向参考。"),
  toStudentTierCard(studentTiers, "watch", "需要关注", "有提交但错误较多，建议课堂重点跟进。"),
  toStudentTierCard(studentTiers, "notSubmitted", "未提交", "当前窗口内未形成有效提交记录。"),
];

const renderStudentTierRow = (
  student: StudentTierStudentView,
  tierKey: StudentTierCardView["key"]
): React.ReactElement => (
  <li key={student.key} className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs">
    <p className="font-medium text-zinc-800">{student.studentName}</p>
    {student.studentNo ? <p className="text-zinc-500">学号：{student.studentNo}</p> : null}
    {tierKey !== "notSubmitted" ? (
      <p className="text-zinc-500">
        尝试：{typeof student.attemptsCount === "number" ? student.attemptsCount : "—"} · 最近错误：
        {typeof student.latestErrorCount === "number" ? student.latestErrorCount : "—"}
      </p>
    ) : null}
    {tierKey !== "notSubmitted" && student.latestAiStatus ? (
      <p className="text-zinc-500">AI：{student.latestAiStatus}</p>
    ) : null}
  </li>
);

const buildOverviewMetricCards = (
  overview: unknown,
  window: ReviewWindow,
  examplesCount: number
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
  const attemptDistributionItems: AttemptDistributionItem[] = [
    { key: "0", label: "0次", count: attemptZero },
    { key: "1", label: "1次", count: attemptOne },
    { key: "2", label: "2次", count: attemptTwo },
    { key: "3plus", label: "3+次", count: attemptThreePlus },
  ];
  const hasAttemptDistribution = attemptDistributionItems.some((item) => typeof item.count === "number");

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
      detail: "去重后样例池",
    },
    {
      key: "attempts",
      title: "尝试分布",
      distributionItems: attemptDistributionItems,
      detail: hasAttemptDistribution ? undefined : "暂无尝试分布数据",
    },
  ];
};

const buildSummaryHighlights = (
  overview: unknown,
  window: ReviewWindow,
  topTagItems: IssueDistributionItem[],
  examplesCount: number,
  studentTierCards: StudentTierCardView[]
): string[] => {
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
  const attemptThreePlus = pickNumber(overview, ["attemptsDistribution.3plus", "attemptsDistribution.3+"]);
  const attemptTwo = pickNumber(overview, ["attemptsDistribution.2"]);

  const coverageBase =
    typeof studentsCount === "number" && typeof submittedStudentsCount === "number"
      ? `当前窗口（${WINDOW_LABELS[window]}）提交覆盖 ${submittedStudentsCount}/${studentsCount}（提交率 ${toPercentText(submissionRateComputed)}）。`
      : `当前窗口（${WINDOW_LABELS[window]}）提交覆盖数据暂不完整。`;

  const coverageIteration =
    typeof attemptThreePlus === "number" && attemptThreePlus > 0
      ? `有 ${attemptThreePlus} 名学生达到 3 次及以上尝试，建议优先核查反复修改但仍未稳定通过的问题。`
      : typeof attemptTwo === "number" && attemptTwo > 0
        ? `有 ${attemptTwo} 名学生进行了 2 次尝试，课堂讲评可重点说明常见返工原因。`
        : "多数学生尝试次数处于稳定区间，可结合典型样例做集中讲评。";

  const topTag = topTagItems[0];
  const issueFocus = topTag
    ? `当前最值得优先讲评的方向是「${topTag.label}」${typeof topTag.count === "number" ? `（${topTag.count} 次）` : ""}，可直接结合 ${examplesCount} 条去重样例展开。`
    : examplesCount > 0
      ? `当前未形成明显的单一高频标签，可从 ${examplesCount} 条去重样例中挑选共性问题组织讲评。`
      : "当前未返回高频标签与典型样例，建议先结合提交管理页核查主要问题。";

  const goodCount = studentTierCards.find((card) => card.key === "good")?.students.length ?? 0;
  const watchCount = studentTierCards.find((card) => card.key === "watch")?.students.length ?? 0;
  const notSubmittedCount = studentTierCards.find((card) => card.key === "notSubmitted")?.students.length ?? 0;
  const tierTotal = goodCount + watchCount + notSubmittedCount;

  const tierFocus =
    tierTotal === 0
      ? "当前未返回有效学生分层数据。"
      : watchCount > 0 || notSubmittedCount > 0
        ? `学生分层显示：稳定完成 ${goodCount} 人、需要关注 ${watchCount} 人、未提交 ${notSubmittedCount} 人。`
        : `学生分层显示：当前窗口内学生整体处于稳定完成态（${goodCount} 人）。`;

  return [`${coverageBase}${coverageIteration}`, issueFocus, tierFocus];
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
  const studentTierCards = buildStudentTierCards(viewModel.data.studentTiers);
  const hasStudentTierData = studentTierCards.some((card) => card.students.length > 0);
  const overviewMetricCards = buildOverviewMetricCards(
    viewModel.data.overview,
    viewModel.query.window,
    exampleCards.length
  );
  const summaryHighlights = buildSummaryHighlights(
    viewModel.data.overview,
    viewModel.query.window,
    topTagItems,
    exampleCards.length,
    studentTierCards
  );
  const allSectionsEmpty =
    topTagItems.length === 0 &&
    topTypeItems.length === 0 &&
    topSeverityItems.length === 0 &&
    exampleCards.length === 0 &&
    !hasStudentTierData;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="课堂复盘包"
        description="先看课堂总览，再按高频问题、典型样例与学生分层完成课堂复盘判断。"
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
            {DISPLAY_REVIEW_WINDOWS.map((windowValue: DisplayReviewWindow) => {
              const active = windowValue === viewModel.query.window;
              return (
                <Link
                  key={windowValue}
                  href={buildHref(routePath, queryRecord, { window: windowValue })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {WINDOW_LABELS[windowValue]}
                </Link>
              );
            })}
            <span className="text-zinc-500">当前：{WINDOW_LABELS[viewModel.query.window]}</span>
          </div>

          <div className="flex items-center gap-2">
            <span>问题榜单条数:</span>
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
            <span>每标签候选样例数:</span>
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

        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">课堂总览</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {overviewMetricCards.map((card) => (
            <article key={card.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-medium text-zinc-600">{card.title}</p>
              {card.distributionItems ? (
                <>
                  <div className="mt-2 space-y-1.5">
                    {(() => {
                      const maxCount = card.distributionItems.reduce((max, item) => {
                        const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
                        return count > max ? count : max;
                      }, 0);

                      return card.distributionItems.map((item) => {
                        const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
                        const fillPercent = maxCount > 0 ? Math.max((count / maxCount) * 100, 6) : 6;

                        return (
                          <div key={item.key} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-xs">
                            <span className="text-zinc-600">{item.label}</span>
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                              <div
                                className="h-full rounded-full bg-zinc-500"
                                style={{ width: `${fillPercent}%` }}
                                aria-hidden="true"
                              />
                            </div>
                            <span className="text-right font-medium text-zinc-700">
                              {typeof item.count === "number" ? `${item.count}人` : "—"}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                  {card.detail ? <p className="mt-1 text-xs text-zinc-500">{card.detail}</p> : null}
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold text-zinc-900">{card.value ?? "—"}</p>
                  <p className="mt-1 text-xs text-zinc-500">{card.detail ?? "—"}</p>
                </>
              )}
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
            <h2 className="text-sm font-semibold text-zinc-900">典型样例（已去重）</h2>
            {exampleCards.length > 0 ? (
              <div className="mt-2 space-y-3">
                {exampleCards.slice(0, 10).map((item, index) => {
                  const submissionHref = buildSubmissionDetailHref(
                    item.submissionId,
                    classroomId,
                    classroomTaskId
                  );
                  return (
                    <article key={item.key} className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-zinc-900">样例 {index + 1}</p>
                        <p className="text-xs text-zinc-500">
                          {typeof item.attemptNo === "number" ? `尝试次数：${item.attemptNo}` : "尝试次数：—"}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">主标签：{item.primaryTag}</p>
                      {item.matchedTags.length > 0 ? (
                        <p className="mt-1 text-xs text-zinc-500">其他命中标签：{item.matchedTags.join(" / ")}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-zinc-500">
                        严重程度：{item.severity ?? "—"} · 类型：{item.issueType ?? "—"}
                        {item.source ? ` · 来源：${item.source}` : ""}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium text-zinc-900">反馈内容：</span>
                        {item.message}
                      </p>
                      {item.suggestion ? (
                        <p className="mt-1">
                          <span className="font-medium text-zinc-900">修改建议：</span>
                          {item.suggestion}
                        </p>
                      ) : null}
                      {submissionHref ? (
                        <Link href={submissionHref} className="mt-2 inline-block text-xs text-blue-700 hover:underline">
                          查看对应提交
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
                {exampleCards.length > 10 ? (
                  <p className="text-xs text-zinc-500">已展示前 10 条样例，可通过筛选条件缩小范围。</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">暂无典型样例。</p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">学生分层</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {studentTierCards.map((tierCard) => (
                <article key={tierCard.key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  <p className="font-medium text-zinc-900">
                    {tierCard.title}（{tierCard.students.length}）
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{tierCard.description}</p>
                  {tierCard.students.length > 0 ? (
                    <>
                      <ul className="mt-2 space-y-1">
                        {tierCard.students
                          .slice(0, STUDENT_TIER_PREVIEW_COUNT)
                          .map((student) => renderStudentTierRow(student, tierCard.key))}
                      </ul>
                      {tierCard.students.length > STUDENT_TIER_PREVIEW_COUNT ? (
                        <details className="group mt-2">
                          <summary className="cursor-pointer text-xs text-blue-700 hover:underline">
                            <span className="group-open:hidden">展开全部</span>
                            <span className="hidden group-open:inline">收起</span>
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {tierCard.students
                              .slice(STUDENT_TIER_PREVIEW_COUNT)
                              .map((student) => renderStudentTierRow(student, tierCard.key))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-600">当前分组暂无学生。</p>
                  )}
                </article>
              ))}
            </div>
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
