import type { AiLearningAnalyticsMethodology } from "@/lib/api/types-teacher";
import { getAiLearningAnalyticsMethodologyVersionLabel } from "@/lib/ai-learning-analytics";

type AiLearningAnalyticsMethodologyPanelProps = {
  methodology: AiLearningAnalyticsMethodology;
};

type AiLearningAnalyticsMetricGuideProps = {
  variant: "class" | "student";
};

export function AiLearningAnalyticsMethodologyPanel({
  methodology,
}: AiLearningAnalyticsMethodologyPanelProps) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <h2 className="font-semibold">方法学说明与适用边界</h2>
      <dl className="mt-3 grid gap-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-sky-700">分析范围</dt>
          <dd className="mt-0.5 font-medium">EduForge AI 反馈</dd>
        </div>
        <div>
          <dt className="text-xs text-sky-700">样本单位</dt>
          <dd className="mt-0.5 font-medium">学生 × 课堂任务</dd>
        </div>
        <div>
          <dt className="text-xs text-sky-700">质量代理</dt>
          <dd className="mt-0.5 font-medium">ERROR + 0.5 × WARN</dd>
        </div>
        <div>
          <dt className="text-xs text-sky-700">方法学版本</dt>
          <dd className="mt-0.5 font-medium">
            {getAiLearningAnalyticsMethodologyVersionLabel(
              methodology.version,
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3 space-y-1.5 text-sky-900">
        <p>{methodology.disclaimer}</p>
        <p>
          本页面不覆盖学生使用的其他 AI 工具，不代表正式课程成绩，也不据此判断学生已阅读、理解或采纳反馈。
        </p>
        <p>
          不同课堂任务的难度可能不同；本页面只在同一任务内比较反馈前后问题负荷，不做任务难度校正，也不连接不同任务推断连续成长。
        </p>
      </div>
    </section>
  );
}

export function AiLearningAnalyticsMetricGuide({
  variant,
}: AiLearningAnalyticsMetricGuideProps) {
  const trendLocation =
    variant === "class" ? "学生列表中的" : "学生摘要中的";

  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-zinc-900">
        指标与图表说明
      </summary>
      <div className="mt-4 space-y-5 leading-6 text-zinc-700">
        <section>
          <h3 className="font-medium text-zinc-900">分析样本与起点</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              系统按“学生 ×
              课堂任务”形成分析样本；同一名学生在同一个课堂任务中最多计为一个成效样本，多次请求 AI
              不会重复增加班级样本权重。
            </li>
            <li>
              系统以该学生在该课堂任务中首次成功获得 EduForge AI
              反馈的提交作为分析起点。
            </li>
            <li>
              分析只覆盖 EduForge 内置 AI
              反馈，不覆盖学生使用的其他 AI 工具。
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">反馈后的提交与版本比较</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              “反馈后重提”指 AI
              反馈成功生成后，学生又提交了一个新的版本；反馈生成之前已经发生的下一次提交不计入反馈后重提。
            </li>
            <li>
              “首次反馈后代码变化”只比较分析起点提交与反馈完成后的第一次后续提交，不会检查反馈后的所有版本。
            </li>
            <li>
              比较代码时只统一换行符，并去除代码整体首尾空白；缩进、注释或正文发生变化，仍视为代码变化。
            </li>
            <li>
              代码变化只能说明代码文本发生变化，不能证明学生已经采纳或理解 AI
              建议。
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">质量可比样本</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              只有分析起点和反馈后的后续版本都成功完成 AI
              分析，才能比较前后问题负荷。
            </li>
            <li>
              学生收到反馈后进行了重提，但没有再次成功完成 AI
              分析时，会计入反馈后重提，但不会进入质量可比样本，也不进入改善率分母。
            </li>
            <li>
              用于代码变化判断的是反馈完成后的第一次后续提交；用于质量比较的是反馈后第一次成功完成 AI
              分析的提交，两者可能不是同一个版本。
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">问题负荷与差值</h3>
          <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 font-medium text-zinc-900">
            问题负荷 = ERROR 数量 × 1 + WARN 数量 × 0.5
          </p>
          <p className="mt-2">
            INFO
            不计入问题负荷。问题负荷只是代码问题数量的代理指标，不是课程成绩或学生能力分数，不同任务难度也没有进行校正。
          </p>
          <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 font-medium text-zinc-900">
            问题负荷差值 = AI 反馈前问题负荷 − AI 反馈后问题负荷
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>正数表示问题减少，即改善。</li>
            <li>
              前后均为 0 时，精细结果为“前后均无 ERROR/WARN”；这只表示两次成功
              AI 分析均未检测到 ERROR/WARN，INFO 不计入问题负荷，不代表代码绝对正确。
            </li>
            <li>
              前后相同且大于 0 时，精细结果为“问题负荷未减少”，表示代理问题数量没有下降。
            </li>
            <li>负数表示问题增加，即恶化。</li>
            <li>
              显示“—”或图中“暂无可比样本”表示没有可比较样本，不等于真实的 0。
            </li>
          </ul>
          <p className="mt-2">
            V1.1 已正式将旧版 STABLE
            拆分为“前后均无 ERROR/WARN”和“问题负荷未减少”，页面主结果不再把两者合并展示。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">三个比例指标的分母</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium text-zinc-900">反馈后重提率：</span>
              成功交付 AI 反馈的样本中，反馈完成后再次提交的比例。
            </li>
            <li>
              <span className="font-medium text-zinc-900">质量可比率：</span>
              成功交付 AI
              反馈的样本中，后续又成功完成 AI 分析、可以进行前后比较的比例。
            </li>
            <li>
              <span className="font-medium text-zinc-900">
                可比样本改善率：
              </span>
              质量可比样本中，问题负荷下降的比例。
            </li>
          </ol>
          <p className="mt-2">
            三个比例需按各自分母理解：前两项以成功交付 AI
            反馈的样本为分母，可比样本改善率以质量可比样本为分母；它的分母不是全部学生，也不是全部提交。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">总体结果</h3>
          <p className="mt-2">
            {trendLocation}
            总体结果依据当前统计范围内全部质量可比任务的“反馈前问题负荷 −
            反馈后问题负荷”差值净和判断：净和大于 0 为“总体改善”，等于 0
            为“净变化为零”，小于 0 为“总体恶化”；没有质量可比任务时显示“可比数据不足”。
          </p>
          <p className="mt-2">
            “净变化为零”既可能表示所有可比任务均无净变化，也可能由若干改善与若干恶化相互抵消；它不表示每个任务都持平。总体结果不是时间序列趋势，也不是能力判断。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">反馈参与阶段</h3>
          <p className="mt-2">
            反馈参与阶段表示学生在当前统计范围内到达的最深反馈参与阶段，各状态互斥。它只描述提交、请求、交付、再次提交和形成质量可比结果的流程位置，不表示学习态度、AI
            依赖程度、能力或风险等级。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">统计窗口的真实边界</h3>
          <p className="mt-2">
            “近 7 天发布的任务”和“近 30
            天发布的任务”按课堂任务发布时间筛选，不按学生提交时间、AI
            请求时间或反馈生成时间筛选。课堂任务一旦纳入，该任务下的完整提交链都会参与分析，避免截断 AI
            反馈前后的配对关系；“全部任务”不设置发布时间下界。
          </p>
        </section>
      </div>
    </details>
  );
}
