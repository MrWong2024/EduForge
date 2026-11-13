import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { CreateLearningTaskForm } from "@/components/teacher/CreateLearningTaskForm";
import { LearningTaskFilters } from "@/components/teacher/LearningTaskFilters";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import { getMe } from "@/lib/auth/session";
import {
  LEARNING_TASK_STATUSES,
  type LearningTaskStatus,
  toLearningTaskListResponse,
} from "@/lib/api/types-teacher";
import { normalizeTaskCourseLabel } from "@/lib/learning-tasks/course-labels";
import { parseDifficultyFilter } from "@/lib/learning-tasks/difficulty";
import {
  DEFAULT_TASK_TEMPLATE_SCOPE,
  normalizeTaskTemplateScope,
} from "@/lib/learning-tasks/template-visibility-scope";
import { isValidPaginationTotal } from "@/lib/pagination";
import { paths } from "@/lib/routes/paths";
import {
  buildQueryString,
  getSingleSearchParam,
  parsePositiveInt,
} from "@/lib/ui/format";
import { getCommonErrorSummary } from "@/lib/ui/status";

export const metadata: Metadata = {
  title: "任务模板",
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

type LearningTasksViewModel =
  | {
      mode: "ready";
      taskList: ReturnType<typeof toLearningTaskListResponse>;
      total: number;
      currentUserId?: string;
    }
  | { mode: "error"; status?: number; description: string };

type TeacherLearningTasksPageProps = {
  searchParams: Promise<{
    fromClassroomId?: string | string[];
    page?: string | string[];
    status?: string | string[];
    knowledgeModule?: string | string[];
    courseLabel?: string | string[];
    difficulty?: string | string[];
    scope?: string | string[];
  }>;
};

const TASK_TEMPLATE_PAGE_LIMIT = 100;

const normalizeTaskStatusFilter = (
  value: string | undefined,
): LearningTaskStatus | undefined => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  return LEARNING_TASK_STATUSES.find((status) => status === normalized);
};

