export const runtime = "nodejs";

import { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

type ProxyErrorType = "NETWORK_ERROR" | "CONFIG_ERROR";

const REQUEST_HEADER_ALLOWLIST = new Set([
  "cookie",
  "content-type",
  "accept",
  "user-agent",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-disposition",
  "cache-control",
  "location",
]);

const trimTrailingSlash = (value: string) => value.replace(/\/+$/g, "");
const normalizePath = (path: string) => path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");

const getBackendOrigin = (): string => {
  const configuredOrigin = process.env.FRONTEND_BACKEND_ORIGIN ?? "";
  const normalizedOrigin = trimTrailingSlash(configuredOrigin);
  if (!normalizedOrigin) {
    throw new Error("CONFIG_ERROR");
  }
  return normalizedOrigin;
};

const buildUpstreamHeaders = (request: NextRequest): Headers => {
  const proxyHeaders = new Headers();

  for (const [key, value] of request.headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      continue;
    }
    if (!REQUEST_HEADER_ALLOWLIST.has(normalizedKey)) {
      continue;
    }
    proxyHeaders.set(normalizedKey, value);
  }

  return proxyHeaders;
};

const buildResponseHeaders = (upstream: Response): Headers => {
  const responseHeaders = new Headers();

  for (const [key, value] of upstream.headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(normalizedKey)) {
      responseHeaders.set(normalizedKey, value);
    }
  }

  const setCookieAccessor = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = setCookieAccessor.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      responseHeaders.append("set-cookie", cookie);
    }
  } else {
    const singleSetCookie = upstream.headers.get("set-cookie");
    if (singleSetCookie) {
      responseHeaders.set("set-cookie", singleSetCookie);
    }
  }

  return responseHeaders;
};

const forward = async (request: NextRequest, context: RouteContext): Promise<Response> => {
  const { path } = await context.params;
  const targetPath = normalizePath(path.join("/"));

  try {
    const backendOrigin = getBackendOrigin();
    const targetUrl = `${backendOrigin}/api/${targetPath}${request.nextUrl.search}`;
    const headers = buildUpstreamHeaders(request);

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const rawBody = hasBody ? await request.arrayBuffer() : undefined;
    const body = rawBody && rawBody.byteLength > 0 ? rawBody : undefined;

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: buildResponseHeaders(upstream),
    });
  } catch (error) {
    const errorType: ProxyErrorType =
      error instanceof Error && error.message === "CONFIG_ERROR" ? "CONFIG_ERROR" : "NETWORK_ERROR";

    return Response.json(
      {
        method: request.method,
        path: targetPath,
        type: errorType,
      },
      { status: 502 }
    );
  }
};

export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return forward(request, context);
}
