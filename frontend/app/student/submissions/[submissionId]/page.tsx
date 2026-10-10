import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { SubmissionAiReview } from "@/components/submissions/SubmissionAiReview";
import { SubmissionContent } from "@/components/submissions/SubmissionContent";
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
  getSingleSearchParam,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type SubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
  }>;
};

const toDisplayLateDuration = (value: unknown): string | undefined => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return undefined;
  }

  if (value === 0) {
    return "超时不足 1 秒";
  }

  const secondsPerMinute = 60;
  const secondsPerHour = 60 * secondsPerMinute;
  const secondsPerDay = 24 * secondsPerHour;

  if (value < secondsPerMinute) {
    return `超时 ${value} 秒`;
  }

  if (value < secondsPerHour) {
    const minutes = Math.floor(value / secondsPerMinute);
    const seconds = value % secondsPerMinute;
    return seconds > 0
      ? `超时 ${minutes} 分钟 ${seconds} 秒`
      : `超时 ${minutes} 分钟`;
  }

  if (value < secondsPerDay) {
    const hours = Math.floor(value / secondsPerHour);
    const minutes = Math.floor((value % secondsPerHour) / secondsPerMinute);
    return minutes > 0
      ? `超时 ${hours} 小时 ${minutes} 分钟`
      : `超时 ${hours} 小时`;
  }

  const days = Math.floor(value / secondsPerDay);
  const hours = Math.floor((value % secondsPerDay) / secondsPerHour);
  return hours > 0 ? `超时 ${days} 天 ${hours} 小时` : `超时 ${days} 天`;
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
    const [detailPayload, feedbackPayload] = await Promise.all([
      fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(submissionId)}`,
        {
          origin,
          cache: "no-store",
        },
      ),
      fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
        {
          origin,
          cache: "no-store",
        },
      ),
    ]);

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
        description={`任务：${toDisplayText(viewModel.detail.taskTitle, "未命名任务")} | 提交时间：${toDisplayDate(viewModel.detail.submittedAt)}`}
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
          <p>语言：{toDisplayText(viewModel.detail.language)}</p>
          <p>提交时间：{toDisplayDate(viewModel.detail.submittedAt)}</p>
          <p>尝试次数：{toDisplayText(viewModel.detail.attemptNo)}</p>
          <p>
            是否迟交：{toDisplayText(viewModel.detail.isLate)}
            {lateDurationText ? `（${lateDurationText}）` : ""}
          </p>
        </div>
      </section>

      <SubmissionContent detail={viewModel.detail} />
      <SubmissionAiReview
        key={submissionId}
        submissionId={submissionId}
        status={viewModel.detail.aiFeedbackStatus}
        review={viewModel.detail.aiReview}
        autoRefresh={true}
      />

      {viewModel.feedback.items.length === 0 ? (
        <EmptyState
          title="暂无反馈"
          description="当前尚无可展示的反馈。处理完成也不表示作品已通过；请按任务要求和教师反馈继续核对。"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">来源</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">严重程度</th>
                <th className="px-4 py-3">反馈内容</th>
                <th className="px-4 py-3">修改建议</th>
                <th className="px-4 py-3">标签</th>
                <th className="px-4 py-3">时间</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.feedback.items.map((item, index) => (
                <tr
                  key={item.id ?? `feedback-${index}`}
                  className="border-t border-zinc-100 align-top"
                >
                  <td className="px-4 py-3">
                    {item.source === "TEACHER"
                      ? "教师反馈"
                      : item.source === "AI"
                        ? "AI 辅助反馈"
                        : "其他反馈"}
                  </td>
                  <td className="px-4 py-3">{toDisplayText(item.type, "—")}</td>
                  <td className="px-4 py-3">
                    {toDisplayText(item.severity, "—")}
                  </td>
                  <td className="max-w-lg break-words px-4 py-3 whitespace-pre-wrap">
                    {toDisplayText(item.message)}
                  </td>
                  <td className="max-w-lg break-words px-4 py-3 whitespace-pre-wrap">
                    {toDisplayText(item.suggestion, "暂无")}
                  </td>
                  <td className="px-4 py-3">
                    {item.tags.length > 0 ? item.tags.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3">{toDisplayDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
