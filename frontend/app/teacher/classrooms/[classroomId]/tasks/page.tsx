import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditClassroomTaskForm } from "@/components/teacher/EditClassroomTaskForm";
import { ClassroomTaskLifecycleActions } from "@/components/teacher/ClassroomTaskLifecycleActions";
import { PublishClassroomTaskForm } from "@/components/teacher/PublishClassroomTaskForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  toClassroomSummary,
  toClassroomTasksResponse,
  toPublishableTaskTemplateListResponse,
} from "@/lib/api/types-teacher";
import { normalizeTaskCourseLabel } from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { buildQueryString, getSingleSearchParam, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type ClassroomTasksPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{
    courseLabel?: string | string[];
    onlyMine?: string | string[];
    knowledgeModule?: string | string[];
    stage?: string | string[];
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

type TasksViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      taskList: ReturnType<typeof toClassroomTasksResponse>;
      availableTasks: ReturnType<typeof toPublishableTaskTemplateListResponse>["items"];
      availableTasksTotal?: number;
      availableTasksPage?: number;
      availableTasksLimit?: number;
      initialCourseLabelFilter?: string;
      initialOnlyMineFilter: boolean;
      initialKnowledgeModuleFilter?: string;
      initialStageFilter?: "1" | "2" | "3" | "4";
    }
  | { mode: "error"; status: number; description: string };

const parseOnlyMine = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

const parseStageFilter = (value: string | undefined): "1" | "2" | "3" | "4" | undefined => {
  if (value === "1" || value === "2" || value === "3" || value === "4") {
    return value;
  }
  return undefined;
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

const getSubmissionWindowStatus = (
  status: string | undefined,
  dueAt: string | null | undefined,
  allowLate: boolean | undefined,
): {
  label: "可提交" | "允许迟交" | "不可提交" | "状态未知";
  title: string;
  badgeClassName: string;
} => {
  if (status !== "ACTIVE") {
    return {
      label: "不可提交",
      title: "课堂任务未处于开放状态，学生不能继续提交。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (!dueAt) {
    return {
      label: "可提交",
      title: "课堂任务开放且未设置截止时间；最终提交权限仍以后端校验为准。",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  const dueTime = new Date(dueAt).getTime();
  if (!Number.isFinite(dueTime)) {
    return {
      label: "状态未知",
      title: "截止时间格式异常，无法判断提交窗口状态。",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  if (dueTime >= Date.now()) {
    return {
      label: "可提交",
      title: "课堂任务开放且尚未截止；最终提交权限仍以后端校验为准。",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (allowLate === true) {
    return {
      label: "允许迟交",
      title: "课堂任务已截止，但当前设置允许迟交；最终提交权限仍以后端校验为准。",
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "不可提交",
    title: "课堂任务已截止且未允许迟交。",
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
  };
};

export default async function ClassroomTasksPage({ params, searchParams }: ClassroomTasksPageProps) {
  const { classroomId } = await params;
  const query = await searchParams;
  const initialCourseLabelFilter = normalizeTaskCourseLabel(
    getSingleSearchParam(query.courseLabel)
  );
  const initialOnlyMineFilter = parseOnlyMine(getSingleSearchParam(query.onlyMine));
  const initialKnowledgeModuleFilter = getSingleSearchParam(query.knowledgeModule)?.trim() || undefined;
  const initialStageFilter = parseStageFilter(getSingleSearchParam(query.stage));
  let viewModel: TasksViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级任务列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const publishableQuery = buildQueryString({
      page: 1,
      limit: 50,
      courseLabel: initialCourseLabelFilter,
      onlyMine: initialOnlyMineFilter ? "true" : undefined,
      knowledgeModule: initialKnowledgeModuleFilter,
      stage: initialStageFilter ? Number(initialStageFilter) : undefined,
    });
    const [classroomPayload, tasksPayload, learningTasksPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}/tasks`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/publishable-task-templates?${publishableQuery}`,
        {
          origin,
          cache: "no-store",
        }
      ),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const taskList = toClassroomTasksResponse(tasksPayload);
    const learningTasks = toPublishableTaskTemplateListResponse(learningTasksPayload);

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      taskList,
      availableTasks: learningTasks.items,
      availableTasksTotal: learningTasks.total,
      availableTasksPage: learningTasks.page,
      availableTasksLimit: learningTasks.limit,
      initialCourseLabelFilter,
      initialOnlyMineFilter,
      initialKnowledgeModuleFilter,
      initialStageFilter,
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
      <ErrorState status={viewModel.status} title="课堂任务加载失败" description={viewModel.description} />
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="课堂任务"
        description={toDisplayText(viewModel.classroomName, "班级")}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
            <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-blue-700 hover:underline">
              查看班级看板
            </Link>
            <Link href={paths.teacher.classroomMembers(classroomId)} className="text-blue-700 hover:underline">
              成员管理
            </Link>
            <Link href={paths.teacher.tasksFromClassroom(classroomId)} className="text-blue-700 hover:underline">
              任务模板页
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页管理当前班级的课堂任务实例（classroom task）。</p>
        <p className="mt-1">
          这里先选择已发布任务模板，再配置截止时间、迟交与尝试次数等班级实例设置后发布。
        </p>
        <p className="mt-1">候选模板按当前班级与筛选条件实时检索，包含你自己的模板与可见共享模板。</p>
        <p className="mt-1">后端已自动排除当前班级已发布过的模板，并处理课程分类优先匹配排序。</p>
        <p className="mt-2">
          若没有合适模板，请先前往
          <Link
            href={paths.teacher.tasksFromClassroom(classroomId)}
            className="mx-1 text-blue-700 hover:underline"
          >
            任务模板页
          </Link>
          准备 `PUBLISHED` 模板，再回到本页发布到班级。
        </p>
      </section>

      <PublishClassroomTaskForm
        classroomId={classroomId}
        availableTasks={viewModel.availableTasks}
        initialAvailableTasksTotal={viewModel.availableTasksTotal}
        initialAvailableTasksPage={viewModel.availableTasksPage}
        initialAvailableTasksLimit={viewModel.availableTasksLimit}
        initialCourseLabelFilter={viewModel.initialCourseLabelFilter}
        initialOnlyMineFilter={viewModel.initialOnlyMineFilter}
        initialKnowledgeModuleFilter={viewModel.initialKnowledgeModuleFilter}
        initialStageFilter={viewModel.initialStageFilter}
      />

      {viewModel.taskList.items.length === 0 ? (
        <EmptyState
          title="还没有课堂任务"
          description="当前班级还没有已发布任务。请先准备可见的已发布模板（含共享模板），再回到本页发布到当前班级。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="#publish-task-form"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
              >
                发布任务
              </Link>
              <Link
                href={paths.teacher.classroomDashboard(classroomId)}
                className="text-sm text-blue-700 hover:underline"
              >
                返回班级看板
              </Link>
              <Link
                href={paths.teacher.tasksFromClassroom(classroomId)}
                className="text-sm text-blue-700 hover:underline"
              >
                去创建任务模板
              </Link>
            </div>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">任务标题</th>
                <th className="px-4 py-3">截止时间</th>
                <th className="px-4 py-3">允许迟交</th>
                <th className="px-4 py-3">最大尝试次数</th>
                <th className="px-4 py-3">模板模块</th>
                <th className="px-4 py-3">模板阶段</th>
                <th className="px-4 py-3">任务状态</th>
                <th className="px-4 py-3">管理</th>
                <th className="px-4 py-3">三件套入口</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.taskList.items.map((task, index) => {
                const classroomTaskId = task.classroomTaskId;
                const dueTimeStatus = getDueTimeStatus(task.dueAt);
                const submissionWindowStatus = getSubmissionWindowStatus(
                  task.status,
                  task.dueAt,
                  task.allowLate,
                );
                return (
                  <tr
                    key={classroomTaskId ?? `classroom-task-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <p>{toDisplayText(task.title, "未命名任务")}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        模板状态：{toDisplayText(task.taskStatus)}
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
                      {typeof task.allowLate === "boolean" ? (task.allowLate ? "是" : "否") : "—"}
                    </td>
                    <td className="px-4 py-3">{toDisplayText(task.maxAttempts)}</td>
                    <td className="px-4 py-3">{toDisplayText(task.knowledgeModule)}</td>
                    <td className="px-4 py-3">{toDisplayText(task.stage)}</td>
                    <td className="px-4 py-3">
                      <ClassroomTaskLifecycleActions
                        classroomId={classroomId}
                        classroomTaskId={classroomTaskId}
                        status={task.status}
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
                              href={paths.teacher.classroomTaskDetail(classroomId, classroomTaskId)}
                              className="text-blue-700 hover:underline"
                            >
                              任务详情
                            </Link>
                            <Link
                              href={paths.teacher.classroomTaskSubmissions(classroomId, classroomTaskId)}
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
                            maxAttempts={task.maxAttempts}
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
    </section>
  );
}
