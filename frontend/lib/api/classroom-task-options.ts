import { fetchJson } from "@/lib/api/client";
import { toClassroomTasksResponse } from "@/lib/api/types-teacher";
import { buildQueryString } from "@/lib/ui/format";

const TASK_OPTION_PAGE_SIZE = 100;
const MAX_TASK_OPTION_PAGES = 20;

export type ClassroomTaskOption = {
  id: string;
  title: string;
  publishedAt?: string;
  dueAt?: string;
  status?: string;
};

type LoadAllClassroomTaskOptionsParams = {
  classroomId: string;
  origin: string;
};

export async function loadAllClassroomTaskOptions({
  classroomId,
  origin,
}: LoadAllClassroomTaskOptionsParams): Promise<ClassroomTaskOption[]> {
  const taskOptions: ClassroomTaskOption[] = [];
  const seenTaskIds = new Set<string>();

  for (let page = 1; page <= MAX_TASK_OPTION_PAGES; page += 1) {
    const query = buildQueryString({
      page,
      limit: TASK_OPTION_PAGE_SIZE,
    });
    const payload = await fetchJson<unknown>(
      `classrooms/${encodeURIComponent(classroomId)}/tasks?${query}`,
      {
        origin,
        cache: "no-store",
      },
    );
    const taskList = toClassroomTasksResponse(payload);
    let addedCount = 0;

    for (const task of taskList.items) {
      const id = task.classroomTaskId?.trim();
      if (!id || seenTaskIds.has(id)) {
        continue;
      }

      seenTaskIds.add(id);
      addedCount += 1;
      taskOptions.push({
        id,
        title: task.title?.trim() || "未命名任务",
        ...(task.publishedAt ? { publishedAt: task.publishedAt } : {}),
        ...(task.dueAt ? { dueAt: task.dueAt } : {}),
        ...(task.status ? { status: task.status } : {}),
      });
    }

    if (
      (typeof taskList.total === "number" &&
        taskOptions.length >= taskList.total) ||
      taskList.items.length < TASK_OPTION_PAGE_SIZE ||
      addedCount === 0
    ) {
      break;
    }
  }

  return taskOptions;
}
