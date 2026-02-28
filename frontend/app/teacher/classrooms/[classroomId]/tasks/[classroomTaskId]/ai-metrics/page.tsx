import { EmptyState } from "@/components/blocks/EmptyState";

type AiMetricsPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function AiMetricsPage({ params }: AiMetricsPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="AI 指标"
      description={`班级 ID: ${classroomId} | 课堂任务 ID: ${classroomTaskId}（占位）`}
    />
  );
}
