import { PublicCaseHeader } from "./PublicCaseHeader";
import { PublicCaseStep } from "./PublicCaseStep";
import { PublicCaseCodeBlock } from "./PublicCaseCodeBlock";

const initialDraft = `const file = snapshot.lookup(change.path);
if (change.path.startsWith("src/") &&
    file.text.includes(change.before)) {
  return { verdict: "can-continue", change };
}`;

const proposedDiff = `--- a/src/main.ts
+++ b/src/main.ts
@@ describePreview
 export function describePreview() {
-  return "Patch applied";
+  return "Preview only";
 }`;

const revisedSketch = `require patch.baselineId === snapshot.baselineId
require onlyExistingUtf8TextEdits(patch)
rejectMalformedAsciiPaths(patch.targets)
rejectCaseAmbiguity(snapshot.manifest, patch.targets)

for target in patch.targets:
  entry = requireExactManifestEntry(target.path)
  if entry.knownOutsideWorkspace: reject("路径越界")
  if not entry.confirmedRegularTextAndPath:
    return needsEnvironmentCheck(target.path)
  require countExactContextMatches(entry.text, target.context) === 1

rejectDuplicateTargetsAndConflictingEdits(patch)
preview = buildDiffInSeparateBuffers(snapshot, patch)
return { verdict: "preview", diff: preview }`;

const verificationScenarios = [
  {
    name: "合法修改",
    input:
      "src/main.ts 位于清单中；补丁与快照均为基线 A；上下文恰好匹配一处，目标已确认为常规 UTF-8 文本。",
    expected:
      "输出指定位置的准确差异；原文件内容与输入快照保持不变，只得到预览。",
    basis: "精确文件、相同基线与唯一上下文同时满足；对比输入快照前后内容。",
  },
  {
    name: "基线变化",
    input: "补丁基于 A，当前快照为 B；旧文本在 B 中仍然存在。",
    expected: "返回“基线变化”，要求重新生成或审查；不生成可继续的修改条目。",
    basis: "匹配到文字不能替代基线一致；先核对基线，再判断上下文。",
  },
  {
    name: "路径越界",
    input:
      "目标为 src/../private.txt、/private.txt、C:/private.txt，或含反斜杠、. 路径段。",
    expected:
      "明确拒绝目标；不修正路径、不寻找替代文件，不生成可继续的修改条目。",
    basis:
      "ASCII 相对路径规则逐段核对；绝对路径、盘符、反斜杠及 .、.. 段均非法。",
  },
  {
    name: "大小写歧义",
    input:
      "清单仅有 src/main.ts，目标为 Src/main.ts；或清单同时包含 src/main.ts 与 src/Main.ts。",
    expected:
      "拒绝大小写不一致或清单歧义；不改小写，不猜测所在文件系统的行为。",
    basis: "按清单原文精确匹配，同时检查仅大小写不同的冲突项。",
  },
  {
    name: "链接或类型未确认",
    input:
      "目标为符号链接，或真实路径、文件类型尚未确认；另一目标已知指向工作区外。",
    expected:
      "前者标记“需要环境核验”，不报告安全；已知指向工作区外的目标直接拒绝。",
    basis: "路径字符串与文本快照不能证明真实目标的位置和类型。",
  },
  {
    name: "上下文与修改冲突",
    input: "上下文匹配 0 处或多处；同一文件出现重复目标，或修改区间相互重叠。",
    expected:
      "分别报告上下文缺失、匹配歧义、重复目标或修改冲突；不选择第一处凑出差异。",
    basis: "每项修改须有唯一定位；预览前整体核对目标与修改区间。",
  },
];

const summaryClassName =
  "cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold text-[#0F766E] transition-colors hover:bg-[#F0FDFA] hover:text-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E] motion-reduce:transition-none";

