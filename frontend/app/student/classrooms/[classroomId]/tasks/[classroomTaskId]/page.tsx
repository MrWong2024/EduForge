import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type StudentTaskDetailPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function StudentTaskDetailPage({ params }: StudentTaskDetailPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <section>
      <PageHeader
        title="Student Task Detail"
        description={`classroomId: ${classroomId} | classroomTaskId: ${classroomTaskId}`}
      />
      <EmptyState title="Task detail placeholder" description="TODO: integrate my-task-detail and submission APIs." />
    </section>
  );
}
