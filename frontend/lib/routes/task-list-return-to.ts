import { paths } from "./paths";

const PARSE_ORIGIN = "http://task-list.local";

export function toSafeTaskListReturnTo(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith("/") || trimmed.startsWith("//")) {
    return paths.teacher.tasks;
  }

  try {
    const url = new URL(trimmed, PARSE_ORIGIN);
    if (url.origin !== PARSE_ORIGIN || url.pathname !== paths.teacher.tasks) {
      return paths.teacher.tasks;
    }
    url.searchParams.delete("stage");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return paths.teacher.tasks;
  }
}
