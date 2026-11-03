import { PublicCaseCodeBlock } from "./PublicCaseCodeBlock";
import { PublicCaseHeader } from "./PublicCaseHeader";
import { PublicCaseStep } from "./PublicCaseStep";

const taskRules = [
  ["预约唯一", "同一用户对同一活动，最多获得一个有效预约。"],
  ["重试不多扣", "网络重试返回原预约，不再次扣减名额。"],
  ["并发不超额", "仅剩一席时，多人同时申请只能有一人成功。"],
  ["写入须完整", "扣减名额与建立预约，整体成功或整体失败。"],
  ["身份可信", "从认证上下文确定用户，不能靠请求参数冒用身份。"],
  ["原查询保持", "既有查询的结果、字段和分页约定保持不变。"],
];

const initialDraft = `// 初稿片段
const { eventId, userId } = request.body;
const remaining = await readRemaining(eventId);
if (remaining <= 0) throw SoldOut;

// 两个请求可能都已读到 remaining = 1
await decreaseSeat(eventId);
return await createReservation({ userId, eventId });`;

const revisedSketch = `// 修订方案（伪代码）：省略数据库适配与完整错误处理
principal = requireAuthenticatedPrincipal(context)
eventId = validateEventId(input.eventId)
rejectUnexpectedIdentityFields(input)

transaction:
  event = findEventForUpdate(eventId)        // 锁定该活动行
  existing = findReservation(principal.id, eventId)
  if existing exists: return existing       // 先处理重试，再判断售罄

  require event exists and event.remaining > 0
  affected = decreaseSeatWhereRemainingPositive(eventId)
  require affected == 1
  reservation = insertReservation(principal.id, eventId)
  // 数据库约束：UNIQUE(userId, eventId)
commit -> return reservation
on any failure -> rollback the entire transaction`;

const verificationRecords = [
  {
    rule: "正常预约",
    input: "活动余量为 2，当前用户尚无预约。",
    trigger: "已认证用户发起一次合法预约。",
    expected: "应新增 1 条预约，余量从 2 变为 1。",
    basis: "一次有效预约只扣减一个名额，两项写入整体成功。",
  },
  {
    rule: "同一用户重复请求",
    input: "该用户已有预约 R-01，活动余量为 0。",
    trigger: "用相同认证身份和活动标识重试请求。",
    expected: "应返回同一预约 R-01，不新增预约，余量仍为 0。",
    basis: "先处理已有预约再判断售罄；重试不重复扣减。",
  },
  {
    rule: "最后一席，20 人并发",
    input: "活动仅剩 1 席，20 名不同用户均尚无预约。",
    trigger: "20 名用户同时申请该活动的席位。",
    expected: "应仅有 1 人成功、19 人售罄，新增预约 1 条，余量为 0。",
    basis: "容量约束要求所有并发请求共享同一份名额事实。",
  },
  {
    rule: "预约写入故障",
    input: "活动余量为 1，当前用户尚无预约。",
    trigger: "在扣减之后、插入预约时注入写入错误。",
    expected: "应整体回滚，余量仍为 1，新增预约为 0 条。",
    basis: "扣减名额和建立预约必须整体成功或整体失败。",
  },
  {
    rule: "非法参数或冒用身份",
    input: "未登录、非法活动标识，或携带他人 userId 的请求。",
    trigger: "分别提交这些非法输入。",
    expected: "拒绝请求，预约条数和剩余名额均不变。",
    basis: "身份取自可信上下文，输入校验先于业务写入。",
  },
  {
    rule: "既有查询",
    input: "固定预约样本，以及按原接口约定手写的结果。",
    trigger: "调用既有查询及分页入口。",
    expected: "预约 ID、返回顺序、字段和分页 total 应与预期一致。",
    basis: "新增预约保护不得改变既有查询行为。",
  },
];

const independentNotes = [
  {
    question: "我请 AI 完成什么？",
    answer:
      "说明委托范围：在已有预约功能上补充安全重试与并发保护，保留查询行为；任务卡应先给出唯一预约、名额上限、原子写入和可信身份等规则。",
  },
  {
    question: "我审查并要求修订了什么？",
    answer:
      "指出初稿把读取余量、扣减和插入拆开，还直接使用请求里的 userId；要求解释同读最后一席的竞争，并说明锁定活动行、优先返回已有预约、条件扣减、唯一约束和可信身份如何分别回应问题。",
  },
  {
    question: "哪些检查对应哪些业务规则？",
    answer:
      "正常与重复请求对应“只建一条、只扣一次”；20 人争最后一席应只有 1 人成功；插入故障后余量应恢复；非法输入应无业务写入；固定样本查询应保持。先按任务规则写预期，再审查 AI 的检查是否充分。",
  },
  {
    question: "我为什么接受当前方案？",
    answer:
      "接受方案的前提是能解释锁、条件扣减、唯一约束和回滚各自负责什么，并在目标环境核对上述输入、触发和预期；不能仅凭 AI 自报“通过”作出判断。实际执行情况应另行如实说明。",
  },
  {
    question: "当前材料尚不能证明什么？",
    answer:
      "方案分析与验收标准尚不能证明真实数据库中的隔离配置、锁超时、死锁及网络断连行为；取消、候补和跨服务写入也不在当前范围。实际交付仍需在目标环境验证和审查。",
  },
];

