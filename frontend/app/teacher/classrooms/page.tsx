import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function TeacherClassroomsPage() {
  return (
    <section>
      <PageHeader title="班级" description="班级列表占位。" />
      <EmptyState title="暂无班级内容" description="TODO: 接入 GET /api/classrooms。" />
    </section>
  );
}
