import type { ReactNode } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { TeacherShell } from "@/components/layout/TeacherShell";
import { requireRole } from "@/lib/auth/session";

export default async function TeacherLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const gate = await requireRole("TEACHER");

  return (
    <TeacherShell>
      {gate.allowed ? (
        children
      ) : (
        <ErrorState
          status={403}
          title="403 Forbidden"
          description="Current account is not a teacher role and cannot access teacher pages."
        />
      )}
    </TeacherShell>
  );
}
