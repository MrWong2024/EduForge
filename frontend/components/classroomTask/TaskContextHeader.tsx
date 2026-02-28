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
        title="课堂任务工作区"
        description={`班级 ${classroomId} | 任务 ${classroomTaskId}`}
      />
      <Tabs
        activeHref={pathname}
        items={[
          { label: "学习轨迹", href: trajectoryHref },
          { label: "课堂复盘", href: reviewPackHref },
          { label: "AI 指标", href: aiMetricsHref },
        ]}
      />
    </section>
  );
}
