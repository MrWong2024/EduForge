import { EmptyState } from "@/components/blocks/EmptyState";

type LearningTrajectoryPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function LearningTrajectoryPage({ params }: LearningTrajectoryPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="学习轨迹"
      description={`班级 ID: ${classroomId} | 课堂任务 ID: ${classroomTaskId}（占位）`}
    />
  );
}
