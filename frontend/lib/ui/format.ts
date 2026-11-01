type PathInput = string | readonly string[];

const toPathSegments = (path: PathInput): string[] =>
  typeof path === "string" ? path.split(".").filter(Boolean) : [...path];

export const safeGet = <T>(
  source: unknown,
  path: PathInput,
  fallback: T,
): T => {
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

export const getSingleSearchParam = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

type ParsePositiveIntOptions = {
  min?: number;
  max?: number;
};

export const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
  options: ParsePositiveIntOptions = {},
): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  const min = options.min ?? 1;
  const max = options.max;
  if (parsed < min) {
    return fallback;
  }
  if (typeof max === "number" && parsed > max) {
    return fallback;
  }

  return parsed;
};

export const parseBool01 = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }

  return fallback;
};

export const parseEnum = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (value && allowed.includes(value as T) ? (value as T) : fallback);

export const buildQueryString = (
  params: Record<string, string | number | boolean | undefined | null>,
): string => {
  const search = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue;
    }
    search.set(key, String(rawValue));
  }

  return search.toString();
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

export const toDisplayLateDuration = (value: unknown): string | undefined => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return undefined;
  }

  if (value === 0) {
    return "超时不足 1 秒";
  }

  const secondsPerMinute = 60;
  const secondsPerHour = 60 * secondsPerMinute;
  const secondsPerDay = 24 * secondsPerHour;

  if (value < secondsPerMinute) {
    return `超时 ${value} 秒`;
  }

  if (value < secondsPerHour) {
    const minutes = Math.floor(value / secondsPerMinute);
    const seconds = value % secondsPerMinute;
    return seconds > 0
      ? `超时 ${minutes} 分钟 ${seconds} 秒`
      : `超时 ${minutes} 分钟`;
  }

  if (value < secondsPerDay) {
    const hours = Math.floor(value / secondsPerHour);
    const minutes = Math.floor((value % secondsPerHour) / secondsPerMinute);
    return minutes > 0
      ? `超时 ${hours} 小时 ${minutes} 分钟`
      : `超时 ${hours} 小时`;
  }

  const days = Math.floor(value / secondsPerDay);
  const hours = Math.floor((value % secondsPerDay) / secondsPerHour);
  return hours > 0 ? `超时 ${days} 天 ${hours} 小时` : `超时 ${days} 天`;
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

export const getPublisherLabel = (
  publisher: { id?: string; name?: string } | null | undefined,
  currentUserId: string | null | undefined,
): string | null => {
  if (!publisher?.id || !currentUserId) {
    return null;
  }

  if (publisher.id === currentUserId) {
    return null;
  }

  return publisher.name ? `模板发布者：${publisher.name}` : "其他教师模板";
};
