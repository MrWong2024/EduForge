"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { toSubmissionDetailResponse } from "@/lib/api/types-student";
import {
  buildTextSubmissionRequest,
  canCreateTextSubmission,
  getSavedSubmissionHref,
  getTextSubmissionError,
  countCodePoints,
  getSubmissionTextError,
  SUBMISSION_NOTE_MAX_CODE_POINTS,
} from "@/lib/learning-tasks/text-submission";

type SubmissionFormProps = {
  classroomId: string;
  classroomTaskId: string;
};

type SubmissionErrorState = {
  status?: number;
  summary: string;
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

export function SubmissionForm({
  classroomId,
  classroomTaskId,
}: SubmissionFormProps) {
  const router = useRouter();
  const [language, setLanguage] = useState("auto");
  const [codeText, setCodeText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<SubmissionErrorState | null>(
    null,
  );
  const [submissionNote, setSubmissionNote] = useState("");
  const [resultUncertain, setResultUncertain] = useState(false);
  const inFlight = useRef(false);
  const savedSubmissionIdRef = useRef<string | null>(null);
  const [savedSubmission, setSavedSubmission] = useState<{
    id: string;
    href: string;
  } | null>(null);
  const noteLength = countCodePoints(submissionNote);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !canCreateTextSubmission(
        inFlight.current,
        resultUncertain,
        savedSubmissionIdRef.current,
      )
    )
      return;
    const textError = getSubmissionTextError(codeText, submissionNote);
    if (textError) {
      setErrorState({ summary: textError });
      return;
    }
    const normalizedLanguage = language.trim().toLowerCase() || "auto";
    const requestBody = buildTextSubmissionRequest(
      codeText,
      normalizedLanguage,
      submissionNote,
    );
    inFlight.current = true;
    setIsSubmitting(true);
    setErrorState(null);

    try {
      const payload = await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/tasks/${encodeURIComponent(classroomTaskId)}/submissions`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      const submissionId = toSubmissionDetailResponse(payload).id;
      if (!submissionId) {
        setResultUncertain(true);
        setErrorState({
          summary: "提交请求已成功，但返回信息不完整，请到任务提交历史核对",
        });
        return;
      }
      const href = getSavedSubmissionHref(
        submissionId,
        classroomId,
        classroomTaskId,
      );
      savedSubmissionIdRef.current = submissionId;
      setSavedSubmission({ id: submissionId, href });
      router.push(href);
    } catch (error) {
      // A navigation failure cannot turn an already saved work into another POST.
      if (savedSubmissionIdRef.current) return;
      if (error instanceof BrowserFetchJsonError) {
        const summary = getTextSubmissionError(error.status, error.data);

        if (error.status >= 500) {
          setResultUncertain(true);
          setErrorState({
            status: error.status,
            summary:
              "服务暂不可用，提交结果可能尚未确认，请先到提交历史核对，避免重复提交。",
          });
        } else setErrorState({ status: error.status, summary });
      } else {
        setResultUncertain(true);
        setErrorState({
          summary:
            "网络中断或请求超时，提交结果未确认，请先到任务提交历史核对，避免重复提交。",
        });
      }
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">提交作业</h2>
      <form onSubmit={handleSubmit} className="mt-3">
        <fieldset
          disabled={isSubmitting || savedSubmission !== null}
          className="min-w-0 space-y-3"
        >
          <div className="space-y-1">
            <label
              className="block text-sm font-medium text-zinc-800"
              htmlFor="submission-language"
            >
              编程语言
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
            <p className="text-xs text-zinc-500">
              未指定具体语言时，将优先按代码内容自动识别。
            </p>
          </div>

          <div className="space-y-1">
            <label
              className="block text-sm font-medium text-zinc-800"
              htmlFor="submission-code-text"
            >
              代码内容
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
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
              <p>普通单文件代码可直接粘贴提交，无需添加标记。</p>
              <p className="mt-1">
                如果代码分散在多个文件中，可使用 FILE
                标记分隔不同文件。示例中的文件名可替换为自己的文件名或相对路径，例如
                main.py、Main.java、index.html。
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-zinc-700">
                  多文件代码粘贴格式示例
                </summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-800">
                  {
                    "===== FILE: src/file-a.ext =====\n第一个文件的代码内容\n\n===== FILE: src/file-b.ext =====\n第二个文件的代码内容"
                  }
                </pre>
              </details>
            </div>
          </div>

          <div className="space-y-1">
            <label
              className="block text-sm font-medium text-zinc-800"
              htmlFor="submission-note"
            >
              提交说明（可选）
            </label>
            <textarea
              id="submission-note"
              value={submissionNote}
              onChange={(event) => setSubmissionNote(event.target.value)}
              rows={6}
              aria-describedby="submission-note-hint"
              aria-invalid={noteLength > SUBMISSION_NOTE_MAX_CODE_POINTS}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              placeholder="例如设计思路、实际运行核对、修订过程或 AI 协作说明；按任务要求填写即可。"
            />
            <p
              id="submission-note-hint"
              className={
                noteLength > SUBMISSION_NOTE_MAX_CODE_POINTS
                  ? "text-xs text-red-700"
                  : "text-xs text-zinc-500"
              }
            >
              {noteLength.toLocaleString()} / 20,000 个 Unicode
              码点。说明独立保存，保留原文格式。
            </p>
          </div>

          <button
            type="submit"
            disabled={
              !canCreateTextSubmission(
                isSubmitting,
                resultUncertain,
                savedSubmission?.id ?? null,
              )
            }
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
          >
            {savedSubmission
              ? "已保存"
              : isSubmitting
                ? "提交中..."
                : "提交作业"}
          </button>
        </fieldset>
      </form>

      {savedSubmission ? (
        <div role="status" className="mt-4 space-y-2 text-sm text-zinc-700">
          <p>作业已保存，正在打开详情。</p>
          <Link href={savedSubmission.href} className="text-blue-700 underline">
            打开本次已保存的提交详情
          </Link>
        </div>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title={resultUncertain ? "提交结果待核对" : "暂未完成提交"}
            description={errorState.summary}
          />
        </div>
      ) : null}

      {resultUncertain ? (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-blue-700 underline"
          >
            刷新任务提交历史
          </button>
          <button
            type="button"
            onClick={() => {
              setResultUncertain(false);
              setErrorState(null);
            }}
            className="text-zinc-700 underline"
          >
            已核对历史，继续编辑
          </button>
        </div>
      ) : null}
    </section>
  );
}
