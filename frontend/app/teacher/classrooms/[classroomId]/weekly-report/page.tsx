import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type WeeklyReportPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function WeeklyReportPage({ params }: WeeklyReportPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="周报" description={`班级 ID: ${classroomId}`} />
      <EmptyState title="周报占位" description="TODO: 接入 weekly-report 数据。" />
    </section>
  );
}
