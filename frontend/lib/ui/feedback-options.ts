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
