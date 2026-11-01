import type { ReactNode } from "react";
import Link from "next/link";
import { AccountNavEntry } from "@/components/account/AccountNavEntry";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { type AccountUser } from "@/components/account/account-types";
import { paths } from "@/lib/routes/paths";

type TeacherShellProps = {
  children: ReactNode;
  currentUser: AccountUser;
};

export function TeacherShell({ children, currentUser }: TeacherShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <p className="shrink-0 whitespace-nowrap text-sm font-semibold text-zinc-900">EduForge 教师端</p>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:w-auto">
            <nav className="flex shrink-0 items-center gap-4 text-sm text-zinc-700">
              <Link href={paths.teacher.courses} className="whitespace-nowrap hover:text-zinc-900">
                课程
              </Link>
              <Link href={paths.teacher.classrooms} className="whitespace-nowrap hover:text-zinc-900">
                班级
              </Link>
            </nav>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-4 sm:flex-initial">
              <AccountNavEntry href={paths.teacher.account} user={currentUser} />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
