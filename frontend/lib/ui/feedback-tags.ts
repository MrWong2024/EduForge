export const FEEDBACK_TAG_OPTIONS = [
  { value: "readability", label: "readability - 可读性" },
  { value: "naming", label: "naming - 命名" },
  { value: "style", label: "style - 代码风格" },
  { value: "formatting", label: "formatting - 代码格式" },
  { value: "complexity", label: "complexity - 复杂度" },
  { value: "duplication", label: "duplication - 重复代码" },
  { value: "edge-cases", label: "edge-cases - 边界情况" },
  { value: "null-safety", label: "null-safety - 空值安全" },
  { value: "exception-safety", label: "exception-safety - 异常安全" },
  { value: "performance", label: "performance - 性能" },
  { value: "memory", label: "memory - 内存使用" },
  { value: "security", label: "security - 安全" },
  { value: "correctness", label: "correctness - 正确性" },
  { value: "bug-risk", label: "bug-risk - 缺陷风险" },
  { value: "maintainability", label: "maintainability - 可维护性" },
  { value: "testability", label: "testability - 可测试性" },
  { value: "api-design", label: "api-design - 接口设计" },
  { value: "abstraction", label: "abstraction - 抽象设计" },
  { value: "encapsulation", label: "encapsulation - 封装" },
  { value: "coupling", label: "coupling - 耦合度" },
  { value: "cohesion", label: "cohesion - 内聚性" },
  { value: "concurrency", label: "concurrency - 并发" },
  { value: "io", label: "io - 输入输出" },
  { value: "algorithm", label: "algorithm - 算法" },
  { value: "data-structure", label: "data-structure - 数据结构" },
  { value: "documentation", label: "documentation - 文档" },
  { value: "logging", label: "logging - 日志" },
  { value: "error-handling", label: "error-handling - 错误处理" },
  { value: "validation", label: "validation - 校验" },
  { value: "input-sanitization", label: "input-sanitization - 输入清理" },
  { value: "resource-management", label: "resource-management - 资源管理" },
  { value: "time-complexity", label: "time-complexity - 时间复杂度" },
  { value: "space-complexity", label: "space-complexity - 空间复杂度" },
  { value: "readability-comments", label: "readability-comments - 注释可读性" },
  { value: "modularity", label: "modularity - 模块化" },
  { value: "dead-code", label: "dead-code - 无效代码" },
  { value: "unused", label: "unused - 未使用内容" },
  { value: "other", label: "other - 其他" },
] as const;

export type FeedbackTagOption = (typeof FEEDBACK_TAG_OPTIONS)[number];
export type FeedbackTagValue = FeedbackTagOption["value"];

export const getFeedbackTagLabel = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "—";
  return (
    FEEDBACK_TAG_OPTIONS.find((option) => option.value === value)?.label ??
    value
  );
};
