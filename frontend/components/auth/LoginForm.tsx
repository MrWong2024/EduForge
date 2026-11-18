"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { SubmitEventHandler } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson } from "@/lib/api/browser-client";
import { getAuthError, type AuthError } from "@/lib/auth/auth-errors";
import { PASSWORD_RULES, validatePassword } from "@/lib/auth/password-policy";
import { getRoleHomePath, type RoleAwareMe } from "@/lib/auth/role-home";
import { getSafeNextPath } from "@/lib/auth/safe-next";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<AuthError | null>(null);
  const [noRole, setNoRole] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const validation = validatePassword(password, "login");
    if (validation.error) {
      setLoginError({ summary: validation.error });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setLoginError(null);
    setNoRole(false);

    let loginSucceeded = false;
    let navigating = false;
    try {
      await fetchJson<unknown>("auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      loginSucceeded = true;
      setPassword("");
      const me = await fetchJson<RoleAwareMe>("users/me", {
        method: "GET",
        cache: "no-store",
      });

      const nextPath = getSafeNextPath(searchParams.get("next"));
      if (nextPath) {
        router.push(nextPath);
        navigating = true;
        router.refresh();
        return;
      }

      const roleHomePath = getRoleHomePath(me);
      if (roleHomePath) {
        router.push(roleHomePath);
        navigating = true;
        router.refresh();
        return;
      }

      setNoRole(true);
    } catch (error) {
      setLoginError(getAuthError(error, loginSucceeded ? "login-probe" : "login"));
    } finally {
      if (!navigating) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-800" htmlFor="login-email">
            邮箱
          </label>
          <input
            id="login-email"
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

        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-800" htmlFor="login-password">
            密码
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            disabled={isSubmitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="••••••••"
          />
          <p className="text-xs text-zinc-500">{PASSWORD_RULES.login}</p>
        </div>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            忘记密码？
          </Link>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {isSubmitting ? "登录中..." : "登录"}
        </button>
      </form>

      {noRole ? (
        <div className="mt-4">
          <ErrorState
            status={403}
            title="403 无可用角色"
            description="当前账号未配置 TEACHER 或 STUDENT 角色，请联系管理员。"
          />
        </div>
      ) : null}

      {loginError ? (
        <div className="mt-4">
          <ErrorState
            status={loginError.status}
            title="登录提示"
            description={loginError.summary}
          />
          {loginError.recovery === "check-login" ? (
            <div className="mt-3 flex gap-4 text-sm">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900"
              >
                刷新核对登录状态
              </button>
              <Link href="/login" className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
                返回登录入口
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
