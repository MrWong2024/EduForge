import { EmptyState } from "@/components/blocks/EmptyState";

type ReviewPackPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function ReviewPackPage({ params }: ReviewPackPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <EmptyState
      title="Review Pack placeholder"
      description={`classroomId: ${classroomId} | classroomTaskId: ${classroomTaskId}`}
    />
  );
}
