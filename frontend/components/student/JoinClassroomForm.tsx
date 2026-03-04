"use client";

import { useState } from "react";
import type { SubmitEventHandler } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { paths } from "@/lib/routes/paths";

type JoinErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const extractRawDetail = (data: unknown): string | undefined => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const message =
    "message" in data && typeof (data as { message?: unknown }).message === "string"
      ? String((data as { message: string }).message)
      : "";
  const code =
    "code" in data && typeof (data as { code?: unknown }).code === "string"
      ? String((data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

export function JoinClassroomForm() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<JoinErrorState | null>(null);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const normalizedJoinCode = joinCode.trim();
    if (!normalizedJoinCode) {
      setErrorState({
        summary: "请输入班级加入码后再提交。",
      });
      return;
    }

    setIsSubmitting(true);
    setErrorState(null);

    try {
      await fetchJson<unknown>("classrooms/join", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ joinCode: normalizedJoinCode }),
      });

      router.push(paths.student.dashboard);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summaryByStatus: Record<number, string> = {
          401: "登录状态已失效，请重新登录。",
          400: "加入码无效或班级不存在，请检查后重试。",
          403: "当前账号无权限加入该班级。",
          404: "加入码无效或班级不存在，请检查后重试。",
        };
        const summary = summaryByStatus[error.status] ?? "加入班级失败，请稍后重试。";
        setErrorState({
          status: error.status,
          summary,
          detail,
        });
      } else {
        setErrorState({
          summary: "加入班级请求失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
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
            onChange={(event) => setJoinCode(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm uppercase outline-none focus:border-zinc-500"
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
