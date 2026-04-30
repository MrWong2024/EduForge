"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import type { CreateTeacherFeedbackRequest } from "@/lib/api/types-teacher";
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_TYPES,
  type FeedbackSeverityValue,
  type FeedbackTypeValue,
} from "@/lib/ui/feedback-options";
import { getCommonErrorSummary } from "@/lib/ui/status";
import {
  FEEDBACK_TAG_OPTIONS,
  type FeedbackTagValue,
} from "@/lib/ui/feedback-tags";

type TeacherFeedbackFormProps = {
  submissionId: string;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const INVALID_TAGS_MESSAGE = "Invalid tag(s), please select from predefined tags";

export function TeacherFeedbackForm({ submissionId }: TeacherFeedbackFormProps) {
  const router = useRouter();
  const [type, setType] = useState<FeedbackTypeValue>("OTHER");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverityValue>("INFO");
  const [selectedTags, setSelectedTags] = useState<FeedbackTagValue[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<FeedbackErrorState | null>(null);

  const toggleTag = (tagValue: FeedbackTagValue) => {
    setSelectedTags((prev) =>
      prev.includes(tagValue)
        ? prev.filter((item) => item !== tagValue)
        : [...prev, tagValue]
    );
  };

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
      const payload: CreateTeacherFeedbackRequest = {
        source: "TEACHER",
        type,
        severity,
        message: normalizedMessage,
      };
      if (suggestion.trim()) {
        payload.suggestion = suggestion.trim();
      }
      if (selectedTags.length > 0) {
        payload.tags = selectedTags;
      }

      await fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      setSuccessText("已添加教师反馈。");
      setType("OTHER");
      setMessage("");
      setSuggestion("");
      setSeverity("INFO");
      setSelectedTags([]);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summary = (() => {
          if (error.status === 403) {
            return "无权限查看或批阅该提交。";
          }
          if (error.status === 400 && detail?.includes(INVALID_TAGS_MESSAGE)) {
            return "标签无效，请从预设标签中选择。";
          }
          return getCommonErrorSummary(error.status, "提交教师反馈");
        })();
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
            <span className="mb-1 block text-zinc-700">类型</span>
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value as FeedbackTypeValue)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {FEEDBACK_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">严重级别</span>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as FeedbackSeverityValue)
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {FEEDBACK_SEVERITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="block text-sm">
          <legend className="mb-2 block text-zinc-700">
            标签（可选，多选；不选将归为 other）
          </legend>
          <div className="max-h-44 overflow-auto rounded-md border border-zinc-300 p-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {FEEDBACK_TAG_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-xs text-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedTags.includes(option.value)}
                    onChange={() => toggleTag(option.value)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <span className="mt-1 block text-xs text-zinc-500">
            用于归类常见问题；不选择时系统会按 other 处理。
          </span>
        </fieldset>

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
            description={buildErrorDescription(
              errorState.summary,
              errorState.detail,
            )}
          />
        </div>
      ) : null}
    </section>
  );
}
