import type { ReactNode } from "react";

type PublicCaseStepProps = {
  number: number;
  title: string;
  titleId: string;
  children: ReactNode;
};

export function PublicCaseStep({
  number,
  title,
  titleId,
  children,
}: PublicCaseStepProps) {
  return (
    <section
      aria-labelledby={titleId}
      className="mt-10 min-w-0 border-t border-zinc-200 pt-7 sm:mt-12"
    >
      <h2
        id={titleId}
        className="flex items-center gap-3 text-xl font-semibold tracking-tight text-zinc-900"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0FDFA] text-xs font-semibold text-[#0F766E] ring-1 ring-inset ring-teal-200">
          {String(number).padStart(2, "0")}
        </span>
        {title}
      </h2>
      <div className="mt-5 min-w-0">{children}</div>
    </section>
  );
}
