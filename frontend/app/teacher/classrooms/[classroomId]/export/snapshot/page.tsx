import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type SnapshotExportPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function SnapshotExportPage({ params }: SnapshotExportPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="教学快照导出" description={`班级 ID: ${classroomId}`} />
      <EmptyState
        title="快照导出占位"
        description="TODO: 接入 snapshot 下载并保留 content-disposition。"
      />
    </section>
  );
}
