import Link from "next/link";
import type {
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsOverallOutcome,
  AiLearningAnalyticsWindow,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_OPTIONS,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_OPTIONS,
  toAiLearningAnalyticsExcludedTaskIdsQueryValue,
} from "@/lib/ai-learning-analytics";
import { paths } from "@/lib/routes/paths";
import { buildQueryString } from "@/lib/ui/format";

type AiLearningAnalyticsStudentFiltersProps = {
  classroomId: string;
  window: AiLearningAnalyticsWindow;
  excludedTaskIds: string[];
  q: string | undefined;
  overallOutcome: AiLearningAnalyticsOverallOutcome | undefined;
  engagementStatus: AiLearningAnalyticsEngagementStatus | undefined;
};

export function AiLearningAnalyticsStudentFilters({
  classroomId,
  window,
  excludedTaskIds,
  q,
  overallOutcome,
  engagementStatus,
}: AiLearningAnalyticsStudentFiltersProps) {
  const pathname = paths.teacher.classroomAiLearningAnalytics(classroomId);
  const excludedTaskIdsValue =
    toAiLearningAnalyticsExcludedTaskIdsQueryValue(excludedTaskIds);
  const clearQuery = buildQueryString({
    window,
    excludedTaskIds: excludedTaskIdsValue,
    page: 1,
  });
  const clearHref = clearQuery ? `${pathname}?${clearQuery}` : pathname;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-zinc-500">
        以下搜索与筛选只影响学生列表，不改变上方班级摘要、教学关注、图表和课堂任务分析。
      </p>
      <form
        action={pathname}
        method="get"
        className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_minmax(240px,1fr)_auto]"
      >
        <input type="hidden" name="window" value={window} />
        {excludedTaskIdsValue ? (
          <input
            type="hidden"
            name="excludedTaskIds"
            value={excludedTaskIdsValue}
          />
        ) : null}
        <label className="text-xs text-zinc-600">
          姓名或学号
          <input
            type="search"
            name="q"
            placeholder="姓名或学号"
            maxLength={100}
            defaultValue={q ?? ""}
            className="mt-1 block h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-blue-500"
          />
        </label>
        <label className="text-xs text-zinc-600">
          总体结果
          <select
            name="overallOutcome"
            defaultValue={overallOutcome ?? ""}
            className="mt-1 block h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-blue-500"
          >
            <option value="">全部总体结果</option>
            {AI_LEARNING_ANALYTICS_OVERALL_OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-600">
          反馈参与阶段
          <select
            name="engagementStatus"
            defaultValue={engagementStatus ?? ""}
            className="mt-1 block h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-blue-500"
          >
            <option value="">全部反馈阶段</option>
            {AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            应用筛选
          </button>
          <Link
            href={clearHref}
            className="inline-flex h-9 items-center text-sm text-blue-700 hover:underline"
          >
            清空筛选
          </Link>
        </div>
      </form>
      <p className="text-xs leading-5 text-zinc-500">
        学生搜索与筛选只影响下方学生列表；班级摘要、教学关注、任务图表和任务表仍按当前任务范围统计。
      </p>
    </div>
  );
}
