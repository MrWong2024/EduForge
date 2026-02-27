import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type SnapshotExportPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function SnapshotExportPage({ params }: SnapshotExportPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Snapshot Export" description={`classroomId: ${classroomId}`} />
      <EmptyState
        title="Snapshot export placeholder"
        description="TODO: integrate snapshot download and preserve content-disposition."
      />
    </section>
  );
}
