import Link from "next/link";
import { PageHeader } from "@/components/blocks/PageHeader";
import { paths } from "@/lib/routes/paths";
export default function StudentAiHelpPage() {
  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="理解 AI 辅助反馈"
        description="作品保存、AI 辅助反馈与教师评价分别查看。"
      />
      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">
          先确认作品是否保存
        </h2>
        <p className="mt-2">
          到任务提交历史进入对应提交详情，核对完整源码与独立说明。AI
          输入超限表示作品已保存、本次没有生成 AI
          反馈，不是提交失败，也不应删除必要源码来换取反馈。
        </p>
        <p className="mt-2">
          提交或 AI 申请遇到网络中断时，先刷新历史或详情核对结果，避免重复操作。
        </p>
      </section>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">
          进入评阅前修改本次提交
        </h2>
        <p className="mt-2">
          在提交详情中，若仍有参与资格且截止规则允许，可修改本次提交的代码、语言和说明。取消不保存；保存仍是同一份提交，不增加尝试次数。首次提交时间与迟交记录保留，最近修改时间和本次修改是否迟交另行显示。
        </p>
        <p className="mt-2">
          教师仅打开查看不会锁定作品。教师正式提交反馈，或平台受理有权用户的 AI
          评阅申请后，作品即进入评阅并不能再修改；即使后续处理失败，也不会重新开放修改。是否可以申请
          AI 与是否可以修改作品分别判断。
        </p>
        <p className="mt-2">
          保存时若作品已有变化或已经进入评阅，草稿会保留。请读取并核对最新作品与反馈，再明确决定是否继续；平台不会自动合并或替你提交到新版。网络中断或结果待核对时也请先查看权威详情，避免重复操作。
        </p>
      </section>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">
          申请与处理状态
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>
            未申请是正常状态。平台可以关闭
            AI、仅允许教师发起、允许师生手动发起，或首次提交自动申请。外部 AI
            是否允许使用仍由任务要求规定。
          </li>
          <li>
            首次自动申请依赖系统开启自动处理，不保证自动生成成功；后续按详情中的实际资格手动申请。
          </li>
          <li>
            排队中或处理中可能需要等待；学生提交详情在这些状态下自动刷新，任务提交草稿页保留手动刷新。
          </li>
          <li>
            本次处理失败时，查看是否已安排重试；未安排重试时不会自动刷新。已有任务不会因重复申请重新排队或重置次数。
          </li>
          <li>
            已终止的任务不能重新申请；按详情中的公开原因联系教师或管理员。
          </li>
          <li>处理完成但没有条目时，表示暂无可展示的反馈，不表示作品通过。</li>
        </ul>
      </section>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">
          理解反馈和用量
        </h2>
        <p className="mt-2">
          模拟反馈会明确标识。完整输入覆盖只表示材料进入本次请求；平台未运行程序，不认证学生自述，也不据此认定作品正确或学生已经掌握。教师反馈与
          AI 辅助反馈按来源分别展示。
        </p>
        <p className="mt-2">
          用量可在详情中展开查看：预留请求数不等于准确送达次数，未知 Token
          显示“未知”，不补成零、不估算金额。
        </p>
      </section>
      <Link
        href={paths.student.dashboard}
        className="text-sm text-blue-700 underline"
      >
        返回学习看板
      </Link>
    </section>
  );
}
