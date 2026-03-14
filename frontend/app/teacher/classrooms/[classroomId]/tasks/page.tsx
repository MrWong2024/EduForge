import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { PublishClassroomTaskForm } from "@/components/teacher/PublishClassroomTaskForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  toClassroomSummary,
  toClassroomTasksResponse,
  toLearningTaskListResponse,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";

type ClassroomTasksPageProps = {
  params: Promise<{ classroomId: string }>;
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
      availableTasks: ReturnType<typeof toLearningTaskListResponse>["items"];
    }
  | { mode: "error"; status: number; description: string };

export default async function ClassroomTasksPage({ params }: ClassroomTasksPageProps) {
  const { classroomId } = await params;
  let viewModel: TasksViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级任务列表失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, tasksPayload, learningTasksPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}/tasks`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>("learning-tasks/tasks?status=PUBLISHED&page=1&limit=50", {
        origin,
        cache: "no-store",
      }),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const taskList = toClassroomTasksResponse(tasksPayload);
    const learningTasks = toLearningTaskListResponse(learningTasksPayload);

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      taskList,
      availableTasks: learningTasks.items,
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
        description={`${toDisplayText(viewModel.classroomName, "班级")}（ID: ${classroomId}）`}
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
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>此页用于管理当前班级的课堂任务，可发布任务并进入提交管理与三件套分析页。</p>
      </section>

      <PublishClassroomTaskForm classroomId={classroomId} availableTasks={viewModel.availableTasks} />

      {viewModel.taskList.items.length === 0 ? (
        <EmptyState
          title="还没有课堂任务"
          description="先发布一个课堂任务，学生加入班级后即可开始提交。"
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
                <th className="px-4 py-3">AI 状态</th>
                <th className="px-4 py-3">管理</th>
                <th className="px-4 py-3">三件套入口</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.taskList.items.map((task, index) => {
                const classroomTaskId = task.classroomTaskId;
                return (
                  <tr
                    key={classroomTaskId ?? `classroom-task-${index}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">{toDisplayText(task.title, "未命名任务")}</td>
                    <td className="px-4 py-3">{toDisplayDate(task.dueAt)}</td>
                    <td className="px-4 py-3">
                      {typeof task.allowLate === "boolean" ? (task.allowLate ? "是" : "否") : "—"}
                    </td>
                    <td className="px-4 py-3">{getAiStatusLabel(task.aiStatus)}</td>
                    <td className="px-4 py-3">
                      {classroomTaskId ? (
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
                      ) : (
                        <span className="text-zinc-500">缺少 classroomTaskId</span>
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
                        <span className="text-zinc-500">缺少 classroomTaskId</span>
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
