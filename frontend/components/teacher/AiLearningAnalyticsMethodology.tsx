import type { AiLearningAnalyticsMethodology } from "@/lib/api/types-teacher";

type AiLearningAnalyticsMethodologyPanelProps = {
  methodology: AiLearningAnalyticsMethodology;
};

export function AiLearningAnalyticsMethodologyPanel({
  methodology,
}: AiLearningAnalyticsMethodologyPanelProps) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <h2 className="font-semibold">方法学说明与适用边界</h2>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
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
      </dl>
      <div className="mt-3 space-y-1.5 text-sky-900">
        <p>{methodology.disclaimer}</p>
        <p>
          本页面不覆盖学生使用的其他 AI 工具，不代表正式课程成绩，也不据此判断学生已阅读、理解或采纳反馈。
        </p>
        <p>
          不同课堂任务的难度可能不同；本页面按课堂任务顺序观察变化，不做任务难度校正。
        </p>
      </div>
    </section>
  );
}
