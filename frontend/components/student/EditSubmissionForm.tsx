"use client";

import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SubmissionContent } from "@/components/submissions/SubmissionContent";
import { SubmissionAiReview } from "@/components/submissions/SubmissionAiReview";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  toSubmissionDetailResponse,
  type SubmissionDetailResponse,
} from "@/lib/api/types-student";
import {
  buildUpdateSubmissionRequest,
  canEditSubmission,
  countCodePoints,
  getSubmissionRevisionError,
  getSubmissionTextError,
  isDraftRevisionCurrent,
  isSavedSubmissionRevision,
  isValidContentRevision,
  selectSubmissionDisplayDetail,
} from "@/lib/learning-tasks/text-submission";
import { toDisplayDate } from "@/lib/ui/format";

type Draft = {
  baseRevision: number;
  language: string;
  codeText: string;
  submissionNote: string;
};

export function EditSubmissionForm({
  submissionId,
  detail,
}: {
  submissionId: string;
  detail: SubmissionDetailResponse;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SubmissionDetailResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checked, setChecked] = useState<SubmissionDetailResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
  const current = selectSubmissionDisplayDetail(detail, saved);
  const changed =
    draft !== null &&
    !isDraftRevisionCurrent(draft.baseRevision, current.contentRevision);
  const path = `learning-tasks/submissions/${encodeURIComponent(submissionId)}`;

  const startEdit = () => {
    if (
      blocked ||
      inFlight.current ||
      !canEditSubmission(current) ||
      !isValidContentRevision(current.contentRevision)
    )
      return;
    setDraft({
      baseRevision: current.contentRevision,
      language: current.content.language ?? "auto",
      codeText: current.content.codeText ?? "",
      submissionNote: current.content.submissionNote ?? "",
    });
    setBlocked(false);
    setChecked(null);
    setMessage(null);
  };
  const checkCurrent = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setChecked(null);
    try {
      const result = toSubmissionDetailResponse(
        await fetchJson<unknown>(path, {
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        }),
      );
      if (
        result.id !== submissionId ||
        !isValidContentRevision(result.contentRevision)
      )
        throw new Error("Incomplete detail");
      setSaved(result);
      setChecked(result);
      if (!draft) setBlocked(false);
      setMessage(
        canEditSubmission(result)
          ? "已读取最新作品。请核对下方内容；确认后可将保留草稿用于当前作品。"
          : (result.editing.message ??
              "本次提交当前不能修改。草稿仍保留，可复制后取消编辑。"),
      );
      startTransition(() => router.refresh());
    } catch {
      setMessage(
        "最新详情读取未完成，草稿已保留。请再次点击核对，暂不继续保存。",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !draft ||
      inFlight.current ||
      blocked ||
      changed ||
      !canEditSubmission(current)
    )
      return;
    const textError = getSubmissionTextError(
      draft.codeText,
      draft.submissionNote,
    );
    if (textError) {
      setMessage(textError);
      return;
    }
    const body = buildUpdateSubmissionRequest(
      draft.baseRevision,
      draft.codeText,
      draft.language,
      draft.submissionNote,
    );
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setChecked(null);
    try {
      const result = toSubmissionDetailResponse(
        await fetchJson<unknown>(path, {
          method: "PATCH",
          signal: AbortSignal.timeout(30_000),
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      if (
        result.id !== submissionId ||
        !isSavedSubmissionRevision(draft.baseRevision, result.contentRevision)
      ) {
        setBlocked(true);
        setMessage(
          "保存响应不完整，结果待核对。草稿已保留，请先读取当前作品，避免重复保存。",
        );
        return;
      }
      setSaved(result);
      setDraft(null);
      setMessage("本次提交已修改；提交编号和尝试次数保持不变。");
      startTransition(() => router.refresh());
    } catch (error) {
      if (error instanceof BrowserFetchJsonError && error.status < 500) {
        setBlocked(error.status === 409 || error.status === 403);
        setMessage(
          error.status === 409
            ? getSubmissionRevisionError(error.data)
            : error.status === 403
              ? "当前无修改资格或已超过截止时间。草稿已保留，请核对详情。"
              : "修改未保存，请检查内容并核对当前详情。草稿已保留。",
        );
      } else {
        setBlocked(true);
        setMessage(
          "网络中断、超时或服务异常，保存结果待核对。草稿已保留，请先读取当前作品，避免重复保存。",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">修改本次提交</h2>
        <p>
          进入评阅前，可在参与资格与截止规则允许时修改同一份作品；教师仅查看不会锁定作品。
        </p>
        {!draft ? (
          <>
            <button
              type="button"
              onClick={startEdit}
              disabled={
                blocked || !canEditSubmission(current) || busy || refreshing
              }
              className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:bg-zinc-400"
            >
              修改本次提交
            </button>
            {!canEditSubmission(current) ? (
              <p>
                {current.editing.message ??
                  "修改资格暂不可用，请刷新详情核对。"}
              </p>
            ) : null}
            {blocked ? (
              <button
                type="button"
                disabled={busy || refreshing}
                onClick={() => void checkCurrent()}
                className="ml-3 text-blue-700 underline"
              >
                读取当前作品并核对后再编辑
              </button>
            ) : null}
          </>
        ) : (
          <form onSubmit={save} className="space-y-3">
            <fieldset disabled={busy} className="min-w-0 space-y-3">
              <label className="block">
                编程语言
                <input
                  required
                  value={draft.language}
                  onChange={(event) =>
                    setDraft({ ...draft, language: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="block">
                代码内容
                <textarea
                  required
                  rows={10}
                  value={draft.codeText}
                  onChange={(event) =>
                    setDraft({ ...draft, codeText: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono"
                />
              </label>
              <label className="block">
                提交说明（可选）
                <textarea
                  rows={5}
                  value={draft.submissionNote}
                  onChange={(event) =>
                    setDraft({ ...draft, submissionNote: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
              <p className="text-xs text-zinc-500">
                说明 {countCodePoints(draft.submissionNote)} / 20,000 个 Unicode
                码点；代码与说明按原文保存。
              </p>
              {changed ? (
                <p role="status" className="text-amber-800">
                  作品已有新版。当前输入仍基于开始编辑时的作品，草稿没有被刷新覆盖；请核对后明确继续。
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={
                    blocked ||
                    changed ||
                    !canEditSubmission(current) ||
                    refreshing
                  }
                  className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:bg-zinc-400"
                >
                  {busy ? "保存中…" : "保存本次修改"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setMessage(null);
                    setChecked(null);
                  }}
                  className="text-zinc-700 underline"
                >
                  取消修改
                </button>
                <button
                  type="button"
                  onClick={() => void checkCurrent()}
                  className="text-blue-700 underline"
                >
                  读取最新作品并核对
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {message ? (
          <p role="status" className="whitespace-pre-wrap break-words">
            {message}
          </p>
        ) : null}
        {draft &&
        checked &&
        canEditSubmission(checked) &&
        isValidContentRevision(checked.contentRevision) ? (
          <button
            type="button"
            disabled={
              busy ||
              refreshing ||
              checked.contentRevision !== current.contentRevision
            }
            onClick={() => {
              if (!isValidContentRevision(checked.contentRevision)) return;
              setDraft({ ...draft, baseRevision: checked.contentRevision });
              setBlocked(false);
              setChecked(null);
              setMessage(
                "已确认当前作品，保留草稿可继续修改；保存仍以服务端当前状态为准。",
              );
            }}
            className="text-blue-700 underline"
          >
            已核对最新作品，保留草稿继续编辑
          </button>
        ) : null}
        {current.lastEditedAt ? (
          <p>
            最近修改：{toDisplayDate(current.lastEditedAt)}（
            {current.lastEditIsLate === true
              ? "本次修改已超过截止时间"
              : current.lastEditIsLate === false
                ? "本次修改未超时"
                : "修改迟交信息未知"}
            ）
          </p>
        ) : null}
      </section>
      <SubmissionContent detail={current} />
      <SubmissionAiReview
        submissionId={submissionId}
        contentRevision={current.contentRevision}
        status={current.aiFeedbackStatus}
        review={current.aiReview}
        autoRefresh={true}
      />
    </>
  );
}
