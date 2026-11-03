type PublicCaseHeaderProps = {
  titleId: string;
  title: string;
  description: string;
  keywords: readonly string[];
};

export function PublicCaseHeader({
  titleId,
  title,
  description,
  keywords,
}: PublicCaseHeaderProps) {
  return (
    <header className="min-w-0 rounded-2xl border border-teal-200 bg-[#F0FDFA] p-6 sm:p-8">
      <p className="text-sm font-semibold text-[#0F766E]">AI 协作编程案例</p>
      <h1
        id={titleId}
        className="mt-3 text-3xl font-semibold leading-snug tracking-tight text-zinc-950 sm:text-4xl"
      >
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-8 text-zinc-700 sm:text-lg">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-[#0F766E]">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="rounded-full border border-teal-200 bg-white px-3 py-1.5"
          >
            {keyword}
          </span>
        ))}
      </div>
    </header>
  );
}
