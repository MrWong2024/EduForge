import Link from "next/link";

const navItems = [
  { href: "/demo", label: "概览" },
  { href: "/demo/teacher", label: "任务管理" },
  { href: "/demo/student", label: "作业提交" },
  { href: "/demo/jobs", label: "AI 反馈队列" },
  { href: "/demo/reports", label: "课堂报表" },
];

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-slate-200 bg-slate-950 text-slate-100">
          <div className="px-6 py-6 text-lg font-semibold">教学管理平台</div>
          <nav className="flex flex-col gap-2 px-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 px-6 text-xs text-slate-500">© EduForge</div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
            <div>
              <div className="text-sm text-slate-500">软件工程学院 教学管理平台</div>
              <div className="text-lg font-semibold">学期：2025-2026-2 · 当前角色：教务管理员</div>
            </div>
            <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              课程任务中心
            </div>
          </header>

          <main className="flex-1 px-8 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
