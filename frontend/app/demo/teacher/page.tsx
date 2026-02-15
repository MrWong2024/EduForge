"use client";

import { useEffect, useState } from "react";
import type { Task } from "@/lib/demo-types";

const statusBadge = (status: Task["status"]) => {
  const base = "rounded-full px-2.5 py-1 text-xs font-semibold";
  if (status === "PUBLISHED") {
    return `${base} bg-emerald-100 text-emerald-700`;
  }
  return `${base} bg-slate-100 text-slate-600`;
};

export default function TeacherPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    const res = await fetch("/api/demo/tasks");
    const data = await res.json();
    setTasks(data.tasks ?? []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    await fetch("/api/demo/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    setTitle("");
    setDescription("");
    await loadTasks();
    setLoading(false);
  };

  const handlePublish = async (id: string) => {
    setLoading(true);
    await fetch(`/api/demo/tasks/${id}/publish`, { method: "POST" });
    await loadTasks();
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-semibold text-slate-400">教学管理 / 任务管理</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">任务管理</h1>
        <p className="mt-2 text-sm text-slate-600">
          发布后的任务将出现在作业提交入口，学生即可选择并提交作业。
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-500">新建任务</div>
        <div className="mt-4 grid gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">任务标题</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder="请输入任务标题"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">任务描述</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder="简要描述任务要求与评分重点"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={loading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              创建任务
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-500">任务列表</div>
            <div className="text-xs text-slate-400">共 {tasks.length} 条</div>
          </div>
          <button
            onClick={loadTasks}
            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            刷新
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">任务名称</th>
                <th className="py-2 pr-4 font-semibold">描述</th>
                <th className="py-2 pr-4 font-semibold">状态</th>
                <th className="py-2 pr-4 font-semibold">创建人</th>
                <th className="py-2 pr-4 font-semibold">更新时间</th>
                <th className="py-2 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr key={task.id} className="text-slate-700">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-slate-900">{task.title}</div>
                    <div className="text-xs text-slate-400">编号 {task.id}</div>
                  </td>
                  <td className="py-3 pr-4 text-sm text-slate-600">
                    {task.description || "暂无描述"}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={statusBadge(task.status)}>
                      {task.status === "PUBLISHED" ? "已发布" : "草稿"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-sm">王老师</td>
                  <td className="py-3 pr-4 text-sm text-slate-500">
                    {new Date(task.publishedAt ?? task.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 text-right">
                    {task.status === "DRAFT" ? (
                      <button
                        onClick={() => handlePublish(task.id)}
                        disabled={loading}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                      >
                        发布
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">已发布</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tasks.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            暂无任务，请先创建并发布。
          </div>
        )}
      </section>
    </div>
  );
}
