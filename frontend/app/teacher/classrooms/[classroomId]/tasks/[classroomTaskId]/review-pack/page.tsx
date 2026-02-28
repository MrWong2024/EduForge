import { EmptyState } from "@/components/blocks/EmptyState";

type ReviewPackPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function ReviewPackPage({ params }: ReviewPackPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="课堂复盘"
      description={`班级 ID: ${classroomId} | 课堂任务 ID: ${classroomTaskId}（占位）`}
    />
  );
}
