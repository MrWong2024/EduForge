import type {
  AiLearningAnalyticsOverviewResponse,
  AiLearningAnalyticsTaskTrend,
  AiLearningAnalyticsEvidenceSummary,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
  getAiLearningAnalyticsDeltaMeaning,
  selectAiLearningAnalyticsTeachingAttention,
  getAiLearningAnalyticsEvidenceNotes,
} from "@/lib/ai-learning-analytics";

const formatRateWithDenominator = (
  rate: number | null,
  denominator: number,
): string => (denominator > 0 ? formatAiLearningAnalyticsPercent(rate) : "—");

export function AiLearningAnalyticsEvidenceNotes({
  evidence,
}: {
  evidence: AiLearningAnalyticsEvidenceSummary;
}) {
  const notes = getAiLearningAnalyticsEvidenceNotes(evidence);
  if (notes.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      <p>提示项可重叠，不能相加作为分母；具体来源见学生任务点。</p>
    </div>
  );
}

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
      名当前在班学生；{" "}
      {summary.aiDeliveredStudentTaskCount > 0 ? (
        <>
          <span className="font-semibold tabular-nums">
            {summary.aiDeliveredStudentTaskCount}
          </span>{" "}
          个学生任务样本获得可用反馈。
          {summary.postFeedbackRevisedStudentTaskCount > 0 ? (
            <>
              其中{" "}
              <span className="font-semibold tabular-nums">
                {summary.postFeedbackRevisedStudentTaskCount}
              </span>{" "}
              个存在可确认的反馈后作品更新。{" "}
            </>
          ) : (
            <>当前尚无可确认的后续作品更新。 </>
          )}
        </>
      ) : (
        <>当前没有学生任务样本获得可用反馈。 </>
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
          个{AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.REMAINED_CLEAN}、{" "}
          <span className="font-semibold tabular-nums">
            {summary.unchangedWithIssuesStudentTaskCount}
          </span>{" "}
          个
          {AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.UNCHANGED_WITH_ISSUES}
          、{" "}
          <span className="font-semibold tabular-nums">
            {summary.regressedStudentTaskCount}
          </span>{" "}
          个{AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS.REGRESSED}
          ，平均反馈条目负荷由{" "}
          <span className="font-semibold tabular-nums">
            {formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadBefore)}
          </span>{" "}
          变为{" "}
          <span className="font-semibold tabular-nums">
            {formatAiLearningAnalyticsIssueLoad(summary.averageIssueLoadAfter)}
          </span>
          。
        </>
      ) : (
        <>当前没有形成反馈可对照样本，平均反馈条目负荷前后值与差值显示为“—”。</>
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
        以下汇总覆盖当前统计范围，不受学生列表分页影响。
      </p>

      <div className="mt-3">
        <DeterministicClassSummary overview={overview} />
        <p className="mt-2 text-xs text-zinc-600">
          可对照样本 {summary.qualityComparableStudentTaskCount} /
          可用反馈交付样本 {summary.aiDeliveredStudentTaskCount}
          ；结果仅代表可对照子集。
        </p>
        <AiLearningAnalyticsEvidenceNotes evidence={summary.evidenceSummary} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          <h3 className="text-sm font-semibold text-blue-950">AI 反馈覆盖</h3>
          <p className="mt-3 text-xs text-blue-800">AI 反馈请求学生覆盖率</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-blue-950">
            {formatRateWithDenominator(
              summary.aiStudentCoverageRate,
              summary.activeStudentsCount,
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            至少一个已提交任务存在 EduForge AI 反馈请求的当前在班
            学生占比；请求可以由教师或学生发起。
          </p>
          <dl className="mt-4 space-y-2 border-t border-blue-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-blue-800">当前在班学生数</dt>
              <dd className="font-medium tabular-nums text-blue-950">
                {summary.activeStudentsCount}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-blue-800">AI 反馈请求任务覆盖率</dt>
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
              <dt className="text-blue-800">可用反馈交付率</dt>
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
          <p className="mt-3 text-xs text-violet-800">反馈后作品更新率</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-violet-950">
            {formatRateWithDenominator(
              summary.postFeedbackRevisionRate,
              summary.aiDeliveredStudentTaskCount,
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-violet-800">
            更新 {summary.postFeedbackRevisedStudentTaskCount} / 可用反馈交付{" "}
            {summary.aiDeliveredStudentTaskCount}
          </p>
          <dl className="mt-4 border-t border-violet-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-violet-800">现存后续版本代码变化率</dt>
              <dd className="text-right font-medium tabular-nums text-violet-950">
                {formatRateWithDenominator(
                  summary.postFeedbackCodeChangeRate,
                  summary.postFeedbackRevisedStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-violet-800">
                  代码变化 {summary.postFeedbackCodeChangedStudentTaskCount} /
                  更新 {summary.postFeedbackRevisedStudentTaskCount}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-violet-800">
            新增提交样本 {summary.postFeedbackResubmittedStudentTaskCount}
            ，新增提交率{" "}
            {formatAiLearningAnalyticsPercent(
              summary.postFeedbackResubmissionRate,
            )}
            。作品更新包括新增提交与同次修改；现存后续版本代码变化不等于学生采纳了
            AI 建议。
          </p>
        </article>

        <article className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
          <h3 className="text-sm font-semibold text-emerald-950">可比结果</h3>
          <p className="mt-3 text-xs text-emerald-800">反馈可对照样本数</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-emerald-950">
            {summary.qualityComparableStudentTaskCount}
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            负荷下降 {summary.improvedStudentTaskCount} · 前后均无错误/警告{" "}
            {summary.remainedCleanStudentTaskCount} · 非零负荷持平{" "}
            {summary.unchangedWithIssuesStudentTaskCount} · 负荷上升{" "}
            {summary.regressedStudentTaskCount}
          </p>
          <dl className="mt-4 space-y-2 border-t border-emerald-200 pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">可比样本负荷下降率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.improvedRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  负荷下降 {summary.improvedStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">前后均无错误/警告比率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.remainedCleanRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  均无错误/警告 {summary.remainedCleanStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">非零负荷持平比率</dt>
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
              <dt className="text-emerald-800">负荷上升率</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-950">
                {formatRateWithDenominator(
                  summary.regressedRate,
                  summary.qualityComparableStudentTaskCount,
                )}
                <span className="ml-1 block text-[11px] font-normal text-emerald-800">
                  负荷上升 {summary.regressedStudentTaskCount} / 可比{" "}
                  {summary.qualityComparableStudentTaskCount}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-emerald-800">平均反馈条目负荷</dt>
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
            负荷是实际反馈条目的约定权重，不是缺陷数、正确率或能力分数。
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
        <span className="ml-2 text-xs font-normal text-zinc-500">{counts}</span>
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
    attention.lowestRevisionTask !== null ||
    attention.mostRegressedTask !== null ||
    attention.highestImprovedRateTask !== null;

  if (!hasAttention) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-950">教学关注</h2>
      <p className="mt-1 text-xs text-amber-800">
        根据当前课堂任务统计定位极值，便于继续核查具体任务。
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {attention.lowestRevisionTask ? (
          <AttentionItem
            label="反馈后作品更新率相对较低"
            task={attention.lowestRevisionTask}
            metric={formatAiLearningAnalyticsPercent(
              attention.lowestRevisionTask.postFeedbackRevisionRate,
            )}
            counts={
              "更新 " +
              attention.lowestRevisionTask.postFeedbackRevisedStudentCount +
              " / 交付 " +
              attention.lowestRevisionTask.aiDeliveredStudentCount
            }
            description="仅反映可确认的现存后续更新；可结合时间信息、任务安排和反馈继续核查。"
          />
        ) : null}
        {attention.mostRegressedTask ? (
          <AttentionItem
            label="负荷上升样本数量最多"
            task={attention.mostRegressedTask}
            metric={
              attention.mostRegressedTask.regressedStudentCount +
              " 个负荷上升样本"
            }
            counts={
              "反馈可对照 " +
              attention.mostRegressedTask.qualityComparableStudentCount
            }
            description="该任务出现的负荷上升样本相对较多，建议抽查具体学生提交和反馈内容。"
          />
        ) : null}
        {attention.highestImprovedRateTask ? (
          <AttentionItem
            label="可比样本负荷下降率最高"
            task={attention.highestImprovedRateTask}
            metric={formatAiLearningAnalyticsPercent(
              attention.highestImprovedRateTask.improvedRate,
            )}
            counts={
              "负荷下降 " +
              attention.highestImprovedRateTask.improvedStudentCount +
              " / 可比 " +
              attention.highestImprovedRateTask.qualityComparableStudentCount
            }
            description="该任务的可比样本负荷下降率相对较高，可作为反馈设计复核样本。"
          />
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-amber-900">
        以上提示附样本数，仅供定位和核查；小样本极值不表示确定的教学效果，不构成自动教学诊断。
      </p>
    </section>
  );
}
