"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import type { CreateTeacherFeedbackRequest } from "@/lib/api/types-teacher";
import {
  toListFeedbackResponse,
  toSubmissionDetailResponse,
  type SubmissionDetailResponse,
} from "@/lib/api/types-student";
import { SubmissionContent } from "@/components/submissions/SubmissionContent";
import {
  getSubmissionRevisionError,
  isDraftRevisionCurrent,
  isValidContentRevision,
} from "@/lib/learning-tasks/text-submission";
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
  contentRevision?: number | null;
};

type FeedbackErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const INVALID_TAGS_MESSAGE =
  "Invalid tag(s), please select from predefined tags";

export function TeacherFeedbackForm({
  submissionId,
  contentRevision,
}: TeacherFeedbackFormProps) {
  const router = useRouter();
  // New props never rebind an existing feedback draft to unseen work.
  const [baseRevision, setBaseRevision] = useState(contentRevision);
  const [needsReview, setNeedsReview] = useState(false);
  const [checked, setChecked] = useState<SubmissionDetailResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [feedbackCheck, setFeedbackCheck] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
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
        : [...prev, tagValue],
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      inFlight.current ||
      needsReview ||
      !isDraftRevisionCurrent(baseRevision, contentRevision) ||
      !isValidContentRevision(baseRevision)
    )
      return;

    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      setValidationError("反馈内容不能为空。");
      return;
    }

    setValidationError(null);
    setErrorState(null);
    setSuccessText(null);
    setIsSubmitting(true);
    inFlight.current = true;

    try {
      const payload: CreateTeacherFeedbackRequest = {
        expectedRevision: baseRevision,
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
          signal: AbortSignal.timeout(30_000),
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
          if (error.status === 409)
            return getSubmissionRevisionError(error.data);
          if (error.status >= 500)
            return "反馈提交结果待核对。评语草稿已保留，请读取当前作品和反馈历史，避免重复提交。";
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
        if (error.status === 409 || error.status >= 500) {
          setNeedsReview(true);
          setChecked(null);
        }
      } else {
        setNeedsReview(true);
        setChecked(null);
        setErrorState({
          summary:
            "网络中断或超时，反馈结果待核对。评语草稿已保留，请先核对作品与反馈历史。",
        });
      }
    } finally {
      setIsSubmitting(false);
      inFlight.current = false;
    }
  };

  const checkCurrent = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setNeedsReview(true);
    setChecked(null);
    setFeedbackCheck(null);
    try {
      const path = `learning-tasks/submissions/${encodeURIComponent(submissionId)}`;
      const latest = toSubmissionDetailResponse(
        await fetchJson<unknown>(path, {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }),
      );
      const history = toListFeedbackResponse(
        await fetchJson<unknown>(path + "/feedback", {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }),
      );
      if (
        latest.id !== submissionId ||
        !isValidContentRevision(latest.contentRevision)
      )
        throw new Error("Incomplete detail");
      setChecked(latest);
      setFeedbackCheck(
        history.items.length === 0
          ? "当前尚无反馈。"
          : "当前反馈：\n" +
              history.items
                .map(
                  (item) =>
                    `${item.source ?? "反馈"}：${item.message ?? "（无内容）"}`,
                )
                .join("\n"),
      );
      startTransition(() => router.refresh());
    } catch {
      setErrorState({
        summary:
          "权威作品或反馈历史读取未完成，评语草稿已保留，请再次显式核对。",
      });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900">
      <h2 className="text-base font-semibold text-zinc-900">新增教师反馈</h2>
      <p className="mt-1 text-sm text-zinc-600">
        至少填写反馈内容，其他字段可选。
      </p>
      {needsReview || !isDraftRevisionCurrent(baseRevision, contentRevision) ? (
        <div className="mt-3 space-y-3 text-sm text-amber-900" role="status">
          <p>
            评语草稿已保留。请重新查看当前作品和反馈历史，确认评语仍适用于当前作品后继续；不会自动提交。
          </p>
          <button
            type="button"
            disabled={isSubmitting || checking || isRefreshing}
            onClick={() => void checkCurrent()}
            className="text-blue-700 underline"
          >
            {checking ? "核对中…" : "刷新查看当前作品与反馈"}
          </button>
          {checked ? (
            <>
              <SubmissionContent detail={checked} />
              <p className="whitespace-pre-wrap break-words">{feedbackCheck}</p>
              <button
                type="button"
                disabled={checking || isRefreshing}
                onClick={() => {
                  if (
                    !isValidContentRevision(checked.contentRevision) ||
                    checked.contentRevision !== contentRevision
                  )
                    return;
                  setBaseRevision(checked.contentRevision);
                  setNeedsReview(false);
                  setChecked(null);
                  setErrorState(null);
                }}
                className="text-blue-700 underline"
              >
                已查看当前作品并核对反馈，保留评语继续
              </button>
            </>
          ) : null}
        </div>
      ) : null}

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
          disabled={
            isSubmitting ||
            checking ||
            isRefreshing ||
            needsReview ||
            !isDraftRevisionCurrent(baseRevision, contentRevision)
          }
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "提交中..." : "提交教师反馈"}
        </button>
      </form>

      {validationError ? (
        <p className="mt-3 text-sm text-red-700">{validationError}</p>
      ) : null}
      {successText ? (
        <p className="mt-3 text-sm text-emerald-700">{successText}</p>
      ) : null}

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
