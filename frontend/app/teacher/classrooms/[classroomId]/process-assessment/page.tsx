import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type ProcessAssessmentPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ProcessAssessmentPage({ params }: ProcessAssessmentPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="Process Assessment" description={`classroomId: ${classroomId}`} />
      <EmptyState
        title="Process assessment placeholder"
        description="TODO: integrate JSON and CSV download flow; keep 404 copy compatible with feature-disabled state."
      />
    </section>
  );
}