export function PatchDockCase() {
  return (
    <article
      aria-labelledby="patchdock-title"
      className="min-w-0 bg-white text-zinc-900"
    >
      <PublicCaseHeader
        titleId="patchdock-title"
        title="PatchDock｜AI 代码补丁审查台"
        description="AI 写好了修改，先确认它能否安全应用。从文件快照出发，把“能找到这段文字”拆成基线、路径和上下文三个独立的审查问题。"
        keywords={["基线核对", "路径边界", "差异审查"]}
      />

      <PublicCaseStep
        number={1}
        title="任务约束"
        titleId="patchdock-task-title"
      >
        <p className="max-w-3xl text-sm leading-7 text-zinc-700">
          为明确的文件快照增加补丁预检与差异预览。输入是快照、基线标识，以及修改既有
          UTF-8 文本文件的补丁；输出检查结论、原因和拟修改差异。
          不实际应用补丁，不创建、删除或重命名文件，也不执行命令。
        </p>
        <div className="mt-5 grid gap-5 border-y border-zinc-200 py-5 md:grid-cols-3 md:gap-8">
          <div>
            <h3 className="text-sm font-semibold">文件必须对得上</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              目标精确匹配快照清单；不补全名称，不模糊匹配，也不替换成“看起来相似”的文件。
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">修改必须定位唯一</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              基线一致、上下文唯一，并检查重复目标及互相冲突的修改。
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">结论必须有依据</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              大小写歧义要拒绝；链接、真实路径或类型未确认时，需要环境核验，不能直接报告安全。
            </p>
          </div>
        </div>
      </PublicCaseStep>

      <PublicCaseStep
        number={2}
        title="AI 提交初稿"
        titleId="patchdock-draft-title"
      >
        <p className="text-sm leading-7 text-zinc-700">
          初稿只检查路径以 src/ 开头、待替换文本能够找到，就给出“可继续”的结论。
          它没有回答：是不是同一份基线、目标在哪里、文字究竟匹配了几处。
        </p>
        <details
          className="mt-4 min-w-0 rounded-lg border border-zinc-200 bg-zinc-50"
          open
        >
          <summary className={summaryClassName}>查看初稿片段</summary>
          <p className="px-4 pb-2 text-xs leading-6 text-zinc-500">
            初稿与修订逻辑以伪代码呈现，只说明检查顺序。
          </p>
          <PublicCaseCodeBlock label="遗漏基线与路径边界的初稿逻辑">
            {initialDraft}
          </PublicCaseCodeBlock>
        </details>
      </PublicCaseStep>

      <PublicCaseStep
        number={3}
        title="人审查并提出修订"
        titleId="patchdock-review-title"
      >
        <blockquote className="border-l-2 border-amber-400 bg-amber-50 px-5 py-4 text-base leading-8 text-zinc-800">
          文本还能匹配，不代表文件没有被更新。路径以 src/
          开头，也不能证明它仍在项目目录内。
        </blockquote>
        <ul className="mt-5 space-y-3 text-sm leading-7 text-zinc-700">
          <li>基线已从 A 变成 B，即使文字仍在，也必须重新审查。</li>
          <li>src/../private.txt 同样满足前缀判断，却包含越界路径段。</li>
          <li>匹配两处时不能默认选第一处，重复修改也不能逐项忽略。</li>
        </ul>
      </PublicCaseStep>

      <PublicCaseStep
        number={4}
        title="修订方案"
        titleId="patchdock-revision-title"
      >
        <p className="max-w-4xl text-sm leading-7 text-zinc-700">
          案例采用 ASCII
          相对路径约定：路径段仅包含英文字母、数字、点、下划线和连字符，以正斜杠分隔；不接受空段、绝对路径、盘符、反斜杠及
          .、.. 段。按原文匹配清单，并单独识别大小写冲突，不用路径修正代替拒绝。
        </p>

        <div className="mt-6 grid min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:grid-cols-[0.85fr_1.15fr]">
          <div className="min-w-0 border-b border-zinc-200 bg-zinc-50 p-5 lg:border-b-0 lg:border-r">
            <h3 className="text-sm font-semibold text-zinc-800">文件快照 A</h3>
            <p className="mt-1 text-xs leading-6 text-zinc-500">
              清单节选 · 目标名称精确匹配
            </p>
            <div className="mt-4">
              <PublicCaseCodeBlock label="文件快照清单">
                {`project/
├─ src/
│  ├─ main.ts       ← 拟修改
│  ├─ config.ts
│  └─ shortcut.ts   ← 路径状态待核验
└─ README.md`}
              </PublicCaseCodeBlock>
            </div>
            <p className="mt-4 text-xs leading-6 text-zinc-600">
              本次差异目标 src/main.ts：清单记录为常规 UTF-8
              文本，补丁与快照基线一致，上下文唯一匹配。
            </p>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-zinc-800">
                拟修改差异
              </h3>
              <span className="rounded-full bg-[#F0FDFA] px-2 py-1 text-xs font-medium text-[#0F766E]">
                差异预览
              </span>
            </div>
            <PublicCaseCodeBlock label="src/main.ts 的拟修改差异">
              {proposedDiff}
            </PublicCaseCodeBlock>
            <div className="border-t border-zinc-200 bg-[#F0FDFA] px-5 py-4">
              <h3 className="text-xs font-semibold text-[#0F766E]">预检意见</h3>
              <p className="mt-1 text-sm leading-7 text-zinc-700">
                在上述输入条件下，可继续审查这份差异；结论只包含预览，不表示补丁已写入。
              </p>
            </div>
          </div>
        </div>

        <details className="mt-5 min-w-0 rounded-lg border border-zinc-200 bg-zinc-50">
          <summary className={summaryClassName}>查看修订方案的关键逻辑</summary>
          <PublicCaseCodeBlock label="先核对基线与路径，再构造差异的修订逻辑">
            {revisedSketch}
          </PublicCaseCodeBlock>
        </details>
        <p className="mt-4 text-sm leading-7 text-zinc-600">
          预检结论针对所检查的快照；实际应用前仍需重新核对基线和真实路径状态。
        </p>
      </PublicCaseStep>

      <PublicCaseStep
        number={5}
        title="验证场景与验收标准"
        titleId="patchdock-verification-title"
      >
        <p className="max-w-3xl text-sm leading-7 text-zinc-600">
          预期先从任务约束写出，再用这些场景审查实现及 AI
          编写的检查。拒绝的具体原因和输入是否保持不变，都属于验收内容。
        </p>
        <div
          tabIndex={0}
          role="region"
          aria-label="六类补丁预检验证场景，可横向滚动"
          className="mt-5 min-w-0 max-w-full overflow-x-auto rounded-xl border border-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F766E]"
        >
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <caption className="sr-only">输入条件、验收预期与判断依据</caption>
            <thead className="bg-zinc-50 text-xs text-zinc-600">
              <tr>
                <th scope="col" className="w-[8rem] px-4 py-3 font-medium">
                  场景
                </th>
                <th scope="col" className="w-[17rem] px-4 py-3 font-medium">
                  输入与触发条件
                </th>
                <th scope="col" className="w-[17rem] px-4 py-3 font-medium">
                  预期结果
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  判断依据
                </th>
              </tr>
            </thead>
            <tbody>
              {verificationScenarios.map((scenario) => (
                <tr
                  key={scenario.name}
                  className="border-t border-zinc-200 align-top"
                >
                  <th
                    scope="row"
                    className="px-4 py-4 font-medium leading-7 text-zinc-900"
                  >
                    {scenario.name}
                  </th>
                  <td className="px-4 py-4 leading-7 text-zinc-700">
                    {scenario.input}
                  </td>
                  <td className="px-4 py-4 leading-7 text-zinc-700">
                    {scenario.expected}
                  </td>
                  <td className="px-4 py-4 leading-7 text-zinc-600">
                    {scenario.basis}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PublicCaseStep>

      <PublicCaseStep
        number={6}
        title="独立说明与教学反馈"
        titleId="patchdock-teaching-title"
      >
        <details className="rounded-lg border border-zinc-200 bg-zinc-50" open>
          <summary className={summaryClassName}>
            学生独立说明 · 说明参考
          </summary>
          <div className="space-y-3 border-t border-zinc-200 px-4 py-4 text-sm leading-7 text-zinc-700">
            <p>
              我请 AI
              在文件快照上实现预检和差异预览。我没有把“待替换文本存在”作为唯一依据，而是要求分别核对基线、路径清单和上下文的唯一性。
            </p>
            <p>
              文本匹配回答的是“改哪一段”；基线一致回答的是“是不是约定的版本”；路径核验回答的是“目标究竟是哪一个文件”。三者不能互相替代。
            </p>
            <p>
              我会用基线
              A/B、大小写冲突、重复目标与多处上下文样本逐项核对拒绝理由，并对比输入快照是否保持原样。接受这份修订的依据，应是方案与验收标准逐项对应，而不是
              AI 自报正确。
            </p>
          </div>
        </details>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-teal-200 bg-[#F0FDFA] p-5">
            <h3 className="text-sm font-semibold text-[#0F766E]">
              AI 辅助反馈参考
            </h3>
            <p className="mt-3 text-sm leading-7 text-zinc-700">
              将“文本匹配”“版本一致”和“真实路径核验”分开说明，有助于解释每项拒绝的依据。还应审查
              AI 生成的测试，确认没有把路径清洗或选取第一处匹配当作正确行为。
            </p>
          </div>
          <div className="min-w-0 border-l border-zinc-200 pl-5">
            <h3 className="text-sm font-semibold text-zinc-900">教师追问</h3>
            <ul className="mt-3 space-y-2 text-sm leading-7 text-zinc-700">
              <li>预检之后文件又被修改，原结论是否仍然成立？</li>
              <li>为什么只检查路径前缀不够？</li>
              <li>没有写入文件，能否宣称补丁已经安全应用？</li>
            </ul>
          </div>
        </div>
      </PublicCaseStep>
    </article>
  );
}
