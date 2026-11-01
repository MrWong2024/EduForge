"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/blocks/PageHeader";
import { Tabs } from "@/components/blocks/Tabs";
import { paths } from "@/lib/routes/paths";

type TaskContextHeaderProps = {
  classroomId: string;
  classroomTaskId: string;
  classroomName?: string;
  taskTitle?: string;
};

export function TaskContextHeader({
  classroomId,
  classroomTaskId,
  classroomName,
  taskTitle,
}: TaskContextHeaderProps) {
  const pathname = usePathname();
  const trajectoryHref = paths.teacher.classroomTaskTrajectory(classroomId, classroomTaskId);
  const reviewPackHref = paths.teacher.classroomTaskReviewPack(classroomId, classroomTaskId);
  const aiMetricsHref = paths.teacher.classroomTaskAiMetrics(classroomId, classroomTaskId);

  return (
    <section className="min-w-0 break-words">
      <PageHeader
        title="课堂任务工作区"
        description={`班级：${classroomName?.trim() || "班级名称暂不可用"} · 任务：${taskTitle?.trim() || "任务名称暂不可用"}`}
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
