import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  StudentTaskCompletionStatus,
  toStudentDashboardResponse,
} from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "学习看板",
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

type StudentDashboardViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toStudentDashboardResponse>;
    }
  | {
      mode: "error";
      status: number;
      description: string;
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

const getAiFeedbackStatusBadge = (
  status?: string | null,
  hasLatestSubmission = false,
): StatusBadgeView => {
  if (!hasLatestSubmission) {
    return {
      label: "未提交",
      title: "尚未提交该任务",
      tone: "neutral",
    };
  }

  const normalized = status?.trim().toUpperCase();
  if (normalized === "NOT_REQUESTED") {
    return {
      label: "未请求",
      title: "最新提交尚未请求 AI 反馈",
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
    title: status ? `未知 AI 状态：${status}` : "最新提交暂无 AI 状态",
    tone: "neutral",
  };
};

const getCompletionSourceLabel = (
  source: StudentTaskCompletionStatus["source"],
) => {
  if (source === "TEACHER") {
    return "教师反馈";
  }
  if (source === "AI") {
    return "AI 反馈";
  }
  return "反馈";
};

const getCompletionStatusBadge = (
  completionStatus?: StudentTaskCompletionStatus | null,
  hasLatestSubmission = false,
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

export default async function StudentDashboardPage() {
  let viewModel: StudentDashboardViewModel = {
    mode: "error",
    status: 500,
    description: "加载学习看板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>("classrooms/mine/dashboard", {
      origin,
      cache: "no-store",
    });

    viewModel = {
      mode: "ready",
      data: toStudentDashboardResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问学习看板。"
          : getCommonErrorSummary(error.status, "加载学习看板");

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
        title="学习看板加载失败"
        description={viewModel.description}
      />
    );
  }

  const classroomItems = viewModel.data.items;

  return (
    <section>
      <PageHeader
        title="我的学习看板"
        description={`第 ${toDisplayText(viewModel.data.page, "1")} 页，每页 ${toDisplayText(
          viewModel.data.limit,
          "20",
        )} 条`}
        actions={
          <Link
            href={paths.student.joinClassroom}
            className="text-sm text-blue-700 hover:underline"
          >
            去加入班级
          </Link>
        }
      />

      {classroomItems.length === 0 ? (
        <EmptyState
          title="还没有加入任何班级"
          description="先输入班级加入码加入班级，再开始做任务。"
          actions={
            <Link
              href={paths.student.joinClassroom}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              去加入班级
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {classroomItems.map((classroom, classroomIndex) => {
            const classroomId = classroom.classroomId;
            return (
              <section
                key={classroomId ?? `classroom-${classroomIndex}`}
                className="rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      {toDisplayText(classroom.classroomName, "未命名班级")}
                    </h2>
                    <p className="text-sm text-zinc-600">
                      班级状态: {toDisplayText(classroom.status)}
                    </p>
                  </div>
                  <p className="text-sm text-zinc-600">
                    任务数: {classroom.tasks.length}
                  </p>
                </div>

                {classroom.tasks.length === 0 ? (
                  <p className="text-sm text-zinc-600">当前班级暂无任务。</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-zinc-100">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-zinc-50 text-left text-zinc-600">
                        <tr>
                          <th className="px-4 py-2">任务</th>
                          <th className="px-4 py-2">截止时间</th>
                          <th className="px-4 py-2">提交次数</th>
                          <th className="px-4 py-2">AI 状态</th>
                          <th className="px-4 py-2">完成情况</th>
                          <th className="px-4 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classroom.tasks.map((task, taskIndex) => {
                          const taskPath =
                            classroomId && task.classroomTaskId
                              ? paths.student.taskDetail(
                                  classroomId,
                                  task.classroomTaskId,
                                )
                              : null;
                          const hasLatestSubmission = Boolean(
                            task.myLatestSubmission,
                          );
                          const aiStatusBadge = getAiFeedbackStatusBadge(
                            task.aiFeedbackStatus,
                            hasLatestSubmission,
                          );
                          const completionStatusBadge =
                            getCompletionStatusBadge(
                              task.completionStatus,
                              hasLatestSubmission,
                            );

                          return (
                            <tr
                              key={task.classroomTaskId ?? `task-${taskIndex}`}
                              className="border-t border-zinc-100"
                            >
                              <td className="px-4 py-2">
                                {toDisplayText(task.title, "未命名任务")}
                              </td>
                              <td className="px-4 py-2">
                                {toDisplayDate(task.dueAt)}
                              </td>
                              <td className="px-4 py-2">
                                {toDisplayText(task.mySubmissionsCount, "0")}
                              </td>
                              <td className="px-4 py-2">
                                <StatusBadge badge={aiStatusBadge} />
                              </td>
                              <td className="px-4 py-2">
                                <StatusBadge badge={completionStatusBadge} />
                              </td>
                              <td className="px-4 py-2">
                                {taskPath ? (
                                  <Link
                                    href={taskPath}
                                    className="text-blue-700 hover:underline"
                                  >
                                    查看详情
                                  </Link>
                                ) : (
                                  <span className="text-zinc-500">
                                    缺少课堂任务标识
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
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
