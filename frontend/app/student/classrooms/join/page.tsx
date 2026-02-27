import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function StudentJoinClassroomPage() {
  return (
    <section>
      <PageHeader title="Join Classroom" description="Join with classroom code (placeholder)." />
      <EmptyState
        title="Join flow pending"
        description="TODO: integrate POST /api/classrooms/join with 400/403/404 status-specific UX."
      />
    </section>
  );
}
