"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError } from "@/lib/api/browser-client";
import { usePageFetch } from "@/lib/api/use-page-fetch";
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
  findTeacherFeedbackForReview,
  rebaseTeacherFeedbackDraft,
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
  isBusy: boolean;
  onChange: (
    update: (current: TeacherFeedbackEditSession) => TeacherFeedbackEditSession,
  ) => void;
  onCancel: () => void;
  onOperationStart: () => boolean;
  onOperationFinish: () => void;
  onLatestRead: (feedback: TeacherFeedbackItem) => void;
  onSaved: (feedback: TeacherFeedbackItem) => void;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

export type TeacherFeedbackEditSession = {
  feedbackId: string;
  original: TeacherFeedbackItem;
  draft: TeacherFeedbackEditValues;
  validationError: string | null;
  errorState: FeedbackErrorState | null;
  conflict:
    | { state: "required" | "failed" }
    | { state: "read"; latest: TeacherFeedbackItem }
    | null;
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
  isBusy,
  onChange,
  onCancel,
  onOperationStart,
  onOperationFinish,
  onLatestRead,
  onSaved,
}: TeacherFeedbackEditFormProps) {
  const fetchJson = usePageFetch();
  const router = useRouter();
  const { feedbackId, original, draft, validationError, errorState, conflict } =
    session;
  const { type, severity, message, suggestion, tags } = draft;
  const payload = buildTeacherFeedbackEditPatch(original, draft);
  const hasChanges = Object.keys(payload).length > 0;
  const feedbackPath = `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`;

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

  const readLatest = async () => {
    if (!conflict || isBusy || !onOperationStart()) return;
    onChange((current) => ({ ...current, conflict: { state: "required" } }));
    try {
      const response = await fetchJson<unknown>(feedbackPath, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const latest = findTeacherFeedbackForReview(
        response,
        submissionId,
        feedbackId,
      );
      if (!latest) throw new Error("Missing teacher feedback");
      onLatestRead(latest);
      onChange((current) => ({
        ...current,
        conflict: { state: "read", latest },
      }));
    } catch {
      onChange((current) => ({ ...current, conflict: { state: "failed" } }));
    } finally {
      onOperationFinish();
    }
  };

  const confirmLatest = () => {
    if (isBusy) return;
    onChange((current) => {
      if (current.conflict?.state !== "read") return current;
      const { latest } = current.conflict;
      return {
        ...current,
        original: latest,
        draft: rebaseTeacherFeedbackDraft(
          current.original,
          current.draft,
          latest,
        ),
        conflict: null,
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || conflict) {
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

    if (!onOperationStart()) {
      return;
    }
    setErrors(null);
    try {
      const response = await fetchJson<unknown>(
        `${feedbackPath}/${encodeURIComponent(feedbackId)}`,
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
      if (
        error instanceof BrowserFetchJsonError &&
        error.status === 409 &&
        safeGet<unknown>(error.data, "code", undefined) ===
          "TEACHER_FEEDBACK_TEXT_CONFLICT"
      ) {
        onChange((current) => ({ ...current, conflict: { state: "required" } }));
      } else if (error instanceof BrowserFetchJsonError) {
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
      onOperationFinish();
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
            disabled={isBusy}
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
            disabled={isBusy}
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
          disabled={isBusy}
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
          disabled={isBusy}
          value={suggestion}
          onChange={(event) => changeDraft({ suggestion: event.target.value })}
          rows={3}
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="可选：给学生的改进建议"
        />
      </label>

      <fieldset disabled={isBusy} className="mt-3 block text-sm">
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
          disabled={isBusy || !!conflict || !hasChanges}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isBusy && !conflict ? "保存中..." : "保存修改"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
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

      {conflict ? (
        <section
          className="mt-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900"
          aria-label="先核对已保存反馈"
        >
          <h4 className="font-medium">先核对已保存反馈</h4>
          <p>正文或建议已有新保存的内容。你的草稿仍保留，请核对后再继续。</p>
          {conflict.state === "failed" ? (
            <p role="alert">读取最新反馈失败。请重试，暂不能保存。</p>
          ) : null}
          {conflict.state === "read" ? (
            <FeedbackTextComparison latest={conflict.latest} draft={draft} />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void readLatest()}
              className="text-blue-700 underline disabled:text-zinc-500"
            >
              {isBusy
                ? "正在读取已保存反馈…"
                : conflict.state === "failed"
                  ? "重试读取已保存反馈"
                  : "查看最新已保存反馈"}
            </button>
            {conflict.state === "read" ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={confirmLatest}
                className="text-blue-700 underline disabled:text-zinc-500"
              >
                已核对，继续修改
              </button>
            ) : null}
          </div>
        </section>
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

function FeedbackTextComparison({
  latest,
  draft,
}: {
  latest: TeacherFeedbackItem;
  draft: TeacherFeedbackEditValues;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const versions = [
    {
      title: "最新已保存反馈",
      message: latest.message,
      suggestion: latest.suggestion,
    },
    { title: "我的草稿", message: draft.message, suggestion: draft.suggestion },
  ];

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`已复制${label}。`);
    } catch {
      setCopyStatus("无法访问剪贴板，可选中文本后复制。");
    }
  };

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {versions.map(({ title, message, suggestion }) => (
          <section
            key={title}
            aria-label={title}
            className="min-w-0 rounded border border-zinc-200 bg-white p-3"
          >
            <h5 className="font-medium">{title}</h5>
            {[
              { label: "正文", text: message },
              { label: "建议", text: suggestion },
            ].map(({ label, text }) => (
              <div key={label} className="mt-2">
                <div className="flex items-center justify-between gap-2">
                  <p>{label}</p>
                  {text !== undefined ? (
                    <button
                      type="button"
                      onClick={() => void copy(text, label)}
                      className="text-blue-700 underline"
                    >
                      复制{label}
                    </button>
                  ) : null}
                </div>
                {text ? (
                  <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>
                ) : (
                  <p className="text-zinc-500">
                    {text === undefined ? "无建议" : "空文本"}
                  </p>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </>
  );
}
