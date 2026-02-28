import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type MembersPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomMembersPage({ params }: MembersPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="成员" description={`班级 ID: ${classroomId}`} />
      <EmptyState title="成员页占位" description="TODO: 接入成员相关接口。" />
    </section>
  );
}
