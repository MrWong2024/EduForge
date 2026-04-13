import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiProcessingHint } from "@/components/student/AiProcessingHint";
import { SubmissionAutoRefresh } from "@/components/student/SubmissionAutoRefresh";
import { SubmissionForm } from "@/components/student/SubmissionForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toMyTaskDetailResponse } from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getRubricDimensionLabel } from "@/lib/ui/rubric";
import { getAiStatusHint, getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  parsePositiveInt,
  safeGet,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type StudentTaskDetailPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
  searchParams: Promise<{
    includeFeedbackItems?: string | string[];
    feedbackLimit?: string | string[];
  }>;
};

type TaskDetailQueryState = {
  includeFeedbackItems: boolean;
  feedbackLimit: number;
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
  query: Awaited<StudentTaskDetailPageProps["searchParams"]>
): TaskDetailQueryState => ({
  includeFeedbackItems: parseBool01(getSingleSearchParam(query.includeFeedbackItems), true),
  feedbackLimit: parsePositiveInt(getSingleSearchParam(query.feedbackLimit), 5, {
    min: 1,
    max: 20,
  }),
});

const toQueryRecord = (query: TaskDetailQueryState): Record<string, string> => ({
  includeFeedbackItems: String(query.includeFeedbackItems),
  feedbackLimit: String(query.feedbackLimit),
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

const toAiStatusDescription = (status?: string): string | null => {
  const hint = getAiStatusHint(status);
  if (!status || hint === "当前暂无 AI 状态。") {
    return null;
  }
  if (status === "NOT_REQUESTED") {
    return "当前为正常未请求状态。如需 AI 反馈，请进入提交详情后点击“请求 AI 反馈”。";
  }
  return hint;
};

const isProcessingAiStatus = (status?: string): boolean =>
  status === "PENDING" || status === "RUNNING";

const normalizeAiStatus = (status: unknown): string | null => {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return normalized || null;
};

const resolveTaskDetailAutoRefreshStatus = (
  submissions: unknown[]
): "PENDING" | "RUNNING" | "FAILED" | undefined => {
  let hasPending = false;
  let hasRunning = false;
  let hasFailed = false;

  for (const submission of submissions) {
    const normalized = normalizeAiStatus(safeGet(submission, "aiFeedbackStatus", undefined));
    if (normalized === "PENDING") {
      hasPending = true;
      continue;
    }
    if (normalized === "RUNNING") {
      hasRunning = true;
      continue;
    }
    if (normalized === "FAILED") {
      hasFailed = true;
    }
  }

  if (hasRunning) {
    return "RUNNING";
  }
  if (hasPending) {
    return "PENDING";
  }
  if (hasFailed) {
    return "FAILED";
  }
  return undefined;
};

const toDisplayDateOrFallback = (value?: string | null): string => {
  const displayDate = toDisplayDate(value);
  return displayDate === "—" ? "未设置" : displayDate;
};

const toAllowLateText = (value: boolean | null): string => {
  if (value === true) {
    return "允许";
  }
  if (value === false) {
    return "不允许";
  }
  return "未设置";
};

const toStageText = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `阶段 ${value}`;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? `阶段 ${trimmed}` : trimmed;
  }
  return "当前未设置阶段";
};

