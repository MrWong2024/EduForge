"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";

type ResetPasswordFormProps = {
  token: string | null;
};

const SUCCESS_MESSAGE = "密码已重置，请使用新密码登录。";
const RESET_TOKEN_ERROR = "重置链接无效或已过期，请重新申请密码重置。";

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    token ? null : RESET_TOKEN_ERROR
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      setErrorMessage(RESET_TOKEN_ERROR);
      return;
    }

    const trimmedPassword = newPassword.trim();
    if (!trimmedPassword) {
      setErrorMessage("请输入新密码。");
      setSuccessMessage(null);
      return;
    }

    if (trimmedPassword.length < 8) {
      setErrorMessage("新密码至少需要 8 位。");
      setSuccessMessage(null);
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setErrorMessage("两次输入的密码不一致。");
      setSuccessMessage(null);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson<unknown>("auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          token,
          newPassword: trimmedPassword,
        }),
      });

      setSuccessMessage(SUCCESS_MESSAGE);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        setErrorMessage(error.status === 400 ? RESET_TOKEN_ERROR : "请求失败，请稍后重试。");
      } else {
        setErrorMessage("请求失败，请稍后重试。");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <ErrorState title="链接无效" description={RESET_TOKEN_ERROR} />
        <div className="mt-4">
          <Link
            href="/forgot-password"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            重新申请密码重置
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label
            className="block text-sm font-medium text-zinc-800"
            htmlFor="reset-password-new"
          >
            新密码
          </label>
          <input
            id="reset-password-new"
            type="password"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="不少于 8 位"
          />
        </div>

        <div className="space-y-1">
          <label
            className="block text-sm font-medium text-zinc-800"
            htmlFor="reset-password-confirm"
          >
            确认新密码
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="再次输入新密码"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || Boolean(successMessage)}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting ? "提交中..." : "重置密码"}
        </button>
      </form>

      {successMessage ? (
        <section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">重置成功</p>
          <p className="mt-1">{successMessage}</p>
          <div className="mt-3">
            <Link
              href="/login"
              className="text-sm font-medium text-emerald-900 underline underline-offset-4"
            >
              返回登录
            </Link>
          </div>
        </section>
      ) : null}

      {errorMessage ? (
        <div className="mt-4">
          <ErrorState title="重置失败" description={errorMessage} />
        </div>
      ) : null}

      {!successMessage ? (
        <div className="mt-4 flex gap-4">
          <Link
            href="/forgot-password"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            重新申请密码重置
          </Link>
          <Link
            href="/login"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            返回登录
          </Link>
        </div>
      ) : null}
    </section>
  );
}
