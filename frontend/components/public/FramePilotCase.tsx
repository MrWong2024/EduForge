import { PublicCaseHeader } from "./PublicCaseHeader";
import { PublicCaseStep } from "./PublicCaseStep";
import { PublicCaseCodeBlock } from "./PublicCaseCodeBlock";

const initialDraft = `const offset = clips[0].startMs;
return uniqueById(
  clips.flatMap(() =>
    subtitles.map((cue) => ({
      ...cue,
      startMs: cue.startMs - offset,
      endMs: cue.endMs - offset,
    })),
  ),
);`;

const revisedLogic = `validateAllIntervals(clips, subtitles)
// 每个时间：非负安全整数；每个区间：startMs < endMs
p = 0
output = []

for (clip, clipIndex) in clips in input order:
  a = clip.startMs
  b = clip.endMs
  nextP = p + (b - a)
  require Number.isSafeInteger(nextP)

  for (cue, subtitleIndex) in subtitles in input order:
    left = max(a, cue.startMs)
    right = min(b, cue.endMs)
    if left < right:
      output.append({
        startMs: p + (left - a),
        endMs: p + (right - a),
        text: cue.text,
        clipIndex,
        subtitleIndex,
      })
  p = nextP

return sort(output, by startMs, then clipIndex, then subtitleIndex)
// 不按字幕 ID 去重，不合并跨片段结果`;

const scenarios = [
  {
    name: "完整保留",
    input: "片段：[0,5000)\n字幕 A：[1000,3000)",
    expected: "A [1000,3000)",
    basis: "字幕完整落在片段内；片段成片起点为 0，源起点也为 0。",
  },
  {
    name: "两端裁切",
    input: "片段：[2000,4000)\nA：[1000,3000)\nB：[3500,4500)",
    expected: "A [0,1000)\nB [1500,2000)",
    basis: "先分别取交集 [2000,3000)、[3500,4000)，再减去片段源起点 2000。",
  },
  {
    name: "只碰边界",
    input: "片段：[2000,4000)\nA：[1000,2000)\nB：[4000,5000)",
    expected: "无输出，交集长度为 0",
    basis: "两次交集均为 left = right；半开区间仅接触端点，没有保留时长。",
  },
  {
    name: "按剪辑顺序重排",
    input:
      "片段依次：[6000,8000)、[1000,4000)\n字幕输入依次：A [1500,2500)、B [6500,7000)",
    expected: "B [500,1000) 在前\nA [2500,3500) 在后",
    basis: "第一个片段成片起点 p = 0，第二个 p = 2000；字幕按成片起点排序。",
  },
  {
    name: "重复使用片段",
    input: "片段依次：[1000,3000)、[1000,3000)\n字幕 A：[1500,2500)",
    expected: "两个实例：\n[500,1500)\n[2500,3500)",
    basis:
      "两次片段使用的成片起点分别为 0、2000；字幕 ID 相同也要保留两个实例。",
  },
  {
    name: "字幕跨拼接点",
    input: "片段依次：[1000,2000)、[2000,3000)\n字幕 A：[1500,2500)",
    expected: "[500,1000)\n[1000,1500)\n不自动合并",
    basis: "分别与两个片段求交并映射；成片上相邻，仍保留各自的片段来源。",
  },
];

const sourceTicks = [
  { x: 120, label: "0" },
  { x: 210, label: "1000" },
  { x: 300, label: "2000" },
  { x: 390, label: "3000" },
  { x: 480, label: "4000" },
  { x: 570, label: "5000" },
  { x: 660, label: "6000" },
  { x: 750, label: "7000" },
  { x: 840, label: "8000" },
];

const summaryClassName =
  "cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold text-[#0F766E] transition-colors hover:bg-[#F0FDFA] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] motion-reduce:transition-none";

