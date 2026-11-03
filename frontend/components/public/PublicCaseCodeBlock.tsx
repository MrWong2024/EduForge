type PublicCaseCodeBlockProps = {
  label: string;
  children: string;
};

export function PublicCaseCodeBlock({
  label,
  children,
}: PublicCaseCodeBlockProps) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="m-0 min-w-0 max-w-full overflow-x-auto rounded-xl bg-zinc-950 p-5 font-mono text-xs leading-7 text-zinc-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0F766E] sm:text-sm"
    >
      <code>{children}</code>
    </pre>
  );
}
