import type {
  AiLearningAnalyticsOverviewResponse,
  AiLearningAnalyticsTaskTrend,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
  getAiLearningAnalyticsDeltaMeaning,
  selectAiLearningAnalyticsTeachingAttention,
} from "@/lib/ai-learning-analytics";

const formatRateWithDenominator = (
  rate: number,
  denominator: number,
): string =>
  denominator > 0 ? formatAiLearningAnalyticsPercent(rate) : "—";

function DeterministicClassSummary({
  overview,
}: {
  overview: AiLearningAnalyticsOverviewResponse;
}) {
  const { summary } = overview;
  const hasComparableSamples = summary.qualityComparableStudentTaskCount > 0;

  return (
    <p className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-7 text-blue-950">
      当前范围内，共有{" "}
      <span className="font-semibold tabular-nums">
        {summary.activeStudentsCount}
      </span>{" "}
      名 ACTIVE 学生；{" "}
      {summary.aiDeliveredStudentTaskCount > 0 ? (
        <>
          <span className="font-semibold tabular-nums">
            {summary.aiDeliveredStudentTaskCount}
          </span>{" "}
          个学生任务样本成功获得 AI 反馈。
          {summary.postFeedbackResubmittedStudentTaskCount > 0 ? (
            <>
              其中{" "}
              <span className="font-semibold tabular-nums">
                {summary.postFeedbackResubmittedStudentTaskCount}
              </span>{" "}
              个在反馈后再次提交。{" "}
            </>
          ) : (
            <>当前没有样本在反馈后再次提交。 </>
          )}
        </>
      ) : (
        <>当前没有学生任务样本成功获得 AI 反馈，也没有反馈后重提样本。 </>
      )}
      {hasComparableSamples ? (
        <>
          <span className="font-semibold tabular-nums">
            {summary.qualityComparableStudentTaskCount}
          </span>{" "}
          个样本形成前后可比，其中{" "}
          <span className="font-semibold tabular-nums">
            {summary.improvedStudentTaskCount}
          </span>{" "}
          个{AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.IMPROVED}、{" "}
          <span className="font-semibold tabular-nums">
            {summary.remainedCleanStudentTaskCount}
          </span>{" "}
          个
          {AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.REMAINED_CLEAN}、{" "}
          <span className="font-semibold tabular-nums">
            {summary.unchangedWithIssuesStudentTaskCount}
          </span>{" "}
          个
          {
            AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.UNCHANGED_WITH_ISSUES
          }
          、{" "}
          <span className="font-semibold tabular-nums">
            {summary.regressedStudentTaskCount}
          </span>{" "}
          个{AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.REGRESSED}
          ，平均问题负荷由{" "}
          <span className="font-semibold tabular-nums">
            {formatAiLearningAnalyticsIssueLoad(
              summary.averageIssueLoadBefore,
            )}
          </span>{" "}
          变为{" "}
          <span className="font-semibold tabular-nums">
            {formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadAfter)}
          </span>
          。
        </>
      ) : (
        <>当前没有形成质量可比样本，平均问题负荷前后值与差值显示为“—”。</>
      )}
    </p>
  );
}

