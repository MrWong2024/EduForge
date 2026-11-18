const VALIDATION_ORIGIN = "https://eduforge.invalid";

const isSingleSlashPath = (value: string) =>
  value.startsWith("/") && !value.startsWith("//");

export function getSafeNextPath(value: string | null): string | null {
  if (
    !value ||
    !isSingleSlashPath(value) ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, VALIDATION_ORIGIN);
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.origin === VALIDATION_ORIGIN && isSingleSlashPath(normalized)
      ? normalized
      : null;
  } catch {
    return null;
  }
}
