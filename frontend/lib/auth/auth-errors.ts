import { BrowserFetchJsonError } from "@/lib/api/browser-client";
import { PASSWORD_RULES } from "@/lib/auth/password-policy";

export type AuthOperation = "login" | "forgot" | "reset" | "change" | "login-probe";

export type AuthError = {
  status?: number;
  summary: string;
  recovery?: "check-login" | "login" | "reset";
};

export function getAuthError(error: unknown, operation: AuthOperation): AuthError {
  const status = error instanceof BrowserFetchJsonError ? error.status : undefined;

  if (operation === "login-probe") {
    return {
      status,
      summary: "登录请求已成功，但登录状态确认失败。请刷新核对登录状态，或返回登录入口核实。",
      recovery: "check-login",
    };
  }

  const data = error instanceof BrowserFetchJsonError ? error.data : null;
  const code =
    data && typeof data === "object" && !Array.isArray(data) && "code" in data
      ? data.code
      : undefined;

  if (status === 400) {
    if (code === "PASSWORD_POLICY_VIOLATION") {
      return {
        status,
        summary:
          operation === "login"
            ? PASSWORD_RULES.login
            : operation === "change"
              ? `${PASSWORD_RULES.current}${PASSWORD_RULES.new}`
              : PASSWORD_RULES.new,
      };
    }
    if (operation === "reset" && code === "RESET_TOKEN_INVALID") {
      return {
        status,
        summary: "重置链接无效或已过期，请重新申请密码重置。",
        recovery: "reset",
      };
    }
    return { status, summary: "输入有误，请检查填写内容后重新提交。" };
  }

  if (status === 401) {
    if (operation === "login") {
      return { status, summary: "登录失败，请检查账号或密码。" };
    }
    if (operation === "change") {
      return {
        status,
        summary: "当前密码可能不匹配，或会话、凭据已变化。请重新登录核实密码与登录状态。",
        recovery: "login",
      };
    }
    return { status, summary: "登录状态已失效，请重新登录核实。", recovery: "login" };
  }

  if (status === undefined || status >= 500) {
    if (operation === "reset" || operation === "change") {
      return {
        status,
        summary: "密码修改结果暂不能确认。可尝试使用新密码登录，必要时重新申请密码重置链接。",
        recovery: "reset",
      };
    }
    if (operation === "login") {
      return {
        status,
        summary: "登录结果暂不能确认。请刷新核对登录状态后，再决定是否重新登录。",
        recovery: "check-login",
      };
    }
    return { status, summary: "请求结果暂不能确认，请稍后检查邮箱或重新提交请求。" };
  }

  if (status === 403) {
    return { status, summary: "无权限执行该操作。" };
  }
  if (status === 404) {
    return { status, summary: "功能未启用、不可用或资源不存在。" };
  }
  return { status, summary: "请求未能完成，请检查后重新提交。" };
}