const summaryClassName =
  "cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold text-[#0F766E] transition-colors hover:bg-[#F0FDFA] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] motion-reduce:transition-none";

export function OrbitPassCase() {
  return (
    <article
      aria-labelledby="orbitpass-title"
      className="min-w-0 text-zinc-900"
    >
      <div className="mx-auto min-w-0 max-w-6xl">
        <PublicCaseHeader
          titleId="orbitpass-title"
          title="OrbitPass｜大会席位预约"
          description="为已有预约功能补上一个保障：可安全重试，不重复扣减，也不超额分配。看人怎样定义规则、审查 AI 初稿，再用证据说明为什么这样改。"
          keywords={["安全重试", "并发保护", "失败回滚"]}
        />

        <PublicCaseStep
          number={1}
          title="任务约束"
          titleId="orbitpass-constraints"
        >
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight">
              先写清楚“安全”意味着什么
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-600">
              任务不是“帮我写一个预约接口”，而是为已有功能补上六条可检查的约束。
              验收预期来自这些规则，不从 AI 初稿的行为反推。
            </p>
            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {taskRules.map(([title, description]) => (
                <div
                  key={title}
                  className="min-w-0 border-l-2 border-teal-200 pl-4"
                >
                  <dt className="text-sm font-semibold text-zinc-900">
                    {title}
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-zinc-600">
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </PublicCaseStep>

        <PublicCaseStep
          number={2}
          title="AI 提交初稿"
          titleId="orbitpass-draft"
        >
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight">
              看似有检查，仍有竞争窗口
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-600">
              初稿先读取余量，再分别扣减、建立预约。
              两个请求可能同时读到最后一个名额；重复请求和部分写入也还没有得到解释。
            </p>
            <details className="mt-5 min-w-0 rounded-xl border border-zinc-200 bg-white">
              <summary className={summaryClassName}>
                查看 AI 初稿片段与问题位置
              </summary>
              <PublicCaseCodeBlock label="AI 初稿示意代码，可横向滚动">
                {initialDraft}
              </PublicCaseCodeBlock>
            </details>
          </div>
        </PublicCaseStep>

        <PublicCaseStep
          number={3}
          title="人审查并提出修订"
          titleId="orbitpass-review"
        >
          <div className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
            <p className="text-sm font-semibold text-amber-900">人的审查意见</p>
            <blockquote className="mt-3 text-base leading-8 text-zinc-800">
              “剩余 1 席，A 和 B 都先读到
              1，谁阻止第二次扣减？同一用户重试会不会再建预约？
              如果扣减成功、预约写入失败，名额去哪里了？”
            </blockquote>
            <p className="mt-4 border-t border-amber-200 pt-4 text-sm leading-7 text-zinc-600">
              修订要求：分别解释容量、重复请求、失败一致性和可信身份；
              用按任务规则手写的预期审查测试，不能只让测试适应当前代码。
            </p>
          </div>
        </PublicCaseStep>

        <PublicCaseStep
          number={4}
          title="修订方案"
          titleId="orbitpass-revision"
        >
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight">
              让每条规则都有对应的机制和证据
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-600">
              在同一数据库事务中锁定活动行，先查当前用户已有预约，再条件扣减并插入预约。
              活动行锁协调并发分配，条件扣减守住余量，数据库唯一约束守住用户与活动的组合；
              任一步失败都回滚整个事务。身份和输入则在进入写入流程前校验。
            </p>
            <details className="mt-5 min-w-0 rounded-xl border border-zinc-200 bg-white">
              <summary className={summaryClassName}>
                查看修订方案与适用边界
              </summary>
              <PublicCaseCodeBlock label="修订关键逻辑，可横向滚动">
                {revisedSketch}
              </PublicCaseCodeBlock>
              <div className="space-y-3 px-5 py-4 text-sm leading-7 text-zinc-600">
                <p>
                  先查已有预约，意味着提交成功但响应丢失后，同一身份重试可返回原预约，
                  不会因为此时已售罄而再扣名额。唯一约束冲突或插入失败时，扣减也须回滚。
                </p>
                <p>
                  真实数据库的隔离级别、锁超时、死锁与断连处理仍需验证；
                  取消、候补和跨服务写入不在片段范围，加入这些流程时需重新审查唯一约束与一致性。
                  单靠一个锁或事务不能证明全部风险已经解决。
                </p>
              </div>
            </details>
          </div>
        </PublicCaseStep>

        <PublicCaseStep
          number={5}
          title="验证场景与验收标准"
          titleId="orbitpass-verification-title"
        >
          <div className="min-w-0">
            <div id="orbitpass-verification" className="min-w-0 scroll-mt-8">
              <p className="text-xl font-semibold tracking-tight">
                从规则出发，先确定怎样才算正确
              </p>
              <details
                open
                className="mt-4 min-w-0 rounded-xl border border-zinc-200 bg-white"
              >
                <summary className={summaryClassName}>
                  查看输入、触发条件、预期结果和判断依据
                </summary>
                <div
                  tabIndex={0}
                  aria-label="验证场景与验收标准表，可横向滚动"
                  className="max-w-full overflow-x-auto rounded-b-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
                >
                  <table className="w-full min-w-[56rem] border-collapse text-left text-sm leading-6">
                    <caption className="sr-only">
                      OrbitPass 验证场景与验收标准
                    </caption>
                    <thead className="border-y border-zinc-200 bg-zinc-50 text-zinc-700">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-medium">
                          场景
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          输入条件
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          触发条件
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          预期结果
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          判断依据
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {verificationRecords.map((record) => (
                        <tr key={record.rule}>
                          <th
                            scope="row"
                            className="px-4 py-4 align-top font-medium text-zinc-900"
                          >
                            {record.rule}
                          </th>
                          <td className="px-4 py-4 align-top text-zinc-600">
                            {record.input}
                          </td>
                          <td className="px-4 py-4 align-top text-zinc-600">
                            {record.trigger}
                          </td>
                          <td className="px-4 py-4 align-top text-zinc-600">
                            {record.expected}
                          </td>
                          <td className="px-4 py-4 align-top text-zinc-700">
                            {record.basis}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>
        </PublicCaseStep>

        <PublicCaseStep
          number={6}
          title="独立说明与教学反馈"
          titleId="orbitpass-reflection"
        >
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight">
              学生要能解释为什么接受这次修订
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-600">
              交付不止是一段改过的代码，还包括对 AI
              输出、检查依据与剩余边界的独立判断。
            </p>
            <details
              open
              className="mt-5 rounded-xl border border-zinc-200 bg-white"
            >
              <summary className={summaryClassName}>
                学生独立说明 · 说明参考
              </summary>
              <dl className="space-y-5 px-5 pb-5 pt-2 text-sm leading-7">
                {independentNotes.map((note) => (
                  <div key={note.question}>
                    <dt className="font-semibold text-zinc-900">
                      {note.question}
                    </dt>
                    <dd className="mt-1 text-zinc-600">{note.answer}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="mt-8 text-xl font-semibold tracking-tight">
              作品、说明与反馈，形成可回看的教学过程
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-600">
              提交作品时，独立说明应记录 AI 的协助范围、人的审查意见、
              各项验收依据和待验证边界，并如实区分实际执行与尚待检查的部分。
            </p>
            <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-teal-200 bg-[#F0FDFA] p-5">
                <h3 className="text-sm font-semibold text-[#0F766E]">
                  AI 辅助反馈 · 示例
                </h3>
                <p className="mt-3 text-sm leading-7 text-zinc-700">
                  请结合修订方案核对：已有预约是否在售罄判断前返回？
                  故障检查是否覆盖“扣减已发生、插入随后失败”的位置？
                  说明中还应给出实际验证依据，不能仅列出预期结果。
                </p>
              </section>
              <section className="min-w-0 rounded-xl border border-teal-200 bg-[#F0FDFA] p-5">
                <h3 className="text-sm font-semibold text-[#0F766E]">
                  教师追问
                </h3>
                <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-7 text-zinc-700">
                  <li>为什么先检查剩余名额仍可能超额？</li>
                  <li>哪项测试能暴露这个问题？</li>
                  <li>如果预约写入失败，如何保证名额不丢失？</li>
                  <li>AI 编写的测试是否遗漏了任务约束？</li>
                </ul>
              </section>
            </div>
            <p className="mt-4 text-sm leading-7 text-zinc-500">
              评阅应结合学生对方案和检查的解释；即使检查通过，也不能单独证明已经掌握相关知识。
            </p>
          </div>
        </PublicCaseStep>
      </div>
    </article>
  );
}
