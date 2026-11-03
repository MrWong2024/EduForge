import Link from "next/link";
import { PublicHomeHero } from "@/components/public/PublicHomeHero";
import { paths } from "@/lib/routes/paths";

export function PublicHome() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-zinc-900">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-white px-4 py-3 text-[#0F766E] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-offset-4 focus:outline-[#0F766E]"
      >
        跳到主要内容
      </a>
      <header className="border-b border-zinc-100">
        <nav
          aria-label="首页导航"
          className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8"
        >
          <Link
            href={paths.home}
            className="inline-flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-200 bg-[#F0FDFA] text-xl text-[#0F766E]"
            >
              E
            </span>
            <span className="text-lg sm:text-xl">EduForge · 智炼</span>
          </Link>
          <Link
            href={paths.login}
            prefetch={false}
            className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:border-teal-700 hover:text-[#0F766E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] motion-reduce:transition-none"
          >
            登录平台
          </Link>
        </nav>
      </header>

      <main
        id="main-content"
        className="flex flex-1 flex-col bg-[linear-gradient(120deg,#F0FDFA_0%,#ffffff_65%)]"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 py-5 sm:px-8 lg:py-3">
          <PublicHomeHero />
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-1 px-5 py-3 text-xs leading-5 text-zinc-500 sm:px-8">
          <p>
            EduForge · 智炼{" "}
            <span className="mx-1" aria-hidden="true">
              ·
            </span>{" "}
            重庆邮电大学
          </p>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm hover:text-[#0F766E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
          >
            渝ICP备2026008292号-1
          </a>
        </div>
      </footer>
    </div>
  );
}
