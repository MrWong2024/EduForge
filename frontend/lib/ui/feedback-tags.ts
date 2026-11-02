export const FEEDBACK_TAG_OPTIONS = [
  { value: "readability", label: "可读性" },
  { value: "naming", label: "命名" },
  { value: "style", label: "代码风格" },
  { value: "formatting", label: "代码格式" },
  { value: "complexity", label: "复杂度" },
  { value: "duplication", label: "重复代码" },
  { value: "edge-cases", label: "边界情况" },
  { value: "null-safety", label: "空值安全" },
  { value: "exception-safety", label: "异常安全" },
  { value: "performance", label: "性能" },
  { value: "memory", label: "内存使用" },
  { value: "security", label: "安全" },
  { value: "correctness", label: "正确性" },
  { value: "bug-risk", label: "缺陷风险" },
  { value: "maintainability", label: "可维护性" },
  { value: "testability", label: "可测试性" },
  { value: "api-design", label: "接口设计" },
  { value: "abstraction", label: "抽象设计" },
  { value: "encapsulation", label: "封装" },
  { value: "coupling", label: "耦合度" },
  { value: "cohesion", label: "内聚性" },
  { value: "concurrency", label: "并发" },
  { value: "io", label: "输入输出" },
  { value: "algorithm", label: "算法" },
  { value: "data-structure", label: "数据结构" },
  { value: "documentation", label: "文档" },
  { value: "logging", label: "日志" },
  { value: "error-handling", label: "错误处理" },
  { value: "validation", label: "校验" },
  { value: "input-sanitization", label: "输入清理" },
  { value: "resource-management", label: "资源管理" },
  { value: "time-complexity", label: "时间复杂度" },
  { value: "space-complexity", label: "空间复杂度" },
  { value: "readability-comments", label: "注释可读性" },
  { value: "modularity", label: "模块化" },
  { value: "dead-code", label: "无效代码" },
  { value: "unused", label: "未使用内容" },
  { value: "other", label: "其他" },
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
