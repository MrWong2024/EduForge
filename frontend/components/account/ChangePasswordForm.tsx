"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { usePageFetch } from "@/lib/api/use-page-fetch";
import { getAuthError, type AuthError } from "@/lib/auth/auth-errors";
import {
  PASSWORD_RULES,
  validateNewPassword,
  validatePassword,
} from "@/lib/auth/password-policy";

export function ChangePasswordForm() {
  const fetchJson = usePageFetch();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<AuthError | null>(null);
  const submittingRef = useRef(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    setSuccessMessage(null);
    const currentValidation = validatePassword(currentPassword, "current");
    if (currentValidation.error) {
      setErrorState({ summary: currentValidation.error });
      return;
    }
    const newValidation = validateNewPassword(newPassword, confirmPassword, currentPassword);
    if (newValidation.error) {
      setErrorState({ summary: newValidation.error });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
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
          newPassword: newValidation.value,
        }),
      });

      setSuccessMessage("密码已修改成功。当前登录状态已保留，其他历史会话已失效。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setErrorState(getAuthError(error, "change"));
    } finally {
      submittingRef.current = false;
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
            disabled={isSubmitting}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-zinc-500">{PASSWORD_RULES.current}</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            disabled={isSubmitting}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-zinc-500">{PASSWORD_RULES.new}</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">确认新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            disabled={isSubmitting}
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
          <ErrorState status={errorState.status} title="修改密码提示" description={errorState.summary} />
          {errorState.recovery ? (
            <div className="mt-3 text-sm">
              <p className="mb-2 text-zinc-600">
                如仍处于登录状态，请先通过顶部“退出登录”，再重新登录核实；改密结果不确定时可尝试新密码。
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/login" className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
                  重新登录核实
                </Link>
                {errorState.recovery === "reset" ? (
                  <Link href="/forgot-password" className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
                    申请密码重置
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
