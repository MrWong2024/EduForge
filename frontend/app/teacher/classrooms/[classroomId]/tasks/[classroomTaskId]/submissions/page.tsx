import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toClassroomTaskSubmissionsResponse, toClassroomSummary } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getSingleSearchParam,
  parsePositiveInt,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type ClassroomTaskSubmissionsPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
  searchParams: Promise<{
    page?: string | string[];
  }>;
};

const SUBMISSIONS_PAGE_SIZE = 100;

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }
  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

const getSubmissionsErrorSummary = (status: number): string => {
  if (status === 403) {
    return "无权限访问对应页面。";
  }
  if (status >= 500) {
    return "加载失败，请稍后重试。";
  }
  return getCommonErrorSummary(status);
};

type TaskSubmissionsViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      submissionsResponse: ReturnType<typeof toClassroomTaskSubmissionsResponse>;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

type SubmissionsQueryState = {
  page: number;
};

const resolveQueryState = (
  query: Awaited<ClassroomTaskSubmissionsPageProps["searchParams"]>,
): SubmissionsQueryState => ({
  page: parsePositiveInt(getSingleSearchParam(query.page), 1, { min: 1 }),
});

const buildPageHref = (
  routePath: string,
  page: number,
): string => `${routePath}?${buildQueryString({ page })}`;

export default async function ClassroomTaskSubmissionsPage({
  params,
  searchParams,
}: ClassroomTaskSubmissionsPageProps) {
  const { classroomId, classroomTaskId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const submissionsQuery = buildQueryString({
    page: String(queryState.page),
    limit: String(SUBMISSIONS_PAGE_SIZE),
  });
  const submissionsPath = `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(
    classroomTaskId
  )}/submissions?${submissionsQuery}`;

  let viewModel: TaskSubmissionsViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务提交记录失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, submissionsPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(submissionsPath, {
        origin,
        cache: "no-store",
      }),
    ]);

    const submissionsResponse = toClassroomTaskSubmissionsResponse(submissionsPayload);
    viewModel = {
      mode: "ready",
      classroomName: toClassroomSummary(classroomPayload).name,
      submissionsResponse,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getSubmissionsErrorSummary(error.status), detail),
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

  const routePath = paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId);
  const submissions = viewModel.submissionsResponse.items;
  const displayedSubmissionsCount = submissions.length;
  const totalSubmissionsCount =
    typeof viewModel.submissionsResponse.total === "number"
      ? viewModel.submissionsResponse.total
      : displayedSubmissionsCount;
  const currentPageSource =
    typeof viewModel.submissionsResponse.page === "number" &&
    viewModel.submissionsResponse.page > 0
      ? viewModel.submissionsResponse.page
      : queryState.page;
  const totalPages = Math.max(
    1,
    Math.ceil(totalSubmissionsCount / SUBMISSIONS_PAGE_SIZE),
  );
  const currentPage = Math.min(currentPageSource, totalPages);
  const showPagination = totalSubmissionsCount > SUBMISSIONS_PAGE_SIZE;
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <section className="mt-4 space-y-4">
      <PageHeader
        title="任务提交管理"
        description={`${toDisplayText(viewModel.classroomName, "班级")} | 当前课堂任务提交记录`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={paths.teacher.classroomDashboard(classroomId)}
              className="text-blue-700 hover:underline"
            >
              班级看板
            </Link>
            <Link
              href={paths.teacher.classroomTasks(classroomId)}
              className="text-blue-700 hover:underline"
            >
              返回任务列表
            </Link>
            <Link
              href={paths.teacher.classroomTaskDetail(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              返回任务详情
            </Link>
            <Link
              href={paths.teacher.classroomTaskTrajectory(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              学习轨迹
            </Link>
            <Link
              href={paths.teacher.classroomTaskReviewPack(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              课堂复盘
            </Link>
            <Link
              href={paths.teacher.classroomTaskAiMetrics(classroomId, classroomTaskId)}
              className="text-blue-700 hover:underline"
            >
              AI 指标
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页展示当前课堂任务的提交记录，可进入详情查看反馈与批阅。</p>
        <p className="mt-1 text-xs text-zinc-600">
          “本任务第几次提交”按当前 classroomTask 独立递增，不跨班级累计。
        </p>
      </section>

      <div className="text-sm text-zinc-600">
        共 {totalSubmissionsCount} 条提交，当前显示 {displayedSubmissionsCount} 条
      </div>

      {submissions.length === 0 ? (
        <EmptyState title="当前任务暂无提交" description="该课堂任务暂未收到学生提交。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">学生</th>
                <th className="px-4 py-3">提交时间</th>
                <th className="px-4 py-3">AI 反馈状态</th>
                <th className="px-4 py-3">反馈数</th>
                <th
                  className="px-4 py-3"
                  title="表示该学生在当前课堂任务下的第几次提交"
                >
                  本任务第几次提交
                </th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission, index) => {
                const submissionId = submission.submissionId;
                const baseDetailPath = submissionId
                  ? paths.teacher.submissionDetail(submissionId)
                  : null;
                const detailQuery = buildQueryString({
                  classroomId,
                  classroomTaskId,
                });
                const detailHref = baseDetailPath
                  ? detailQuery
                    ? `${baseDetailPath}?${detailQuery}`
                    : baseDetailPath
                  : null;

                return (
                  <tr
                    key={submission.submissionId ?? `submission-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900">
                        {toDisplayText(submission.studentName, "—")}
                      </p>
                    </td>
                    <td className="px-4 py-3">{toDisplayDate(submission.submittedAt)}</td>
                    <td className="px-4 py-3">{getAiStatusLabel(submission.aiFeedbackStatus)}</td>
                    <td className="px-4 py-3">{toDisplayText(submission.feedbackCount, "—")}</td>
                    <td className="px-4 py-3">{toDisplayText(submission.attemptNo, "—")}</td>
                    <td className="px-4 py-3">
                      {detailHref ? (
                        <Link href={detailHref} className="text-blue-700 hover:underline">
                          查看详情 / 批阅
                        </Link>
                      ) : (
                        <span className="text-zinc-500">缺少提交标识</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPagination ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600">
            第 {currentPage} / {totalPages} 页
          </span>

          {hasPrev ? (
            <Link
              href={buildPageHref(routePath, currentPage - 1)}
              className="text-blue-700 hover:underline"
            >
              上一页
            </Link>
          ) : (
            <span className="text-zinc-400">上一页</span>
          )}

          {hasNext ? (
            <Link
              href={buildPageHref(routePath, currentPage + 1)}
              className="text-blue-700 hover:underline"
            >
              下一页
            </Link>
          ) : (
            <span className="text-zinc-400">下一页</span>
          )}
        </div>
      ) : null}

    </section>
  );
}
