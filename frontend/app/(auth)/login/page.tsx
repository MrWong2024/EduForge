import { redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { LoginForm } from "@/components/auth/LoginForm";
import { FetchJsonError } from "@/lib/api/client";
import { getRoleHomePath, getMe } from "@/lib/auth/session";

const isDev = process.env.NODE_ENV !== "production";

type LoginPageViewModel =
  | { mode: "form" }
  | { mode: "forbidden" }
  | { mode: "probe-error"; status: number; description: string };

const extractRawDetail = (error: unknown): string | undefined => {
  if (!(error instanceof FetchJsonError)) {
    return undefined;
  }

  const data = error.data;
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const message =
    "message" in data &&
    typeof (data as { message?: unknown }).message === "string"
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

  try {
    const raw = JSON.stringify(data);
    return raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
  } catch {
    return undefined;
  }
};

function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <section className="relative mx-auto w-full max-w-4xl px-4 py-10 md:py-14">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_50%)]" />
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-100 px-6 py-8 text-center md:px-10">
          <p className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
            EduForge · 教学应用版
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            重庆邮电大学智能化教学平台
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            面向教师与学生的统一教学入口，支持课堂任务、AI 反馈与过程性评价。
          </p>
        </header>

        <div className="px-6 py-6 md:px-10 md:py-8">{children}</div>

        <footer className="border-t border-zinc-100 px-6 py-4 text-center text-xs leading-5 text-zinc-500 md:px-10">
          教师与学生使用统一账号登录，系统将按角色自动进入对应工作区。
        </footer>
      </div>
    </section>
  );
}

export default async function LoginPage() {
  let viewModel: LoginPageViewModel = { mode: "form" };

  try {
    const me = await getMe();
    const roleHomePath = getRoleHomePath(me);

    if (roleHomePath) {
      redirect(roleHomePath);
    }

    viewModel = { mode: "forbidden" };
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof FetchJsonError) {
      if (error.status !== 401) {
        const detail = extractRawDetail(error);
        viewModel = {
          mode: "probe-error",
          status: error.status,
          description: isDev && detail
            ? `登录状态探针失败。Detail: ${detail}`
            : "登录状态探针失败，请稍后重试。",
        };
      }
    } else {
      const detail =
        error instanceof Error && error.message ? error.message : "";

      viewModel = {
        mode: "probe-error",
        status: 500,
        description: isDev && detail
          ? `登录状态探针失败。Detail: ${detail}`
          : "登录状态探针失败，请稍后重试。",
      };
    }
  }

  if (viewModel.mode === "forbidden") {
    return (
      <LoginFrame>
        <PageHeader
          title="登录入口"
          description="当前账号已登录，但未分配可用角色。"
        />
        <ErrorState
          status={403}
          title="403 无可用角色"
          description="当前账号未配置 TEACHER 或 STUDENT 角色，请联系管理员。"
        />
      </LoginFrame>
    );
  }

  if (viewModel.mode === "probe-error") {
    return (
      <LoginFrame>
        <PageHeader
          title="登录入口"
          description="系统正在检查登录状态，请稍后重试。"
        />
        <ErrorState
          status={viewModel.status}
          title="登录状态检查失败"
          description={viewModel.description}
        />
      </LoginFrame>
    );
  }

  return (
    <LoginFrame>
      <PageHeader title="欢迎登录" description="请输入账号与密码，进入教学工作区。" />
      <LoginForm />
    </LoginFrame>
  );
}
