type WithData = {
  data?: unknown;
};

const getPayload = (source: unknown): unknown => {
  if (source && typeof source === "object" && "data" in source) {
    return (source as WithData).data;
  }

  return source;
};

export const extractRawDetail = (source: unknown): string | undefined => {
  const payload = getPayload(source);

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const message =
    "message" in payload && typeof (payload as { message?: unknown }).message === "string"
      ? String((payload as { message: string }).message)
      : "";
  const code =
    "code" in payload && typeof (payload as { code?: unknown }).code === "string"
      ? String((payload as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

export const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