export function FramePilotCase() {
  return (
    <article
      aria-labelledby="framepilot-title"
      className="min-w-0 text-zinc-900"
    >
      <PublicCaseHeader
        titleId="framepilot-title"
        title="FramePilot｜智能视频剪辑工作台"
        description="视频重新剪辑，字幕也要准确跟着走。这次协作聚焦同一视频裁切、重排和拼接后的字幕时间数据，不涉及视频解码、字幕生成或播放器。"
        keywords={["时间映射", "边界处理", "精确验证"]}
      />

      <PublicCaseStep
        number={1}
        title="任务约束"
        titleId="framepilot-constraints"
      >
        <h3 className="text-lg font-semibold tracking-tight">
          先约定两套时间，再讨论怎么移动字幕
        </h3>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          源时间描述素材中的位置；成片时间描述剪辑后的播放位置。
          片段数组的输入顺序就是播放顺序，各片段连续拼接，无间隙、无转场、无倍速。
        </p>
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <div className="border-l-2 border-teal-300 pl-4">
            <dt className="text-sm font-semibold">时间有统一边界</dt>
            <dd className="mt-1 text-sm leading-7 text-zinc-600">
              全部时间使用非负安全整数毫秒，区间统一为半开区间 [startMs,
              endMs)，且 startMs &lt; endMs。
            </dd>
          </div>
          <div className="border-l-2 border-teal-300 pl-4">
            <dt className="text-sm font-semibold">顺序来自剪辑意图</dt>
            <dd className="mt-1 text-sm leading-7 text-zinc-600">
              不按片段源起点重新排序。字幕输入可以无序，输出文字保持原样。
            </dd>
          </div>
          <div className="border-l-2 border-teal-300 pl-4">
            <dt className="text-sm font-semibold">每次使用都是独立实例</dt>
            <dd className="mt-1 text-sm leading-7 text-zinc-600">
              同一源片段可重复使用，每次分别映射；不按字幕 ID
              去重，跨片段结果不自动合并。
            </dd>
          </div>
          <div className="border-l-2 border-teal-300 pl-4">
            <dt className="text-sm font-semibold">输出要可复核</dt>
            <dd className="mt-1 text-sm leading-7 text-zinc-600">
              按成片起点排序；同起点时，依次按片段序号、字幕原序号稳定排序。
              非法时间、倒置或零长度区间、累计时长溢出应明确拒绝。
            </dd>
          </div>
        </dl>

        <figure className="mt-7 min-w-0 rounded-2xl border border-zinc-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-4">
            <h3 className="text-sm font-semibold">
              重排示意：先用后段，再接前段
            </h3>
            <span className="text-xs text-zinc-500">
              两条时间轴采用相同比例 · 单位 ms
            </span>
          </div>
          <div
            tabIndex={0}
            aria-label="源时间与成片时间示意，可横向滚动"
            className="min-w-0 max-w-full overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
          >
            <svg
              width="900"
              height="330"
              viewBox="0 0 900 330"
              role="img"
              aria-labelledby="framepilot-timeline-title framepilot-timeline-description"
              className="block h-auto w-[900px] max-w-none"
            >
              <title id="framepilot-timeline-title">
                重排前后的字幕时间映射
              </title>
              <desc id="framepilot-timeline-description">
                源片段按 [6000,8000)、[1000,4000) 的顺序拼接。 源字幕 A
                [1500,2500)、B [6500,7000) 映射为成片字幕 B [500,1000)、A
                [2500,3500)。 成片总长 5000 毫秒，两个片段在成片 2000
                毫秒处拼接。
              </desc>
              <text x="24" y="35" fill="#3f3f46" fontSize="13" fontWeight="600">
                源时间
              </text>
              <line x1="120" y1="44" x2="840" y2="44" stroke="#d4d4d8" />
              {sourceTicks.map((tick) => (
                <g key={tick.label}>
                  <text
                    x={tick.x}
                    y="35"
                    fill="#71717a"
                    fontSize="11"
                    textAnchor="middle"
                  >
                    {tick.label}
                  </text>
                  <line
                    x1={tick.x}
                    y1="44"
                    x2={tick.x}
                    y2="50"
                    stroke="#a1a1aa"
                  />
                </g>
              ))}
              <rect
                x="120"
                y="54"
                width="720"
                height="32"
                rx="5"
                fill="#f4f4f5"
              />
              <rect
                x="210"
                y="54"
                width="270"
                height="32"
                rx="5"
                fill="#ccfbf1"
                stroke="#0d9488"
              />
              <text
                x="345"
                y="74"
                fill="#115E59"
                fontSize="12"
                textAnchor="middle"
              >
                ② 源片段 [1000,4000)
              </text>
              <rect
                x="660"
                y="54"
                width="180"
                height="32"
                rx="5"
                fill="#0F766E"
              />
              <text
                x="750"
                y="74"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                ① 源片段 [6000,8000)
              </text>
              <text x="24" y="118" fill="#71717a" fontSize="12">
                源字幕
              </text>
              <rect
                x="255"
                y="100"
                width="90"
                height="26"
                rx="4"
                fill="#475569"
              />
              <text
                x="300"
                y="118"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                A
              </text>
              <rect
                x="705"
                y="100"
                width="45"
                height="26"
                rx="4"
                fill="#0F766E"
              />
              <text
                x="727.5"
                y="118"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                B
              </text>
              <text x="120" y="151" fill="#52525b" fontSize="12">
                字幕输入顺序：A → B；片段播放顺序：① → ②
              </text>

              <text
                x="24"
                y="195"
                fill="#3f3f46"
                fontSize="13"
                fontWeight="600"
              >
                成片时间
              </text>
              <line x1="120" y1="204" x2="570" y2="204" stroke="#d4d4d8" />
              {sourceTicks.slice(0, 6).map((tick) => (
                <g key={tick.label}>
                  <text
                    x={tick.x}
                    y="195"
                    fill="#71717a"
                    fontSize="11"
                    textAnchor="middle"
                  >
                    {tick.label}
                  </text>
                  <line
                    x1={tick.x}
                    y1="204"
                    x2={tick.x}
                    y2="210"
                    stroke="#a1a1aa"
                  />
                </g>
              ))}
              <rect
                x="120"
                y="214"
                width="180"
                height="32"
                rx="5"
                fill="#0F766E"
              />
              <text
                x="210"
                y="234"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                ① 时长 2000
              </text>
              <rect
                x="300"
                y="214"
                width="270"
                height="32"
                rx="5"
                fill="#ccfbf1"
                stroke="#0d9488"
              />
              <text
                x="435"
                y="234"
                fill="#115E59"
                fontSize="12"
                textAnchor="middle"
              >
                ② 时长 3000
              </text>
              <text x="24" y="282" fill="#71717a" fontSize="12">
                成片字幕
              </text>
              <rect
                x="165"
                y="264"
                width="45"
                height="26"
                rx="4"
                fill="#0F766E"
              />
              <text
                x="187.5"
                y="282"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                B
              </text>
              <rect
                x="345"
                y="264"
                width="90"
                height="26"
                rx="4"
                fill="#475569"
              />
              <text
                x="390"
                y="282"
                fill="white"
                fontSize="12"
                textAnchor="middle"
              >
                A
              </text>
              <line
                x1="300"
                y1="210"
                x2="300"
                y2="297"
                stroke="#0d9488"
                strokeDasharray="4 4"
              />
              <text
                x="300"
                y="316"
                fill="#0F766E"
                fontSize="12"
                textAnchor="middle"
              >
                拼接点 2000
              </text>
            </svg>
          </div>
          <figcaption className="border-t border-zinc-100 px-5 py-4 text-sm leading-7 text-zinc-600">
            源字幕 A [1500,2500)、B [6500,7000)，成片应为 B [500,1000) 在前、A
            [2500,3500) 在后。 图中的深青绿片段先播放，浅青绿片段后播放。
          </figcaption>
        </figure>
      </PublicCaseStep>

      <PublicCaseStep number={2} title="AI 提交初稿" titleId="framepilot-draft">
        <h3 className="text-lg font-semibold tracking-tight">
          一个偏移量，不能代表整段成片
        </h3>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          初稿只减去第一个片段的源起点，再按字幕 ID 去重。
          重排后，后续片段在成片中的起点被忽略；重复使用同一画面时，本该出现两次的字幕也会被删去一次。
        </p>
        <p className="mt-3 text-xs leading-6 text-zinc-500">
          以下初稿与后文修订逻辑均为伪代码，用于讨论时间数据。
        </p>
        <details className="mt-4 min-w-0 rounded-xl border border-zinc-200 bg-white">
          <summary className={summaryClassName}>查看初稿片段</summary>
          <PublicCaseCodeBlock label="初稿代码，可横向滚动">
            {initialDraft}
          </PublicCaseCodeBlock>
        </details>
      </PublicCaseStep>

      <PublicCaseStep
        number={3}
        title="人审查并提出修订"
        titleId="framepilot-review"
      >
        <h3 className="text-lg font-semibold tracking-tight">
          先问坐标系，再看代码是否简洁
        </h3>
        <blockquote className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-base leading-8 text-zinc-800">
          “每个片段在成片中都有自己的起点。重排之后为什么还使用第一个片段的偏移？
          同一画面出现两次，字幕为什么只剩一次？”
        </blockquote>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          人的修订要求应落到三件事：对每个片段独立求交，累计它在成片中的起点，保留每次使用所产生的字幕实例。
          先按这些规则手写预期，避免让 AI 用初稿输出反过来定义正确答案。
        </p>
      </PublicCaseStep>

      <PublicCaseStep number={4} title="修订方案" titleId="framepilot-revision">
        <h3 className="text-lg font-semibold tracking-tight">
          先取交集，再从源时间映射到成片时间
        </h3>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          对字幕 [s,e) 与片段 [a,b) 取交集。片段在成片中的起点为 p， 则 left =
          max(a,s)，right = min(b,e)。只有 left &lt; right 时才输出：
        </p>
        <div className="mt-4">
          <PublicCaseCodeBlock label="时间映射公式，可横向滚动">
            {"[p + left - a, p + right - a)"}
          </PublicCaseCodeBlock>
        </div>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          p 来自前面所有片段的累计时长，不能用源起点替代。
          先检查全部区间，再在处理每个片段前检查 p + (b - a)
          仍为安全整数；任何非法输入都应拒绝整个映射结果。
          字幕文字直接保留，不修剪、不改写。
        </p>
        <details className="mt-5 min-w-0 rounded-xl border border-zinc-200 bg-white">
          <summary className={summaryClassName}>
            展开关键逻辑与排序规则（伪代码）
          </summary>
          <PublicCaseCodeBlock label="修订逻辑，可横向滚动">
            {revisedLogic}
          </PublicCaseCodeBlock>
        </details>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          输出以成片 startMs 排序，同起点时再按片段序号、字幕原序号排序。
          原序号在映射前保留，字幕 ID
          只用于溯源，不决定结果是否保留；跨片段的相邻结果也不自动合并。
        </p>
      </PublicCaseStep>

      <PublicCaseStep
        number={5}
        title="验证场景与验收标准"
        titleId="framepilot-verification"
      >
        <h3 className="text-lg font-semibold tracking-tight">
          用固定输入，把每一毫秒的预期写清楚
        </h3>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          下表均以 ms
          为单位。执行验证时，应比较完整输出的数量、区间、顺序与文字原值，而不只检查是否存在一条字幕。
        </p>
        <details
          open
          className="mt-5 min-w-0 rounded-xl border border-zinc-200 bg-white"
        >
          <summary className={summaryClassName}>
            查看六种固定场景的输入与手写预期
          </summary>
          <div
            tabIndex={0}
            aria-label="FramePilot 验收标准表，可横向滚动"
            className="max-w-full overflow-x-auto rounded-b-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
          >
            <table className="w-full min-w-[58rem] border-collapse text-left text-sm leading-6">
              <caption className="sr-only">
                字幕时间映射的固定输入与验收标准，单位毫秒
              </caption>
              <thead className="border-y border-zinc-200 bg-zinc-50 text-zinc-700">
                <tr>
                  <th scope="col" className="w-[14%] px-4 py-3 font-medium">
                    场景
                  </th>
                  <th scope="col" className="w-[30%] px-4 py-3 font-medium">
                    输入与触发条件
                  </th>
                  <th scope="col" className="w-[24%] px-4 py-3 font-medium">
                    预期结果
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    判断依据
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {scenarios.map((scenario) => (
                  <tr key={scenario.name}>
                    <th
                      scope="row"
                      className="px-4 py-4 align-top font-medium text-zinc-900"
                    >
                      {scenario.name}
                    </th>
                    <td className="whitespace-pre-line px-4 py-4 align-top text-zinc-600">
                      {scenario.input}
                    </td>
                    <td className="whitespace-pre-line px-4 py-4 align-top font-medium text-[#0F766E]">
                      {scenario.expected}
                    </td>
                    <td className="px-4 py-4 align-top text-zinc-600">
                      {scenario.basis}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-7 text-zinc-700">
          非法输入还需明确拒绝：例如负数、小数或非安全整数时间，startMs ≥ endMs
          的区间，以及累计时长超出安全整数范围。
          不能把异常值自动取整、调换起止，或静默跳过后继续返回部分结果。
        </p>
      </PublicCaseStep>

      <PublicCaseStep
        number={6}
        title="独立说明与教学反馈"
        titleId="framepilot-reflection"
      >
        <h3 className="text-lg font-semibold tracking-tight">
          能说明映射依据，才有审查代码的起点
        </h3>
        <details
          open
          className="mt-5 rounded-xl border border-zinc-200 bg-white"
        >
          <summary className={summaryClassName}>
            说明参考 · 从坐标系到边界
          </summary>
          <dl className="space-y-5 px-5 pb-5 pt-1 text-sm leading-7">
            <div>
              <dt className="font-semibold">源时间与成片时间有什么区别？</dt>
              <dd className="mt-1 text-zinc-600">
                源时间定位原视频，成片时间由剪辑顺序累计得到。同一段源画面出现两次，会对应两个不同的成片位置。
              </dd>
            </div>
            <div>
              <dt className="font-semibold">为什么先求交集？</dt>
              <dd className="mt-1 text-zinc-600">
                只有字幕与保留片段重叠的部分才应出现。先裁切，再用 p
                加上片段内的偏移；只碰端点时 left =
                right，没有持续时间，因此没有输出。
              </dd>
            </div>
            <div>
              <dt className="font-semibold">为什么不能用字幕 ID 去重？</dt>
              <dd className="mt-1 text-zinc-600">
                ID
                标识源字幕，不标识它在成片中的每次出现。重复片段必须保留多个实例；跨拼接点的结果即使相邻，也保留各自来源。
              </dd>
            </div>
            <div>
              <dt className="font-semibold">我怎样审查 AI 的修订与检查？</dt>
              <dd className="mt-1 text-zinc-600">
                先独立计算六个场景的区间，再核对代码是否逐片段累计
                p、保留文字、稳定排序，并拒绝非法区间与累计溢出。不能由被测实现生成它自己的预期答案。
              </dd>
            </div>
            <div>
              <dt className="font-semibold">当前方案的边界在哪里？</dt>
              <dd className="mt-1 text-zinc-600">
                公式依赖连续拼接且不变速。倍速、转场、音画同步和实际媒体解码不在此时间数据合同内；增加这些能力时，需要重新定义坐标映射与验收标准。
              </dd>
            </div>
          </dl>
        </details>
        <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-teal-200 bg-[#F0FDFA] p-5">
            <h3 className="text-sm font-semibold text-[#0F766E]">
              AI 辅助反馈参考
            </h3>
            <p className="mt-3 text-sm leading-7 text-zinc-700">
              交集公式还不足以覆盖累计溢出与稳定排序。请说明相同成片起点时的排序依据，并检查映射前后字幕文字是否完全一致。
            </p>
          </section>
          <section className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
            <h3 className="text-sm font-semibold text-zinc-900">教师追问</h3>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-7 text-zinc-700">
              <li>字幕碰到片段边界为什么没有输出？</li>
              <li>为什么不能按字幕 ID 去重？</li>
              <li>如果允许倍速，当前映射公式还够用吗？</li>
            </ul>
          </section>
        </div>
      </PublicCaseStep>
    </article>
  );
}
