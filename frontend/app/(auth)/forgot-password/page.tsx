import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "忘记密码",
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <section className="relative mx-auto flex min-h-dvh w-full max-w-3xl items-center px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_50%)]" />
      <div className="w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-100 px-6 py-4 text-center md:px-8 md:py-5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            EduForge · 智炼
          </h1>
          <p className="mx-auto mt-1 max-w-xl text-sm leading-5 text-zinc-600">
            面向 AI 协作编程的教学平台
          </p>
        </header>

        <div className="px-6 py-3 md:px-8 md:py-4">
          <div className="mx-auto w-full max-w-lg">{children}</div>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-4">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
    </header>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthFrame>
      <SectionHeading
        title="找回密码"
        description="请输入登录邮箱。如果该邮箱存在，我们将发送密码重置邮件。"
      />
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
