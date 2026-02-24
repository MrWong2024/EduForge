/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { CommonIssuesReport, Task } from "@/lib/demo-types";

const tagDisplay: Record<string, string> = {
  polymorphism: "多态设计",
  readability: "可读性",
  duplication: "重复逻辑",
  "edge-cases": "边界条件",
  correctness: "正确性",
  robustness: "健壮性",
  testability: "可测试性",
};

const buildConclusion = (report: CommonIssuesReport) => {
  const topTags = report.topTags.slice(0, 3).map((tag) => tagDisplay[tag.tag] ?? tag.tag);
  if (topTags.length === 0) {
    return "当前暂无共性问题数据，建议先完成作业提交与反馈处理。";
  }
  return `本次任务主要共性问题集中在：${topTags.join("、")}。建议课堂重点讲解条件分发消除与异常处理。`;
};

export default function ReportsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [report, setReport] = useState<CommonIssuesReport | null>(null);
  const [loading, setLoading] = useState(false);

  const publishedTasks = useMemo(
    () => tasks.filter((task) => task.status === "PUBLISHED"),
    [tasks]
  );

  const loadTasks = async () => {
    const res = await fetch("/api/demo/tasks");
    const data = await res.json();
    setTasks(data.tasks ?? []);
  };

  const loadReport = async (currentTaskId: string) => {
    setLoading(true);
    const params = new URLSearchParams({ taskId: currentTaskId });
    const res = await fetch(`/api/demo/reports/common-issues?${params.toString()}`);
    const data = await res.json();
    setReport(data.report ?? null);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, []);

  useEffect(() => {
    if (publishedTasks.length > 0 && !taskId) {
      setTaskId(publishedTasks[0].id);
    }
  }, [publishedTasks, taskId]);

  useEffect(() => {
    if (taskId) {
      void loadReport(taskId);
    } else {
      setReport(null);
    }
  }, [taskId]);

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-semibold text-slate-400">教学管理 / 课堂报表</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">课堂报表</h1>
        <p className="mt-2 text-sm text-slate-600">
          汇总共性问题与样例，辅助课堂讲解与后续优化。
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px]">
            <label className="text-xs font-semibold text-slate-500">选择任务</label>
            <select
              value={taskId ?? ""}
              onChange={(event) => setTaskId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {publishedTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={loadTasks}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            刷新任务
          </button>
          {taskId && (
            <button
              onClick={() => loadReport(taskId)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              刷新报表
            </button>
          )}
        </div>
        {publishedTasks.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            当前暂无已发布任务，请先发布任务后查看报表。
          </div>
        )}
      </section>

      {report && (
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">概览</div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span>提交数</span>
                <span className="font-semibold">{report.summary.submissionsCount}</span>
              </div>
              <div className="flex justify-between">
                <span>学生数</span>
                <span className="font-semibold">{report.summary.distinctStudentsCount}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">课堂结论</div>
            <p className="mt-4 text-sm text-slate-600">{buildConclusion(report)}</p>
          </div>

          <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">共性问题标签</div>
            <div className="mt-4 space-y-3">
              {report.topTags.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                  暂无共性问题数据，请先处理队列。
                </div>
              )}
              {report.topTags.map((tag) => (
                <div key={tag.tag} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">
                      {tagDisplay[tag.tag] ?? tag.tag}
                    </div>
                    <div className="text-xs text-slate-500">出现 {tag.count} 次</div>
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-slate-500">
                    <span>INFO {tag.severityBreakdown.INFO}</span>
                    <span>WARN {tag.severityBreakdown.WARN}</span>
                    <span>ERROR {tag.severityBreakdown.ERROR}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">样例</div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {report.examples.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                  暂无样例，请先处理队列。
                </div>
              )}
              {report.examples.map((example) => (
                <div key={example.tag} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-800">
                    {tagDisplay[example.tag] ?? example.tag}
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-slate-600">
                    {example.samples.map((sample, index) => (
                      <div key={`${sample.submissionId}-${index}`}>
                        <div className="font-semibold">{sample.studentId}</div>
                        <div className="text-slate-500">{sample.severity}</div>
                        <div className="mt-1 rounded bg-white p-2 font-mono text-[11px] text-slate-600">
                          {sample.excerpt || "(空代码)"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          正在生成报表...
        </div>
      )}
    </div>
  );
}
