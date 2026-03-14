import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { AiProcessingHint } from "@/components/student/AiProcessingHint";
import { RequestAiFeedbackButton } from "@/components/student/RequestAiFeedbackButton";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toListFeedbackResponse, toSubmissionDetailResponse } from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { getSingleSearchParam, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type SubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    status?: string | string[];
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
    taskTitle?: string | string[];
    language?: string | string[];
    submittedAt?: string | string[];
    attemptNo?: string | string[];
    isLate?: string | string[];
    lateBySeconds?: string | string[];
    codeText?: string | string[];
  }>;
};

const AI_STATUSES = [
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;

type AiStatus = (typeof AI_STATUSES)[number];

const parseAiStatus = (value: unknown): AiStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase() as AiStatus;
  return AI_STATUSES.includes(normalized) ? normalized : null;
};

const asNumberLike = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const asBooleanLike = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }
  return undefined;
};

const toLimitedCodeText = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value.length <= 2000 ? value : undefined;
};

const getStudentSubmissionErrorSummary = (status: number): string => {
  if (status === 403) {
    return "无权限查看该提交。";
  }
  if (status === 404) {
    return "提交不存在或功能未启用/不可用。";
  }
  if (status >= 500) {
    return "加载失败，请稍后重试。";
  }
  return getCommonErrorSummary(status);
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

type SubmissionFeedbackViewModel =
  | {
      mode: "ready";
      detail: ReturnType<typeof toSubmissionDetailResponse>;
      feedback: ReturnType<typeof toListFeedbackResponse>;
      aiFeedbackStatus: AiStatus | null;
      taskTitle?: string;
      language?: string;
      submittedAt?: string;
      attemptNo?: number;
      isLate?: boolean;
      lateBySeconds?: number;
      codeText?: string;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function StudentSubmissionDetailPage({
  params,
  searchParams,
}: SubmissionDetailPageProps) {
  const { submissionId } = await params;
  const query = await searchParams;
  const queryStatus = parseAiStatus(getSingleSearchParam(query.status));
  const classroomId = getSingleSearchParam(query.classroomId);
  const classroomTaskId = getSingleSearchParam(query.classroomTaskId);
  const taskDetailHref =
    classroomId && classroomTaskId
      ? paths.student.taskDetail(classroomId, classroomTaskId)
      : null;

  let viewModel: SubmissionFeedbackViewModel = {
    mode: "error",
    status: 500,
    description: "加载提交详情失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [detailPayload, feedbackPayload] = await Promise.all([
      fetchJson<unknown>(`learning-tasks/submissions/${encodeURIComponent(submissionId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
        {
          origin,
          cache: "no-store",
        }
      ),
    ]);

    const detail = toSubmissionDetailResponse(detailPayload);
    const feedback = toListFeedbackResponse(feedbackPayload);
    viewModel = {
      mode: "ready",
      detail,
      feedback,
      aiFeedbackStatus: parseAiStatus(detail.aiFeedbackStatus) ?? queryStatus,
      taskTitle: detail.taskTitle ?? getSingleSearchParam(query.taskTitle),
      language:
        detail.language ??
        detail.content.language ??
        getSingleSearchParam(query.language),
      submittedAt: detail.submittedAt ?? getSingleSearchParam(query.submittedAt),
      attemptNo:
        detail.attemptNo ?? asNumberLike(getSingleSearchParam(query.attemptNo)),
      isLate: detail.isLate ?? asBooleanLike(getSingleSearchParam(query.isLate)),
      lateBySeconds:
        detail.lateBySeconds ??
        asNumberLike(getSingleSearchParam(query.lateBySeconds)),
      codeText:
        detail.content.codeText ??
        toLimitedCodeText(getSingleSearchParam(query.codeText)),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(
          getStudentSubmissionErrorSummary(error.status),
          detail
        ),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState
        status={viewModel.status}
        title="提交详情加载失败"
        description={viewModel.description}
      />
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="提交详情 / 反馈"
        description={`提交 ID: ${submissionId}`}
        actions={
          <div className="flex items-center gap-3 text-sm">
            {taskDetailHref ? (
              <Link href={taskDetailHref} className="text-blue-700 hover:underline">
                返回任务详情
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

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页展示本次提交的反馈结果，也可在此请求 AI 反馈。</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <div className="grid gap-2 md:grid-cols-2">
          <p>任务标题：{toDisplayText(viewModel.taskTitle)}</p>
          <p>语言：{toDisplayText(viewModel.language)}</p>
          <p>提交时间：{toDisplayDate(viewModel.submittedAt)}</p>
          <p>尝试次数：{toDisplayText(viewModel.attemptNo)}</p>
          <p>
            是否迟交：{toDisplayText(viewModel.isLate)}
            {viewModel.isLate && viewModel.lateBySeconds !== undefined
              ? `（超时 ${viewModel.lateBySeconds} 秒）`
              : ""}
          </p>
          <p>课堂任务 ID：{toDisplayText(viewModel.detail.classroomTaskId)}</p>
        </div>
      </section>

      <AiProcessingHint
        status={viewModel.aiFeedbackStatus}
        variant="submission"
        helpHref={paths.student.aiHelp}
      />
      <RequestAiFeedbackButton
        submissionId={submissionId}
        initialStatus={viewModel.aiFeedbackStatus ?? undefined}
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">提交内容</h2>
        {viewModel.codeText ? (
          <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-xs text-zinc-100">
            {viewModel.codeText}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">当前接口未返回代码内容。</p>
        )}
      </section>

      {viewModel.feedback.items.length === 0 ? (
        <EmptyState title="暂无反馈" description="当前提交还没有反馈内容，可点击上方按钮请求 AI 反馈。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">source</th>
                <th className="px-4 py-3">type</th>
                <th className="px-4 py-3">severity</th>
                <th className="px-4 py-3">message</th>
                <th className="px-4 py-3">tags</th>
                <th className="px-4 py-3">时间</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.feedback.items.map((item, index) => (
                <tr key={item.id ?? `feedback-${index}`} className="border-t border-zinc-100 align-top">
                  <td className="px-4 py-3">{toDisplayText(item.source)}</td>
                  <td className="px-4 py-3">{toDisplayText(item.type)}</td>
                  <td className="px-4 py-3">{toDisplayText(item.severity)}</td>
                  <td className="px-4 py-3 whitespace-pre-wrap">{toDisplayText(item.message)}</td>
                  <td className="px-4 py-3">{item.tags.length > 0 ? item.tags.join(", ") : "—"}</td>
                  <td className="px-4 py-3">{toDisplayDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始数据（调试用）
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify({ detail: viewModel.detail.raw, feedback: viewModel.feedback.raw }, null, 2)}
        </pre>
      </details>
    </section>
  );
}
