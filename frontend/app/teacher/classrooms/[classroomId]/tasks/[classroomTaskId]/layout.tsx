import type { ReactNode } from "react";
import { TaskContextHeader } from "@/components/classroomTask/TaskContextHeader";

type ClassroomTaskLayoutProps = {
  children: ReactNode;
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function ClassroomTaskLayout({
  children,
  params,
}: ClassroomTaskLayoutProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <section>
      <TaskContextHeader classroomId={classroomId} classroomTaskId={classroomTaskId} />
      {children}
    </section>
  );
}
