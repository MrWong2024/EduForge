import type { ReactNode } from "react";
import Link from "next/link";
import { AccountNavEntry } from "@/components/account/AccountNavEntry";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { type AccountUser } from "@/components/account/account-types";
import { paths } from "@/lib/routes/paths";

type StudentShellProps = {
  children: ReactNode;
  currentUser: AccountUser;
};

export function StudentShell({ children, currentUser }: StudentShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">EduForge 学生端</p>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-4 text-sm text-zinc-700">
              <Link href={paths.student.dashboard} className="hover:text-zinc-900">
                总览
              </Link>
              <Link href={paths.student.joinClassroom} className="hover:text-zinc-900">
                加入班级
              </Link>
            </nav>
            <AccountNavEntry href={paths.student.account} user={currentUser} />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
