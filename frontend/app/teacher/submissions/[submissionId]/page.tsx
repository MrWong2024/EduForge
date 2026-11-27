import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { RefreshButton } from "@/components/blocks/RefreshButton";
import { TaskRubric } from "@/components/learning-tasks/TaskRubric";
import { SubmissionContent } from "@/components/submissions/SubmissionContent";
import { PageHeader } from "@/components/blocks/PageHeader";
import {
  TeacherSubmissionReview,
  type TeacherSubmissionReviewContext,
} from "@/components/teacher/TeacherSubmissionReview";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toClassroomTask,
  type SubmissionDetailResponse,
  type TeacherFeedbackListResponse,
  type TeacherSubmissionContext,
} from "@/lib/api/types-teacher";
import { readSubmissionWithFeedback } from "@/lib/learning-tasks/read-submission-with-feedback";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplaySubmissionLanguage } from "@/lib/learning-tasks/submission-language";
import {
  getSingleSearchParam,
  toDisplayDate,
  toDisplayLateDuration,
  toDisplayText,
} from "@/lib/ui/format";

type TeacherSubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
  }>;
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
  detail: SubmissionDetailResponse,
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
      detail: SubmissionDetailResponse;
      feedback: TeacherFeedbackListResponse;
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
  const confirmedSubmissionId = submissionId.toLowerCase();
  const renderSubmissionDetail = (
    overview: ReactNode,
    context: TeacherSubmissionReviewContext | null,
  ) => (
    <section className="min-w-0 space-y-4">
      {overview}
      <TeacherSubmissionReview
        key={confirmedSubmissionId}
        submissionId={confirmedSubmissionId}
        context={context}
      />
    </section>
  );

  let viewModel: SubmissionFeedbackViewModel = {
    mode: "error",
    status: 500,
    description: "加载提交详情失败，请稍后重试。",
  };

  try {
    const result = await readSubmissionWithFeedback(submissionId, fetchJson);
    viewModel = {
      mode: "ready",
      ...result,
      context: buildContext(submissionId, result.detail, query),
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
    const error = (
      <ErrorState
        status={viewModel.status}
        title="提交详情加载失败"
        description={viewModel.description}
      />
    );
    if (viewModel.status < 500) return error;

    return renderSubmissionDetail(
      <>
        {error}
        <RefreshButton label="重试加载提交详情" />
      </>,
      null,
    );
  }

  const gate = await requireRole("TEACHER");
  if (!gate.allowed) return <ErrorState status={403} />;
  if (typeof gate.me.id !== "string" || !gate.me.id) {
    return <ErrorState status={500} title="当前账号身份无法确认" />;
  }

  let rubric: Record<string, unknown> | undefined;
  let rubricAvailable = false;
  if (viewModel.context.classroomId && viewModel.detail.classroomTaskId) {
    try {
      const taskPayload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(viewModel.context.classroomId)}/tasks/${encodeURIComponent(viewModel.detail.classroomTaskId)}`,
        { cache: "no-store" },
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
  const lateDurationText =
    viewModel.context.isLate === true
      ? toDisplayLateDuration(viewModel.context.lateBySeconds)
      : undefined;

  const overview = (
    <>
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
              {toDisplaySubmissionLanguage(viewModel.context.language)}
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
              {lateDurationText ? `（${lateDurationText}）` : ""}
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
          评阅标准暂不可用，请从任务详情核对。
        </p>
      )}
    </>
  );

  return renderSubmissionDetail(overview, {
    viewerId: gate.me.id,
    detail: viewModel.detail,
    feedback: viewModel.feedback.items,
  });
}
