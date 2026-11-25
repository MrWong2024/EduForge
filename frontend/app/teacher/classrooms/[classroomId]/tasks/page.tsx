import Link from "next/link";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditClassroomTaskForm } from "@/components/teacher/EditClassroomTaskForm";
import { ClassroomTaskLifecycleActions } from "@/components/teacher/ClassroomTaskLifecycleActions";
import { ClassroomTaskDeletionNotice, ClassroomTaskListInteractions } from "@/components/teacher/ClassroomTaskListInteractions";
import { PublishClassroomTaskForm } from "@/components/teacher/PublishClassroomTaskForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toClassroomSummary,
  toClassroomTasksResponse,
  toPublishableTaskTemplateListResponse,
} from "@/lib/api/types-teacher";
import { getMe } from "@/lib/auth/session";
import { getClassroomTaskSubmissionWindowStatus } from "@/lib/classroom-task-settings";
import { normalizeTaskCourseLabel } from "@/lib/learning-tasks/course-labels";
import { parseDifficultyFilter } from "@/lib/learning-tasks/difficulty";
import { getTaskSnapshotMessage } from "@/lib/learning-tasks/ai-review";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  buildQueryString,
  getPublisherLabel,
  getSingleSearchParam,
  parsePositiveInt,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type ClassroomTasksPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{
    page?: string | string[];
    courseLabel?: string | string[];
    onlyMine?: string | string[];
    knowledgeModule?: string | string[];
    difficulty?: string | string[];
  }>;
};

const CLASSROOM_TASKS_PAGE_SIZE = 100;
const PUBLISHED_TASKS_HEADING_ID = "published-classroom-tasks";

type TasksViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      classroomArchived: boolean;
      taskList: ReturnType<typeof toClassroomTasksResponse>;
      availableTasks: ReturnType<
        typeof toPublishableTaskTemplateListResponse
      >["items"];
      availableTasksTotal?: number;
      availableTasksPage?: number;
      availableTasksLimit?: number;
      initialCourseLabelFilter?: string;
      initialOnlyMineFilter: boolean;
      initialKnowledgeModuleFilter?: string;
      initialDifficultyFilter?: ReturnType<typeof parseDifficultyFilter>;
      currentUserId?: string;
    }
  | { mode: "error"; status: number; description: string };

const parseOnlyMine = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

