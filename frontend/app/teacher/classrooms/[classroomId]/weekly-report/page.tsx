import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type WeeklyReportPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function WeeklyReportPage({ params }: WeeklyReportPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Weekly Report" description={`classroomId: ${classroomId}`} />
      <EmptyState title="Weekly report placeholder" description="TODO: integrate weekly-report data." />
    </section>
  );
}
