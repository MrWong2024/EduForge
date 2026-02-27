import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </div>
  );
}
