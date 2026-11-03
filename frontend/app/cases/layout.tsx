import Link from "next/link";
import type { ReactNode } from "react";
import { PublicCaseNav } from "@/components/public/PublicCaseNav";
import { paths } from "@/lib/routes/paths";

export default function CasesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-zinc-900">
      <a
        href="#case-content"
        className="sr-only rounded-md bg-white px-4 py-3 text-[#0F766E] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-offset-4 focus:outline-[#0F766E]"
      >
        跳到案例内容
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <nav
            aria-label="公开页面导航"
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <Link
              href={paths.home}
              className="inline-flex items-center gap-2.5 rounded-sm text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-teal-200 bg-[#F0FDFA] text-[#0F766E]"
              >
                E
              </span>
              EduForge · 智炼
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link
                href={paths.home}
                className="rounded-sm text-[#0F766E] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
              >
                返回首页
              </Link>
              <Link
                href={paths.login}
                prefetch={false}
                className="rounded-md bg-[#0F766E] px-4 py-2 font-medium text-white hover:bg-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
              >
                登录平台
              </Link>
            </div>
          </nav>
          <PublicCaseNav />
        </div>
      </header>
      <main
        id="case-content"
        className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14"
      >
        {children}
      </main>
      <footer className="border-t border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-5 py-6 text-xs leading-6 text-zinc-500 sm:px-8">
          <p>
            开发与验证在外部开发工具中进行；作品、独立说明与 AI/教师反馈由
            EduForge 承载。
          </p>
          <p className="mt-3">EduForge · 智炼 · 重庆邮电大学</p>
        </div>
      </footer>
    </div>
  );
}
