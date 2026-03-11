export type AiStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const AI_STATUS_ORDER = [
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;

type AiStatus = (typeof AI_STATUS_ORDER)[number];

const normalizeAiStatus = (status?: string | null): AiStatus | undefined => {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  return AI_STATUS_ORDER.find((item) => item === normalized);
};

export const getAiStatusLabel = (status?: string | null): string => {
  const normalized = normalizeAiStatus(status);
  if (!normalized) {
    return "暂无状态";
  }

  if (normalized === "NOT_REQUESTED") {
    return "NOT_REQUESTED（未请求/策略未触发，正常）";
  }
  if (normalized === "PENDING") {
    return "PENDING（排队中）";
  }
  if (normalized === "RUNNING") {
    return "RUNNING（处理中）";
  }
  if (normalized === "SUCCEEDED") {
    return "SUCCEEDED（已生成）";
  }
  if (normalized === "FAILED") {
    return "FAILED（失败，可重试）";
  }

  return "DEAD（失败，不可自动重试）";
};

export const getAiStatusTone = (status?: string | null): AiStatusTone => {
  const normalized = normalizeAiStatus(status);
  if (!normalized || normalized === "NOT_REQUESTED") {
    return "neutral";
  }
  if (normalized === "PENDING" || normalized === "RUNNING") {
    return "info";
  }
  if (normalized === "SUCCEEDED") {
    return "success";
  }
  if (normalized === "FAILED") {
    return "warning";
  }

  return "danger";
};

export const getAiStatusHint = (status?: string | null): string => {
  const normalized = normalizeAiStatus(status);
  if (!normalized) {
    return "当前暂无 AI 状态。";
  }

  if (normalized === "NOT_REQUESTED") {
    return "当前为正常未请求状态。";
  }
  if (normalized === "PENDING") {
    return "AI 反馈排队中，请稍候。";
  }
  if (normalized === "RUNNING") {
    return "AI 反馈处理中，请稍候。";
  }
  if (normalized === "SUCCEEDED") {
    return "AI 反馈已生成，可查看反馈内容。";
  }
  if (normalized === "FAILED") {
    return "上次处理失败，可再次请求 AI 反馈。";
  }

  return "AI 任务已终止，不可自动重试，请联系老师。";
};

export const getCommonErrorSummary = (status: number, scene?: string): string => {
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return scene ? `无权限访问${scene}。` : "无权限访问该页面。";
  }
  if (status === 404) {
    return "功能未启用、不可用或资源不存在。";
  }
  if (status >= 500) {
    return scene ? `${scene}失败，请稍后重试。` : "服务暂时不可用，请稍后重试。";
  }

  return scene ? `${scene}失败，请稍后重试。` : "请求失败，请稍后重试。";
};

