import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { buildProxyPath, fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  toClassroomTask,
  toClassroomTaskSubmissionsResponse,
  toClassroomSummary,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { buildQueryString, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type ClassroomTaskSubmissionsPageProps = {
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

type TaskSubmissionsViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      task: ReturnType<typeof toClassroomTask>;
      submissions: ReturnType<typeof toClassroomTaskSubmissionsResponse>["items"];
      submissionsRaw: unknown;
      rawSubmissionsHref: string | null;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function ClassroomTaskSubmissionsPage({
  params,
}: ClassroomTaskSubmissionsPageProps) {
  const { classroomId, classroomTaskId } = await params;

  let viewModel: TaskSubmissionsViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务提交记录失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, classroomTaskPayload] = await Promise.all([
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

    const task = toClassroomTask(classroomTaskPayload);
    let submissions: ReturnType<typeof toClassroomTaskSubmissionsResponse>["items"] = [];
    let submissionsRaw: unknown = { items: [] };
    let rawSubmissionsHref: string | null = null;

    if (task.taskId) {
      const submissionsQuery = buildQueryString({ page: 1, limit: 50 });
      const submissionsPath = `learning-tasks/tasks/${encodeURIComponent(task.taskId)}/submissions?${submissionsQuery}`;
      const submissionsPayload = await fetchJson<unknown>(submissionsPath, {
        origin,
        cache: "no-store",
      });
      const submissionsResponse = toClassroomTaskSubmissionsResponse(submissionsPayload);
      submissions = submissionsResponse.items.filter(
        (submission) => submission.classroomTaskId === classroomTaskId
      );
      submissionsRaw = submissionsResponse.raw;
      rawSubmissionsHref = buildProxyPath(submissionsPath);
    }

    viewModel = {
      mode: "ready",
      classroomName: toClassroomSummary(classroomPayload).name,
      task,
      submissions,
      submissionsRaw,
      rawSubmissionsHref,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限管理任务。",
        404: "提交管理功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载任务提交记录失败，请稍后重试。";

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
        title="任务提交记录加载失败"
        description={viewModel.description}
      />
    );
  }

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="任务提交管理"
        description={`${toDisplayText(viewModel.classroomName, "班级")} | 课堂任务 ID: ${classroomTaskId}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={paths.teacher.classroomTaskDetail(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              返回任务详情
            </Link>
            {viewModel.rawSubmissionsHref ? (
              <a
                href={viewModel.rawSubmissionsHref}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 hover:underline"
              >
                导出/查看原始提交 JSON
              </a>
            ) : null}
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>
          当前页面按 <code>classroomTaskId</code> 过滤展示提交，避免跨班聚合误读。
        </p>
      </section>

      {viewModel.submissions.length === 0 ? (
        <EmptyState title="暂无提交记录" description="当前课堂任务尚未收到学生提交。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">提交 ID</th>
                <th className="px-4 py-3">学生 ID</th>
                <th className="px-4 py-3">尝试次数</th>
                <th className="px-4 py-3">提交状态</th>
                <th className="px-4 py-3">反馈状态</th>
                <th className="px-4 py-3">提交时间</th>
                <th className="px-4 py-3">是否迟交</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.submissions.map((submission, index) => (
                <tr key={submission.id ?? `submission-${index}`} className="border-t border-zinc-100 align-top">
                  <td className="px-4 py-3">{toDisplayText(submission.id)}</td>
                  <td className="px-4 py-3">{toDisplayText(submission.studentId)}</td>
                  <td className="px-4 py-3">{toDisplayText(submission.attemptNo)}</td>
                  <td className="px-4 py-3">{toDisplayText(submission.status)}</td>
                  <td className="px-4 py-3">{toDisplayText(submission.aiFeedbackStatus)}</td>
                  <td className="px-4 py-3">{toDisplayDate(submission.submittedAt)}</td>
                  <td className="px-4 py-3">{toDisplayText(submission.isLate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始提交 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.submissionsRaw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
