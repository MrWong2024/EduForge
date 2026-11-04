import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditSubmissionForm } from "@/components/student/EditSubmissionForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toListFeedbackResponse,
  toSubmissionDetailResponse,
} from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  getFeedbackSeverityLabel,
  getFeedbackSourceLabel,
  getFeedbackTypeLabel,
} from "@/lib/ui/feedback-options";
import { getFeedbackTagLabel } from "@/lib/ui/feedback-tags";
import { toDisplaySubmissionLanguage } from "@/lib/learning-tasks/submission-language";
import {
  getSingleSearchParam,
  toDisplayDate,
  toDisplayLateDuration,
  toDisplayText,
} from "@/lib/ui/format";

type SubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
  }>;
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
    const detailPayload = await fetchJson<unknown>(
      `learning-tasks/submissions/${encodeURIComponent(submissionId)}`,
      { origin, cache: "no-store" },
    );
    const feedbackPayload = await fetchJson<unknown>(
      `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
      { origin, cache: "no-store" },
    );

    const detail = toSubmissionDetailResponse(detailPayload);
    const feedback = toListFeedbackResponse(feedbackPayload);
    viewModel = {
      mode: "ready",
      detail,
      feedback,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(
          getStudentSubmissionErrorSummary(error.status),
          detail,
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

  const lateDurationText =
    viewModel.detail.isLate === true
      ? toDisplayLateDuration(viewModel.detail.lateBySeconds)
      : undefined;

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="提交详情 / 反馈"
        description={`任务：${toDisplayText(viewModel.detail.taskTitle, "未命名任务")} | 首次提交时间：${toDisplayDate(viewModel.detail.submittedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {taskDetailHref ? (
              <Link
                href={taskDetailHref}
                className="text-blue-700 hover:underline"
              >
                返回任务详情
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

      <section className="break-words rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>
          此页展示该次保存的作品和反馈。AI
          申请资格与重试安排以当前详情为准；排队、处理或已安排重试时才自动刷新。
        </p>
      </section>

      <section className="break-words rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <div className="grid gap-2 md:grid-cols-2">
          <p>任务标题：{toDisplayText(viewModel.detail.taskTitle)}</p>
          <p>语言：{toDisplaySubmissionLanguage(viewModel.detail.language)}</p>
          <p>首次提交时间：{toDisplayDate(viewModel.detail.submittedAt)}</p>
          <p>
            最近修改时间：
            {viewModel.detail.lastEditedAt
              ? toDisplayDate(viewModel.detail.lastEditedAt)
              : viewModel.detail.lastEditedAt === null
                ? "尚未修改"
                : "未知"}
          </p>
          <p>尝试次数：{toDisplayText(viewModel.detail.attemptNo)}</p>
          <p>
            首次提交是否迟交：{toDisplayText(viewModel.detail.isLate)}
            {lateDurationText ? `（${lateDurationText}）` : ""}
          </p>
          {viewModel.detail.lastEditedAt ? (
            <p>
              本次修改是否迟交：
              {viewModel.detail.lastEditIsLate === true
                ? "是"
                : viewModel.detail.lastEditIsLate === false
                  ? "否"
                  : "未知"}
            </p>
          ) : null}
          <p>
            {viewModel.detail.reviewStartedAt ||
            viewModel.detail.editing.reason === "REVIEW_STARTED"
              ? "已进入评阅，不能修改作品。"
              : (viewModel.detail.editing.message ??
                (viewModel.detail.editing.canEdit
                  ? "尚未进入评阅；修改资格以保存时校验为准。"
                  : "当前修改资格暂不可用，请刷新核对。"))}
          </p>
        </div>
      </section>

      <EditSubmissionForm
        key={submissionId}
        submissionId={submissionId}
        detail={viewModel.detail}
      />

      {viewModel.feedback.items.length === 0 ? (
        <EmptyState
          title="暂无反馈"
          description="当前尚无可展示的反馈。处理完成也不表示作品已通过；请按任务要求和教师反馈继续核对。"
        />
      ) : (
        <ul className="min-w-0 space-y-4">
          {viewModel.feedback.items.map((item, index) => (
            <li
              key={item.id ?? `feedback-${index}`}
              className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 text-sm [overflow-wrap:anywhere]">
                <dl className="flex min-w-0 max-w-full flex-wrap gap-x-4 gap-y-2">
                  <div className="flex min-w-0 max-w-full flex-wrap gap-x-1">
                    <dt className="text-zinc-500">来源：</dt>
                    <dd className="min-w-0 text-zinc-700">
                      {getFeedbackSourceLabel(item.source)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 max-w-full flex-wrap gap-x-1">
                    <dt className="text-zinc-500">类型：</dt>
                    <dd className="min-w-0 text-zinc-700">
                      {getFeedbackTypeLabel(item.type)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 max-w-full flex-wrap gap-x-1">
                    <dt className="text-zinc-500">严重程度：</dt>
                    <dd className="min-w-0 font-medium text-zinc-700">
                      {getFeedbackSeverityLabel(item.severity)}
                    </dd>
                  </div>
                </dl>
                <p className="min-w-0 max-w-full text-zinc-500">
                  时间：{toDisplayDate(item.createdAt)}
                </p>
              </div>

              <dl className="mt-4 min-w-0 [overflow-wrap:anywhere]">
                <div>
                  <dt className="text-sm font-medium text-zinc-600">反馈内容</dt>
                  <dd className="mt-2 whitespace-pre-wrap text-base leading-7 text-zinc-900">
                    {toDisplayText(item.message)}
                  </dd>
                </div>
                <div className="mt-5 border-t border-zinc-100 pt-4">
                  <dt className="text-sm font-medium text-zinc-700">修改建议</dt>
                  <dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                    {toDisplayText(item.suggestion, "暂无")}
                  </dd>
                </div>
                <div className="mt-4 flex min-w-0 items-start gap-2 text-sm">
                  <dt className="shrink-0 text-zinc-500">标签：</dt>
                  <dd className="flex min-w-0 flex-1 flex-wrap gap-2 text-zinc-600">
                    {item.tags.length > 0
                      ? item.tags.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="min-w-0 max-w-full rounded-md bg-zinc-50 px-2 py-1"
                          >
                            {getFeedbackTagLabel(tag)}
                          </span>
                        ))
                      : "—"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
