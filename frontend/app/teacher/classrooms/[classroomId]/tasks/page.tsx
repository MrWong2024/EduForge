import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type ClassroomTasksPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomTasksPage({ params }: ClassroomTasksPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="课堂任务" description={`班级 ID: ${classroomId}`} />
      <EmptyState title="任务列表占位" description="TODO: 接入班级任务列表。" />
    </section>
  );
}
