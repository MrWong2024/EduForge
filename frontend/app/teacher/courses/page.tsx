import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function TeacherCoursesPage() {
  return (
    <section>
      <PageHeader title="课程" description="课程列表占位。" />
      <EmptyState title="暂无课程内容" description="TODO: 接入 GET /api/courses。" />
    </section>
  );
}
