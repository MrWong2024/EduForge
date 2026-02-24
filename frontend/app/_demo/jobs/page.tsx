/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/demo-types";

const statusOptions = ["ALL", "PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;

const statusBadge = (status: Job["status"]) => {
  const base = "rounded-full px-2.5 py-1 text-xs font-semibold";
  if (status === "SUCCEEDED") return `${base} bg-emerald-100 text-emerald-700`;
  if (status === "RUNNING") return `${base} bg-blue-100 text-blue-700`;
  if (status === "FAILED") return `${base} bg-rose-100 text-rose-700`;
  return `${base} bg-amber-100 text-amber-700`;
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("ALL");
  const [limit, setLimit] = useState(20);
  const [batchSize, setBatchSize] = useState(3);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<null | {
    processed: number;
    succeeded: number;
    failed: number;
    dead: number;
    batchSize: number;
  }>(null);

  const loadJobs = async () => {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (limit) params.set("limit", String(limit));
    const res = await fetch(`/api/demo/jobs?${params.toString()}`);
    const data = await res.json();
    setJobs(data.jobs ?? []);
  };

  useEffect(() => {
    loadJobs();
  }, [status, limit]);

  const handleProcessOnce = async () => {
    setProcessing(true);
    const res = await fetch("/api/demo/jobs/process-once", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchSize }),
    });
    const data = await res.json();
    setLastResult(data);
    await loadJobs();
    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-semibold text-slate-400">教学管理 / AI 反馈队列</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">AI 反馈队列</h1>
        <p className="mt-2 text-sm text-slate-600">
          管理待分析作业队列，处理完成后自动回写反馈状态。
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">状态筛选</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {statusOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">列表数量</label>
            <input
              type="number"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="mt-2 w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">批处理量</label>
            <input
              type="number"
              value={batchSize}
              onChange={(event) => setBatchSize(Number(event.target.value))}
              className="mt-2 w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={loadJobs}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300"
          >
            刷新列表
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleProcessOnce}
              disabled={processing}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
            >
              立即处理
            </button>
            <span className="text-xs text-slate-400">用于处理待分析作业</span>
          </div>
        </div>
        {lastResult && (
          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700">
            处理结果：processed {lastResult.processed} / succeeded {lastResult.succeeded} / failed {lastResult.failed}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-500">队列列表</div>
            <div className="text-xs text-slate-400">共 {jobs.length} 条</div>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">任务编号</th>
                <th className="py-2 pr-4 font-semibold">提交编号</th>
                <th className="py-2 pr-4 font-semibold">学生</th>
                <th className="py-2 pr-4 font-semibold">创建时间</th>
                <th className="py-2 pr-4 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id} className="text-slate-700">
                  <td className="py-3 pr-4 font-semibold text-slate-900">{job.id}</td>
                  <td className="py-3 pr-4 text-sm text-slate-600">{job.submissionId}</td>
                  <td className="py-3 pr-4 text-sm text-slate-600">{job.studentId}</td>
                  <td className="py-3 pr-4 text-sm text-slate-500">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={statusBadge(job.status)}>{job.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {jobs.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            暂无待处理队列，请先完成学生提交。
          </div>
        )}
      </section>
    </div>
  );
}
