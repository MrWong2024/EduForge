import { redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/blocks/ErrorState";
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
    <section className="relative mx-auto flex min-h-dvh w-full max-w-3xl items-center px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_50%)]" />
      <div className="w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-100 px-6 py-4 text-center md:px-8 md:py-5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            重庆邮电大学智能化教学平台
          </h1>
          <p className="mx-auto mt-1 max-w-xl text-sm leading-5 text-zinc-600">
            面向教师与学生的统一教学入口，支持课堂任务、AI 反馈与过程性评价。
          </p>
        </header>

        <div className="px-6 py-3 md:px-8 md:py-4">
          <div className="mx-auto w-full max-w-lg">{children}</div>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-4">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
    </header>
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
        <SectionHeading
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
        <SectionHeading
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
      <SectionHeading title="欢迎登录" />
      <LoginForm />
    </LoginFrame>
  );
}

