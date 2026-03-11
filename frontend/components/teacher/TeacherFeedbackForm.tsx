"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getCommonErrorSummary } from "@/lib/ui/status";

type TeacherFeedbackFormProps = {
  submissionId: string;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function TeacherFeedbackForm({ submissionId }: TeacherFeedbackFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [severity, setSeverity] = useState("INFO");
  const [tagsInput, setTagsInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<FeedbackErrorState | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      setValidationError("反馈内容不能为空。");
      return;
    }

    setValidationError(null);
    setErrorState(null);
    setSuccessText(null);
    setIsSubmitting(true);

    try {
      const tags = parseTags(tagsInput);
      const payload: Record<string, unknown> = {
        source: "TEACHER",
        type: "OTHER",
        severity,
        message: normalizedMessage,
      };
      if (suggestion.trim()) {
        payload.suggestion = suggestion.trim();
      }
      if (tags.length > 0) {
        payload.tags = tags;
      }

      await fetchJson<unknown>(`learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      setSuccessText("已添加教师反馈。");
      setMessage("");
      setSuggestion("");
      setSeverity("INFO");
      setTagsInput("");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summary =
          error.status === 403
            ? "无权限查看或批阅该提交。"
            : getCommonErrorSummary(error.status, "提交教师反馈");
        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "提交教师反馈失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">新增教师反馈</h2>
      <p className="mt-1 text-sm text-zinc-600">至少填写反馈内容，其他字段可选。</p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">反馈内容</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            placeholder="请输入本次批阅反馈"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">建议（可选）</span>
          <textarea
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            placeholder="可选：给学生的改进建议"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">严重级别（可选）</span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">标签（可选）</span>
            <input
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              placeholder="例如：逻辑, 边界条件"
            />
            <span className="mt-1 block text-xs text-zinc-500">多个标签请用英文逗号分隔。</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "提交中..." : "提交教师反馈"}
        </button>
      </form>

      {validationError ? <p className="mt-3 text-sm text-red-700">{validationError}</p> : null}
      {successText ? <p className="mt-3 text-sm text-emerald-700">{successText}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="提交教师反馈失败"
            description={buildErrorDescription(errorState.summary, errorState.detail)}
          />
        </div>
      ) : null}
    </section>
  );
}
