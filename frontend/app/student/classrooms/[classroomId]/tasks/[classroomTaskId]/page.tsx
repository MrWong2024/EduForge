import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiProcessingHint } from "@/components/student/AiProcessingHint";
import { SubmissionAutoRefresh } from "@/components/student/SubmissionAutoRefresh";
import { SubmissionForm } from "@/components/student/SubmissionForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import type { StudentTaskCompletionStatus } from "@/lib/api/types-student";
import { toMyTaskDetailResponse } from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getRubricDimensionLabel } from "@/lib/ui/rubric";
import { getAiStatusHint, getCommonErrorSummary } from "@/lib/ui/status";
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

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

type StatusBadgeView = {
  label: string;
  title: string;
  tone: BadgeTone;
};

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
};

const StatusBadge = ({ badge }: { badge: StatusBadgeView }) => (
  <span
    title={badge.title}
    className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${badgeToneClasses[badge.tone]}`}
  >
    {badge.label}
  </span>
);

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
  query: Awaited<StudentTaskDetailPageProps["searchParams"]>,
): TaskDetailQueryState => ({
  includeFeedbackItems: parseBool01(
    getSingleSearchParam(query.includeFeedbackItems),
    true,
  ),
  feedbackLimit: parsePositiveInt(
    getSingleSearchParam(query.feedbackLimit),
    5,
    {
      min: 1,
      max: 20,
    },
  ),
});

const toQueryRecord = (
  query: TaskDetailQueryState,
): Record<string, string> => ({
  includeFeedbackItems: String(query.includeFeedbackItems),
  feedbackLimit: String(query.feedbackLimit),
});

const buildHref = (
  basePath: string,
  currentParams: Record<string, string>,
  nextParams: Partial<Record<string, string | undefined>>,
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

const READ_ONLY_FALLBACK_MESSAGE =
  "该任务当前仅可查看历史提交与反馈，不能继续提交或请求 AI 反馈。";

const toAiStatusDescription = (
  status: string | undefined,
  canRequestAiByStatus: boolean,
  readOnlyMessage: string,
): string | null => {
  const hint = getAiStatusHint(status);
  if (!status || hint === "当前暂无 AI 状态。") {
    return null;
  }
  if (status === "NOT_REQUESTED") {
    if (!canRequestAiByStatus) {
      return readOnlyMessage;
    }
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

const getAiFeedbackStatusBadge = (
  status: unknown,
  hasLatestSubmission: boolean,
): StatusBadgeView => {
  if (!hasLatestSubmission) {
    return {
      label: "未提交",
      title: "尚未提交该任务",
      tone: "neutral",
    };
  }

  const normalized = normalizeAiStatus(status);
  if (normalized === "NOT_REQUESTED") {
    return {
      label: "未请求",
      title: "该提交尚未请求 AI 反馈",
      tone: "neutral",
    };
  }
  if (normalized === "PENDING") {
    return { label: "排队中", title: "AI 反馈正在排队生成", tone: "info" };
  }
  if (normalized === "RUNNING") {
    return { label: "生成中", title: "AI 反馈正在生成", tone: "info" };
  }
  if (normalized === "SUCCEEDED") {
    return { label: "已生成", title: "AI 反馈已生成", tone: "success" };
  }
  if (normalized === "FAILED") {
    return { label: "生成失败", title: "AI 反馈生成失败", tone: "danger" };
  }
  if (normalized === "DEAD") {
    return { label: "已终止", title: "AI 反馈任务已终止", tone: "neutral" };
  }

  return {
    label: "未知状态",
    title:
      typeof status === "string" && status.trim()
        ? `未知 AI 状态：${status}`
        : "该提交暂无 AI 状态",
    tone: "neutral",
  };
};

const getCompletionSourceLabel = (
  source: StudentTaskCompletionStatus["source"],
): string => {
  if (source === "TEACHER") {
    return "教师反馈";
  }
  if (source === "AI") {
    return "AI 反馈";
  }
  return "反馈";
};

const getCompletionStatusBadge = (
  completionStatus: StudentTaskCompletionStatus | null | undefined,
  hasLatestSubmission: boolean,
): StatusBadgeView => {
  if (!completionStatus) {
    return hasLatestSubmission
      ? {
          label: "暂无结论",
          title: "当前响应暂无完成情况结论，请稍后刷新或等待反馈生成",
          tone: "neutral",
        }
      : {
          label: "未提交",
          title: "尚未提交该任务",
          tone: "neutral",
        };
  }

  const sourceLabel = getCompletionSourceLabel(completionStatus.source);
  if (completionStatus.status === "NOT_SUBMITTED") {
    return { label: "未提交", title: "尚未提交该任务", tone: "neutral" };
  }
  if (completionStatus.status === "NO_FEEDBACK") {
    return {
      label: "暂无反馈",
      title: "最新提交暂无教师或 AI 反馈",
      tone: "neutral",
    };
  }
  if (completionStatus.status === "QUALIFIED") {
    return {
      label: "已合格",
      title: `${sourceLabel}判定为合格`,
      tone: "success",
    };
  }
  if (completionStatus.status === "QUALIFIED_WITH_WARNINGS") {
    return {
      label: "基本合格",
      title: `${sourceLabel}提示仍有改进点`,
      tone: "warning",
    };
  }

  return {
    label: "不合格",
    title: `${sourceLabel}判定为不合格`,
    tone: "danger",
  };
};

const toTaskDetailAutoRefreshStatuses = (
  latestStatus: string | undefined,
  submissions: unknown[],
): Array<string | undefined> => {
  const statuses: Array<string | undefined> = [latestStatus];
  for (const submission of submissions) {
    statuses.push(
      safeGet<string | undefined>(submission, "aiFeedbackStatus", undefined),
    );
  }
  return statuses;
};

const resolveTaskDetailAutoRefreshStatus = (
  statuses: Array<string | undefined>,
): "PENDING" | "RUNNING" | "FAILED" | undefined => {
  let hasPending = false;
  let hasRunning = false;
  let hasFailed = false;

  for (const status of statuses) {
    const normalized = normalizeAiStatus(status);
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

const toRubricDimensions = (
  rubric: unknown,
): Array<{ key: string; value: string }> => {
  if (!rubric || typeof rubric !== "object" || Array.isArray(rubric)) {
    return [];
  }

  const dimensionsRaw = safeGet<unknown>(rubric, "dimensions", undefined);
  if (
    !dimensionsRaw ||
    typeof dimensionsRaw !== "object" ||
    Array.isArray(dimensionsRaw)
  ) {
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
  classroomTaskId: string,
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
        classroomTaskId,
      )}/my-task-detail?${queryString}`,
      {
        origin,
        cache: "no-store",
      },
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
    return (
      <ErrorState
        status={viewModel.status}
        title="任务详情加载失败"
        description={viewModel.description}
      />
    );
  }

  const routePath = paths.student.taskDetail(classroomId, classroomTaskId);
  const queryRecord = toQueryRecord(viewModel.query);
  const taskTitle = toDisplayText(
    safeGet(viewModel.data.task, "title", undefined),
    "任务详情",
  );
  const classroomName = toDisplayText(
    safeGet(viewModel.data.classroom, "name", undefined),
    "当前班级",
  );
  const publishedAt = safeGet<string | null>(
    viewModel.data.classroomTask,
    "publishedAt",
    null,
  );
  const dueAt = safeGet<string | null>(
    viewModel.data.classroomTask,
    "dueAt",
    null,
  );
  const allowLate = safeGet<boolean | null>(
    viewModel.data.classroomTask,
    "settings.allowLate",
    null,
  );
  const knowledgeModule = toDisplayText(
    safeGet(viewModel.data.task, "knowledgeModule", undefined),
    "当前未设置知识模块",
  );
  const stageText = toStageText(
    safeGet(viewModel.data.task, "stage", undefined),
  );
  const description = toDisplayText(
    safeGet(viewModel.data.task, "description", undefined),
    "当前未提供任务说明",
  );
  const rubric = asRecord(
    safeGet<unknown>(viewModel.data.task, "rubric", undefined),
  );
  const rubricDimensions = toRubricDimensions(rubric);
  const rubricNotes = toDisplayText(
    safeGet<unknown>(rubric, "notes", undefined),
    "",
  );
  const hasRubricContent = rubricDimensions.length > 0 || Boolean(rubricNotes);
  const latestRawStatus = safeGet<string | undefined>(
    viewModel.data.latest,
    "aiFeedbackStatus",
    undefined,
  );
  const hasLatestSubmission = Boolean(viewModel.data.latest);
  const latestStatusBadge = getAiFeedbackStatusBadge(
    latestRawStatus,
    hasLatestSubmission,
  );
  const completionStatusBadge = getCompletionStatusBadge(
    viewModel.data.completionStatus,
    hasLatestSubmission,
  );
  const participationStatus = viewModel.data.participationStatus;
  const readOnly = participationStatus?.readOnly === true;
  const canSubmitByStatus =
    !readOnly && participationStatus?.canSubmit !== false;
  const canRequestAiByStatus =
    !readOnly && participationStatus?.canRequestAiFeedback !== false;
  const readOnlyMessage =
    participationStatus?.message ?? READ_ONLY_FALLBACK_MESSAGE;
  const latestStatusDescription = toAiStatusDescription(
    latestRawStatus,
    canRequestAiByStatus,
    readOnlyMessage,
  );
  const latestSubmissionId = safeGet<string | undefined>(
    viewModel.data.latest,
    "submissionId",
    undefined,
  );
  const latestSubmissionHref = latestSubmissionId
    ? buildSubmissionFeedbackHref(
        latestSubmissionId,
        classroomId,
        classroomTaskId,
      )
    : null;
  const autoRefreshStatuses = toTaskDetailAutoRefreshStatuses(
    latestRawStatus,
    viewModel.data.submissions,
  );
  const autoRefreshStatus =
    resolveTaskDetailAutoRefreshStatus(autoRefreshStatuses);
  const isAutoRefreshing = Boolean(autoRefreshStatus);

  return (
    <section className="space-y-4">
      <PageHeader
        title={taskTitle}
        description={classroomName}
        actions={
          <div className="flex items-center gap-3 text-sm">
            {latestSubmissionHref ? (
              <Link
                href={latestSubmissionHref}
                className="text-blue-700 hover:underline"
              >
                查看提交反馈
              </Link>
            ) : null}
            <Link
              href={paths.student.dashboard}
              className="text-blue-700 hover:underline"
            >
              返回学习看板
            </Link>
            <Link
              href={paths.student.aiHelp}
              className="text-blue-700 hover:underline"
            >
              AI 帮助
            </Link>
          </div>
        }
      />

      {readOnly ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">当前为只读模式</p>
          <p className="mt-1">{readOnlyMessage}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-zinc-900">任务基础信息</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <p>发布时间：{toDisplayDateOrFallback(publishedAt)}</p>
          <p>截止时间：{toDisplayDateOrFallback(dueAt)}</p>
          <p>是否允许迟交：{toAllowLateText(allowLate)}</p>
          <p>知识模块：{knowledgeModule}</p>
          <p>阶段：{stageText}</p>
          <p className="flex items-center gap-2">
            <span>最新 AI 状态：</span>
            <StatusBadge badge={latestStatusBadge} />
          </p>
          <p className="flex items-center gap-2">
            <span>完成情况：</span>
            <StatusBadge badge={completionStatusBadge} />
          </p>
        </div>
        {latestSubmissionHref ? (
          <p className="mt-2 text-sm text-zinc-700">
            最新提交反馈：
            <Link
              href={latestSubmissionHref}
              className="ml-1 text-blue-700 hover:underline"
            >
              查看反馈
            </Link>
          </p>
        ) : null}
        {latestStatusDescription ? (
          <p className="mt-2 text-sm text-zinc-700">
            {latestStatusDescription}
          </p>
        ) : null}
        {isAutoRefreshing ? (
          <p className="mt-2 text-sm text-zinc-700">
            AI 状态更新中，页面会自动刷新。
          </p>
        ) : null}
        {isProcessingAiStatus(latestRawStatus) ? (
          <p className="mt-2 text-sm text-zinc-700">
            若等待时间较长，可先查看
            <Link
              href={paths.student.aiHelp}
              className="ml-1 text-blue-700 hover:underline"
            >
              AI 反馈帮助
            </Link>
            。
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-zinc-900">任务说明</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-zinc-700">
          {description}
        </p>
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
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {rubricNotes}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-zinc-700">当前未提供评分标准说明</p>
        )}
      </section>

      <AiProcessingHint
        status={latestRawStatus}
        variant="taskDetail"
        helpHref={paths.student.aiHelp}
      />
      <SubmissionAutoRefresh statuses={autoRefreshStatuses} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">参数</p>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-zinc-700">
          <div className="flex items-center gap-2">
            <span>反馈明细:</span>
            <Link
              href={buildHref(routePath, queryRecord, {
                includeFeedbackItems: String(
                  !viewModel.query.includeFeedbackItems,
                ),
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
                  className={
                    active
                      ? "font-semibold text-blue-700"
                      : "text-blue-700 hover:underline"
                  }
                >
                  {limitValue}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {canSubmitByStatus ? (
        <SubmissionForm
          classroomId={classroomId}
          classroomTaskId={classroomTaskId}
        />
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-900">提交作业</h2>
          <p className="mt-2 text-zinc-600">{readOnlyMessage}</p>
          <button
            type="button"
            disabled
            title={readOnlyMessage}
            className="mt-3 rounded-md bg-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 disabled:cursor-not-allowed"
          >
            提交作业
          </button>
        </section>
      )}

      {viewModel.data.submissions.length === 0 ? (
        <EmptyState
          title="暂无提交记录"
          description="完成作业提交后，记录会显示在这里。"
        />
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
                const submissionId = safeGet<string | undefined>(
                  submission,
                  "id",
                  undefined,
                );
                const submissionAiStatus = safeGet<string | undefined>(
                  submission,
                  "aiFeedbackStatus",
                  undefined,
                );
                const submissionAiStatusBadge = getAiFeedbackStatusBadge(
                  submissionAiStatus,
                  true,
                );
                const feedbackHref = submissionId
                  ? buildSubmissionFeedbackHref(
                      submissionId,
                      classroomId,
                      classroomTaskId,
                    )
                  : null;

                return (
                  <tr
                    key={String(submissionId ?? `submission-${index}`)}
                    className="border-t border-zinc-100"
                  >
                    <td className="px-4 py-3">
                      {toDisplayText(
                        safeGet(submission, "attemptNo", undefined),
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {toDisplayDate(
                        safeGet<string | null>(submission, "createdAt", null),
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge badge={submissionAiStatusBadge} />
                    </td>
                    <td className="px-4 py-3">
                      {feedbackHref ? (
                        <Link
                          href={feedbackHref}
                          className="text-blue-700 hover:underline"
                        >
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
