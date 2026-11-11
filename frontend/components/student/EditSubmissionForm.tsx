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
import { SUBMISSION_LANGUAGE_OPTIONS } from "@/lib/learning-tasks/submission-language";
import { getTaskSnapshotErrorMessage } from "@/lib/learning-tasks/ai-review";
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
  const recovering = blocked || changed;
  const canConfirmCurrent =
    recovering &&
    draft !== null &&
    checked !== null &&
    canEditSubmission(checked) &&
    canEditSubmission(current) &&
    isValidContentRevision(checked.contentRevision) &&
    isValidContentRevision(current.contentRevision) &&
    checked.contentRevision === current.contentRevision;
  const path = `learning-tasks/submissions/${encodeURIComponent(submissionId)}`;

  const startEdit = () => {
    if (
      blocked ||
      busy ||
      refreshing ||
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
    if (!recovering || busy || refreshing || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setBlocked(true);
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
        draft
          ? "已读取最新已保存作品。下方展示已保存作品，上方未保存的修改仍保留，尚未保存。请核对后再决定是否继续修改。"
          : "已读取最新已保存作品，下方展示当前已保存作品；修改资格与可用操作以当前页面为准。",
      );
      startTransition(() => router.refresh());
    } catch {
      setChecked(null);
      setMessage(
        draft
          ? "最新已保存作品读取未完成，未保存的修改仍保留。请重试“查看最新已保存作品”，暂不能继续保存。"
          : "最新已保存作品读取未完成，请重试“查看最新已保存作品”，暂不能开始修改。",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const confirmCurrent = () => {
    if (
      !recovering ||
      !draft ||
      !checked ||
      !canEditSubmission(checked) ||
      !canEditSubmission(current) ||
      !isValidContentRevision(checked.contentRevision) ||
      !isValidContentRevision(current.contentRevision) ||
      checked.contentRevision !== current.contentRevision ||
      busy ||
      refreshing ||
      inFlight.current
    )
      return;
    setDraft({ ...draft, baseRevision: checked.contentRevision });
    setBlocked(false);
    setChecked(null);
    setMessage(
      "已核对已保存作品，未保存的修改仍保留。请继续修改，完成后再点击“保存本次修改”。",
    );
  };
  const cancelEdit = () => {
    if (busy || refreshing || inFlight.current) return;
    if (changed) setBlocked(true);
    setDraft(null);
    setMessage(null);
    setChecked(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !draft ||
      busy ||
      refreshing ||
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
          "保存响应不完整，结果待核对。未保存的修改已保留，请先查看最新已保存作品，避免重复保存。",
        );
        return;
      }
      setSaved(result);
      setDraft(null);
      setMessage("本次提交已修改；提交编号和尝试次数保持不变。");
      startTransition(() => router.refresh());
    } catch (error) {
      if (error instanceof BrowserFetchJsonError && error.status < 500) {
        const snapshotMessage = error.status === 403
          ? getTaskSnapshotErrorMessage(error.status, error.data)
          : undefined;
        setBlocked(error.status === 409 || error.status === 403);
        setMessage(
          snapshotMessage
            ? snapshotMessage + "未保存的修改已保留。"
            : error.status === 409
              ? getSubmissionRevisionError(error.data)
              : error.status === 403
                ? "当前无修改资格或已超过截止时间。未保存的修改已保留，请查看最新已保存作品。"
                : "修改未保存，请检查内容并核对当前详情。未保存的修改已保留。",
        );
      } else {
        setBlocked(true);
        setMessage(
          "网络中断、超时或服务异常，保存结果待核对。未保存的修改已保留，请先查看最新已保存作品，避免重复保存。",
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
        ) : (
          <form onSubmit={save} className="space-y-3">
            <fieldset
              disabled={busy || refreshing}
              className="min-w-0 space-y-3"
            >
              <label className="block">
                编程语言
                <select
                  required
                  disabled={!canEditSubmission(current)}
                  value={draft.language}
                  onChange={(event) =>
                    setDraft({ ...draft, language: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
                >
                  {SUBMISSION_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {!SUBMISSION_LANGUAGE_OPTIONS.some(
                    (option) => option.value === draft.language,
                  ) ? (
                    <option value={draft.language}>
                      当前值：{draft.language}
                    </option>
                  ) : null}
                </select>
              </label>
              <label className="block">
                代码内容
                <textarea
                  required
                  readOnly={!canEditSubmission(current)}
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
                  readOnly={!canEditSubmission(current)}
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
              <div className="flex flex-wrap gap-3">
                {canEditSubmission(current) ? (
                  <button
                    type="submit"
                    disabled={recovering || busy || refreshing}
                    className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:bg-zinc-400"
                  >
                    {busy ? "保存中…" : "保存本次修改"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="text-zinc-700 underline"
                >
                  取消修改
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {!canEditSubmission(current) ? (
          <p className="whitespace-pre-wrap break-words">
            {current.editing.message ??
              "当前修改资格不可用，请核对已保存作品或联系任课教师。"}
            {draft ? "当前输入仍保留，可复制或取消修改。" : ""}
          </p>
        ) : null}
        {recovering ? (
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <h3 className="font-medium text-amber-900">先核对已保存作品</h3>
            <p className="text-amber-900">
              {!isValidContentRevision(current.contentRevision)
                ? "当前已保存作品的版本信息不可用，请先查看最新已保存作品再核对。"
                : changed
                  ? "已保存作品的版本已变化。当前输入仍基于开始修改时的版本，未保存的修改已保留；请核对后明确继续。"
                  : draft
                    ? "当前修改需要先核对最新已保存作品，确认当前版本与修改资格后再继续。"
                    : "请先查看最新已保存作品，核对当前版本与修改资格后再开始修改。"}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || refreshing}
                onClick={() => void checkCurrent()}
                className="text-blue-700 underline disabled:text-zinc-500"
              >
                查看最新已保存作品
              </button>
              {canConfirmCurrent ? (
                <button
                  type="button"
                  disabled={busy || refreshing}
                  onClick={confirmCurrent}
                  className="text-blue-700 underline disabled:text-zinc-500"
                >
                  已核对，继续修改
                </button>
              ) : null}
            </div>
            {draft &&
            checked &&
            (!isValidContentRevision(current.contentRevision) ||
              checked.contentRevision !== current.contentRevision) ? (
              <p className="text-amber-900">
                已核对的版本已不是当前版本，或当前版本信息不可用；请重新查看最新已保存作品。
              </p>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <p role="status" className="whitespace-pre-wrap break-words">
            {message}
          </p>
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
