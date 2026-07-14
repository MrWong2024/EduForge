import Link from "next/link";
import { EmptyState } from "@/components/blocks/EmptyState";
import type {
  AiLearningAnalyticsStudentItem,
  AiLearningAnalyticsTaskTrend,
  AiLearningAnalyticsWindow,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
  getAiLearningAnalyticsDeltaMeaning,
  toAiLearningAnalyticsExcludedTaskIdsQueryValue,
} from "@/lib/ai-learning-analytics";
import { paths } from "@/lib/routes/paths";
import { buildQueryString, toDisplayDate } from "@/lib/ui/format";

const formatRateWithDenominator = (
  rate: number,
  denominator: number,
): string =>
  denominator > 0 ? formatAiLearningAnalyticsPercent(rate) : "—";

const formatComparableDelta = (
  value: number,
  comparableCount: number,
): string =>
  comparableCount > 0
    ? formatAiLearningAnalyticsDelta(value) +
      "（" +
      getAiLearningAnalyticsDeltaMeaning(value) +
      "）"
    : "—";

export function AiLearningAnalyticsTaskTable({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  if (taskTrends.length === 0) {
    return (
      <EmptyState
        title="当前统计范围内暂无有效课堂任务"
        description="任务排除和统计窗口共同决定当前有效任务范围。"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[220px]" />
          <col className="w-[140px]" />
          <col className="w-[190px]" />
          <col className="w-[130px]" />
          <col className="w-[170px]" />
          <col className="w-[190px]" />
        </colgroup>
        <thead className="bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2.5">
              任务
            </th>
            <th className="px-3 py-2.5">提交与 AI 反馈</th>
            <th className="px-3 py-2.5">反馈后响应</th>
            <th className="px-3 py-2.5">质量可比</th>
            <th className="px-3 py-2.5">结果分布</th>
            <th className="px-3 py-2.5">问题负荷变化</th>
          </tr>
        </thead>
        <tbody>
          {taskTrends.map((task, index) => {
            const hasComparable = task.qualityComparableStudentCount > 0;
            return (
              <tr
                key={task.classroomTaskId || "task-trend-" + index}
                className="border-t border-zinc-100 align-top"
              >
                <td className="sticky left-0 z-10 bg-white px-3 py-3">
                  <p
                    className="break-words font-medium leading-5 text-zinc-900"
                    title={task.taskTitle}
                  >
                    {task.taskTitle}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                    发布时间：{toDisplayDate(task.publishedAt)}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>提交：{task.submittedStudentCount}</p>
                  <p className="mt-1">请求：{task.aiRequestedStudentCount}</p>
                  <p className="mt-1">交付：{task.aiDeliveredStudentCount}</p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>
                    重提：{task.postFeedbackResubmittedStudentCount} ·{" "}
                    {formatRateWithDenominator(
                      task.postFeedbackResubmissionRate,
                      task.aiDeliveredStudentCount,
                    )}
                  </p>
                  <p className="mt-1">
                    代码变化：{task.postFeedbackCodeChangedStudentCount}
                  </p>
                  <p className="mt-1 leading-5">
                    首次反馈后重提代码变化率：
                    {formatRateWithDenominator(
                      task.postFeedbackCodeChangeRate,
                      task.postFeedbackResubmittedStudentCount,
                    )}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>可比：{task.qualityComparableStudentCount}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    可比率：
                    {formatRateWithDenominator(
                      task.qualityComparableRate,
                      task.aiDeliveredStudentCount,
                    )}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>改善：{task.improvedStudentCount}</p>
                  <p className="mt-1">持平：{task.stableStudentCount}</p>
                  <p className="mt-1">恶化：{task.regressedStudentCount}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    改善率：
                    {formatRateWithDenominator(
                      task.improvedRate,
                      task.qualityComparableStudentCount,
                    )}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  {hasComparable ? (
                    <>
                      <p className="font-medium text-zinc-900">
                        {formatAiLearningAnalyticsIssueLoad(
                          task.averageIssueLoadBefore,
                        )}{" "}
                        →{" "}
                        {formatAiLearningAnalyticsIssueLoad(
                          task.averageIssueLoadAfter,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        差值{" "}
                        {formatComparableDelta(
                          task.averageIssueLoadDelta,
                          task.qualityComparableStudentCount,
                        )}
                      </p>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const buildStudentDetailHref = ({
  classroomId,
  studentId,
  window,
  excludedTaskIds,
  page,
}: {
  classroomId: string;
  studentId: string;
  window: AiLearningAnalyticsWindow;
  excludedTaskIds: string[];
  page: number;
}): string => {
  const query = buildQueryString({
    window,
    excludedTaskIds:
      toAiLearningAnalyticsExcludedTaskIdsQueryValue(excludedTaskIds),
    page,
  });
  const pathname = paths.teacher.classroomAiLearningAnalyticsStudent(
    classroomId,
    studentId,
  );
  return query ? pathname + "?" + query : pathname;
};

export function AiLearningAnalyticsStudentsTable({
  students,
  classroomId,
  window,
  excludedTaskIds,
  page,
}: {
  students: AiLearningAnalyticsStudentItem[];
  classroomId: string;
  window: AiLearningAnalyticsWindow;
  excludedTaskIds: string[];
  page: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[190px]" />
          <col className="w-[95px]" />
          <col className="w-[170px]" />
          <col className="w-[130px]" />
          <col className="w-[125px]" />
          <col className="w-[130px]" />
          <col className="w-[165px]" />
          <col className="w-[75px]" />
        </colgroup>
        <thead className="bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2.5">
              学生
            </th>
            <th className="px-3 py-2.5 text-center">任务参与</th>
            <th className="px-3 py-2.5">反馈响应</th>
            <th className="px-3 py-2.5">质量可比</th>
            <th className="px-3 py-2.5">结果分布</th>
            <th className="px-3 py-2.5">平均变化</th>
            <th className="px-3 py-2.5">总体变化</th>
            <th className="px-3 py-2.5">操作</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student, index) => {
            const hasComparable = student.qualityComparableTasksCount > 0;
            return (
              <tr
                key={student.studentId || "student-" + index}
                className="border-t border-zinc-100 align-top"
              >
                <td className="sticky left-0 z-10 bg-white px-3 py-3">
                  <p
                    className="break-words font-medium leading-5 text-zinc-900"
                    title={student.studentName}
                  >
                    {student.studentName}
                  </p>
                  <p className="mt-1 break-words text-[11px] leading-4 text-zinc-500">
                    {student.studentNo
                      ? "学号：" + student.studentNo
                      : "学号未设置"}
                  </p>
                </td>
                <td className="px-3 py-3 text-center tabular-nums text-zinc-800">
                  <p className="font-medium">{student.submittedTasksCount}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">已提交任务</p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>
                    请求 / 交付：{student.aiRequestedTasksCount} /{" "}
                    {student.aiDeliveredTasksCount}
                  </p>
                  <p className="mt-1 leading-5">
                    重提 {student.postFeedbackResubmittedTasksCount} ·
                    代码变化 {student.postFeedbackCodeChangedTasksCount}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p className="font-medium">
                    {student.qualityComparableTasksCount}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {hasComparable
                      ? "基于 " +
                        student.qualityComparableTasksCount +
                        " 个可比任务"
                      : "暂无可比任务"}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  <p>改善 {student.improvedTasksCount}</p>
                  <p className="mt-1">持平 {student.stableTasksCount}</p>
                  <p className="mt-1">恶化 {student.regressedTasksCount}</p>
                </td>
                <td className="px-3 py-3 tabular-nums text-zinc-800">
                  {formatComparableDelta(
                    student.averageIssueLoadDelta,
                    student.qualityComparableTasksCount,
                  )}
                </td>
                <td className="px-3 py-3 text-zinc-800">
                  <p className="font-medium">
                    {
                      AI_LEARNING_ANALYTICS_GROWTH_TREND_LABELS[
                        student.growthTrend
                      ]
                    }
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {hasComparable
                      ? "基于 " +
                        student.qualityComparableTasksCount +
                        " 个可比任务"
                      : "暂无质量可比任务"}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {student.studentId ? (
                    <Link
                      href={buildStudentDetailHref({
                        classroomId,
                        studentId: student.studentId,
                        window,
                        excludedTaskIds,
                        page,
                      })}
                      className="text-blue-700 hover:underline"
                    >
                      查看详情
                    </Link>
                  ) : (
                    <span className="text-zinc-400">暂不可用</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
