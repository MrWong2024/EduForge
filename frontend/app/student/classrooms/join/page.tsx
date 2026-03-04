import { PageHeader } from "@/components/blocks/PageHeader";
import { JoinClassroomForm } from "@/components/student/JoinClassroomForm";

export default function StudentJoinClassroomPage() {
  return (
    <section>
      <PageHeader title="加入班级" description="输入班级加入码后加入学习班级。" />
      <JoinClassroomForm />
    </section>
  );
}
