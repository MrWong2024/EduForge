type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-700">
      <p className="font-medium text-zinc-900">{title}</p>
      {description ? <p className="mt-1">{description}</p> : null}
    </section>
  );
}
