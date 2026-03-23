"use client";

import { useState } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";

type ChangePasswordErrorState = {
  status?: number;
  description: string;
};

const getChangePasswordErrorSummary = (status: number): string => {
  if (status === 400) {
    return "新密码不符合要求，请检查后重试。";
  }
  if (status === 401) {
    return "当前密码错误，或登录状态已失效。";
  }
  if (status === 403) {
    return "无权限执行该操作。";
  }
  if (status === 404) {
    return "功能未启用、不可用或资源不存在。";
  }
  if (status >= 500) {
    return "修改密码失败，请稍后重试。";
  }
  return "修改密码失败，请稍后重试。";
};

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<ChangePasswordErrorState | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setErrorState({ description: "请填写当前密码、新密码和确认新密码。" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorState({ description: "新密码与确认新密码不一致。" });
      return;
    }
    if (newPassword === currentPassword) {
      setErrorState({ description: "新密码不能与当前密码相同。" });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    try {
      await fetchJson<{ ok?: boolean }>("users/me/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      setSuccessMessage("密码已修改成功。当前登录状态已保留，其他历史会话已失效。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summary = getChangePasswordErrorSummary(error.status);
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          description: buildErrorDescription(summary, detail),
        });
      } else {
        setErrorState({
          description: "修改密码失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">修改密码</h2>
      <p className="mt-1 text-sm text-zinc-600">修改后当前会话保留，其他历史会话将自动失效。</p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:max-w-xl">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">当前密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">确认新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {isSubmitting ? "提交中..." : "确认修改密码"}
          </button>
        </div>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="修改密码失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
