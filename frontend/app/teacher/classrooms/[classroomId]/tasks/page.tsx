import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type ClassroomTasksPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomTasksPage({ params }: ClassroomTasksPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Classroom Tasks" description={`classroomId: ${classroomId}`} />
      <EmptyState title="Task list placeholder" description="TODO: integrate classroom task list." />
    </section>
  );
}
