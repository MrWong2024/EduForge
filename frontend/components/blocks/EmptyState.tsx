import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function EmptyState({ title, description, actions }: EmptyStateProps) {
  const displayTitle = title.trim() || "暂无内容";

  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-700">
      <p className="font-medium text-zinc-900">{displayTitle}</p>
      {description ? <p className="mt-1">{description}</p> : null}
      {actions ? <div className="mt-3">{actions}</div> : null}
    </section>
  );
}
