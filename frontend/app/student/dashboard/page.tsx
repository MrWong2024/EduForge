import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function StudentDashboardPage() {
  return (
    <section>
      <PageHeader title="我的学习" description="学生端首页占位。" />
      <EmptyState title="暂无数据" description="TODO: 接入学生 dashboard 数据。" />
    </section>
  );
}
