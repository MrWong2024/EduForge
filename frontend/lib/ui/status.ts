export type AiStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

const getDomainStatusLabel = (
  value: unknown,
  labels: Readonly<Record<string, string>>,
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
    : "未知状态";
};

export const getTaskTemplateStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, {
    DRAFT: "草稿",
    PUBLISHED: "已发布",
    ARCHIVED: "已归档",
  });

export const getClassroomTaskStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, {
    ACTIVE: "开放中",
    CLOSED: "已关闭",
    RECALLED: "已撤回",
  });

export const getEnrollmentStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, { ACTIVE: "在班", REMOVED: "已移除" });

export const getAccountStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, { active: "正常", suspended: "已停用" });

export const getCourseStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, { ACTIVE: "进行中", ARCHIVED: "已归档" });

export const getClassroomStatusLabel = (value: unknown): string =>
  getDomainStatusLabel(value, { ACTIVE: "进行中", ARCHIVED: "已归档" });

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

export const getAiStatusLabel = (status?: unknown): string => {
  if (status === "UNKNOWN") {
    return "状态未知";
  }
  if (
    status === undefined ||
    status === null ||
    (typeof status === "string" && !status.trim())
  ) {
    return "—";
  }
  const normalized =
    typeof status === "string" ? normalizeAiStatus(status) : undefined;
  if (!normalized) {
    return "未知状态";
  }

  if (normalized === "NOT_REQUESTED") {
    return "未申请";
  }
  if (normalized === "PENDING") {
    return "排队中";
  }
  if (normalized === "RUNNING") {
    return "处理中";
  }
  if (normalized === "SUCCEEDED") {
    return "处理完成";
  }
  if (normalized === "FAILED") {
    return "本次处理失败";
  }

  return "已终止";
};

const AI_FAILURE_REASON_LABELS: Readonly<Record<string, string>> = {
  INPUT_BUDGET_EXCEEDED: "评阅材料超出处理范围",
  OUTPUT_LIMIT_REACHED: "反馈内容超出长度限制",
  UNAUTHORIZED: "AI 服务授权失败",
  RATE_LIMIT_UPSTREAM: "AI 服务请求过于频繁",
  RATE_LIMIT_LOCAL: "本次请求受到频率限制",
  UPSTREAM_4XX: "AI 服务无法处理本次请求",
  UPSTREAM_5XX: "AI 服务暂时不可用",
  TIMEOUT: "AI 处理超时",
  BAD_RESPONSE: "AI 返回内容暂不可用",
  MISSING_API_KEY: "AI 服务尚未配置完成",
};

export const getAiFailureReasonLabel = (value: unknown): string => {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim())
  ) {
    return "—";
  }
  return typeof value === "string" &&
    Object.hasOwn(AI_FAILURE_REASON_LABELS, value)
    ? AI_FAILURE_REASON_LABELS[value]
    : "其他处理失败原因";
};

export const getAiStatusTone = (status?: string | null): AiStatusTone => {
  if (status === "UNKNOWN") {
    return "neutral";
  }
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
  if (status === "UNKNOWN") {
    return "已存在 AI 处理任务，但当前状态暂不可确认。请刷新详情核对。";
  }
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
    return "AI 处理已完成，可查看已有反馈；没有条目时尚无可展示的反馈。";
  }
  if (normalized === "FAILED") {
    return "本次处理失败，请进入提交详情查看是否已安排重试。";
  }

  return "AI 任务已终止，不可自动重试，请联系老师。";
};

export const getCommonErrorSummary = (
  status: number,
  scene?: string,
): string => {
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
    return scene
      ? `${scene}失败，请稍后重试。`
      : "服务暂时不可用，请稍后重试。";
  }

  return scene ? `${scene}失败，请稍后重试。` : "请求失败，请稍后重试。";
};
