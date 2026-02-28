import { EmptyState } from "@/components/blocks/EmptyState";
import { PageHeader } from "@/components/blocks/PageHeader";

export default function StudentJoinClassroomPage() {
  return (
    <section>
      <PageHeader title="加入班级" description="通过班级邀请码加入（占位）。" />
      <EmptyState
        title="加入流程待接入"
        description="TODO: 接入 POST /api/classrooms/join，并按 400/403/404 状态分流提示。"
      />
    </section>
  );
}
