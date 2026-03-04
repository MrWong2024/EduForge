import Link from "next/link";
import { PageHeader } from "@/components/blocks/PageHeader";
import { paths } from "@/lib/routes/paths";

export default function StudentAiHelpPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        title="AI 反馈为什么还没出来？"
        description="本页用于解释常见状态与处理建议，不会调用任何调试接口。"
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900">你会看到哪些状态</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>NOT_REQUESTED：未请求或策略未触发，属于正常状态。</li>
          <li>PENDING：已进入队列，正在等待处理。</li>
          <li>RUNNING：系统正在处理你的请求。</li>
          <li>SUCCEEDED：反馈已生成，可查看结果。</li>
          <li>FAILED：本次处理失败，可稍后重试请求。</li>
          <li>DEAD：当前不可自动重试，请联系老师。</li>
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900">为什么会一直排队或处理中</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>学校或老师侧尚未开启 AI 处理后台。</li>
          <li>当前排队任务较多，处理时间延长。</li>
          <li>AI 服务配额或网络出现临时波动。</li>
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900">学生可以先做什么</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>等待一段时间后手动刷新页面。</li>
          <li>确认自己已成功提交作业。</li>
          <li>若长时间无结果，联系老师或管理员协助排查。</li>
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900">老师或管理员通常需要确认</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>AI Worker 是否已开启并处于运行状态。</li>
          <li>AI 服务供应商配置与配额是否可用。</li>
          <li>学校网络或服务连通性是否正常。</li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link href={paths.student.dashboard} className="text-blue-700 hover:underline">
          返回学习看板
        </Link>
        <p className="text-zinc-600">如需返回刚才的提交详情，请使用浏览器返回上一页。</p>
      </div>
    </section>
  );
}
