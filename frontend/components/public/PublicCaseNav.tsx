"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { paths } from "@/lib/routes/paths";

const cases = [
  { label: "OrbitPass", href: paths.cases.orbitpass },
  { label: "FramePilot", href: paths.cases.framepilot },
  { label: "PatchDock", href: paths.cases.patchdock },
];

export function PublicCaseNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="案例导航" className="border-t border-zinc-100 py-3">
      <div className="grid w-full max-w-lg grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1">
        {cases.map(({ label, href }) => {
          const active = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`min-w-0 rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E] motion-reduce:transition-none sm:text-sm ${
                active
                  ? "bg-white text-[#0F766E] shadow-sm"
                  : "text-zinc-600 hover:bg-white/70 hover:text-[#115E59]"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
