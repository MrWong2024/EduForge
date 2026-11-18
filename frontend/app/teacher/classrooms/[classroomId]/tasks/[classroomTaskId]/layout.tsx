import type { ReactNode } from "react";
import { TaskContextHeader } from "@/components/classroomTask/TaskContextHeader";
import { fetchJson } from "@/lib/api/client";
import {
  toClassroomDetailResponse,
  toClassroomTask,
} from "@/lib/api/types-teacher";

type ClassroomTaskLayoutProps = {
  children: ReactNode;
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function ClassroomTaskLayout({
  children,
  params,
}: ClassroomTaskLayoutProps) {
  const { classroomId, classroomTaskId } = await params;
  let classroomName: string | undefined;
  let taskTitle: string | undefined;

  try {
    [classroomName, taskTitle] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      })
        .then((payload) => toClassroomDetailResponse(payload).name)
        .catch(() => undefined),
      fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      )
        .then((payload) => toClassroomTask(payload).title)
        .catch(() => undefined),
    ]);
  } catch {
    // Context labels are auxiliary and must not replace the child page.
  }

  return (
    <section>
      <TaskContextHeader
        classroomId={classroomId}
        classroomTaskId={classroomTaskId}
        classroomName={classroomName}
        taskTitle={taskTitle}
      />
      {children}
    </section>
  );
}
