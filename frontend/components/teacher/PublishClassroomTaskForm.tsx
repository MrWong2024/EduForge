"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  type LearningTaskOption,
  toSubmitTaskResponse,
  type PublishClassroomTaskRequest,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";

type PublishClassroomTaskFormProps = {
  classroomId: string;
  availableTasks: LearningTaskOption[];
};

type PublishErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const DEFAULT_KNOWLEDGE_MODULE = "GENERAL";
const DEFAULT_STAGE = 1;

const extractRawDetail = (data: unknown): string | undefined => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const message =
    "message" in data && typeof (data as { message?: unknown }).message === "string"
      ? String((data as { message: string }).message)
      : "";
  const code =
    "code" in data && typeof (data as { code?: unknown }).code === "string"
      ? String((data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

const toIsoDateTime = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

export function PublishClassroomTaskForm({
  classroomId,
  availableTasks,
}: PublishClassroomTaskFormProps) {
  const router = useRouter();
  const [taskId, setTaskId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>("");
  const [allowLate, setAllowLate] = useState<boolean>(true);
  const [feedbackEnabled, setFeedbackEnabled] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<PublishErrorState | null>(null);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [createdBaseTaskId, setCreatedBaseTaskId] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => availableTasks.find((task) => task.id === taskId),
    [availableTasks, taskId]
  );

  const handleTaskSelect = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    const nextTask = availableTasks.find((item) => item.id === nextTaskId);
    setTitle(nextTask?.title ?? "");
    setDescription(nextTask?.description ?? "");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setErrorState(null);
    setCreatedTaskId(null);
    setCreatedBaseTaskId(null);

    try {
      let publishTaskId = taskId.trim();
      if (!publishTaskId) {
        if (!title.trim() || !description.trim()) {
          setErrorState({
            summary: "未选择任务时，请至少填写任务标题与描述。",
          });
          return;
        }

        const createTaskPayload = await fetchJson<unknown>("learning-tasks/tasks", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            knowledgeModule: DEFAULT_KNOWLEDGE_MODULE,
            stage: DEFAULT_STAGE,
            status: "PUBLISHED",
          }),
        });

        const generatedTaskId =
          typeof createTaskPayload === "object" &&
          createTaskPayload &&
          "id" in createTaskPayload &&
          typeof (createTaskPayload as { id?: unknown }).id === "string"
            ? String((createTaskPayload as { id: string }).id)
            : "";

        if (!generatedTaskId) {
          setErrorState({
            summary: "任务创建成功但未返回 taskId，请稍后重试。",
          });
          return;
        }
        publishTaskId = generatedTaskId;
        setCreatedBaseTaskId(generatedTaskId);
      }

      const dueAtIso = toIsoDateTime(dueAt);
      const body: PublishClassroomTaskRequest = {
        taskId: publishTaskId,
        settings: {
          allowLate,
        },
      };
      if (dueAtIso) {
        body.dueAt = dueAtIso;
      }

      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      const response = toSubmitTaskResponse(payload);
      setCreatedTaskId(response.id ?? null);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          403: "无权限管理任务。",
          404: "任务发布功能未启用、不可用或资源不存在。",
        };
        const summary = summaryByStatus[error.status] ?? "发布任务失败，请稍后重试。";

        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "发布任务失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">发布任务到班级</h2>
      <p className="mt-1 text-sm text-zinc-600">
        可直接选择已发布任务，或填写标题/描述由后端先创建任务（生成 taskId）再发布到班级。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">选择任务</span>
          <select
            value={taskId}
            onChange={(event) => handleTaskSelect(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            <option value="">请选择已发布任务</option>
            {availableTasks.map((task) => (
              <option key={task.id ?? task.title} value={task.id}>
                {task.title ?? "未命名任务"} {task.id ? `(${task.id})` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">任务标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="标题来自任务库，当前仅用于展示"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">截止时间</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">任务描述</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="描述来自任务库，当前仅用于展示"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={allowLate}
              onChange={(event) => setAllowLate(event.target.checked)}
            />
            允许迟交
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={feedbackEnabled}
              onChange={(event) => setFeedbackEnabled(event.target.checked)}
            />
            显示反馈（当前接口暂不接收此字段）
          </label>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "发布中..." : "发布任务"}
        </button>
      </form>

      {selectedTask ? (
        <p className="mt-3 text-xs text-zinc-500">
          已选任务状态：{selectedTask.status ?? "—"} | 模块：{selectedTask.knowledgeModule ?? "—"} | 阶段：
          {selectedTask.stage ?? "—"}
        </p>
      ) : null}

      {createdTaskId ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {createdBaseTaskId ? <p>已创建任务，taskId：{createdBaseTaskId}</p> : null}
          <p>任务发布成功，课堂任务 ID：{createdTaskId}</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Link
              href={paths.teacher.classroomTaskDetail(classroomId, createdTaskId)}
              className="text-emerald-800 underline"
            >
              查看任务详情
            </Link>
            <Link
              href={paths.teacher.classroomTaskSubmissions(classroomId, createdTaskId)}
              className="text-emerald-800 underline"
            >
              查看提交管理
            </Link>
          </div>
        </div>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="发布任务失败"
            description={buildErrorDescription(errorState.summary, errorState.detail)}
          />
        </div>
      ) : null}
    </section>
  );
}
