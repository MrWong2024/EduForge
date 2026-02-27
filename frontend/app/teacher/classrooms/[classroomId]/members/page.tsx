import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type MembersPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomMembersPage({ params }: MembersPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Classroom Members" description={`classroomId: ${classroomId}`} />
      <EmptyState title="Members page placeholder" description="TODO: integrate member-related endpoints." />
    </section>
  );
}
