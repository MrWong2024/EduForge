import type { AiLearningAnalyticsMethodology } from "@/lib/api/types-teacher";
import { getAiLearningAnalyticsMethodologyVersionLabel } from "@/lib/ai-learning-analytics";

export function AiLearningAnalyticsMethodologyPanel({
  methodology,
}: {
  methodology: AiLearningAnalyticsMethodology;
}) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <h2 className="font-semibold">方法学说明与适用边界</h2>
      <dl className="mt-3 grid gap-2 sm:grid-cols-4">
        <div>
          <dt>分析范围</dt>
          <dd>EduForge AI 反馈</dd>
        </div>
        <div>
          <dt>样本单位</dt>
          <dd>学生 × 课堂任务</dd>
        </div>
        <div>
          <dt>反馈条目负荷</dt>
          <dd>错误 + 0.5 × 警告；提示 = 0</dd>
        </div>
        <div>
          <dt>方法学版本</dt>
          <dd>
            {getAiLearningAnalyticsMethodologyVersionLabel(methodology.version)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 space-y-1.5">
        <p>{methodology.disclaimer}</p>
        <p>
          不覆盖其他 AI
          工具，不代表课程成绩、代码正确率或能力分数；不能据此证明学生阅读、理解或采纳反馈，也不作因果归因。
        </p>
        <p>
          不同任务难度未校正，只在同一任务内对照，不连接不同任务推断连续成长。
        </p>
      </div>
    </section>
  );
}

export function AiLearningAnalyticsMetricGuide({
  variant,
}: {
  variant: "class" | "student";
}) {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-zinc-900">
        指标与图表说明
      </summary>
      <div className="mt-4 space-y-5 leading-6 text-zinc-700">
        <section>
          <h3 className="font-medium text-zinc-900">样本、时间与比较端点</h3>
          <p className="mt-2">
            每个学生 ×
            课堂任务最多一个样本，多次请求不会重复加权。按课堂任务发布时间选择窗口，保留入选任务完整提交链。有效任务包括
            开放中和已关闭的任务，排除已撤回的任务；仅覆盖当前在班学生。
          </p>
          <p className="mt-2">
            V1.2
            以完成时间最早且可确认的可用反馈为基线，比较内容形成时间晚于基线反馈完成时间、并获得可用反馈的最近作品版本。旧版“首个后续版本”口径已被取代；旧稿晚完成评阅不会覆盖更新作品。基线作品已冻结，不虚构同一提交的历史版本。
          </p>
          <p className="mt-2">
            内容形成时间使用可靠的最近编辑时间，未编辑的初始版本使用提交时间。编辑或完成时间缺证时不猜测；“尚无可确认的后续更新”不等于断言未修改。比较端点和最新版本可在学生任务点核对，较新版本可能尚未纳入比较。
          </p>
        </section>
        <section>
          <h3 className="font-medium text-zinc-900">请求与可用反馈交付</h3>
          <p className="mt-2">
            存在反馈处理任务即计入请求，可以由教师或学生发起。可用反馈交付要求处理成功且有实际
            AI 反馈条目，已知模拟评阅排除。空成功反馈、排队、失败和终止都不作为比较端点；有提示
            条目而无错误/警告的可用反馈，负荷才为真实 0。
          </p>
          <p className="mt-2">
            历史来源不明的反馈保留为已有记录对照，不推定为真实模型。模型只取对应实际请求记录；模型不同会提示，同名模型也不证明
            评阅提示或内部版本一致。来源与模型提示项可以重叠，不能相加作为分母。
          </p>
        </section>
        <section>
          <h3 className="font-medium text-zinc-900">计数、比率与分母</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {variant === "class" ? (
              <>
                <li>
                  请求学生覆盖率：至少有请求任务的当前在班学生 / 当前在班
                  学生。请求任务覆盖率：存在请求的学生任务样本 /
                  已提交学生任务样本。
                </li>
                <li>
                  可用反馈交付率：可用反馈交付样本 /
                  请求样本。可对照率：可对照样本 /
                  可用反馈交付样本；结果只代表可对照子集，不代表全部学生或全部提交。
                </li>
              </>
            ) : (
              <li>
                已提交、请求、可用反馈交付和可对照任务数均在当前有效任务范围内按任务计一次，不按提交数累计。请求不一定由学生本人发起。
              </li>
            )}
            <li>
              反馈后新增提交：基线反馈完成后新创建其他
              提交；不含已有提交的修改。新增提交率分母为可用反馈交付样本。
            </li>
            <li>
              反馈后作品更新：可确认在反馈完成后形成的现存其他作品版本，包括新增提交或修改已有提交；修改不增加提交次数。作品更新率分母为可用反馈交付样本。
            </li>
            <li>
              现存后续版本代码变化率：存在至少一份代码不同于基线的现存后续作品 /
              作品更新样本。仅统一
              换行符形式，保留首尾空白。说明或语言变化可构成更新，不冒充代码文本变化。没有完整编辑历史，不能识别全部“改后又改回”过程，也不能据此推断采纳或理解。
            </li>
            <li>
              负荷下降、前后均无
              错误/警告、非零负荷持平、负荷上升四类互斥，计数之和等于可对照样本数；各结果比率分母均为可对照样本。不具备端点的任务不可对照，不归入四类。
            </li>
            <li>
              各比率分母为 0 时为未知“—”；分子为 0 且分母大于 0 时显示真实
              0。无可对照样本时平均负荷及平均差值为“—”，不补 0。
            </li>
          </ul>
        </section>
        <section>
          <h3 className="font-medium text-zinc-900">负荷与总体结果</h3>
          <p className="mt-2">
            反馈条目负荷使用错误 = 1、警告 = 0.5、提示 =
            0。反馈可能评价源码、说明、协作和实践证据，条目数量还受合并、限条、模型差异影响；它不是缺陷数量或质量认证。“前后均无
            错误/警告”不等于代码正确。
          </p>
          <p className="mt-2">
            {variant === "class" ? "学生列表" : "学生摘要"}
            总体结果使用可对照任务的“基线负荷 −
            比较版本负荷”净和，分别为负荷净下降、净变化为零、负荷净上升；任务间可相互抵消，不按下降任务多数投票。无可对照任务为数据不足；单任务或小样本不能证明教学效果、能力成长或退步。
          </p>
          <p className="mt-2">
            图表逐任务展示。班级图为平均反馈条目负荷，个人图为反馈条目负荷；均不连接不同任务。数值只在展示时控制精度，小非零不会伪装成精确
            0。
          </p>
        </section>
        <section>
          <h3 className="font-medium text-zinc-900">参与阶段</h3>
          <p className="mt-2">
            按当前范围达到的最深阶段返回一个互斥状态：未提交；已提交未请求；已请求暂无可用交付；已获可用反馈尚无可确认后续更新；已有作品更新暂无可对照；已形成可对照结果。阶段依据作品更新，不只依据新增提交，也不代表每个任务均达到该阶段。
          </p>
          <p className="mt-2">
            阶段只描述流程位置，不表示学习态度、AI
            依赖、风险或能力；本轮统计均为只读计算。
          </p>
        </section>
      </div>
    </details>
  );
}
