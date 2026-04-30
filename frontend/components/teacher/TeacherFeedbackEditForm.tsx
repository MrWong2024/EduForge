"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import type {
  TeacherFeedbackItem,
  UpdateTeacherFeedbackRequest,
} from "@/lib/api/types-teacher";
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_TYPES,
  normalizeFeedbackSeverity,
  normalizeFeedbackType,
  type FeedbackSeverityValue,
  type FeedbackTypeValue,
} from "@/lib/ui/feedback-options";
import {
  FEEDBACK_TAG_OPTIONS,
  type FeedbackTagValue,
} from "@/lib/ui/feedback-tags";

type TeacherFeedbackEditFormProps = {
  feedback: TeacherFeedbackItem;
  submissionId: string;
  onCancel: () => void;
  onSaved?: () => void;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const normalizeFeedbackTags = (tags: string[]): FeedbackTagValue[] =>
  tags.filter((tag): tag is FeedbackTagValue =>
    FEEDBACK_TAG_OPTIONS.some((option) => option.value === tag),
  );

const sameStringArray = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((item, index) => item === right[index]);

const getUpdateFeedbackErrorSummary = (status: number): string => {
  if (status === 400) {
    return "反馈内容不完整或格式不正确，请检查后再保存。";
  }
  if (status === 403) {
    return "无权限修改该反馈，或该反馈不是可修改的教师反馈。";
  }
  if (status === 404) {
    return "反馈不存在，可能已被更新或当前提交不匹配，请刷新页面后重试。";
  }
  if (status >= 500) {
    return "保存失败，请稍后重试。";
  }
  return "保存反馈修改失败，请稍后重试。";
};

export function TeacherFeedbackEditForm({
  feedback,
  submissionId,
  onCancel,
  onSaved,
}: TeacherFeedbackEditFormProps) {
  const router = useRouter();
  const initialValues = useMemo(
    () => ({
      type: normalizeFeedbackType(feedback.type),
      severity: normalizeFeedbackSeverity(feedback.severity),
      message: feedback.message?.trim() ?? "",
      suggestion: feedback.suggestion?.trim() ?? "",
      tags: normalizeFeedbackTags(feedback.tags),
    }),
    [feedback],
  );

  const [type, setType] = useState<FeedbackTypeValue>(initialValues.type);
  const [severity, setSeverity] = useState<FeedbackSeverityValue>(
    initialValues.severity,
  );
  const [message, setMessage] = useState(initialValues.message);
  const [suggestion, setSuggestion] = useState(initialValues.suggestion);
  const [selectedTags, setSelectedTags] = useState<FeedbackTagValue[]>(
    initialValues.tags,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<FeedbackErrorState | null>(null);

  const normalizedMessage = message.trim();
  const normalizedSuggestion = suggestion.trim();
  const hasChanges =
    type !== initialValues.type ||
    severity !== initialValues.severity ||
    normalizedMessage !== initialValues.message ||
    normalizedSuggestion !== initialValues.suggestion ||
    !sameStringArray(selectedTags, initialValues.tags);

  const toggleTag = (tagValue: FeedbackTagValue) => {
    setSelectedTags((prev) =>
      prev.includes(tagValue)
        ? prev.filter((item) => item !== tagValue)
        : [...prev, tagValue],
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    setErrorState(null);

    if (!feedback.id) {
      setValidationError("当前反馈缺少标识，无法保存修改。");
      return;
    }
    if (!normalizedMessage) {
      setValidationError("反馈内容不能为空。");
      return;
    }
    if (!hasChanges) {
      setValidationError("内容未变化。");
      return;
    }

    const payload: UpdateTeacherFeedbackRequest = {};
    if (type !== initialValues.type) {
      payload.type = type;
    }
    if (severity !== initialValues.severity) {
      payload.severity = severity;
    }
    if (normalizedMessage !== initialValues.message) {
      payload.message = normalizedMessage;
    }
    if (normalizedSuggestion !== initialValues.suggestion) {
      payload.suggestion = normalizedSuggestion;
    }
    if (!sameStringArray(selectedTags, initialValues.tags)) {
      payload.tags = selectedTags;
    }

    setIsSubmitting(true);
    try {
      await fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(
          submissionId,
        )}/feedback/${encodeURIComponent(feedback.id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      onSaved?.();
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        setErrorState({
          status: error.status,
          summary: getUpdateFeedbackErrorSummary(error.status),
          detail: extractRawDetail(error.data),
        });
      } else {
        setErrorState({
          summary: "保存失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-md border border-zinc-200 bg-white p-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
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

      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-zinc-700">反馈内容</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="请输入本次批阅反馈"
        />
      </label>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-zinc-700">建议（可选）</span>
        <textarea
          value={suggestion}
          onChange={(event) => setSuggestion(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="可选：给学生的改进建议"
        />
      </label>

      <fieldset className="mt-3 block text-sm">
        <legend className="mb-2 block text-zinc-700">标签（可选，多选）</legend>
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
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || !hasChanges}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "保存中..." : "保存修改"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          取消
        </button>
        {!hasChanges ? (
          <span className="text-xs text-zinc-500">内容未变化</span>
        ) : null}
      </div>

      {validationError ? (
        <p className="mt-3 text-sm text-red-700">{validationError}</p>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="保存反馈修改失败"
            description={buildErrorDescription(
              errorState.summary,
              errorState.detail,
            )}
          />
        </div>
      ) : null}
    </form>
  );
}
