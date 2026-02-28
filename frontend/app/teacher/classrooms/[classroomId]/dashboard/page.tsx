import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type DashboardPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomDashboardPage({ params }: DashboardPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="班级看板" description={`班级 ID: ${classroomId}`} />
      <EmptyState title="看板内容占位" description="TODO: 接入班级看板数据。" />
    </section>
  );
}
