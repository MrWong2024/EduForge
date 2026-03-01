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

type BrowserFetchJsonOptions = RequestInit;

export const buildProxyPath = (path: string): string => {
  const cleanPath = trimSlashes(path);
  return `${PROXY_PREFIX}/${cleanPath}`;
};

export async function fetchJson<T>(
  path: string,
  options: BrowserFetchJsonOptions = {}
): Promise<T> {
  const { cache, ...requestInit } = options;
  const response = await fetch(buildProxyPath(path), {
    ...requestInit,
    cache: cache ?? "no-store",
    credentials: "include",
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new BrowserFetchJsonError(response.status, body);
  }

  return body as T;
}
