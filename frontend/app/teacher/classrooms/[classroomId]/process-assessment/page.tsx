import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type ProcessAssessmentPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ProcessAssessmentPage({ params }: ProcessAssessmentPageProps) {
  const { classroomId } = await params;

  return (
    <section>
      <PageHeader title="过程性评价" description={`班级 ID: ${classroomId}`} />
      <EmptyState
        title="过程性评价占位"
        description="TODO: 接入 JSON 与 CSV 下载；404 文案需兼容功能未启用。"
      />
    </section>
  );
}
