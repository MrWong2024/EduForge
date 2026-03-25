"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import type { CreateSubmissionRequest } from "@/lib/api/types-student";
import { getCommonErrorSummary } from "@/lib/ui/status";

type SubmissionFormProps = {
  classroomId: string;
  classroomTaskId: string;
};

type SubmissionErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动识别（默认）" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "other", label: "Other" },
] as const;

const extractErrorCode = (data: unknown): string | undefined => {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  if ("code" in data && typeof (data as { code?: unknown }).code === "string") {
    return String((data as { code: string }).code);
  }

  return undefined;
};

const containsLateSubmissionCode = (data: unknown, detail?: string): boolean => {
  const code = extractErrorCode(data);
  if (code === "LATE_SUBMISSION_NOT_ALLOWED") {
    return true;
  }

  return Boolean(detail && detail.includes("LATE_SUBMISSION_NOT_ALLOWED"));
};

export function SubmissionForm({ classroomId, classroomTaskId }: SubmissionFormProps) {
  const router = useRouter();
  const [language, setLanguage] = useState("auto");
  const [codeText, setCodeText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<SubmissionErrorState | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedLanguage = language.trim().toLowerCase() || "auto";
    const normalizedCodeText = codeText.trim();
    if (!normalizedCodeText) {
      setErrorState({
        summary: "请填写代码内容后再提交。",
      });
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);

    const requestBody: CreateSubmissionRequest = {
      content: {
        language: normalizedLanguage,
        codeText: normalizedCodeText,
      },
    };

    try {
      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/submissions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      setResult(payload);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const isLateSubmission =
          error.status === 403 && containsLateSubmissionCode(error.data, detail);

        if (isLateSubmission) {
          setErrorState({
            status: 403,
            summary: "已截止，禁止迟交，请联系老师。",
            detail,
          });
          return;
        }

        const summary =
          error.status === 403
            ? "无权限提交该课堂任务。"
            : getCommonErrorSummary(error.status, "提交作业");

        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "提交请求失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">提交作业</h2>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-800" htmlFor="submission-language">
            language
          </label>
          <select
            id="submission-language"
            required
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">未指定具体语言时，将优先按代码内容自动识别。</p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-800" htmlFor="submission-code-text">
            codeText
          </label>
          <textarea
            id="submission-code-text"
            required
            value={codeText}
            onChange={(event) => setCodeText(event.target.value)}
            rows={8}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="请输入要提交的代码内容"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting ? "提交中..." : "提交作业"}
        </button>
      </form>

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="提交失败"
            description={buildErrorDescription(errorState.summary, errorState.detail)}
          />
        </div>
      ) : null}

      {result ? (
        <details className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-emerald-900">提交成功，查看返回结果</summary>
          <pre className="mt-2 overflow-auto text-xs text-emerald-900">{JSON.stringify(result, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}
