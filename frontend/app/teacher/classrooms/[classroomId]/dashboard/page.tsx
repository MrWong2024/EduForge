import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type DashboardPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomDashboardPage({ params }: DashboardPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Classroom Dashboard" description={`classroomId: ${classroomId}`} />
      <EmptyState title="Dashboard placeholder" description="TODO: integrate classroom dashboard data." />
    </section>
  );
}
