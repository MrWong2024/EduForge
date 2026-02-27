import Link from "next/link";

export type TabItem = {
  label: string;
  href: string;
};

type TabsProps = {
  items: TabItem[];
  activeHref?: string;
};

export function Tabs({ items, activeHref }: TabsProps) {
  return (
    <nav className="mb-6 border-b border-zinc-200">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isActive = activeHref === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`inline-block rounded-t-md border border-b-0 px-3 py-2 text-sm ${
                  isActive
                    ? "border-zinc-400 bg-zinc-50 font-medium text-zinc-900"
                    : "border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
