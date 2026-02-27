import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function TeacherCoursesPage() {
  return (
    <section>
      <PageHeader title="Teacher Courses" description="Courses list placeholder." />
      <EmptyState title="No course content yet" description="TODO: integrate GET /api/courses." />
    </section>
  );
}
