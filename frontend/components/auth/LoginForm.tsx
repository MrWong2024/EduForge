"use client";

import { useState } from "react";
import type { SubmitEventHandler } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { getRoleHomePath, type RoleAwareMe } from "@/lib/auth/role-home";

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

  if (message) {
    return message;
  }

  if (code) {
    return code;
  }

  return undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

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
      if (error instanceof FetchJsonError) {
        if (error.status === 401) {
          setLoginError({
            status: 401,
            summary: "登录失败，请检查账号或密码。",
          });
          return;
        }

        setLoginError({
          status: error.status,
          summary: "登录失败，请稍后重试。",
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
