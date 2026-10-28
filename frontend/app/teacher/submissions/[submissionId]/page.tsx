import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { SubmissionAiReview } from "@/components/submissions/SubmissionAiReview";
import { TaskRubric } from "@/components/learning-tasks/TaskRubric";
import { SubmissionContent } from "@/components/submissions/SubmissionContent";
import { PageHeader } from "@/components/blocks/PageHeader";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";
import { TeacherFeedbackHistory } from "@/components/teacher/TeacherFeedbackHistory";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toClassroomTask,
  toSubmissionDetailResponse,
  toTeacherFeedbackListResponse,
  type TeacherSubmissionContext,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  getSingleSearchParam,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type TeacherSubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
  }>;
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

const getTeacherSubmissionErrorSummary = (status: number): string => {
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

const buildContext = (
  submissionId: string,
  detail: ReturnType<typeof toSubmissionDetailResponse>,
  query: Awaited<TeacherSubmissionDetailPageProps["searchParams"]>,
): TeacherSubmissionContext => ({
  submissionId,
  classroomId: getSingleSearchParam(query.classroomId),
  classroomTaskId:
    detail.classroomTaskId ?? getSingleSearchParam(query.classroomTaskId),
  taskTitle: detail.taskTitle ?? undefined,
  studentName: detail.studentName ?? undefined,
  language: detail.language ?? detail.content.language ?? undefined,
  submittedAt: detail.submittedAt ?? undefined,
  attemptNo: detail.attemptNo ?? undefined,
  isLate: detail.isLate,
  lateBySeconds: detail.lateBySeconds,
  codeText: detail.content.codeText ?? undefined,
});

type SubmissionFeedbackViewModel =
  | {
      mode: "ready";
      detail: ReturnType<typeof toSubmissionDetailResponse>;
      feedback: ReturnType<typeof toTeacherFeedbackListResponse>;
      context: TeacherSubmissionContext;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function TeacherSubmissionDetailPage({
  params,
  searchParams,
}: TeacherSubmissionDetailPageProps) {
  const { submissionId } = await params;
  const query = await searchParams;

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
    const feedback = toTeacherFeedbackListResponse(feedbackPayload);
    viewModel = {
      mode: "ready",
      detail,
      feedback,
      context: buildContext(submissionId, detail, query),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(
          getTeacherSubmissionErrorSummary(error.status),
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

  let rubric: Record<string, unknown> | undefined;
  let rubricAvailable = false;
  if (viewModel.context.classroomId && viewModel.detail.classroomTaskId) {
    try {
      const taskPayload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(viewModel.context.classroomId)}/tasks/${encodeURIComponent(viewModel.detail.classroomTaskId)}`,
        { origin: await getRequestOrigin(), cache: "no-store" },
      );
      const task = toClassroomTask(taskPayload);
      if (task.taskId === viewModel.detail.taskId) {
        rubric = task.rubric;
        rubricAvailable = true;
      }
    } catch {
      // Optional reference failure must not replace the saved work or draft form.
      rubricAvailable = false;
    }
  }

  const backHref =
    viewModel.context.classroomId && viewModel.context.classroomTaskId
      ? paths.teacher.classroomTaskSubmissions(
          viewModel.context.classroomId,
          viewModel.context.classroomTaskId,
        )
      : null;
  const taskHref =
    viewModel.context.classroomId && viewModel.context.classroomTaskId
      ? paths.teacher.classroomTaskDetail(
          viewModel.context.classroomId,
          viewModel.context.classroomTaskId,
        )
      : null;
  const classroomDashboardHref = viewModel.context.classroomId
    ? paths.teacher.classroomDashboard(viewModel.context.classroomId)
    : null;

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="提交详情 / 教师批阅"
        description={`任务：${toDisplayText(viewModel.context.taskTitle, "未命名任务")} | 学生：${toDisplayText(
          viewModel.context.studentName,
          "未知学生",
        )}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {classroomDashboardHref ? (
              <Link
                href={classroomDashboardHref}
                className="text-blue-700 hover:underline"
              >
                班级看板
              </Link>
            ) : null}
            {backHref ? (
              <Link href={backHref} className="text-blue-700 hover:underline">
                返回任务提交列表
              </Link>
            ) : null}
            {taskHref ? (
              <Link href={taskHref} className="text-blue-700 hover:underline">
                返回任务详情
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">提交概览</h2>
        <div className="mt-3 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
          <div>
            <p className="text-zinc-500">任务标题</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.taskTitle)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">学生</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.studentName, "未知学生")}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">语言</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.language)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">首次提交时间</p>
            <p className="font-medium text-zinc-900">
              {toDisplayDate(viewModel.context.submittedAt)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">尝试次数</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.attemptNo)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">首次提交是否迟交</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.isLate)}
              {viewModel.context.isLate &&
              viewModel.context.lateBySeconds !== undefined
                ? `（超时 ${viewModel.context.lateBySeconds} 秒）`
                : ""}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">最近修改时间</p>
            <p>
              {viewModel.detail.lastEditedAt
                ? toDisplayDate(viewModel.detail.lastEditedAt)
                : viewModel.detail.lastEditedAt === null
                  ? "尚未修改"
                  : "未知"}
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
          </div>
          <p>
            {viewModel.detail.reviewStartedAt ||
            viewModel.detail.editing.reason === "REVIEW_STARTED"
              ? "已进入评阅，作品已固定，学生不能修改。"
              : "教师仅查看不会锁定作品；正式提交反馈或受理 AI 申请后固定作品。"}
          </p>
        </div>
      </section>

      <SubmissionContent detail={viewModel.detail} />
      {rubricAvailable ? (
        <TaskRubric rubric={rubric} />
      ) : (
        <p className="text-sm text-zinc-600">
          评分参考暂不可用，请从任务详情核对。
        </p>
      )}
      <SubmissionAiReview
        key={submissionId}
        submissionId={submissionId}
        contentRevision={viewModel.detail.contentRevision}
        status={viewModel.detail.aiFeedbackStatus}
        review={viewModel.detail.aiReview}
        autoRefresh={false}
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>
          此页用于查看作品与反馈，并新增或修改教师反馈。为保护未提交的批阅草稿，仅显式刷新；AI
          申请后点击刷新查看最新结果。
        </p>
      </section>

      <TeacherFeedbackForm
        submissionId={submissionId}
        contentRevision={viewModel.detail.contentRevision}
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">反馈历史</h2>
        <TeacherFeedbackHistory
          items={viewModel.feedback.items}
          submissionId={submissionId}
        />
      </section>
    </section>
  );
}
