import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function TeacherClassroomsPage() {
  return (
    <section>
      <PageHeader title="Teacher Classrooms" description="Classroom list placeholder." />
      <EmptyState title="No classroom content yet" description="TODO: integrate GET /api/classrooms." />
    </section>
  );
}
