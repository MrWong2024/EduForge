import type { ReactNode } from "react";
import Link from "next/link";
import { paths } from "@/lib/routes/paths";

type TeacherShellProps = {
  children: ReactNode;
};

export function TeacherShell({ children }: TeacherShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">EduForge 教师端</p>
          <nav className="flex items-center gap-4 text-sm text-zinc-700">
            <Link href={paths.teacher.courses} className="hover:text-zinc-900">
              课程
            </Link>
            <Link href={paths.teacher.classrooms} className="hover:text-zinc-900">
              班级
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
