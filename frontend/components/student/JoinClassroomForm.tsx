"use client";

import { useRef, useState } from "react";
import type { SubmitEventHandler } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { paths } from "@/lib/routes/paths";
import { useCurrentPage } from "@/lib/routes/use-current-page";
import { safeGet } from "@/lib/ui/format";
import { getCommonErrorSummary } from "@/lib/ui/status";

type JoinErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const JOIN_REQUEST_FAILURE = "加入班级请求失败，请稍后重试。";

export const normalizeJoinCodeInput = (value: string): string =>
  value.replace(/[a-z]/g, (letter) => letter.toUpperCase());

export async function submitJoinClassroom(
  joinCode: string,
  request: (path: string, init: RequestInit) => Promise<unknown> = fetchJson,
): Promise<JoinErrorState | null> {
  const normalizedJoinCode = joinCode.trim();
  if (!normalizedJoinCode) {
    return { summary: "请输入班级加入码后再提交。" };
  }

  try {
    await request("classrooms/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ joinCode: normalizedJoinCode }),
    });
    return null;
  } catch (error) {
    if (!(error instanceof BrowserFetchJsonError)) {
      return { summary: JOIN_REQUEST_FAILURE };
    }

    const summaryByStatus: Partial<Record<number, string>> = {
      400: "加入码无效或班级不存在，请检查后重试。",
      403: "当前账号无权限加入该班级。",
      404: "加入码无效或班级不存在，请检查后重试。",
    };
    const archived =
      error.status === 400 &&
      safeGet<unknown>(error.data, "message", undefined) === "Classroom is archived";
    return {
      status: error.status,
      summary: archived
        ? "该班级已归档，暂时无法加入。请联系任课教师确认。"
        : summaryByStatus[error.status] ?? getCommonErrorSummary(error.status, "加入班级"),
      detail: extractRawDetail(error.data),
    };
  }
}

export function JoinClassroomForm() {
  const router = useRouter();
  const captureCurrentPage = useCurrentPage();
  const [joinCode, setJoinCode] = useState("");
  const submitLocked = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<JoinErrorState | null>(null);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (submitLocked.current) {
      return;
    }

    const isOriginalPage = captureCurrentPage();
    submitLocked.current = true;
    setIsSubmitting(true);
    setErrorState(null);

    const failure = await submitJoinClassroom(joinCode);
    if (failure) {
      setErrorState(failure);
      submitLocked.current = false;
      setIsSubmitting(false);
      return;
    }

    if (isOriginalPage()) {
      router.push(paths.student.dashboard);
      router.refresh();
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-800" htmlFor="join-code-input">
            班级加入码
          </label>
          <input
            id="join-code-input"
            type="text"
            required
            value={joinCode}
            disabled={isSubmitting}
            onChange={(event) => setJoinCode(normalizeJoinCodeInput(event.target.value))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="例如：ABCD12"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting ? "加入中..." : "加入班级"}
        </button>
      </form>

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="加入班级失败"
            description={buildErrorDescription(errorState.summary, errorState.detail)}
          />
        </div>
      ) : null}
    </section>
  );
}