const getDueTimeStatus = (
  dueAt: string | null | undefined,
): {
  label: "未截止" | "已截止" | "无截止时间" | "时间异常";
  title: string;
  badgeClassName: string;
} => {
  if (!dueAt) {
    return {
      label: "无截止时间",
      title: "该课堂任务未设置截止时间。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  const dueTime = new Date(dueAt).getTime();
  if (!Number.isFinite(dueTime)) {
    return {
      label: "时间异常",
      title: "截止时间格式异常，请检查任务设置。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (dueTime < Date.now()) {
    return {
      label: "已截止",
      title: "截止时间已过；是否允许迟交取决于任务设置。",
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "未截止",
    title: "截止时间尚未到达。",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
};

const getTemplateStatusBadge = (
  status: string | null | undefined,
): { label: string; className: string } | null => {
  if (status === "ARCHIVED") {
    return {
      label: "模板已归档",
      className: "border-zinc-200 bg-zinc-50 text-zinc-600",
    };
  }

  return null;
};

export default async function ClassroomTasksPage({
  params,
  searchParams,
}: ClassroomTasksPageProps) {
  const { classroomId } = await params;
  const query = await searchParams;
  const currentPublishedTasksPage = parsePositiveInt(
    getSingleSearchParam(query.page),
    1,
    { min: 1 },
  );
  const initialCourseLabelFilter = normalizeTaskCourseLabel(
    getSingleSearchParam(query.courseLabel),
  );
  const initialOnlyMineFilter = parseOnlyMine(
    getSingleSearchParam(query.onlyMine),
  );
  const initialKnowledgeModuleFilter =
    getSingleSearchParam(query.knowledgeModule)?.trim() || undefined;
  const initialDifficultyFilter = parseDifficultyFilter(query.difficulty);
  let viewModel: TasksViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级任务列表失败，请稍后重试。",
  };

  try {
    const publishableQuery = buildQueryString({
      page: 1,
      limit: 50,
      courseLabel: initialCourseLabelFilter,
      onlyMine: initialOnlyMineFilter ? "true" : undefined,
      knowledgeModule: initialKnowledgeModuleFilter,
      difficulty: initialDifficultyFilter,
    });
    const publishedTasksQuery = buildQueryString({
      page: currentPublishedTasksPage,
      limit: CLASSROOM_TASKS_PAGE_SIZE,
    });
    const classroomPromise = fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}`,
      { cache: "no-store" },
    ).then(toClassroomSummary);
    const [classroom, tasksPayload, learningTasks, me] = await Promise.all([
      classroomPromise,
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks?${publishedTasksQuery}`,
        { cache: "no-store" },
      ),
      classroomPromise.then(async ({ status }) => {
        if (status === "ARCHIVED") {
          return undefined;
        }
        const candidates = await fetchJson<unknown>(
          `classrooms/${encodeURIComponent(classroomId)}/publishable-task-templates?${publishableQuery}`,
          { cache: "no-store" },
        );
        return toPublishableTaskTemplateListResponse(candidates);
      }),
      getMe().catch(() => null),
    ]);

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      classroomArchived: classroom.status === "ARCHIVED",
      taskList: toClassroomTasksResponse(tasksPayload),
      availableTasks: learningTasks?.items ?? [],
      availableTasksTotal: learningTasks?.total,
      availableTasksPage: learningTasks?.page,
      availableTasksLimit: learningTasks?.limit,
      initialCourseLabelFilter,
      initialOnlyMineFilter,
      initialKnowledgeModuleFilter,
      initialDifficultyFilter,
      currentUserId:
        typeof me?.id === "string" && me.id.trim() ? me.id.trim() : undefined,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限管理任务。"
          : getCommonErrorSummary(error.status, "加载班级任务列表");
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
        title="课堂任务加载失败"
        description={viewModel.description}
      />
    );
  }

  const totalPublishedTasks =
    typeof viewModel.taskList.total === "number"
      ? viewModel.taskList.total
      : viewModel.taskList.items.length;
  const publishedTasksLimit =
    typeof viewModel.taskList.limit === "number" &&
    Number.isFinite(viewModel.taskList.limit) &&
    viewModel.taskList.limit > 0
      ? Math.floor(viewModel.taskList.limit)
      : CLASSROOM_TASKS_PAGE_SIZE;
  const responsePublishedTasksPage =
    typeof viewModel.taskList.page === "number" &&
    Number.isFinite(viewModel.taskList.page) &&
    viewModel.taskList.page > 0
      ? Math.floor(viewModel.taskList.page)
      : currentPublishedTasksPage;
  const totalPublishedTaskPages = Math.max(
    1,
    Math.ceil(totalPublishedTasks / publishedTasksLimit),
  );
  const currentPublishedTaskPage = Math.min(
    responsePublishedTasksPage,
    totalPublishedTaskPages,
  );
  const showPublishedTasksPagination = totalPublishedTaskPages > 1;
  const buildPublishedTasksHref = (page: number) =>
    `${paths.teacher.classroomTasks(classroomId)}?${buildQueryString({
      page,
      courseLabel: initialCourseLabelFilter,
      onlyMine: initialOnlyMineFilter ? "true" : undefined,
      knowledgeModule: initialKnowledgeModuleFilter,
      difficulty: initialDifficultyFilter,
    })}`;

  const validPageHref =
    typeof viewModel.taskList.total === "number" &&
    currentPublishedTasksPage > totalPublishedTaskPages
      ? buildPublishedTasksHref(totalPublishedTaskPages)
      : undefined;

  const taskPage = (
    <section className="space-y-4">
      <PageHeader
        title="课堂任务"
        description={toDisplayText(viewModel.classroomName, "班级")}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href={paths.teacher.classrooms}
              className="text-blue-700 hover:underline"
            >
              返回班级列表
            </Link>
            <Link
              href={paths.teacher.classroomDashboard(classroomId)}
              className="text-blue-700 hover:underline"
            >
              查看班级看板
            </Link>
            <Link
              href={paths.teacher.classroomMembers(classroomId)}
              className="text-blue-700 hover:underline"
            >
              成员管理
            </Link>
            <Link
              href={
                viewModel.classroomArchived
                  ? paths.teacher.tasks
                  : paths.teacher.tasksFromClassroom(classroomId)
              }
              className="text-blue-700 hover:underline"
            >
              任务模板页
            </Link>
          </div>
        }
      />

      {viewModel.classroomArchived ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          班级已归档，不能发布新任务，学生不能新提交。
        </p>
      ) : (
        <>
          <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
            <p>此页管理本班课堂任务。</p>
            <p className="mt-1">
              这里先选择已发布任务模板，再配置截止时间与迟交设置后发布到班级。
            </p>
            <p className="mt-1">
              候选模板按当前班级与筛选条件实时检索，包含你自己的模板与可见共享模板。
            </p>
            <p className="mt-1">
              候选列表不包含已布置到本班的模板，并优先显示与课程分类匹配的模板。
            </p>
            <p className="mt-2">
              若没有合适模板，请先前往
              <Link
                href={paths.teacher.tasksFromClassroom(classroomId)}
                className="mx-1 text-blue-700 hover:underline"
              >
                任务模板页
              </Link>
              准备已发布模板，再回到本页发布到班级。
            </p>
          </section>
          <PublishClassroomTaskForm
            classroomId={classroomId}
            currentUserId={viewModel.currentUserId}
            availableTasks={viewModel.availableTasks}
            initialAvailableTasksTotal={viewModel.availableTasksTotal}
            initialAvailableTasksPage={viewModel.availableTasksPage}
            initialAvailableTasksLimit={viewModel.availableTasksLimit}
            initialCourseLabelFilter={viewModel.initialCourseLabelFilter}
            initialOnlyMineFilter={viewModel.initialOnlyMineFilter}
            initialKnowledgeModuleFilter={viewModel.initialKnowledgeModuleFilter}
            initialDifficultyFilter={viewModel.initialDifficultyFilter}
          />
        </>
      )}

      <h2 id={PUBLISHED_TASKS_HEADING_ID} tabIndex={-1} className="text-base font-semibold text-zinc-900">
        已发布的课堂任务
      </h2>
      <ClassroomTaskDeletionNotice />
      <p className="text-sm text-zinc-600">
        共 {totalPublishedTasks} 个课堂任务，当前显示{" "}
        {viewModel.taskList.items.length} 个
      </p>

      {validPageHref ? (
        <p role="status" className="text-sm text-zinc-600">正在加载课堂任务列表…</p>
      ) : viewModel.taskList.items.length === 0 ? (
        <EmptyState
          title="还没有课堂任务"
          description={
            viewModel.classroomArchived
              ? "当前列表没有课堂任务。"
              : "当前班级还没有已发布任务。请先准备可见的已发布模板（含共享模板），再回到本页发布到当前班级。"
          }
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {!viewModel.classroomArchived ? (
                <Link
                  href={`${buildPublishedTasksHref(currentPublishedTaskPage)}#publish-task-form`}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  发布任务
                </Link>
              ) : null}
              <Link
                href={paths.teacher.classroomDashboard(classroomId)}
                className="text-sm text-blue-700 hover:underline"
              >
                返回班级看板
              </Link>
              {!viewModel.classroomArchived ? (
                <Link
                  href={paths.teacher.tasksFromClassroom(classroomId)}
                  className="text-sm text-blue-700 hover:underline"
                >
                  去创建任务模板
                </Link>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">任务标题</th>
                <th className="px-4 py-3">发布内容</th>
                <th className="px-4 py-3">截止时间</th>
                <th className="px-4 py-3">允许迟交</th>
                <th className="px-4 py-3">模板模块</th>
                <th className="px-4 py-3">任务状态</th>
                <th className="px-4 py-3">管理</th>
                <th className="px-4 py-3">任务分析</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.taskList.items.map((task, index) => {
                const classroomTaskId = task.classroomTaskId;
                const taskTitle = toDisplayText(task.title, "未命名任务");
                const dueTimeStatus = getDueTimeStatus(task.dueAt);
                const submissionWindowStatus = getClassroomTaskSubmissionWindowStatus(
                  viewModel.classroomArchived,
                  task.status,
                  task.dueAt,
                  task.allowLate,
                );
                const templateStatusBadge = getTemplateStatusBadge(
                  task.taskStatus,
                );
                const publisherLabel = getPublisherLabel(
                  task.taskPublisher,
                  viewModel.currentUserId,
                );
                return (
                  <tr
                    key={classroomTaskId ?? `classroom-task-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="font-medium text-zinc-900">
                          {taskTitle}
                        </p>
                        {publisherLabel ? (
                          <div>
                            <span className="inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                              {publisherLabel}
                            </span>
                          </div>
                        ) : null}
                        {templateStatusBadge ? (
                          <div>
                            <span
                              className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${templateStatusBadge.className}`}
                            >
                              {templateStatusBadge.label}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="mt-1 max-w-xs whitespace-normal break-words text-xs text-zinc-500">
                        {getTaskSnapshotMessage(task.taskSnapshotAvailable)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        title={dueTimeStatus.title}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${dueTimeStatus.badgeClassName}`}
                      >
                        {dueTimeStatus.label}
                      </span>
                      <p className="mt-1 text-xs text-zinc-500">
                        {toDisplayDate(task.dueAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {typeof task.allowLate === "boolean"
                        ? task.allowLate
                          ? "是"
                          : "否"
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {toDisplayText(task.knowledgeModule)}
                    </td>
                    <td className="px-4 py-3">
                      <ClassroomTaskLifecycleActions
                        classroomId={classroomId}
                        classroomTaskId={classroomTaskId}
                        taskTitle={taskTitle}
                        status={task.status}
                        classroomArchived={viewModel.classroomArchived}
                        listHeadingId={PUBLISHED_TASKS_HEADING_ID}
                        submissionWindowBadge={
                          <span
                            title={submissionWindowStatus.title}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${submissionWindowStatus.badgeClassName}`}
                          >
                            {submissionWindowStatus.label}
                          </span>
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      {classroomTaskId ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-3">
                            <Link
                              href={paths.teacher.classroomTaskDetail(
                                classroomId,
                                classroomTaskId,
                              )}
                              className="text-blue-700 hover:underline"
                            >
                              任务详情
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskSubmissions(
                                classroomId,
                                classroomTaskId,
                              )}
                              className="text-blue-700 hover:underline"
                            >
                              提交管理
                            </Link>
                          </div>
                          <EditClassroomTaskForm
                            classroomId={classroomId}
                            classroomTaskId={classroomTaskId}
                            status={task.status}
                            dueAt={task.dueAt}
                            allowLate={task.allowLate}
                          />
                        </div>
                      ) : (
                        <span className="text-zinc-500">缺少课堂任务标识</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {classroomTaskId ? (
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={paths.teacher.classroomTaskTrajectory(
                              classroomId,
                              classroomTaskId,
                            )}
                            className="text-blue-700 hover:underline"
                          >
                            学习轨迹
                          </Link>
                          <Link
                            href={paths.teacher.classroomTaskReviewPack(
                              classroomId,
                              classroomTaskId,
                            )}
                            className="text-blue-700 hover:underline"
                          >
                            课堂复盘
                          </Link>
                          <Link
                            href={paths.teacher.classroomTaskAiMetrics(
                              classroomId,
                              classroomTaskId,
                            )}
                            className="text-blue-700 hover:underline"
                          >
                            AI 指标
                          </Link>
                        </div>
                      ) : (
                        <span className="text-zinc-500">缺少课堂任务标识</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPublishedTasksPagination ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600">
            第 {currentPublishedTaskPage} / {totalPublishedTaskPages} 页
          </span>
          {currentPublishedTaskPage > 1 ? (
            <Link
              href={buildPublishedTasksHref(currentPublishedTaskPage - 1)}
              className="text-blue-700 hover:underline"
            >
              上一页
            </Link>
          ) : (
            <span className="text-zinc-400">上一页</span>
          )}
          {currentPublishedTaskPage < totalPublishedTaskPages ? (
            <Link
              href={buildPublishedTasksHref(currentPublishedTaskPage + 1)}
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

  return (
    <ClassroomTaskListInteractions key={classroomId} validPageHref={validPageHref}>
      {taskPage}
    </ClassroomTaskListInteractions>
  );
}
