import { SubmissionAiOperations } from "../../lib/learning-tasks/submission-ai-operations";
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

const requestable = {
  ...known,
  provider: null,
  canRequest: true,
  requestBlockReason: null,
  inputCoverage: "NOT_SENT",
  usage: {
    reservedRequests: 0,
    reportedRequests: 0,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  },
};
const makeDetail = (status = "NOT_REQUESTED", canRequest: unknown = true) =>
  toSubmissionDetailResponse({
    id: "s",
    aiFeedbackStatus: status,
    aiReview: { ...requestable, canRequest },
  });
const makeOperations = () =>
  new SubmissionAiOperations("s", "NOT_REQUESTED", makeDetail().aiReview);
const postResult = (status: string) =>
  toRequestAiFeedbackResponse({
    submissionId: "s",
    jobId: "j",
    status,
    aiFeedbackStatus: status,
  });

test("orders local reads and POST, and exposes only the real confirmed POST status", () => {
  for (const status of ["PENDING", "SUCCEEDED", "DEAD"]) {
    const operations = makeOperations(),
      request = operations.beginRequest();
    expect(request).not.toBeNull();
    expect(operations.beginRequest()).toBeNull();
    expect(operations.beginRead(true)).toBeNull();
    expect(operations.finishRequest(request!, postResult(status))).toBe(true);
    expect(operations.view.status).toBe(status);
    expect(operations.view.confirmedJob).toBe(true);
    expect(operations.view.canRequest).toBe(false);
    // The old pre-request summary is no longer displayed as current usage.
    expect(operations.view.review).toBeUndefined();
  }
  const operations = makeOperations(),
    read = operations.beginRead(true);
  expect(operations.beginRequest()).toBeNull();
  expect(operations.finishRead(read!, makeDetail())).toBe(true);
  expect(operations.view.canRequest).toBe(true);
});
test("old read results before or after POST completion cannot regress confirmed status", () => {
  for (const returnWhilePostPending of [true, false]) {
    const operations = makeOperations(),
      oldRead = operations.beginRead(false)!;
    expect(operations.finishRead(oldRead, makeDetail())).toBe(true);
    const request = operations.beginRequest()!;
    if (returnWhilePostPending)
      expect(operations.finishRead(oldRead, makeDetail())).toBeNull();
    expect(operations.finishRequest(request, postResult("SUCCEEDED"))).toBe(
      true,
    );
    if (!returnWhilePostPending)
      expect(operations.finishRead(oldRead, makeDetail())).toBeNull();
    expect(operations.view.status).toBe("SUCCEEDED");
    expect(operations.view.canRequest).toBe(false);
    // Even a later contradictory response cannot undo a confirmed Job.
    const freshRead = operations.beginRead(true)!;
    expect(operations.finishRead(freshRead, makeDetail())).toBe(false);
    expect(operations.view.status).toBe("SUCCEEDED");
    expect(operations.beginRequest()).toBeNull();
  }
});
test("an uncertain POST can only be recovered by a subsequent explicit successful read", () => {
  const operations = makeOperations(),
    oldRead = operations.beginRead(false)!;
  operations.finishRead(oldRead, makeDetail());
  const request = operations.beginRequest()!;
  expect(operations.finishRequest(request)).toBe(false);
  expect(operations.finishRead(oldRead, makeDetail())).toBeNull();
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();
  const failedConfirmation = operations.beginRead(true)!;
  expect(operations.finishRead(failedConfirmation)).toBe(false);
  expect(operations.view.canRequest).toBe(false);
  const confirmation = operations.beginRead(true)!;
  expect(operations.finishRead(confirmation, makeDetail())).toBe(true);
  expect(operations.view.needsConfirmation).toBe(false);
  expect(operations.view.canRequest).toBe(true);
  // No replay: completion leaves no active POST; a user must begin one.
  expect(operations.view.busy).toBeNull();
  expect(operations.beginRequest()).not.toBeNull();
});
test("failed, incomplete or non-true confirmation cannot unlock an uncertain request", () => {
  for (const detail of [
    undefined,
    toSubmissionDetailResponse({ id: "s" }),
    toSubmissionDetailResponse({
      id: "s",
      aiFeedbackStatus: "NOT_REQUESTED",
      aiReview: { canRequest: true },
    }),
    toSubmissionDetailResponse({
      id: "other",
      aiFeedbackStatus: "NOT_REQUESTED",
      aiReview: requestable,
    }),
    ...[false, "true", 1, null, undefined].map((value) =>
      toSubmissionDetailResponse({
        id: "s",
        aiFeedbackStatus: "NOT_REQUESTED",
        aiReview: { ...requestable, canRequest: value },
      }),
    ),
  ]) {
    const operations = makeOperations();
    operations.finishRequest(operations.beginRequest()!);
    const confirmation = operations.beginRead(true)!;
    operations.finishRead(confirmation, detail);
    expect(operations.view.canRequest).toBe(false);
    expect(operations.beginRequest()).toBeNull();
  }
});
test("accepted status, eligibility and polling use the same confirmed detail", () => {
  const operations = makeOperations();
  operations.finishRequest(operations.beginRequest()!, postResult("PENDING"));
  const detail = toSubmissionDetailResponse({
    id: "s",
    aiFeedbackStatus: "FAILED",
    aiReview: {
      ...known,
      retryScheduled: true,
      nextRetryAt: "2026-10-11T01:00:00Z",
    },
  });
  expect(operations.finishRead(operations.beginRead(false)!, detail)).toBe(
    true,
  );
  expect(operations.view.status).toBe("FAILED");
  expect(operations.view.review?.canRequest).toBe(false);
  expect(operations.view.canRequest).toBe(false);
  expect(
    getAutoRefreshPhase(operations.view.status, operations.view.review),
  ).toBe("FAILED");
  expect(
    operations.finishRead(
      operations.beginRead(false)!,
      makeDetail("SUCCEEDED", false),
    ),
  ).toBe(true);
  expect(operations.view.status).toBe("SUCCEEDED");
  expect(
    getAutoRefreshPhase(operations.view.status, operations.view.review),
  ).toBeNull();
});
test("invalidated or other-submission operations cannot update a new submission", () => {
  const old = makeOperations(),
    request = old.beginRequest()!;
  old.cancelPending();
  expect(old.finishRequest(request, postResult("DEAD"))).toBeNull();
  const current = new SubmissionAiOperations(
    "other",
    "NOT_REQUESTED",
    makeDetail().aiReview,
  );
  const newRequest = current.beginRequest()!;
  expect(current.finishRequest(request, postResult("DEAD"))).toBeNull();
  expect(current.view.status).toBe("NOT_REQUESTED");
  expect(current.view.busy).toBe("request");
  expect(
    current.finishRequest(
      newRequest,
      toRequestAiFeedbackResponse({
        submissionId: "other",
        jobId: "other-job",
        status: "PENDING",
        aiFeedbackStatus: "PENDING",
      }),
    ),
  ).toBe(true);
  expect(current.view.status).toBe("PENDING");
  const staleRead = current.beginRead(true)!;
  current.cancelPending();
  expect(current.finishRead(staleRead, makeDetail("DEAD", false))).toBeNull();
  expect(current.view.status).toBe("PENDING");
});
test("incomplete successful POST response stays locked pending explicit confirmation", () => {
  const operations = makeOperations();
  expect(
    operations.finishRequest(
      operations.beginRequest()!,
      toRequestAiFeedbackResponse({ status: "PENDING" }),
    ),
  ).toBe(false);
  expect(operations.view.status).toBe("NOT_REQUESTED");
  expect(operations.view.needsConfirmation).toBe(true);
  expect(operations.beginRequest()).toBeNull();
});
