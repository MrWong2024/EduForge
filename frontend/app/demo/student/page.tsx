"use client";

import { useEffect, useMemo, useState } from "react";
import type { SubmissionWithStatus, Task } from "@/lib/demo-types";

const students = [
  { id: "student-a", name: "张三" },
  { id: "student-b", name: "李四" },
];

const sampleCode = {
  good: "class Animal { speak() {} }\nclass Cat extends Animal { speak() { return 'Meow'; } }\nclass Dog extends Animal { speak() { return 'Woof'; } }",
  branch: "if (type === 'cat') {\n  sound = 'Meow'\n} else if (type === 'dog') {\n  sound = 'Woof'\n} else {\n  sound = 'Unknown'\n}",
  todo: "// TODO: handle edge cases\nfunction solve() { return 1; }",
};

const feedbackBadge = (status: SubmissionWithStatus["aiFeedbackStatus"]) => {
  const base = "rounded-full px-2.5 py-1 text-xs font-semibold";
  if (status === "SUCCEEDED") return `${base} bg-emerald-100 text-emerald-700`;
  if (status === "PENDING") return `${base} bg-amber-100 text-amber-700`;
  if (status === "RUNNING") return `${base} bg-blue-100 text-blue-700`;
  if (status === "FAILED") return `${base} bg-rose-100 text-rose-700`;
  return `${base} bg-slate-100 text-slate-600`;
};

export default function StudentPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [studentId, setStudentId] = useState(students[0].id);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [codeText, setCodeText] = useState(sampleCode.good);
  const [submissions, setSubmissions] = useState<SubmissionWithStatus[]>([]);
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

  const loadSubmissions = async (currentTaskId: string | null, currentStudentId: string) => {
    if (!currentTaskId) {
      setSubmissions([]);
      return;
    }
    const params = new URLSearchParams({
      taskId: currentTaskId,
      studentId: currentStudentId,
    });
    const res = await fetch(`/api/demo/submissions?${params.toString()}`);
    const data = await res.json();
    setSubmissions(data.submissions ?? []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, []);

  useEffect(() => {
    if (publishedTasks.length > 0 && !taskId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTaskId(publishedTasks[0].id);
    }
  }, [publishedTasks, taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSubmissions(taskId, studentId);
  }, [taskId, studentId]);

  const handleSubmit = async () => {
    if (!taskId) return;
    setLoading(true);
    await fetch("/api/demo/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, studentId, codeText }),
    });
    await loadSubmissions(taskId, studentId);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-semibold text-slate-400">教学管理 / 作业提交</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">作业提交</h1>
        <p className="mt-2 text-sm text-slate-600">
          请选择学生与任务后提交作业，提交成功后可在列表查看反馈状态。
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">学生姓名</label>
            <select
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
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
            className="mt-6 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            刷新任务
          </button>
        </div>

        {publishedTasks.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            当前暂无可提交任务，请先在任务管理中发布。
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-500">代码提交</label>
            <div className="flex gap-2 text-xs text-slate-500">
              <button
                className="rounded-full border border-slate-200 px-2 py-0.5"
                onClick={() => setCodeText(sampleCode.good)}
              >
                多态示例
              </button>
              <button
                className="rounded-full border border-slate-200 px-2 py-0.5"
                onClick={() => setCodeText(sampleCode.branch)}
              >
                条件分支
              </button>
              <button
                className="rounded-full border border-slate-200 px-2 py-0.5"
                onClick={() => setCodeText(sampleCode.todo)}
              >
                待完善
              </button>
            </div>
          </div>
          <textarea
            value={codeText}
            onChange={(event) => setCodeText(event.target.value)}
            rows={6}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={loading || !taskId}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              提交作业
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-500">提交记录</div>
            <div className="text-xs text-slate-400">共 {submissions.length} 条</div>
          </div>
          <button
            onClick={() => loadSubmissions(taskId, studentId)}
            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            刷新
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">提交编号</th>
                <th className="py-2 pr-4 font-semibold">提交时间</th>
                <th className="py-2 pr-4 font-semibold">反馈状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {submissions.map((item) => (
                <tr key={item.id} className="text-slate-700">
                  <td className="py-3 pr-4 font-semibold text-slate-900">{item.id}</td>
                  <td className="py-3 pr-4 text-sm text-slate-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={feedbackBadge(item.aiFeedbackStatus)}>
                      {item.aiFeedbackStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {submissions.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            暂无提交记录。
          </div>
        )}
      </section>
    </div>
  );
}