const toRubricDimensions = (rubric: unknown): Array<{ key: string; value: string }> => {
  if (!rubric || typeof rubric !== "object" || Array.isArray(rubric)) {
    return [];
  }

  const dimensionsRaw = safeGet<unknown>(rubric, "dimensions", undefined);
  if (!dimensionsRaw || typeof dimensionsRaw !== "object" || Array.isArray(dimensionsRaw)) {
    return [];
  }

  return Object.entries(dimensionsRaw as Record<string, unknown>)
    .map(([rawKey, rawValue]) => {
      const key = rawKey.trim();
      const value = toDisplayText(rawValue, "");
      if (!key || !value) {
        return null;
      }
      return {
        key: getRubricDimensionLabel(key),
        value,
      };
    })
    .filter((item): item is { key: string; value: string } => Boolean(item));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const buildSubmissionFeedbackHref = (
  submissionId: string,
  classroomId: string,
  classroomTaskId: string
): string => {
  const basePath = paths.student.submissionDetail(submissionId);
  const query = new URLSearchParams({
    classroomId,
    classroomTaskId,
  });
  return `${basePath}?${query.toString()}`;
};

type TaskDetailViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toMyTaskDetailResponse>;
      query: TaskDetailQueryState;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function StudentTaskDetailPage({
  params,
  searchParams,
}: StudentTaskDetailPageProps) {
  const { classroomId, classroomTaskId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const queryString = buildQueryString(toQueryRecord(queryState));

  let viewModel: TaskDetailViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务详情失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(
        classroomTaskId
      )}/my-task-detail?${queryString}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      data: toMyTaskDetailResponse(payload),
      query: queryState,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问该任务详情。"
          : getCommonErrorSummary(error.status, "加载任务详情");

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return <ErrorState status={viewModel.status} title="任务详情加载失败" description={viewModel.description} />;
  }

  const routePath = paths.student.taskDetail(classroomId, classroomTaskId);
  const queryRecord = toQueryRecord(viewModel.query);
  const taskTitle = toDisplayText(safeGet(viewModel.data.task, "title", undefined), "任务详情");
  const classroomName = toDisplayText(safeGet(viewModel.data.classroom, "name", undefined), "当前班级");
  const publishedAt = safeGet<string | null>(viewModel.data.classroomTask, "publishedAt", null);
  const dueAt = safeGet<string | null>(viewModel.data.classroomTask, "dueAt", null);
  const allowLate = safeGet<boolean | null>(viewModel.data.classroomTask, "settings.allowLate", null);
  const knowledgeModule = toDisplayText(
    safeGet(viewModel.data.task, "knowledgeModule", undefined),
    "当前未设置知识模块"
  );
  const stageText = toStageText(safeGet(viewModel.data.task, "stage", undefined));
  const description = toDisplayText(
    safeGet(viewModel.data.task, "description", undefined),
    "当前未提供任务说明"
  );
  const rubric = asRecord(safeGet<unknown>(viewModel.data.task, "rubric", undefined));
  const rubricDimensions = toRubricDimensions(rubric);
  const rubricNotes = toDisplayText(safeGet<unknown>(rubric, "notes", undefined), "");
  const hasRubricContent = rubricDimensions.length > 0 || Boolean(rubricNotes);
  const latestRawStatus = safeGet<string | undefined>(viewModel.data.latest, "aiFeedbackStatus", undefined);
  const latestStatus = getAiStatusLabel(latestRawStatus);
  const latestStatusDescription = toAiStatusDescription(latestRawStatus);
  const latestSubmissionId = safeGet<string | undefined>(viewModel.data.latest, "submissionId", undefined);
  const latestSubmissionHref = latestSubmissionId
    ? buildSubmissionFeedbackHref(latestSubmissionId, classroomId, classroomTaskId)
    : null;
  const autoRefreshStatus = resolveTaskDetailAutoRefreshStatus(viewModel.data.submissions);
  const isAutoRefreshing = Boolean(autoRefreshStatus);

  return (
    <section className="space-y-4">
      <PageHeader
        title={taskTitle}
        description={classroomName}
        actions={
          <div className="flex items-center gap-3 text-sm">
            {latestSubmissionHref ? (
              <Link href={latestSubmissionHref} className="text-blue-700 hover:underline">
                查看提交反馈
              </Link>
            ) : null}
            <Link href={paths.student.dashboard} className="text-blue-700 hover:underline">
              返回学习看板
            </Link>
            <Link href={paths.student.aiHelp} className="text-blue-700 hover:underline">
              AI 帮助
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-zinc-900">任务基础信息</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <p>发布时间：{toDisplayDateOrFallback(publishedAt)}</p>
          <p>截止时间：{toDisplayDateOrFallback(dueAt)}</p>
          <p>是否允许迟交：{toAllowLateText(allowLate)}</p>
          <p>知识模块：{knowledgeModule}</p>
          <p>阶段：{stageText}</p>
          <p>最新 AI 状态：{latestStatus}</p>
        </div>
        {latestSubmissionHref ? (
          <p className="mt-2 text-sm text-zinc-700">
            最新提交反馈：
            <Link href={latestSubmissionHref} className="ml-1 text-blue-700 hover:underline">
              查看反馈
            </Link>
          </p>
        ) : null}
        {latestStatusDescription ? <p className="mt-2 text-sm text-zinc-700">{latestStatusDescription}</p> : null}
        {isAutoRefreshing ? (
          <p className="mt-2 text-sm text-zinc-700">AI 状态更新中，页面会自动刷新。</p>
        ) : null}
        {isProcessingAiStatus(latestRawStatus) ? (
          <p className="mt-2 text-sm text-zinc-700">
            若等待时间较长，可先查看
            <Link href={paths.student.aiHelp} className="ml-1 text-blue-700 hover:underline">
              AI 反馈帮助
            </Link>
            。
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-zinc-900">任务说明</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-zinc-700">{description}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-zinc-900">评分标准</h2>
        {hasRubricContent ? (
          <div className="mt-3 space-y-3 text-zinc-700">
            {rubricDimensions.length > 0 ? (
              <div>
                <p className="font-medium text-zinc-900">评分维度</p>
                <ul className="mt-2 space-y-1">
                  {rubricDimensions.map((dimension, index) => (
                    <li key={`${dimension.key}-${index}`}>
                      {dimension.key}：{dimension.value}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {rubricNotes ? (
              <div>
                <p className="font-medium text-zinc-900">评分说明</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{rubricNotes}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-zinc-700">当前未提供评分标准说明</p>
        )}
      </section>

      <AiProcessingHint status={latestRawStatus} variant="taskDetail" helpHref={paths.student.aiHelp} />
      <SubmissionAutoRefresh status={autoRefreshStatus} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">参数</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>反馈明细:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeFeedbackItems: String(!viewModel.query.includeFeedbackItems),
              })}
              className="text-blue-700 hover:underline"
            >
              {viewModel.query.includeFeedbackItems ? "开" : "关"}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span>反馈条数:</span>
            {[3, 5, 10, 20].map((limitValue) => {
              const active = limitValue === viewModel.query.feedbackLimit;
              return (
                <Link
                  key={limitValue}
                  href={buildHref(routePath, queryRecord, {
                    feedbackLimit: String(limitValue),
                  })}
                  className={active ? "font-semibold text-blue-700" : "text-blue-700 hover:underline"}
                >
                  {limitValue}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <SubmissionForm classroomId={classroomId} classroomTaskId={classroomTaskId} />

      {viewModel.data.submissions.length === 0 ? (
        <EmptyState title="暂无提交记录" description="完成作业提交后，记录会显示在这里。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">尝试次数</th>
                <th className="px-4 py-3">提交时间</th>
                <th className="px-4 py-3">AI 状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.data.submissions.map((submission, index) => {
                const submissionId = safeGet<string | undefined>(submission, "id", undefined);
                const submissionAiStatus = safeGet<string | undefined>(
                  submission,
                  "aiFeedbackStatus",
                  undefined
                );
                const feedbackHref = submissionId
                  ? buildSubmissionFeedbackHref(submissionId, classroomId, classroomTaskId)
                  : null;

                return (
                  <tr
                    key={String(submissionId ?? `submission-${index}`)}
                    className="border-t border-zinc-100"
                  >
                    <td className="px-4 py-3">{toDisplayText(safeGet(submission, "attemptNo", undefined))}</td>
                    <td className="px-4 py-3">
                      {toDisplayDate(safeGet<string | null>(submission, "createdAt", null))}
                    </td>
                    <td className="px-4 py-3">{getAiStatusLabel(submissionAiStatus)}</td>
                    <td className="px-4 py-3">
                      {feedbackHref ? (
                        <Link href={feedbackHref} className="text-blue-700 hover:underline">
                          查看反馈
                        </Link>
                      ) : (
                        <span className="text-zinc-500">缺少提交标识</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始数据（调试用）
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
