"use client";

import Link from "next/link";
import { useId, useRef, type KeyboardEvent } from "react";
import { paths } from "@/lib/routes/paths";

export const publicCasePreviews = [
  {
    name: "OrbitPass",
    title: "大会席位预约",
    question: "最后一个席位，不能分给两个人。",
    description: "需求看似简单，真正的判断发生在重试、并发与失败之间。",
    snippetTitle: "AI 初稿节选 · 存在竞争窗口",
    snippet: `const left = await readSeats(eventId);
if (left <= 0) throw soldOut();
await decreaseSeat(eventId);
return reserve(userId, eventId);`,
    review: "两个请求可能都读到最后 1 席；读取和独立扣减之间，仍有竞争窗口。",
    href: paths.cases.orbitpass,
  },
  {
    name: "FramePilot",
    title: "智能视频剪辑工作台",
    question: "视频重新剪辑，字幕也要准确跟着走。",
    description: "画面可以重新排列，字幕的时间关系也必须重新建立。",
    snippetTitle: "关键逻辑 · 重排时间映射示意（ms）",
    snippet: `片段 ① [6000,8000) → ② [1000,4000)
源字幕 A [1500,2500) · B [6500,7000)
成片   B [500,1000) → A [2500,3500)`,
    review: "每个片段都有自己的成片起点，不能只减去第一个片段的源起点。",
    href: paths.cases.framepilot,
  },
  {
    name: "PatchDock",
    title: "AI 代码补丁审查台",
    question: "AI 写好了修改，先确认它能否安全应用。",
    description: "修改看似只差一步，真正的边界藏在基线、路径与上下文里。",
    snippetTitle: "关键逻辑 · 修订方向的 diff 示意",
    snippet: `- if (path.startsWith("src/")) preview()
+ requireExactSnapshotPath(path)
+ requireMatchingBaseline(patch)
+ requireUniqueContext(patch)`,
    review: "文本能匹配不等于基线未变；src/ 前缀也不能排除路径越界。",
    href: paths.cases.patchdock,
  },
] as const;

type PublicCasePreviewProps = {
  activeIndex: number;
  onSelect: (index: number) => void;
};

export function PublicCasePreview({
  activeIndex,
  onSelect,
}: PublicCasePreviewProps) {
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = (index: number) => {
    onSelect(index);
    tabs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % publicCasePreviews.length;
        break;
      case "ArrowLeft":
        nextIndex =
          (index + publicCasePreviews.length - 1) % publicCasePreviews.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = publicCasePreviews.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(nextIndex);
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm"
    >
      <header className="border-b border-zinc-100 px-4 py-3 sm:px-5">
        <h2
          id={`${id}-heading`}
          className="text-xs font-semibold text-[#0F766E]"
        >
          人定义规则 → AI 提交初稿 → 人审查
        </h2>
        <div
          role="tablist"
          aria-label="选择案例预览"
          aria-orientation="horizontal"
          className="mt-2 grid min-w-0 grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1"
        >
          {publicCasePreviews.map((preview, index) => (
            <button
              key={preview.name}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`${id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={activeIndex === index ? 0 : -1}
              onClick={() => selectTab(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`min-w-0 rounded-lg px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E] motion-reduce:transition-none sm:text-sm ${
                activeIndex === index
                  ? "bg-white text-[#0F766E] shadow-sm"
                  : "text-zinc-600 hover:bg-white/70 hover:text-[#115E59]"
              }`}
            >
              {preview.name}
            </button>
          ))}
        </div>
      </header>

      {publicCasePreviews.map((preview, index) => (
        <div
          key={preview.name}
          id={`${id}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          hidden={activeIndex !== index}
          tabIndex={activeIndex === index ? 0 : -1}
          className={`${activeIndex === index ? "flex" : "hidden"} min-h-[23rem] min-w-0 flex-col rounded-b-2xl px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] sm:px-5`}
        >
          <h3 className="text-2xl font-bold leading-[1.35] tracking-tight sm:text-[1.75rem]">
            {preview.question}
          </h3>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {preview.description}
          </p>
          <figure className="mt-3 min-w-0 rounded-xl border border-zinc-200 bg-zinc-50">
            <figcaption className="rounded-t-xl border-b border-zinc-200 px-3 py-2 text-xs font-medium leading-4 text-zinc-600">
              {preview.snippetTitle}
            </figcaption>
            <pre className="min-h-[5.75rem] whitespace-pre-wrap break-words p-3 font-mono text-xs leading-[1.5] text-zinc-700">
              <code>{preview.snippet}</code>
            </pre>
          </figure>
          <blockquote className="mt-3 border-l-2 border-amber-400 bg-amber-50/80 px-3 py-2 text-sm leading-6 text-zinc-700">
            <p className="font-semibold text-amber-800">人的审查意见</p>
            <p>{preview.review}</p>
          </blockquote>
          <div className="mt-auto pt-4">
            <Link
              href={preview.href}
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-[#0F766E] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
            >
              阅读完整案例 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ))}
    </section>
  );
}
