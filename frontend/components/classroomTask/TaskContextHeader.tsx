"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/blocks/PageHeader";
import { Tabs } from "@/components/blocks/Tabs";
import { paths } from "@/lib/routes/paths";

type TaskContextHeaderProps = {
  classroomId: string;
  classroomTaskId: string;
};

export function TaskContextHeader({
  classroomId,
  classroomTaskId,
}: TaskContextHeaderProps) {
  const pathname = usePathname();
  const trajectoryHref = paths.teacher.classroomTaskTrajectory(classroomId, classroomTaskId);
  const reviewPackHref = paths.teacher.classroomTaskReviewPack(classroomId, classroomTaskId);
  const aiMetricsHref = paths.teacher.classroomTaskAiMetrics(classroomId, classroomTaskId);

  return (
    <section>
      <PageHeader
        title="Classroom Task Workspace"
        description={`Classroom ${classroomId} | Task ${classroomTaskId}`}
      />
      <Tabs
        activeHref={pathname}
        items={[
          { label: "Learning Trajectory", href: trajectoryHref },
          { label: "Review Pack", href: reviewPackHref },
          { label: "AI Metrics", href: aiMetricsHref },
        ]}
      />
    </section>
  );
}
