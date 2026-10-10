import { test, expect } from "@playwright/test";
import {
  toSubmissionDetailResponse,
  toRequestAiFeedbackResponse,
} from "../../lib/api/types-student";
import {
  displayAiUsage,
  getAutoRefreshPhase,
  normalizeAiStatus,
  toAiReview,
} from "../../lib/learning-tasks/ai-review";
import { getAiStatusHint, getAiStatusLabel } from "../../lib/ui/status";
const known = {
  provider: "bailian",
  canRequest: false,
  requestBlockReason: "已有任务",
  failure: null,
  retryScheduled: false,
  nextRetryAt: null,
  inputCoverage: "FULL",
  usage: {
    reservedRequests: 1,
    reportedRequests: 1,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
  },
};
test("adapts all public AI fields and retains reported usage", () => {
  expect(
    toSubmissionDetailResponse({
      aiFeedbackStatus: "SUCCEEDED",
      aiReview: known,
    }).aiReview,
  ).toEqual(known);
});
test("keeps unknown totals distinct from known zero without fabricating history", () => {
  const review = toAiReview({
    ...known,
    inputCoverage: "UNKNOWN",
    usage: {
      reservedRequests: 2,
      reportedRequests: 1,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    },
  });
  expect(review?.usage).toEqual({
    reservedRequests: 2,
    reportedRequests: 1,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
  expect(displayAiUsage(review?.usage.totalTokens)).toBe("未知");
  expect(displayAiUsage(0)).toBe("0");
  expect(
    toAiReview({
      ...known,
      usage: {
        reservedRequests: 0,
        reportedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    })?.usage.totalTokens,
  ).toBe(0);
  expect(toAiReview({ ...known, usage: {} })?.usage).toEqual({
    reservedRequests: null,
    reportedRequests: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
});
test("accepts only strict boolean eligibility and closes missing summary", () => {
  for (const canRequest of ["true", 1, null, undefined])
    expect(toAiReview({ ...known, canRequest })?.canRequest).toBeNull();
  expect(toAiReview({ ...known, canRequest: true })?.canRequest).toBe(true);
  expect(toAiReview({ ...known, canRequest: false })?.canRequest).toBe(false);
  expect(toSubmissionDetailResponse({}).aiReview).toBeUndefined();
});
test("invalid provider, coverage, date and usage stay unknown", () => {
  expect(
    toAiReview({
      ...known,
      provider: "other",
      inputCoverage: "PARTIAL",
      nextRetryAt: "bad",
      usage: {
        reservedRequests: -1,
        reportedRequests: 0.5,
        promptTokens: NaN,
        completionTokens: "0",
        totalTokens: Infinity,
      },
    }),
  ).toMatchObject({
    provider: null,
    inputCoverage: null,
    nextRetryAt: null,
    usage: {
      reservedRequests: null,
      reportedRequests: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    },
  });
});
test("preserves stub and budget rejection semantics", () => {
  expect(
    toAiReview({ ...known, provider: "stub", inputCoverage: "NOT_SENT" })
      ?.provider,
  ).toBe("stub");
  const failure = {
    code: "INPUT_BUDGET_EXCEEDED",
    message: "作业已保存，完整内容超过 AI 输入限额，本次未生成 AI 反馈。",
  };
  expect(
    toAiReview({ ...known, failure, inputCoverage: "NOT_SENT" })?.failure,
  ).toEqual(failure);
});
test("polls only active processing or a scheduled FAILED retry", () => {
  const scheduled = toAiReview({
    ...known,
    retryScheduled: true,
    nextRetryAt: "2026-10-11T01:00:00.000Z",
  });
  for (const status of ["PENDING", "RUNNING"])
    expect(getAutoRefreshPhase(status, scheduled)).toBe(status);
  expect(getAutoRefreshPhase("FAILED", scheduled)).toBe("FAILED");
  for (const status of [
    "NOT_REQUESTED",
    "SUCCEEDED",
    "DEAD",
    "FUTURE",
    undefined,
  ])
    expect(getAutoRefreshPhase(status, scheduled)).toBeNull();
  expect(getAutoRefreshPhase("FAILED", toAiReview(known))).toBeNull();
  expect(
    getAutoRefreshPhase(
      "FAILED",
      toAiReview({ ...known, retryScheduled: "true" }),
    ),
  ).toBeNull();
  expect(getAutoRefreshPhase("PENDING", undefined)).toBeNull();
});
test("uses actual POST status and never assumes requeue or success", () => {
  const result = toRequestAiFeedbackResponse({
    submissionId: "s",
    jobId: "j",
    status: "DEAD",
    aiFeedbackStatus: "DEAD",
  });
  expect(normalizeAiStatus(result.aiFeedbackStatus)).toBe("DEAD");
  expect(
    normalizeAiStatus(toRequestAiFeedbackResponse({}).status),
  ).toBeUndefined();
  expect(normalizeAiStatus("FUTURE")).toBeUndefined();
  expect(getAiStatusLabel("FAILED")).toBe("本次处理失败");
  expect(getAiStatusHint("FAILED")).toBe(
    "本次处理失败，请进入提交详情查看是否已安排重试。",
  );
});
