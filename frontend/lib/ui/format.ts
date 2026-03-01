type PathInput = string | readonly string[];

const toPathSegments = (path: PathInput): string[] =>
  typeof path === "string" ? path.split(".").filter(Boolean) : [...path];

export const safeGet = <T>(source: unknown, path: PathInput, fallback: T): T => {
  const segments = toPathSegments(path);
  let current: unknown = source;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return fallback;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return fallback;
      }
      current = current[index];
      continue;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return fallback;
  }

  if (current === null || current === undefined) {
    return fallback;
  }

  return current as T;
};

export const toDisplayDate = (iso?: string | null): string => {
  if (!iso) {
    return "—";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const toDisplayText = (value: unknown, fallback = "—"): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  return fallback;
};
