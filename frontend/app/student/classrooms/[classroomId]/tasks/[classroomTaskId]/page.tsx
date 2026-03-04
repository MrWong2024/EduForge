import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiProcessingHint } from "@/components/student/AiProcessingHint";
import { SubmissionForm } from "@/components/student/SubmissionForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toMyTaskDetailResponse } from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
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

const extractRawDetail = (error: FetchJsonError): string | undefined => {
  if (typeof error.data === "string" && error.data.trim()) {
    return error.data;
  }

  if (!error.data || typeof error.data !== "object") {
    return undefined;
  }

  const message =
    "message" in error.data && typeof (error.data as { message?: unknown }).message === "string"
      ? String((error.data as { message: string }).message)
      : "";
  const code =
    "code" in error.data && typeof (error.data as { code?: unknown }).code === "string"
      ? String((error.data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

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

const toAiStatusLabel = (status?: string): string => {
  if (!status) {
    return "暂无状态";
  }

  if (status === "NOT_REQUESTED") {
    return "NOT_REQUESTED（未请求/策略未触发，正常）";
  }

  return status;
};

const toAiStatusDescription = (status?: string): string | null => {
  if (!status) {
    return null;
  }

  if (status === "NOT_REQUESTED") {
    return "当前为正常未请求状态。如需 AI 反馈，请进入提交详情后点击“请求 AI 反馈”。";
  }

  if (status === "PENDING") {
    return "AI 反馈已进入队列，正在等待处理。";
  }

  if (status === "RUNNING") {
    return "AI 反馈正在处理中，通常需要一点时间。";
  }

  return null;
};

const isProcessingAiStatus = (status?: string): boolean =>
  status === "PENDING" || status === "RUNNING";

const buildSubmissionFeedbackHref = (submissionId: string, aiStatus?: string): string => {
  const basePath = paths.student.submissionDetail(submissionId);
  if (!aiStatus) {
    return basePath;
  }

  const query = new URLSearchParams({ status: aiStatus });
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
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限访问该任务详情。",
        404: "任务详情功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载任务详情失败，请稍后重试。";

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
  const dueAt = safeGet<string | null>(viewModel.data.classroomTask, "dueAt", null);
  const allowLate = safeGet<boolean | null>(viewModel.data.classroomTask, "settings.allowLate", null);
  const latestRawStatus = safeGet<string | undefined>(viewModel.data.latest, "aiFeedbackStatus", undefined);
  const latestStatus = toAiStatusLabel(latestRawStatus);
  const latestStatusDescription = toAiStatusDescription(latestRawStatus);
  const latestSubmissionId = safeGet<string | undefined>(viewModel.data.latest, "submissionId", undefined);
  const latestSubmissionHref = latestSubmissionId
    ? buildSubmissionFeedbackHref(latestSubmissionId, latestRawStatus)
    : null;

  return (
    <section className="space-y-4">
      <PageHeader
        title={taskTitle}
        description={`班级 ID: ${classroomId} | 课堂任务 ID: ${classroomTaskId}`}
        actions={
          <Link href={paths.student.dashboard} className="text-sm text-blue-700 hover:underline">
            返回学习看板
          </Link>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="grid gap-2 md:grid-cols-3">
          <p>截止时间：{toDisplayDate(dueAt)}</p>
          <p>允许迟交：{toDisplayText(allowLate)}</p>
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

      <AiProcessingHint status={latestRawStatus} variant="taskDetail" helpHref={paths.student.aiHelp} />

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
                <th className="px-4 py-3">提交 ID</th>
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
                  ? buildSubmissionFeedbackHref(submissionId, submissionAiStatus)
                  : null;

                return (
                  <tr
                    key={String(submissionId ?? `submission-${index}`)}
                    className="border-t border-zinc-100"
                  >
                    <td className="px-4 py-3">{toDisplayText(submissionId)}</td>
                    <td className="px-4 py-3">{toDisplayText(safeGet(submission, "attemptNo", undefined))}</td>
                    <td className="px-4 py-3">
                      {toDisplayDate(safeGet<string | null>(submission, "createdAt", null))}
                    </td>
                    <td className="px-4 py-3">{toAiStatusLabel(submissionAiStatus)}</td>
                    <td className="px-4 py-3">
                      {feedbackHref ? (
                        <Link href={feedbackHref} className="text-blue-700 hover:underline">
                          查看反馈
                        </Link>
                      ) : (
                        <span className="text-zinc-500">缺少 submissionId</span>
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
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始任务详情 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
