import { redirect } from "next/navigation";
import { paths } from "@/lib/routes/paths";

export default function TeacherHomePage() {
  redirect(paths.teacher.classrooms);
}
