import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { PublishTaskStatusButton } from "@/components/teacher/PublishTaskStatusButton";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toClassroomSummary, toClassroomTask } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";

type ClassroomTaskDetailPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
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

type TaskDetailViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      task: ReturnType<typeof toClassroomTask>;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function ClassroomTaskDetailPage({ params }: ClassroomTaskDetailPageProps) {
  const { classroomId, classroomTaskId } = await params;

  let viewModel: TaskDetailViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务详情失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, taskPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}`,
        {
          origin,
          cache: "no-store",
        }
      ),
    ]);

    viewModel = {
      mode: "ready",
      classroomName: toClassroomSummary(classroomPayload).name,
      task: toClassroomTask(taskPayload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限管理任务。",
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
    return (
      <ErrorState status={viewModel.status} title="任务详情加载失败" description={viewModel.description} />
    );
  }

  const task = viewModel.task;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title={toDisplayText(task.title, "任务详情")}
        description={`${toDisplayText(viewModel.classroomName, "班级")}（ID: ${classroomId}） | 课堂任务 ID: ${classroomTaskId}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              返回任务列表
            </Link>
            <Link
              href={paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              查看提交管理
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <p>任务 ID：{toDisplayText(task.taskId)}</p>
          <p>发布状态：{toDisplayText(task.taskStatus, "—")}</p>
          <p>截止时间：{toDisplayDate(task.dueAt)}</p>
          <p>允许迟交：{toDisplayText(task.allowLate)}</p>
          <p>发布时间：{toDisplayDate(task.publishedAt)}</p>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-zinc-700">{toDisplayText(task.description, "暂无描述")}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">任务状态管理</h2>
        <p className="mt-1 text-sm text-zinc-600">如任务仍为草稿，可在此标记为已发布。</p>
        <div className="mt-3">
          <PublishTaskStatusButton taskId={task.taskId} taskStatus={task.taskStatus} />
        </div>
      </section>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始任务详情 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(task.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