const normalizeKnowledgeModuleFilter = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export default async function TeacherLearningTasksPage({
  searchParams,
}: TeacherLearningTasksPageProps) {
  const query = await searchParams;
  const fromClassroomId =
    getSingleSearchParam(query.fromClassroomId)?.trim() || undefined;
  const initialPage = parsePositiveInt(getSingleSearchParam(query.page), 1, {
    min: 1,
  });
  const initialStatusFilter = normalizeTaskStatusFilter(
    getSingleSearchParam(query.status),
  );
  const initialKnowledgeModuleFilter = normalizeKnowledgeModuleFilter(
    getSingleSearchParam(query.knowledgeModule),
  );
  const initialCourseLabelFilter = normalizeTaskCourseLabel(
    getSingleSearchParam(query.courseLabel),
  );
  const initialDifficultyFilter = parseDifficultyFilter(query.difficulty);
  const initialScope =
    normalizeTaskTemplateScope(getSingleSearchParam(query.scope)) ??
    DEFAULT_TASK_TEMPLATE_SCOPE;

  let viewModel: LearningTasksViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务模板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const listQuery = buildQueryString({
      page: initialPage,
      limit: TASK_TEMPLATE_PAGE_LIMIT,
      scope: initialScope,
      courseLabel: initialCourseLabelFilter,
      difficulty: initialDifficultyFilter,
      status: initialStatusFilter,
      knowledgeModule: initialKnowledgeModuleFilter,
    });
    const [payload, me] = await Promise.all([
      fetchJson<unknown>(`learning-tasks/tasks?${listQuery}`, {
        origin,
        cache: "no-store",
      }),
      getMe().catch(() => null),
    ]);

    const taskList = toLearningTaskListResponse(payload);
    if (isValidPaginationTotal(taskList.total)) {
      viewModel = {
        mode: "ready",
        taskList,
        total: taskList.total,
        currentUserId:
          typeof me?.id === "string" && me.id.trim() ? me.id.trim() : undefined,
      };
    } else {
      viewModel = {
        mode: "error",
        description: "任务模板列表数据不完整，请刷新后重试。",
      };
    }
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(
          getCommonErrorSummary(error.status, "加载任务模板"),
          detail,
        ),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState
        status={viewModel.status}
        title="任务模板加载失败"
        description={viewModel.description}
      />
    );
  }

  const totalTaskTemplates = viewModel.total;
  const taskTemplateLimit =
    typeof viewModel.taskList.limit === "number" &&
    Number.isFinite(viewModel.taskList.limit) &&
    viewModel.taskList.limit > 0
      ? Math.floor(viewModel.taskList.limit)
      : TASK_TEMPLATE_PAGE_LIMIT;
  const responseTaskTemplatePage =
    typeof viewModel.taskList.page === "number" &&
    Number.isFinite(viewModel.taskList.page) &&
    viewModel.taskList.page > 0
      ? Math.floor(viewModel.taskList.page)
      : initialPage;
  const totalTaskTemplatePages = Math.max(
    1,
    Math.ceil(totalTaskTemplates / taskTemplateLimit),
  );
  const currentTaskTemplatePage = Math.min(
    responseTaskTemplatePage,
    totalTaskTemplatePages,
  );
  const showTaskTemplatePagination =
    totalTaskTemplates > TASK_TEMPLATE_PAGE_LIMIT;
  const buildTaskTemplatePageHref = (page: number) =>
    `${paths.teacher.tasks}?${buildQueryString({
      fromClassroomId,
      page,
      status: initialStatusFilter,
      knowledgeModule: initialKnowledgeModuleFilter,
      courseLabel: initialCourseLabelFilter,
      difficulty: initialDifficultyFilter,
      scope: initialScope,
    })}`;

  return (
    <section className="space-y-4">
      <PageHeader
        title="任务模板"
        description="创建并管理可复用的任务模板；创建后请到班级任务页发布到具体班级。"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {fromClassroomId ? (
              <Link
                href={paths.teacher.classroomTasks(fromClassroomId)}
                className="text-blue-700 hover:underline"
              >
                返回当前班级任务页
              </Link>
            ) : null}
            <Link
              href={paths.teacher.classrooms}
              className="text-blue-700 hover:underline"
            >
              返回班级列表
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>本页用于创建任务模板。</p>
        <p className="mt-1">
          在班级任务页选择模板后，可将任务布置到班级。
        </p>
        <p className="mt-1">
          班级发布页当前只显示已发布模板；创建区使用“保存为草稿 /
          发布模板”动作决定初始状态。
        </p>
        <p className="mt-1">先筛选模板，再去班级任务页发布，效率更高。</p>
        <p className="mt-1">
          评阅标准在模板中填写，班级发布页不单独配置。
        </p>
        <p className="mt-1">
          课程分类仅用于模板治理，不代表班级绑定课程，也不限制跨课程复用。
        </p>
        <p className="mt-1">
          默认视图为“我的模板”；切换到共享/全部视图只影响可见性，不改变作者权限边界。
        </p>
        {fromClassroomId ? (
          <p className="mt-2 text-sm text-blue-700">
            你正从班级任务页进入。建议先筛选已发布
            模板，选定后返回班级发布。
          </p>
        ) : null}
      </section>

      <CreateLearningTaskForm />

      <p className="text-sm text-zinc-600">
        共 {totalTaskTemplates} 个任务模板，当前显示{" "}
        {viewModel.taskList.items.length} 个
      </p>

      <div className="[&>section:nth-of-type(2)>p:last-child]:hidden [&>section:nth-of-type(3)]:hidden">
        <LearningTaskFilters
          tasks={viewModel.taskList.items}
          currentUserId={viewModel.currentUserId}
          initialScope={initialScope}
          initialStatus={initialStatusFilter}
          initialKnowledgeModule={initialKnowledgeModuleFilter}
          initialCourseLabel={initialCourseLabelFilter}
          initialDifficultyFilter={initialDifficultyFilter}
          initialPage={viewModel.taskList.page ?? initialPage}
          initialLimit={viewModel.taskList.limit ?? TASK_TEMPLATE_PAGE_LIMIT}
          total={viewModel.total}
        />
      </div>

      {showTaskTemplatePagination ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600">
            第 {currentTaskTemplatePage} / {totalTaskTemplatePages} 页
          </span>
          {currentTaskTemplatePage > 1 ? (
            <Link
              href={buildTaskTemplatePageHref(currentTaskTemplatePage - 1)}
              className="text-blue-700 hover:underline"
            >
              上一页
            </Link>
          ) : (
            <span className="text-zinc-400">上一页</span>
          )}
          {currentTaskTemplatePage < totalTaskTemplatePages ? (
            <Link
              href={buildTaskTemplatePageHref(currentTaskTemplatePage + 1)}
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
