export const FEEDBACK_TYPES = [
  "SYNTAX",
  "STYLE",
  "DESIGN",
  "BUG",
  "PERFORMANCE",
  "SECURITY",
  "OTHER",
] as const;

export const FEEDBACK_SEVERITIES = ["INFO", "WARN", "ERROR"] as const;

export type FeedbackTypeValue = (typeof FEEDBACK_TYPES)[number];
export type FeedbackSeverityValue = (typeof FEEDBACK_SEVERITIES)[number];

const FEEDBACK_TYPE_LABELS: Record<FeedbackTypeValue, string> = {
  SYNTAX: "语法",
  STYLE: "代码规范",
  DESIGN: "设计",
  BUG: "缺陷",
  PERFORMANCE: "性能",
  SECURITY: "安全",
  OTHER: "其他",
};

const FEEDBACK_SEVERITY_LABELS: Record<FeedbackSeverityValue, string> = {
  INFO: "提示",
  WARN: "警告",
  ERROR: "错误",
};

const getFeedbackLabel = (
  value: unknown,
  labels: Readonly<Record<string, string>>,
  fallback: string,
): string => {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim())
  ) {
    return "—";
  }
  return typeof value === "string" && Object.hasOwn(labels, value)
    ? labels[value]
    : fallback;
};

export const getFeedbackTypeLabel = (value: unknown): string =>
  getFeedbackLabel(value, FEEDBACK_TYPE_LABELS, "未知类型");

export const getFeedbackSeverityLabel = (value: unknown): string =>
  getFeedbackLabel(value, FEEDBACK_SEVERITY_LABELS, "未知程度");

export const getFeedbackSourceLabel = (value: unknown): string => {
  if (value === "TEACHER") return "教师反馈";
  if (value === "AI") return "AI 辅助反馈";
  return "其他反馈（来源未识别）";
};

export const normalizeFeedbackType = (
  value: string | undefined,
): FeedbackTypeValue =>
  FEEDBACK_TYPES.includes(value as FeedbackTypeValue)
    ? (value as FeedbackTypeValue)
    : "OTHER";

export const normalizeFeedbackSeverity = (
  value: string | undefined,
): FeedbackSeverityValue =>
  FEEDBACK_SEVERITIES.includes(value as FeedbackSeverityValue)
    ? (value as FeedbackSeverityValue)
    : "INFO";
