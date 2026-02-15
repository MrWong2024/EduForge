import Link from "next/link";

const cards = [
  {
    title: "任务管理",
    desc: "创建与发布课程任务，规范学生提交入口。",
    href: "/demo/teacher",
  },
  {
    title: "作业提交",
    desc: "选择任务与学生身份，完成作业提交。",
    href: "/demo/student",
  },
  {
    title: "AI 反馈队列",
    desc: "处理待分析作业并回写反馈状态。",
    href: "/demo/jobs",
  },
  {
    title: "课堂报表",
    desc: "查看共性问题分布与样例，辅助课堂讲解。",
    href: "/demo/reports",
  },
];

export default function DemoHomePage() {
  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-semibold text-slate-400">首页 / 工作台</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">教学工作台</h1>
        <p className="mt-2 text-sm text-slate-600">
          统一管理课程任务、作业提交、反馈处理与课堂报表。
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          >
            <div className="text-sm font-semibold text-slate-500">功能模块</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              {card.title}
            </div>
            <p className="mt-2 text-sm text-slate-600">{card.desc}</p>
            <div className="mt-4 text-xs font-semibold text-emerald-700">
              进入模块 →
            </div>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-500">工作流程建议</div>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>发布课程任务，开放学生提交</li>
          <li>学生完成作业并提交代码</li>
          <li>处理反馈队列，回写分析结果</li>
          <li>查看课堂报表，归纳共性问题</li>
        </ol>
      </section>
    </div>
  );
}
