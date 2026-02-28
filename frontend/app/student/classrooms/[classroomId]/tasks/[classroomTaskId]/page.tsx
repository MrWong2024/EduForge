import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

type StudentTaskDetailPageProps = {
  params: Promise<{ classroomId: string; classroomTaskId: string }>;
};

export default async function StudentTaskDetailPage({ params }: StudentTaskDetailPageProps) {
  const { classroomId, classroomTaskId } = await params;

  return (
    <section>
      <PageHeader
        title="任务详情"
        description={`班级 ID: ${classroomId} | 课堂任务 ID: ${classroomTaskId}`}
      />
      <EmptyState title="任务详情占位" description="TODO: 接入 my-task-detail 与提交接口。" />
    </section>
  );
}