export function AiLearningAnalyticsSummary({
  overview,
}: {
  overview: AiLearningAnalyticsOverviewResponse;
}) {
  const { summary } = overview;
  const hasComparableSamples = summary.qualityComparableStudentTaskCount > 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">班级分析摘要</h2>
      <p className="mt-1 text-xs text-zinc-500">
        以下汇总直接使用总览接口字段，不由当前学生分页结果重新计算。
      </p>

      <div className="mt-3">
        <DeterministicClassSummary overview={overview} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          <h3 className="text-sm font-semibold text-blue-950">AI 反馈覆盖</h3>
          <p className="mt-3 text-xs text-blue-800">AI 反馈学生覆盖率</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-blue-950">
            {formatRateWithDenominator(
              summary.aiStudentCoverageRate,
              summary.activeStudentsCount,
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            至少一个已提交任务存在 EduForge AI 反馈请求的 ACTIVE 学生占比
          </p>
          <dl className="mt-4 space-y-2 border-t border-blue-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-blue-800">ACTIVE 学生数</dt>
              <dd className="font-medium tabular-nums text-blue-950">
                {summary.activeStudentsCount}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-blue-800">AI 反馈任务覆盖率</dt>
              <dd className="text-right font-medium tabular-nums text-blue-950">
                {formatRateWithDenominator(
                  summary.aiTaskCoverageRate,
                  summary.submittedStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-blue-800">
                  请求 {summary.aiRequestedStudentTaskCount} / 提交{" "}
                  {summary.submittedStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-blue-800">AI 反馈交付率</dt>
              <dd className="text-right font-medium tabular-nums text-blue-950">
                {formatRateWithDenominator(
                  summary.aiDeliveryRate,
                  summary.aiRequestedStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-blue-800">
                  交付 {summary.aiDeliveredStudentTaskCount} / 请求{" "}
                  {summary.aiRequestedStudentTaskCount}
                </span>
              </dd>
            </div>
          </dl>
        </article>

        <article className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
          <h3 className="text-sm font-semibold text-violet-950">反馈后响应</h3>
          <p className="mt-3 text-xs text-violet-800">反馈后重提率</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-violet-950">
            {formatRateWithDenominator(
              summary.postFeedbackResubmissionRate,
              summary.aiDeliveredStudentTaskCount,
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-violet-800">
            重提 {summary.postFeedbackResubmittedStudentTaskCount} / AI
            反馈交付 {summary.aiDeliveredStudentTaskCount}
          </p>
          <dl className="mt-4 border-t border-violet-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-violet-800">
                首次反馈后重提代码变化率
              </dt>
              <dd className="text-right font-medium tabular-nums text-violet-950">
                {formatRateWithDenominator(
                  summary.postFeedbackCodeChangeRate,
                  summary.postFeedbackResubmittedStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-violet-800">
                  代码变化 {summary.postFeedbackCodeChangedStudentTaskCount} /
                  重提 {summary.postFeedbackResubmittedStudentTaskCount}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-violet-800">
            仅比较反馈完成后的第一次后续提交。代码发生变化不等于学生采纳了
            AI 建议。
          </p>
        </article>

        <article className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
          <h3 className="text-sm font-semibold text-emerald-950">可比结果</h3>
          <p className="mt-3 text-xs text-emerald-800">质量可比样本数</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-emerald-950">
            {summary.qualityComparableStudentTaskCount}
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            改善 {summary.improvedStudentTaskCount} · 前后均无 ERROR/WARN{" "}
            {summary.remainedCleanStudentTaskCount} · 问题负荷未减少{" "}
            {summary.unchangedWithIssuesStudentTaskCount} · 恶化{" "}
            {summary.regressedStudentTaskCount}
          </p>
          <dl className="mt-4 space-y-2 border-t border-emerald-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">可比样本改善率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.improvedRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  改善 {summary.improvedStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">
                前后均无 ERROR/WARN 比率
              </dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.remainedCleanRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  均无 ERROR/WARN {summary.remainedCleanStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">问题负荷未减少比率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.unchangedWithIssuesRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  未减少 {summary.unchangedWithIssuesStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">恶化率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.regressedRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  恶化 {summary.regressedStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">平均问题负荷</dt>
              <dd className="font-medium tabular-nums text-emerald-950">
                {hasComparableSamples ? (
                  <>
                    {formatAiLearningAnalyticsIssueLoad(
                      summary.averageIssueLoadBefore,
                    )}{" "}
                    →{" "}
                    {formatAiLearningAnalyticsIssueLoad(
                      summary.averageIssueLoadAfter,
                    )}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">平均差值</dt>
              <dd className="font-medium tabular-nums text-emerald-950">
                {hasComparableSamples ? (
                  <>
                    {formatAiLearningAnalyticsDelta(
                      summary.averageIssueLoadDelta,
                    )}
                    （
                    {getAiLearningAnalyticsDeltaMeaning(
                      summary.averageIssueLoadDelta,
                    )}
                    ）
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-emerald-800">
            V1.1 已将旧版“持平”拆分为“前后均无 ERROR/WARN”和“问题负荷未减少”。前者只说明两次 AI 分析均未检测到 ERROR/WARN。
          </p>
        </article>
      </div>
    </section>
  );
}

function AttentionItem({
  label,
  task,
  metric,
  counts,
  description,
}: {
  label: string;
  task: AiLearningAnalyticsTaskTrend;
  metric: string;
  counts: string;
  description: string;
}) {
  return (
    <article className="rounded-md border border-amber-200 bg-white p-3">
      <p className="text-xs font-medium text-amber-800">{label}</p>
      <h3
        className="mt-1 break-words text-sm font-semibold leading-5 text-zinc-900"
        title={task.taskTitle}
      >
        {task.taskTitle}
      </h3>
      <p className="mt-2 font-medium tabular-nums text-zinc-900">
        {metric}
        <span className="ml-2 text-xs font-normal text-zinc-500">
          {counts}
        </span>
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-600">{description}</p>
    </article>
  );
}

export function AiLearningAnalyticsTeachingAttention({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  const attention = selectAiLearningAnalyticsTeachingAttention(taskTrends);
  const hasAttention =
    attention.lowestResubmissionTask !== null ||
    attention.mostRegressedTask !== null ||
    attention.highestImprovedRateTask !== null;

  if (!hasAttention) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-950">教学关注</h2>
      <p className="mt-1 text-xs text-amber-800">
        从后端返回的课堂任务统计中定位当前极值，便于继续核查具体任务。
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {attention.lowestResubmissionTask ? (
          <AttentionItem
            label="反馈后重提率最低"
            task={attention.lowestResubmissionTask}
            metric={formatAiLearningAnalyticsPercent(
              attention.lowestResubmissionTask
                .postFeedbackResubmissionRate,
            )}
            counts={
              "重提 " +
              attention.lowestResubmissionTask
                .postFeedbackResubmittedStudentCount +
              " / 交付 " +
              attention.lowestResubmissionTask.aiDeliveredStudentCount
            }
            description="该任务反馈后重提率相对较低，可结合任务难度、反馈内容和课堂安排进一步核查。"
          />
        ) : null}
        {attention.mostRegressedTask ? (
          <AttentionItem
            label="恶化样本数量最多"
            task={attention.mostRegressedTask}
            metric={
              attention.mostRegressedTask.regressedStudentCount + " 个恶化样本"
            }
            counts={
              "质量可比 " +
              attention.mostRegressedTask.qualityComparableStudentCount
            }
            description="该任务出现的恶化样本相对较多，建议抽查具体学生提交和反馈内容。"
          />
        ) : null}
        {attention.highestImprovedRateTask ? (
          <AttentionItem
            label="可比样本改善率最高"
            task={attention.highestImprovedRateTask}
            metric={formatAiLearningAnalyticsPercent(
              attention.highestImprovedRateTask.improvedRate,
            )}
            counts={
              "改善 " +
              attention.highestImprovedRateTask.improvedStudentCount +
              " / 可比 " +
              attention.highestImprovedRateTask.qualityComparableStudentCount
            }
            description="该任务的可比样本改善率相对较高，可作为反馈设计复核样本。"
          />
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-amber-900">
        以上提示仅按当前统计范围内的任务极值生成，供教师定位和核查，不构成自动教学诊断。
      </p>
    </section>
  );
}
