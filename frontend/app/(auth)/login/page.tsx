import Link from "next/link";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EmptyState } from "@/components/blocks/EmptyState";
import { paths } from "@/lib/routes/paths";

export default function LoginPage() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <PageHeader title="Login" description="Session-based auth entry (placeholder)." />
      <EmptyState
        title="Login form pending"
        description="TODO: integrate POST /api/auth/login and role-based redirect via /api/users/me."
      />
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link className="text-blue-700 hover:underline" href={paths.teacher.classrooms}>
          Teacher entry
        </Link>
        <Link className="text-blue-700 hover:underline" href={paths.student.dashboard}>
          Student entry
        </Link>
      </div>
    </section>
  );
}
