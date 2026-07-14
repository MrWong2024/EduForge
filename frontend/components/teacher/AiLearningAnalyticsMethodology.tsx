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
            V1.1
            将原先统一显示的“持平”进一步拆分为“前后均无 ERROR/WARN”和“问题负荷未减少”，避免把教学含义不同的两种情况合并展示。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">图表阅读方式</h3>
          <div className="mt-2 space-y-3">
            <div>
              <h4 className="font-medium text-zinc-900">
                各任务 AI 反馈前后问题对比
              </h4>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  每一行代表一个课堂任务；空心圆表示 AI
                  反馈前的平均问题负荷，实心菱形表示 AI
                  反馈后的平均问题负荷。
                </li>
                <li>
                  横轴数值越低，表示 AI 分析检测到的 ERROR/WARN
                  问题负荷越低。同一任务内，反馈后标记位于反馈前标记左侧表示问题负荷下降，位于右侧表示问题负荷上升。
                </li>
                <li>
                  不同任务的难度和内容不同，不能根据任务之间的横向位置推断连续成长趋势。
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-zinc-900">
                各任务可比样本结果分布
              </h4>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  每一条横向分布条对应一个课堂任务，分母是该任务的质量可比样本数。
                </li>
                <li>
                  分布条依次区分“改善”“前后均无 ERROR/WARN”“问题负荷未减少”和“恶化”，四类人数之和应等于该任务质量可比样本数。
                </li>
                <li>
                  显示“暂无可比样本”表示没有可进行前后质量比较的数据，不代表结果为
                  0；百分比可能因显示时四舍五入产生轻微尾差。
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-zinc-900">学生个人图表</h4>
              <p className="mt-1">
                学生详情页的图表同样按课堂任务逐行比较反馈前后问题负荷，不同任务之间不连接；它不是成绩曲线或能力成长曲线。
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">
            反馈过程指标与结果占比的分母
          </h3>
          <h4 className="mt-2 font-medium text-zinc-900">反馈过程指标</h4>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium text-zinc-900">反馈后重提率：</span>
              成功交付 AI
              反馈的样本中，反馈完成后再次提交的比例；分母为成功交付 AI
              反馈的样本数。
            </li>
            <li>
              <span className="font-medium text-zinc-900">
                首次反馈后重提代码变化率：
              </span>
              已经发生反馈后重提的样本中，第一次后续提交与分析起点提交的代码文本发生变化的比例；分母为反馈后重提样本数。这里只比较第一次后续提交，代码文本变化不等于学生已理解或采纳
              AI 建议。
            </li>
            <li>
              <span className="font-medium text-zinc-900">质量可比率：</span>
              成功交付 AI
              反馈的样本中，后续又成功完成 AI
              分析、能够比较前后问题负荷的比例；分母为成功交付 AI
              反馈的样本数。
            </li>
          </ol>
          <h4 className="mt-3 font-medium text-zinc-900">
            质量可比结果占比
          </h4>
          <p className="mt-2">
            “可比样本改善率”“前后均无 ERROR/WARN 比率”“问题负荷未减少比率”和“恶化率”的分母均为质量可比样本数。四类结果互斥，四类人数之和等于质量可比样本数。
          </p>
          <p className="mt-2">
            这些比率的分母不是全部学生、全部课堂任务、全部提交或全部成功交付
            AI 反馈的样本；百分比展示可能因四舍五入存在轻微尾差。
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
            总体结果不是根据“改善任务是否占多数”进行投票。少数任务中的较大恶化可能抵消多个任务中的较小改善，少数任务中的较大改善也可能抵消多个任务中的较小恶化。
          </p>
          <p className="mt-2">
            “净变化为零”既可能表示每个可比任务都没有净变化，也可能由改善与恶化相互抵消；它不表示每个任务都处于同一种结果。
          </p>
          <p className="mt-2">
            只有一个质量可比任务时，总体结果实际上只反映该单次任务，不能据此判断学生形成了成长趋势。总体结果不是时间序列回归、成绩变化，也不是能力成长或退步判断。
          </p>
        </section>

        <section>
          <h3 className="font-medium text-zinc-900">反馈参与阶段</h3>
          <p className="mt-2">
            六种反馈参与阶段互斥，系统按学生在当前统计范围内到达的最深阶段返回一个状态：
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>未提交任务</li>
            <li>已提交，未请求 AI 反馈</li>
            <li>已请求 AI 反馈，暂无成功交付</li>
            <li>已获 AI 反馈，未再次提交</li>
            <li>已再次提交，暂无质量可比结果</li>
            <li>已形成质量可比结果</li>
          </ol>
          <p className="mt-2">
            “已形成质量可比结果”表示学生至少有一个任务形成质量可比样本，不表示该学生的所有任务都形成了质量可比结果。同理，其他阶段也是学生在当前统计范围内的总体参与阶段，不是逐任务状态列表。
          </p>
          <p className="mt-2">
            该字段只描述提交、请求、交付、再次提交和形成质量可比结果的流程位置，不表示学习态度、AI
            依赖程度、学习能力、风险等级或是否采纳 AI 建议。
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
