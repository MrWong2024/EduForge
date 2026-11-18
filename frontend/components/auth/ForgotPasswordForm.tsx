"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { fetchJson } from "@/lib/api/browser-client";
import { getAuthError } from "@/lib/auth/auth-errors";
import { ErrorState } from "@/components/blocks/ErrorState";

const RESEND_COOLDOWN_SECONDS = 60;
const SUCCESS_MESSAGE = "请求已提交。如果邮箱存在且符合条件，将发送密码重置邮件，请稍后检查邮箱。";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || Date.now() < cooldownUntilRef.current) {
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("请输入登录邮箱。");
      setResultMessage(null);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    setResultMessage(null);

    try {
      await fetchJson<unknown>("auth/forgot-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      setResultMessage(SUCCESS_MESSAGE);
      cooldownUntilRef.current = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setErrorMessage(getAuthError(error, "forgot").summary);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label
            className="block text-sm font-medium text-zinc-800"
            htmlFor="forgot-password-email"
          >
            邮箱
          </label>
          <input
            id="forgot-password-email"
            type="email"
            required
            autoComplete="email"
            disabled={isSubmitting}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="you@example.com"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || cooldownSeconds > 0}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting
            ? "发送中..."
            : cooldownSeconds > 0
              ? `${cooldownSeconds} 秒后可再次发送`
              : "发送重置邮件"}
        </button>
      </form>

      {resultMessage ? (
        <section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">已提交请求</p>
          <p className="mt-1">{resultMessage}</p>
        </section>
      ) : null}

      {errorMessage ? (
        <div className="mt-4">
          <ErrorState title="请求提示" description={errorMessage} />
        </div>
      ) : null}

      <div className="mt-4">
        <Link
          href="/login"
          className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
        >
          返回登录
        </Link>
      </div>
    </section>
  );
}
