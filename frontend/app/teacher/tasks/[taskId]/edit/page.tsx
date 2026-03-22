import Link from "next/link";
import { headers } from "next/headers";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EditLearningTaskForm } from "@/components/teacher/EditLearningTaskForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toLearningTaskDetailResponse } from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayText } from "@/lib/ui/format";

type EditLearningTaskPageProps = {
  params: Promise<{ taskId: string }>;
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

type EditTaskViewModel =
  | {
      mode: "ready";
      task: ReturnType<typeof toLearningTaskDetailResponse>;
      taskId: string;
    }
  | { mode: "error"; status: number; description: string };

const getTaskLoadSummary = (status: number): string => {
  if (status === 403) {
    return "无权限编辑该任务模板。";
  }
  if (status === 404) {
    return "任务模板不存在或功能未启用/不可用。";
  }
  return getCommonErrorSummary(status, "加载任务模板");
};

export default async function EditLearningTaskPage({ params }: EditLearningTaskPageProps) {
  const { taskId } = await params;
  let viewModel: EditTaskViewModel = {
    mode: "error",
    status: 500,
    description: "加载任务模板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `learning-tasks/tasks/${encodeURIComponent(taskId)}`,
      {
        origin,
        cache: "no-store",
      }
    );

    viewModel = {
      mode: "ready",
      task: toLearningTaskDetailResponse(payload),
      taskId,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getTaskLoadSummary(error.status), detail),
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
        title="编辑任务模板"
        description={`模板：${toDisplayText(viewModel.task.title, "未命名模板")} | 状态：${toDisplayText(
          viewModel.task.status
        )}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={paths.teacher.tasks} className="text-blue-700 hover:underline">
              返回任务模板页
            </Link>
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页用于维护 learning task 模板字段与基础评分配置。</p>
        <p className="mt-1">
          当前模板：{toDisplayText(viewModel.task.title, "未命名模板")}（状态：
          {toDisplayText(viewModel.task.status)}）
        </p>
      </section>

      <EditLearningTaskForm taskId={viewModel.taskId} initialTask={viewModel.task} />
    </section>
  );
}
