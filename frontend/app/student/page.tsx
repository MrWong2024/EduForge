import { redirect } from "next/navigation";
import { paths } from "@/lib/routes/paths";

export default function StudentHomePage() {
  redirect(paths.student.dashboard);
}
