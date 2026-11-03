"use client";

import Link from "next/link";
import { useState } from "react";
import { paths } from "@/lib/routes/paths";
import { PublicCasePreview, publicCasePreviews } from "./PublicCasePreview";

export function PublicHomeHero() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="grid items-center gap-9 lg:grid-cols-[1.15fr_1fr] lg:gap-10 xl:gap-12">
      <section aria-labelledby="home-title" className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-[#0F766E]">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-[#0F766E]"
          />
          面向 AI 协作编程的教学平台
        </p>
        <h1
          id="home-title"
          className="mt-5 text-[2.125rem] font-semibold leading-[1.3] tracking-tight sm:text-[2.75rem] xl:text-[3.25rem]"
        >
          <span className="block">让学生知道怎样改，</span>
          <span className="block text-[#0F766E]">让教师看见学习过程。</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-8 text-zinc-600">
          从编程任务出发，提交作品与独立说明，在 AI
          辅助反馈和教师评阅中持续修订，为教学复盘留下可回看的过程。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={paths.login}
            prefetch={false}
            className="inline-flex items-center justify-center rounded-md bg-[#0F766E] px-6 py-3 text-base font-medium text-white transition-colors hover:bg-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] motion-reduce:transition-none"
          >
            登录平台{" "}
            <span aria-hidden="true" className="ml-3">
              →
            </span>
          </Link>
          <Link
            href={publicCasePreviews[activeIndex].href}
            prefetch={false}
            className="inline-flex items-center rounded-md px-4 py-3 text-sm font-medium text-[#0F766E] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
          >
            查看协作案例{" "}
            <span aria-hidden="true" className="ml-2">
              →
            </span>
          </Link>
        </div>
        <div className="mt-7 border-l-2 border-teal-200 pl-4 text-sm leading-7 text-zinc-600">
          <p className="font-medium text-zinc-800">AI 给出建议，人作出判断。</p>
          <p>关注作品怎样形成，也关注学生为什么这样修改。</p>
        </div>
      </section>

      <section aria-label="AI 协作编程案例" className="min-w-0">
        <PublicCasePreview
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
        />
      </section>
    </div>
  );
}
