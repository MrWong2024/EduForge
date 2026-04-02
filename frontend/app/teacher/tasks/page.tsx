import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { CreateLearningTaskForm } from "@/components/teacher/CreateLearningTaskForm";
import { LearningTaskFilters } from "@/components/teacher/LearningTaskFilters";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toLearningTaskListResponse } from "@/lib/api/types-teacher";
import { normalizeTaskCourseLabel } from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";
import { buildQueryString, getSingleSearchParam } from "@/lib/ui/format";
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
    }
  | { mode: "error"; status: number; description: string };

type TeacherLearningTasksPageProps = {
  searchParams: Promise<{
    fromClassroomId?: string | string[];
    status?: string | string[];
    knowledgeModule?: string | string[];
    stage?: string | string[];
    courseLabel?: string | string[];
  }>;
};

export default async function TeacherLearningTasksPage({
  searchParams,
}: TeacherLearningTasksPageProps) {
  const query = await searchParams;
  const fromClassroomId = getSingleSearchParam(query.fromClassroomId)?.trim() || undefined;
  const initialStatusFilter = getSingleSearchParam(query.status)?.trim() || undefined;
  const initialKnowledgeModuleFilter =
    getSingleSearchParam(query.knowledgeModule)?.trim() || undefined;
  const initialStageFilter = getSingleSearchParam(query.stage)?.trim() || undefined;
  const initialCourseLabelFilter = normalizeTaskCourseLabel(
    getSingleSearchParam(query.courseLabel)
  );

  let viewModel: LearningTasksViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务模板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const listQuery = buildQueryString({
      page: 1,
      limit: 100,
      courseLabel: initialCourseLabelFilter,
    });
    const payload = await fetchJson<unknown>(`learning-tasks/tasks?${listQuery}`, {
      origin,
      cache: "no-store",
    });

    viewModel = {
      mode: "ready",
      taskList: toLearningTaskListResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(
          getCommonErrorSummary(error.status, "加载任务模板"),
          detail
        ),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="任务模板加载失败" description={viewModel.description} />
    );
  }

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
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>本页创建的是 learning task（任务模板）。</p>
        <p className="mt-1">
          班级任务页发布的是 classroom task（班级实例），两者职责分离。
        </p>
        <p className="mt-1">
          班级发布页当前只显示 `PUBLISHED` 模板；若创建为 `DRAFT`，需后续发布后才会出现在班级发布选择中。
        </p>
        <p className="mt-1">先筛选模板，再去班级任务页发布，效率更高。</p>
        <p className="mt-1">rubric 用于模板层的基础评分参考，班级发布页不配置 rubric。</p>
        <p className="mt-1">课程分类仅用于模板治理，不代表班级绑定课程，也不限制跨课程复用。</p>
        {fromClassroomId ? (
          <p className="mt-2 text-sm text-blue-700">
            你正从班级任务页进入。建议先筛选 `PUBLISHED` 模板，选定后返回班级发布。
          </p>
        ) : null}
      </section>

      <CreateLearningTaskForm />

      <LearningTaskFilters
        tasks={viewModel.taskList.items}
        initialStatus={initialStatusFilter}
        initialKnowledgeModule={initialKnowledgeModuleFilter}
        initialStage={initialStageFilter}
        initialCourseLabel={initialCourseLabelFilter}
      />
    </section>
  );
}
