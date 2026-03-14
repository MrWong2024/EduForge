import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { toStudentDashboardResponse } from "@/lib/api/types-student";
import { paths } from "@/lib/routes/paths";
import { getAiStatusLabel, getCommonErrorSummary } from "@/lib/ui/status";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }

  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

type StudentDashboardViewModel =
  | {
      mode: "ready";
      data: ReturnType<typeof toStudentDashboardResponse>;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function StudentDashboardPage() {
  let viewModel: StudentDashboardViewModel = {
    mode: "error",
    status: 500,
    description: "加载学习看板失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>("classrooms/mine/dashboard", {
      origin,
      cache: "no-store",
    });

    viewModel = {
      mode: "ready",
      data: toStudentDashboardResponse(payload),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限访问学习看板。"
          : getCommonErrorSummary(error.status, "加载学习看板");

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="学习看板加载失败" description={viewModel.description} />
    );
  }

  const classroomItems = viewModel.data.items;

  return (
    <section>
      <PageHeader
        title="我的学习看板"
        description={`第 ${toDisplayText(viewModel.data.page, "1")} 页，每页 ${toDisplayText(
          viewModel.data.limit,
          "20"
        )} 条`}
        actions={
          <Link href={paths.student.joinClassroom} className="text-sm text-blue-700 hover:underline">
            去加入班级
          </Link>
        }
      />

      {classroomItems.length === 0 ? (
        <EmptyState
          title="还没有加入任何班级"
          description="先输入班级加入码加入班级，再开始做任务。"
          actions={
            <Link
              href={paths.student.joinClassroom}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              去加入班级
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {classroomItems.map((classroom, classroomIndex) => {
            const classroomId = classroom.classroomId;
            return (
              <section
                key={classroomId ?? `classroom-${classroomIndex}`}
                className="rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      {toDisplayText(classroom.classroomName, "未命名班级")}
                    </h2>
                    <p className="text-sm text-zinc-600">
                      班级 ID: {toDisplayText(classroom.classroomId)} | 状态: {toDisplayText(classroom.status)}
                    </p>
                  </div>
                  <p className="text-sm text-zinc-600">任务数: {classroom.tasks.length}</p>
                </div>

                {classroom.tasks.length === 0 ? (
                  <p className="text-sm text-zinc-600">当前班级暂无任务。</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-zinc-100">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-zinc-50 text-left text-zinc-600">
                        <tr>
                          <th className="px-4 py-2">任务</th>
                          <th className="px-4 py-2">截止时间</th>
                          <th className="px-4 py-2">提交次数</th>
                          <th className="px-4 py-2">AI 状态</th>
                          <th className="px-4 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classroom.tasks.map((task, taskIndex) => {
                          const taskPath =
                            classroomId && task.classroomTaskId
                              ? paths.student.taskDetail(classroomId, task.classroomTaskId)
                              : null;

                          return (
                            <tr
                              key={task.classroomTaskId ?? `task-${taskIndex}`}
                              className="border-t border-zinc-100"
                            >
                              <td className="px-4 py-2">{toDisplayText(task.title, "未命名任务")}</td>
                              <td className="px-4 py-2">{toDisplayDate(task.dueAt)}</td>
                              <td className="px-4 py-2">{toDisplayText(task.mySubmissionsCount, "0")}</td>
                              <td className="px-4 py-2">{getAiStatusLabel(task.aiFeedbackStatus)}</td>
                              <td className="px-4 py-2">
                                {taskPath ? (
                                  <Link href={taskPath} className="text-blue-700 hover:underline">
                                    查看详情
                                  </Link>
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
          })}
        </div>
      )}

      <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始数据（调试用）
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.data.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
