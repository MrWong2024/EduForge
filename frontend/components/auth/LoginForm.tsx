"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubmitEventHandler } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, BrowserFetchJsonError } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getRoleHomePath, type RoleAwareMe } from "@/lib/auth/role-home";
import { getCommonErrorSummary } from "@/lib/ui/status";

type LoginErrorState = {
  status?: number;
  summary: string;
  detail?: string;
};

const getSafeNextPath = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<LoginErrorState | null>(null);
  const [noRole, setNoRole] = useState(false);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setLoginError(null);
    setNoRole(false);

    try {
      await fetchJson<unknown>("auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const me = await fetchJson<RoleAwareMe>("users/me", {
        method: "GET",
        cache: "no-store",
      });

      const nextPath = getSafeNextPath(searchParams.get("next"));
      if (nextPath) {
        router.push(nextPath);
        router.refresh();
        return;
      }

      const roleHomePath = getRoleHomePath(me);
      if (roleHomePath) {
        router.push(roleHomePath);
        router.refresh();
        return;
      }

      setNoRole(true);
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        if (error.status === 401) {
          setLoginError({
            status: 401,
            summary: "登录失败，请检查账号或密码。",
          });
          return;
        }

        setLoginError({
          status: error.status,
          summary: getCommonErrorSummary(error.status, "登录"),
          detail: extractRawDetail(error.data),
        });
        return;
      }

      setLoginError({
        summary: "登录请求失败，请稍后重试。",
      });
    } finally {
      setIsSubmitting(false);
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            placeholder="••••••••"
          />
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
            title={loginError.status === 401 ? "登录失败" : undefined}
            description={buildErrorDescription(loginError.summary, loginError.detail)}
          />
        </div>
      ) : null}
    </section>
  );
}
