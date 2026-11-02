const taskRules = [
  ["预约唯一", "同一用户对同一活动，最多获得一个有效预约。"],
  ["重试不多扣", "网络重试返回原预约，不再次扣减名额。"],
  ["并发不超额", "仅剩一席时，多人同时申请只能有一人成功。"],
  ["写入须完整", "扣减名额与建立预约，整体成功或整体失败。"],
  ["身份可信", "从认证上下文确定用户，不能靠请求参数冒用身份。"],
  ["原查询保持", "既有查询的结果、字段和分页约定保持不变。"],
];

const initialDraft = `// 初稿片段：仅用于说明问题，不是完整实现
const { eventId, userId } = request.body;
const remaining = await readRemaining(eventId);
if (remaining <= 0) throw SoldOut;

// 两个请求可能都已读到 remaining = 1
await decreaseSeat(eventId);
return await createReservation({ userId, eventId });`;

const revisedSketch = `// 修订伪代码：省略数据库适配与完整错误处理，不可直接部署
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
    expected: "初始余量 2，建立 1 条预约，余量变为 1。",
    record: "预置样本记录：新增预约 R-01；预约条数增加 1，余量 2 → 1。",
  },
  {
    rule: "同一用户重复请求",
    expected: "同一活动、同一身份返回相同预约，只扣减一次。",
    record:
      "首次返回 R-01；用同一身份再次请求仍返回 R-01，预约仍为 1 条，余量仍为 1。",
  },
  {
    rule: "最后一席，20 人并发",
    expected: "20 名不同用户争 1 席：仅 1 人成功，余量为 0。",
    record:
      "初稿中，A/B 同读余量 1 后可各建一条预约。修订材料记录：1 人成功、19 人售罄，新增预约 1 条，余量 0。",
  },
  {
    rule: "预约写入故障",
    expected: "扣减后插入失败，整个事务回滚；余量和预约均回到起点。",
    record:
      "在扣减后、插入预约前注入错误；事务结束后余量仍为 1，新增预约为 0 条。",
  },
  {
    rule: "非法参数或冒用身份",
    expected: "拒绝请求，预约条数和剩余名额均不变。",
    record:
      "未登录、非法活动标识、携带他人 userId 的输入均被拒；预约条数与余量的前后快照相同。",
  },
  {
    rule: "既有查询",
    expected: "同一固定样本下，查询结果与原接口约定一致。",
    record:
      "按手写预期逐项比对固定查询样本：预约 ID、返回顺序、字段与分页 total 均保持一致。",
  },
];

const independentNotes = [
  {
    question: "我请 AI 完成什么？",
    answer:
      "在已有预约功能上补充安全重试与并发保护，保留查询行为；我先给出唯一预约、名额上限、原子写入和可信身份等规则。",
  },
  {
    question: "我审查并要求修订了什么？",
    answer:
      "初稿把读取余量、扣减和插入拆开，还直接使用请求里的 userId。我要求解释同读最后一席的竞争，改为事务内锁定活动行、优先返回已有预约、条件扣减与唯一约束，并从认证上下文取身份。",
  },
  {
    question: "哪些检查对应哪些业务规则？",
    answer:
      "正常与重复请求对应“只建一条、只扣一次”；20 人争最后一席对应容量约束；插入故障对应整体回滚；非法输入对应身份与参数校验；固定样本对比对应原查询保持。预期先按任务规则手写，再审查 AI 生成的检查是否覆盖这些规则。",
  },
  {
    question: "我为什么接受当前方案？",
    answer:
      "我能逐条解释锁、条件扣减、唯一约束和回滚各自负责什么，且演示材料给出了对应的观察值。我接受这份修订用于交付评阅，理由不是 AI 自报“通过”，而是方案和检查都能对上任务规则。",
  },
  {
    question: "当前材料尚不能证明什么？",
    answer:
      "这些预置记录不能证明真实数据库中的隔离配置、锁超时或死锁处理，也未证明真实网络断连与响应丢失的端到端行为。取消、候补和跨服务写入不在本案例范围；实际交付仍需在目标环境复现和审查。",
  },
];

const summaryClassName =
  "cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 motion-reduce:transition-none";

export function OrbitPassCase() {
  return (
    <section
      id="orbitpass-case"
      aria-labelledby="orbitpass-title"
      className="scroll-mt-8 border-y border-zinc-200 bg-zinc-50 px-4 py-16 text-zinc-900 sm:px-6 sm:py-24"
    >
      <div className="mx-auto min-w-0 max-w-6xl">
        <header className="max-w-3xl">
          <p className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium leading-5 text-indigo-800">
            虚构工程案例 · 预置演示材料
          </p>
          <p className="mt-6 text-sm font-medium tracking-wide text-blue-700">
            从“生成代码”走向“对交付负责”
          </p>
          <h2
            id="orbitpass-title"
            className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl lg:text-4xl"
          >
            OrbitPass｜开发者大会席位预约系统
          </h2>
          <p className="mt-5 text-base leading-8 text-zinc-600">
            为已有预约功能补上一个保障：可安全重试，不重复扣减，也不超额分配。
            看人怎样定义规则、审查 AI 初稿，再用证据说明为什么这样改。
          </p>
        </header>

        <div className="mt-8 grid min-w-0 gap-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-5 sm:p-6 lg:grid-cols-2 lg:gap-8">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sky-900">
              外部开发环境，如 Codex
            </p>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              任务卡、AI 编码、diff 审查、本地验证与人工验收发生在外部开发环境。
            </p>
          </div>
          <div className="min-w-0 border-t border-sky-200 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <p className="text-sm font-semibold text-indigo-900">
              EduForge 承载教学过程
            </p>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              提交源码作品与独立说明，查看 AI
              辅助反馈、教师反馈，并回看修订过程。
              以下展示为静态材料，不在页面内运行预约系统或测试。
            </p>
          </div>
        </div>

        <ol className="mt-10 space-y-8 sm:mt-14 sm:space-y-10">
          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs text-white">
                01
              </span>
              人定义规则
            </h3>
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
                    className="min-w-0 border-l-2 border-blue-200 pl-4"
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
          </li>

          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs text-indigo-800">
                02
              </span>
              AI 提交初稿
            </h3>
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
                <pre
                  tabIndex={0}
                  aria-label="AI 初稿示意代码，可横向滚动"
                  className="m-0 max-w-full overflow-x-auto rounded-b-xl bg-zinc-950 p-5 text-xs leading-7 text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 sm:text-sm"
                >
                  <code>{initialDraft}</code>
                </pre>
              </details>
            </div>
          </li>

          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs text-white">
                03
              </span>
              人审查并提出修订
            </h3>
            <div className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
              <p className="text-sm font-semibold text-amber-900">
                人的审查意见
              </p>
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
          </li>

          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs text-indigo-800">
                04
              </span>
              AI 修订并验证
            </h3>
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
                  查看修订伪代码与剩余边界
                </summary>
                <pre
                  tabIndex={0}
                  aria-label="修订伪代码，可横向滚动"
                  className="m-0 max-w-full overflow-x-auto bg-zinc-950 p-5 text-xs leading-7 text-sky-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 sm:text-sm"
                >
                  <code>{revisedSketch}</code>
                </pre>
                <div className="space-y-3 px-5 py-4 text-sm leading-7 text-zinc-600">
                  <p>
                    先查已有预约，意味着提交成功但响应丢失后，同一身份重试可返回原预约，
                    不会因为此时已售罄而再扣名额。唯一约束冲突或插入失败时，扣减也须回滚。
                  </p>
                  <p>
                    这不是可部署的完整实现。真实数据库的隔离级别、锁超时、死锁与断连处理仍需验证；
                    取消、候补和跨服务写入不在片段范围，加入这些流程时需重新审查唯一约束与一致性。
                    单靠一个锁或事务不能证明全部风险已经解决。
                  </p>
                </div>
              </details>

              <div
                id="orbitpass-verification"
                className="mt-7 min-w-0 scroll-mt-8"
              >
                <h4 className="text-base font-semibold text-zinc-900">
                  把“通过”展开成可检查的依据
                </h4>
                <p className="mt-2 text-sm font-medium leading-7 text-indigo-800">
                  外部开发验证记录（演示），未在当前页面实际运行。
                </p>
                <details
                  open
                  className="mt-4 min-w-0 rounded-xl border border-zinc-200 bg-white"
                >
                  <summary className={summaryClassName}>
                    查看六项业务约束、手写预期与预置记录
                  </summary>
                  <div
                    tabIndex={0}
                    aria-label="演示验证记录表，可横向滚动"
                    className="max-w-full overflow-x-auto rounded-b-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
                  >
                    <table className="w-full min-w-[44rem] border-collapse text-left text-sm leading-6">
                      <caption className="sr-only">
                        OrbitPass 预置演示记录，非本页实际执行结果
                      </caption>
                      <thead className="border-y border-zinc-200 bg-zinc-50 text-zinc-700">
                        <tr>
                          <th
                            scope="col"
                            className="w-[20%] px-4 py-3 font-medium"
                          >
                            业务约束
                          </th>
                          <th
                            scope="col"
                            className="w-[32%] px-4 py-3 font-medium"
                          >
                            手写预期
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            演示结果 / 修订说明
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
                              {record.expected}
                            </td>
                            <td className="px-4 py-4 align-top text-zinc-700">
                              {record.record}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </div>
          </li>

          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs text-white">
                05
              </span>
              人审阅交付
            </h3>
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
                  学生独立说明 · 示例原文
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
            </div>
          </li>

          <li className="grid min-w-0 gap-4 border-t border-zinc-200 pt-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
            <h3 className="flex items-start gap-3 text-sm font-semibold leading-7 text-zinc-900">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                06
              </span>
              提交到 EduForge
            </h3>
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">
                作品、说明与反馈，形成可回看的教学过程
              </p>
              <p className="mt-3 text-sm leading-7 text-zinc-600">
                提交摘要示例：预约源码片段及修订后的实现；独立说明记录 AI
                的协助范围、
                人的审查意见、验证依据和待验证边界。外部验证记录在此作为说明材料呈现，
                不代表平台自动采集或执行测试。
              </p>
              <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
                <section className="min-w-0 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
                  <h4 className="text-sm font-semibold text-indigo-900">
                    AI 辅助反馈 · 示例
                  </h4>
                  <p className="mt-3 text-sm leading-7 text-zinc-700">
                    修订已说明原子分配与唯一约束。请继续核对：已有预约是否在售罄判断前返回？
                    故障检查是否覆盖“扣减已发生、插入随后失败”的位置？预置记录仍需在实际环境复现。
                  </p>
                </section>
                <section className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/50 p-5">
                  <h4 className="text-sm font-semibold text-blue-900">
                    教师反馈 · 示例
                  </h4>
                  <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-7 text-zinc-700">
                    <li>为什么先检查剩余名额仍可能超额？</li>
                    <li>哪项测试能暴露这个问题？</li>
                    <li>如果预约写入失败，如何保证名额不丢失？</li>
                    <li>AI 编写的测试是否遗漏了任务约束？</li>
                  </ul>
                </section>
              </div>
              <p className="mt-4 text-sm leading-7 text-zinc-500">
                这些反馈用于继续讨论与修订；演示检查通过，不等于已经证明学生掌握了相关知识。
              </p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
