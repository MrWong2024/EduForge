export type TaskAiContextRef = {
  archivePath: string;
  entryPaths: string[];
};

// Only validate the JSON shape here. ZIP resources and path safety belong to the backend.
export function readAiContextRefs(value: unknown): TaskAiContextRef[] {
  if (!Array.isArray(value)) {
    throw new Error("AI 评阅参考资料必须是 JSON 数组；无引用请填写 []。");
  }
  return value.map((item: unknown, index) => {
    const label = `资料引用 ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${label}必须是对象。`);
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => key !== "archivePath" && key !== "entryPaths",
      )
    ) {
      throw new Error(`${label}只能包含 archivePath 和 entryPaths 字段。`);
    }
    if (
      typeof record.archivePath !== "string" ||
      record.archivePath.length === 0
    ) {
      throw new Error(`${label}的 archivePath 必须是非空字符串。`);
    }
    if (!Array.isArray(record.entryPaths) || record.entryPaths.length === 0) {
      throw new Error(`${label}的 entryPaths 必须是非空字符串数组。`);
    }
    const entryPaths = record.entryPaths.map((path: unknown, entryIndex) => {
      if (typeof path !== "string" || path.length === 0) {
        throw new Error(`${label}，条目 ${entryIndex + 1}必须是非空字符串。`);
      }
      return path;
    });
    return { archivePath: record.archivePath, entryPaths };
  });
}

export function parseAiContextRefsJson(text: string): TaskAiContextRef[] {
  if (!text.trim()) throw new Error("请填写引用 JSON；无引用请填写 []。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("引用 JSON 语法不正确，请检查引号、逗号和括号。");
  }
  return readAiContextRefs(value);
}

export function formatAiContextRefs(refs: TaskAiContextRef[]): string {
  return JSON.stringify(refs, null, 2);
}

export function buildAiContextRefsPatch(
  text: string,
  baseline: TaskAiContextRef[],
) {
  const next = parseAiContextRefsJson(text);
  // Rebuild each object in contract-key order; array and path order remain significant.
  return JSON.stringify(next) === JSON.stringify(readAiContextRefs(baseline))
    ? {}
    : { aiContextRefs: next };
}

export function isTaskTemplateAuthor(
  currentUserId: string | undefined,
  authorId: string | undefined,
): boolean {
  return Boolean(
    currentUserId?.trim() && authorId?.trim() && currentUserId === authorId,
  );
}

export function canEditTaskTemplate(
  currentUserId: string | undefined,
  authorId: string | undefined,
  status: string | undefined,
): boolean {
  return (
    isTaskTemplateAuthor(currentUserId, authorId) &&
    (status === "DRAFT" || status === "PUBLISHED")
  );
}
