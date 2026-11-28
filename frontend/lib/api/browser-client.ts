import {
  PAGE_ACCOUNT_HEADER,
  PAGE_ACCOUNT_MISMATCH_CODE,
  PAGE_ACCOUNT_MISMATCH_MESSAGE,
  PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE,
  PAGE_ACCOUNT_UNAVAILABLE_MESSAGE,
  readPageAccountId,
  requiresPageAccount,
} from "./page-account";

const PROXY_PREFIX = "/api/proxy";

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

const parseResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }

  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
};

export class BrowserFetchJsonError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    message?: string
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "BrowserFetchJsonError";
  }
}

export function isDefiniteCreateRejection(
  error: unknown,
): error is BrowserFetchJsonError {
  return (
    error instanceof BrowserFetchJsonError &&
    !isPageAccountMismatch(error) &&
    error.status >= 400 &&
    error.status < 500
  );
}

export function isPageAccountMismatch(error: unknown): boolean {
  return (
    error instanceof BrowserFetchJsonError &&
    error.status === 409 &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === PAGE_ACCOUNT_MISMATCH_CODE
  );
}

export type PageFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export type PageAccountScope = {
  expectedUserId: string;
  capture: () => () => boolean;
  canWrite: () => boolean;
  onMismatch: () => void;
  onUnconfirmedSuccess: () => void;
};

export const buildProxyPath = (path: string): string => {
  const cleanPath = trimSlashes(path);
  return `${PROXY_PREFIX}/${cleanPath}`;
};

async function readCurrentPageAccount(): Promise<string | null> {
  try {
    const response = await fetch(buildProxyPath("users/me"), {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const me: unknown = await response.json();
    return typeof me === "object" && me !== null && "id" in me
      ? readPageAccountId(me.id)
      : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  scope?: PageAccountScope,
  pageUserId: unknown = scope?.expectedUserId,
): Promise<T> {
  const { cache, headers: suppliedHeaders, ...requestInit } = options;
  const headers = new Headers(suppliedHeaders);
  headers.delete(PAGE_ACCOUNT_HEADER);
  const needsPageAccount = requiresPageAccount(path, requestInit.method);
  const expectedUserId = needsPageAccount
    ? readPageAccountId(pageUserId)
    : null;
  if (needsPageAccount && !expectedUserId) {
    throw new Error(PAGE_ACCOUNT_UNAVAILABLE_MESSAGE);
  }
  if (expectedUserId) {
    if (scope && !scope.canWrite()) {
      throw new Error(PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE);
    }
    headers.set(PAGE_ACCOUNT_HEADER, expectedUserId);
  }

  const isCurrent = scope?.capture() ?? (() => true);
  if (!isCurrent()) throw new Error(PAGE_ACCOUNT_MISMATCH_MESSAGE);
  let body: unknown;
  try {
    const response = await fetch(buildProxyPath(path), {
      ...requestInit,
      headers,
      cache: cache ?? "no-store",
      credentials: "include",
    });
    body = await parseResponseBody(response);
    if (!response.ok) {
      throw new BrowserFetchJsonError(response.status, body);
    }
  } catch (error) {
    if (!isCurrent()) {
      throw new Error(PAGE_ACCOUNT_MISMATCH_MESSAGE, { cause: error });
    }
    if (isPageAccountMismatch(error)) scope?.onMismatch();
    throw error;
  }
  if (!isCurrent()) throw new Error(PAGE_ACCOUNT_MISMATCH_MESSAGE);
  if (expectedUserId && scope) {
    // The completed write was admitted with its own session. Before letting
    // its reply drive navigation, check whether the browser still uses it.
    const currentUserId = await readCurrentPageAccount();
    if (!isCurrent()) throw new Error(PAGE_ACCOUNT_MISMATCH_MESSAGE);
    if (!currentUserId) {
      scope.onUnconfirmedSuccess();
      throw new Error(PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE);
    }
    if (currentUserId !== expectedUserId) {
      scope.onMismatch();
      throw new BrowserFetchJsonError(
        409,
        { code: PAGE_ACCOUNT_MISMATCH_CODE },
        PAGE_ACCOUNT_MISMATCH_MESSAGE,
      );
    }
    if (!scope.canWrite()) {
      throw new Error(PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE);
    }
  }
  return body as T;
}

export function createPageFetch(scope?: PageAccountScope): PageFetch {
  return <T>(path: string, options?: RequestInit) =>
    requestJson<T>(path, options, scope);
}

export const fetchJson = createPageFetch();

export function logoutFromPage(pageUserId: unknown): Promise<{ ok: true }> {
  // A successful logout has revoked its own session and cannot confirm it.
  return requestJson(
    "auth/logout",
    { method: "POST", headers: { accept: "application/json" } },
    undefined,
    pageUserId,
  );
}
