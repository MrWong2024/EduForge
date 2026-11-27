"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toUpdateTeacherFeedbackResponse,
  type TeacherFeedbackItem,
} from "@/lib/api/types-teacher";
import {
  buildTeacherFeedbackEditPatch,
  type TeacherFeedbackEditValues,
} from "@/lib/learning-tasks/teacher-feedback-edit";
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_TYPES,
  getFeedbackTypeLabel,
  getFeedbackSeverityLabel,
  type FeedbackSeverityValue,
  type FeedbackTypeValue,
} from "@/lib/ui/feedback-options";
import {
  FEEDBACK_TAG_OPTIONS,
  type FeedbackTagValue,
} from "@/lib/ui/feedback-tags";
import { safeGet } from "@/lib/ui/format";

type TeacherFeedbackEditFormProps = {
  session: TeacherFeedbackEditSession;
  submissionId: string;
  isSaving: boolean;
  onChange: (
    update: (current: TeacherFeedbackEditSession) => TeacherFeedbackEditSession,
  ) => void;
  onCancel: () => void;
  onSaveStart: () => boolean;
  onSaveFinish: () => void;
  onSaved: (feedback: TeacherFeedbackItem) => void;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

export type TeacherFeedbackEditSession = {
  feedbackId: string;
  initialValues: TeacherFeedbackEditValues;
  draft: TeacherFeedbackEditValues;
  validationError: string | null;
  errorState: FeedbackErrorState | null;
};

const DUPLICATE_FEEDBACK_MESSAGE =
  "该作品已有相同类型、严重程度和正文的教师反馈，请核对后修改本条反馈。";

const getUpdateFeedbackErrorSummary = (
  status: number,
  data: unknown,
): string => {
  if (
    status === 409 &&
    safeGet<unknown>(data, "message", undefined) === DUPLICATE_FEEDBACK_MESSAGE
  ) {
    return DUPLICATE_FEEDBACK_MESSAGE;
  }
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
  session,
  submissionId,
  isSaving,
  onChange,
  onCancel,
  onSaveStart,
  onSaveFinish,
  onSaved,
}: TeacherFeedbackEditFormProps) {
  const router = useRouter();
  const { feedbackId, initialValues, draft, validationError, errorState } =
    session;
  const { type, severity, message, suggestion, tags } = draft;
  const payload = buildTeacherFeedbackEditPatch(initialValues, draft);
  const hasChanges = Object.keys(payload).length > 0;

  const changeDraft = (changes: Partial<TeacherFeedbackEditValues>) => {
    onChange((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
    }));
  };

  const toggleTag = (tagValue: FeedbackTagValue) => {
    onChange((current) => ({
      ...current,
      draft: {
        ...current.draft,
        tags: current.draft.tags.includes(tagValue)
          ? current.draft.tags.filter((tag) => tag !== tagValue)
          : [...current.draft.tags, tagValue],
      },
    }));
  };

  const setErrors = (
    validationError: string | null,
    errorState: FeedbackErrorState | null = null,
  ) => {
    onChange((current) => ({ ...current, validationError, errorState }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    if (!message.trim()) {
      setErrors("反馈内容不能为空。");
      return;
    }
    if (!hasChanges) {
      setErrors("内容未变化。");
      return;
    }

    if (!onSaveStart()) {
      return;
    }
    setErrors(null);
    try {
      const response = await fetchJson<unknown>(
        `learning-tasks/submissions/${encodeURIComponent(
          submissionId,
        )}/feedback/${encodeURIComponent(feedbackId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const savedFeedback = toUpdateTeacherFeedbackResponse(
        response,
        submissionId,
        feedbackId,
      );
      if (!savedFeedback) {
        setErrors(null, { summary: "无法确认保存结果，请刷新页面核对。" });
        return;
      }
      onSaved(savedFeedback);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        setErrors(null, {
          status: error.status,
          summary: getUpdateFeedbackErrorSummary(error.status, error.data),
          detail: extractRawDetail(error.data),
        });
      } else {
        setErrors(null, {
          summary: "保存失败，请稍后重试。",
        });
      }
    } finally {
      onSaveFinish();
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
            disabled={isSaving}
            value={type}
            onChange={(event) =>
              changeDraft({ type: event.target.value as FeedbackTypeValue })
            }
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            {FEEDBACK_TYPES.map((option) => (
              <option key={option} value={option}>
                {getFeedbackTypeLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">严重级别</span>
          <select
            disabled={isSaving}
            value={severity}
            onChange={(event) =>
              changeDraft({
                severity: event.target.value as FeedbackSeverityValue,
              })
            }
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            {FEEDBACK_SEVERITIES.map((option) => (
              <option key={option} value={option}>
                {getFeedbackSeverityLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-zinc-700">反馈内容</span>
        <textarea
          disabled={isSaving}
          value={message}
          onChange={(event) => changeDraft({ message: event.target.value })}
          rows={4}
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="请输入本次批阅反馈"
        />
      </label>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-zinc-700">建议（可选）</span>
        <textarea
          disabled={isSaving}
          value={suggestion}
          onChange={(event) => changeDraft({ suggestion: event.target.value })}
          rows={3}
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="可选：给学生的改进建议"
        />
      </label>

      <fieldset disabled={isSaving} className="mt-3 block text-sm">
        <legend className="mb-2 block text-zinc-700">
          标签（可选，多选；不选将归为“其他”）
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
                  checked={tags.includes(option.value)}
                  onChange={() => toggleTag(option.value)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
        <span className="mt-1 block text-xs text-zinc-500">
          用于归类常见问题；不选择时将归为“其他”。
        </span>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSaving || !hasChanges}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSaving ? "保存中..." : "保存修改"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
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
