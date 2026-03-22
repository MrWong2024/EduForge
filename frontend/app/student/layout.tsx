import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { StudentShell } from "@/components/layout/StudentShell";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: {
    default: "EduForge 学生端",
    template: "%s | EduForge 学生端",
  },
};

export default async function StudentLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const gate = await requireRole("STUDENT");

  return (
    <StudentShell>
      {gate.allowed ? (
        children
      ) : (
        <ErrorState
          status={403}
          title="403 Forbidden"
          description="Current account is not a student role and cannot access student pages."
        />
      )}
    </StudentShell>
  );
}
