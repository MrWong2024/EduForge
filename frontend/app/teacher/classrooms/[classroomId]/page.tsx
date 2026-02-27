import { redirect } from "next/navigation";
import { paths } from "@/lib/routes/paths";

type ClassroomRootPageProps = {
  params: Promise<{ classroomId: string }>;
};

export default async function ClassroomRootPage({ params }: ClassroomRootPageProps) {
  const { classroomId } = await params;
  redirect(paths.teacher.classroomDashboard(classroomId));
}
