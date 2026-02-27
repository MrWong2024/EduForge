import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </header>
  );
}
