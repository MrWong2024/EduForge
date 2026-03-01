const PROXY_PREFIX = "/api/proxy";

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");
const trimTrailingSlash = (value: string) => value.replace(/\/+$/g, "");

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

type FetchJsonOptions = RequestInit & {
  origin?: string;
};

export const buildProxyPath = (path: string): string => {
  const cleanPath = trimSlashes(path);
  return `${PROXY_PREFIX}/${cleanPath}`;
};

export async function fetchJson<T>(
  path: string,
  options: FetchJsonOptions = {}
): Promise<T> {
  const { origin = "", cache, ...requestInit } = options;
  const cleanOrigin = origin ? trimTrailingSlash(origin) : "";
  const proxyPath = buildProxyPath(path);
  const requestUrl = cleanOrigin ? `${cleanOrigin}${proxyPath}` : proxyPath;

  const response = await fetch(requestUrl, {
    ...requestInit,
    cache: cache ?? "no-store",
    credentials: "include",
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new FetchJsonError(response.status, body);
  }

  return body as T;
}
