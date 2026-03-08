import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { toTeacherFeedbackListResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getSingleSearchParam, toDisplayDate, toDisplayText } from "@/lib/ui/format";

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

type SubmissionFeedbackViewModel =
  | {
      mode: "ready";
      feedback: ReturnType<typeof toTeacherFeedbackListResponse>;
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
  const classroomId = getSingleSearchParam(query.classroomId);
  const classroomTaskId = getSingleSearchParam(query.classroomTaskId);

  let viewModel: SubmissionFeedbackViewModel = {
    mode: "error",
    status: 500,
    description: "加载提交反馈失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      feedback: toTeacherFeedbackListResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限查看或批阅该提交。",
        404: "提交不存在或功能未启用/不可用。",
      };
      const summary = summaryByStatus[error.status] ?? "加载提交反馈失败，请稍后重试。";

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
        title="提交详情加载失败"
        description={viewModel.description}
      />
    );
  }

  const backHref =
    classroomId && classroomTaskId
      ? paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)
      : null;

  return (
    <section className="space-y-4">
      <PageHeader
        title="提交详情 / 教师反馈"
        description={`submissionId: ${submissionId}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {backHref ? (
              <Link href={backHref} className="text-blue-700 hover:underline">
                返回任务提交列表
              </Link>
            ) : null}
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>当前页用于教师批阅闭环：查看反馈历史并新增教师反馈。</p>
      </section>

      <TeacherFeedbackForm submissionId={submissionId} />

      {viewModel.feedback.items.length === 0 ? (
        <EmptyState title="暂无反馈记录" description="可先在上方填写教师反馈。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">source</th>
                <th className="px-4 py-3">severity</th>
                <th className="px-4 py-3">message</th>
                <th className="px-4 py-3">suggestion</th>
                <th className="px-4 py-3">tags</th>
                <th className="px-4 py-3">时间</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.feedback.items.map((item, index) => (
                <tr key={item.id ?? `feedback-${index}`} className="border-t border-zinc-100 align-top">
                  <td className="px-4 py-3">{toDisplayText(item.source)}</td>
                  <td className="px-4 py-3">{toDisplayText(item.severity)}</td>
                  <td className="px-4 py-3 whitespace-pre-wrap">{toDisplayText(item.message)}</td>
                  <td className="px-4 py-3 whitespace-pre-wrap">{toDisplayText(item.suggestion)}</td>
                  <td className="px-4 py-3">{item.tags.length > 0 ? item.tags.join(", ") : "—"}</td>
                  <td className="px-4 py-3">{toDisplayDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始反馈 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.feedback.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
