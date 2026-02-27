import { EmptyState } from "@/components/blocks/EmptyState";

type LearningTrajectoryPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function LearningTrajectoryPage({ params }: LearningTrajectoryPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="Learning Trajectory placeholder"
      description={`classroomId: ${classroomId} | classroomTaskId: ${classroomTaskId}`}
    />
  );
}
