import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function StudentDashboardPage() {
  return (
    <section>
      <PageHeader title="Student Dashboard" description="Student home placeholder." />
      <EmptyState title="No data yet" description="TODO: integrate student dashboard data." />
    </section>
  );
}
