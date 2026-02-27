import { EmptyState } from "@/components/blocks/EmptyState";

type AiMetricsPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function AiMetricsPage({ params }: AiMetricsPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="AI Metrics placeholder"
      description={`classroomId: ${classroomId} | classroomTaskId: ${classroomTaskId}`}
    />
  );
}
