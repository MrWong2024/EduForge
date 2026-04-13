import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <main className="mx-auto w-full max-w-6xl px-4">{children}</main>
    </div>
  );
}
