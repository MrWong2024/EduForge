import { redirect, unstable_rethrow } from "next/navigation";
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
      <ErrorState
        status={403}
        title="403 无可用角色"
        description="当前账号未配置 TEACHER 或 STUDENT 角色，请联系管理员。"
      />
    );
  }

  if (viewModel.mode === "probe-error") {
    return (
      <ErrorState
        status={viewModel.status}
        title="登录状态检查失败"
        description={viewModel.description}
      />
    );
  }

  return (
    <section>
      <PageHeader title="登录" description="请输入账号与密码登录系统。" />
      <LoginForm />
    </section>
  );
}
