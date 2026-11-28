export const PAGE_ACCOUNT_HEADER = "x-expected-user-id";
export const PAGE_ACCOUNT_MISMATCH_CODE = "PAGE_ACCOUNT_MISMATCH";
export const PAGE_ACCOUNT_MISMATCH_MESSAGE =
  "当前登录账号与此页面不一致，请重新打开页面后再操作。";
export const PAGE_ACCOUNT_UNAVAILABLE_MESSAGE =
  "无法确认此页面的账号，请重新打开页面后再操作。";
export const PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE =
  "操作已收到成功回执，暂时无法确认当前账号，请先核对结果。";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SESSION_ENTRY_PATHS = new Set([
  "auth/login",
  "auth/forgot-password",
  "auth/reset-password",
]);

export function requiresPageAccount(path: string, method = "GET"): boolean {
  const route = path.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, "");
  return (
    WRITE_METHODS.has(method.toUpperCase()) &&
    !SESSION_ENTRY_PATHS.has(route)
  );
}

export function readPageAccountId(id: unknown): string | null {
  return typeof id === "string" && /^[\da-f]{24}$/i.test(id)
    ? id.toLowerCase()
    : null;
}
