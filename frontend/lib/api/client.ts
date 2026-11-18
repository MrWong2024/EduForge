import "server-only";

import { getFrontendOrigin } from "@/lib/http/frontend-origin";
import { getInboundCookieHeader } from "@/lib/http/server-cookie";

const PROXY_PREFIX = "/api/proxy";

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

const withServerCookie = async (headersInit?: HeadersInit): Promise<HeadersInit | undefined> => {
  const inboundCookie = await getInboundCookieHeader();
  if (!inboundCookie) {
    return headersInit;
  }

  const mergedHeaders = new Headers(headersInit);
  if (!mergedHeaders.has("cookie")) {
    mergedHeaders.set("cookie", inboundCookie);
  }

  return mergedHeaders;
};

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

export class FetchJsonError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    message?: string
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "FetchJsonError";
  }
}

type FetchJsonOptions = Omit<RequestInit, "redirect">;

export const buildProxyPath = (path: string): string => {
  const cleanPath = trimSlashes(path);
  return `${PROXY_PREFIX}/${cleanPath}`;
};

export async function fetchJson<T>(
  path: string,
  options: FetchJsonOptions = {}
): Promise<T> {
  const { cache, headers, ...requestInit } = options;
  const proxyPath = buildProxyPath(path);
  const requestUrl = `${getFrontendOrigin(process.env.FRONTEND_URL)}${proxyPath}`;
  const requestHeaders = await withServerCookie(headers);

  const response = await fetch(requestUrl, {
    ...requestInit,
    headers: requestHeaders,
    cache: cache ?? "no-store",
    credentials: "include",
    redirect: "manual",
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new FetchJsonError(response.status, body);
  }

  return body as T;
}
