import type { ReactNode } from "react";
import Link from "next/link";
import { paths } from "@/lib/routes/paths";

type StudentShellProps = {
  children: ReactNode;
};

export function StudentShell({ children }: StudentShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">EduForge Student</p>
          <nav className="flex items-center gap-4 text-sm text-zinc-700">
            <Link href={paths.student.dashboard} className="hover:text-zinc-900">
              Dashboard
            </Link>
            <Link href={paths.student.joinClassroom} className="hover:text-zinc-900">
              Join
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
