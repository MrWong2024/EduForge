import Link from "next/link";
import { type AccountUser, getPrimaryAccountName, getRoleLabels } from "@/components/account/account-types";

type AccountNavEntryProps = {
  href: string;
  user: AccountUser;
};

export function AccountNavEntry({ href, user }: AccountNavEntryProps) {
  const primaryName = getPrimaryAccountName(user);
  const primaryRole = getRoleLabels(user)[0];
  const identityLabel = primaryRole ? `${primaryName} · ${primaryRole}` : primaryName;

  return (
    <Link
      href={href}
      className="inline-flex max-w-[18rem] items-center px-2 py-1 text-sm text-zinc-700 transition-colors hover:text-zinc-900 hover:underline hover:underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
      aria-label="进入账户设置"
      title={identityLabel}
    >
      <span className="block truncate whitespace-nowrap font-medium">{identityLabel}</span>
    </Link>
  );
}
