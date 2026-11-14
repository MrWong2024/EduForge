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
    unreportedRequests: 0,
    promptTokens: 12993,
    inputTextTokens: 12993,
    cachedInputTokens: 0,
    uncachedInputTokens: 12993,
    completionTokens: 3632,
    outputTextTokens: 3632,
    reasoningTokens: 3230,
    answerTokens: 402,
    totalTokens: 16625,
  },
};
const usageDetailFields = [
  "inputTextTokens",
  "cachedInputTokens",
  "outputTextTokens",
  "reasoningTokens",
  "answerTokens",
  "uncachedInputTokens",
  "unreportedRequests",
] as const;
const unknownUsageDetails = {
  inputTextTokens: null,
  cachedInputTokens: null,
  outputTextTokens: null,
  reasoningTokens: null,
  answerTokens: null,
  uncachedInputTokens: null,
  unreportedRequests: null,
};

test("detail and request mappers retain every formal AI status and their original payloads", () => {
  for (const status of [
    "NOT_REQUESTED",
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "DEAD",
    "UNKNOWN",
  ]) {
    const source = Object.freeze({
      id: "s",
      aiFeedbackStatus: status,
      data: Object.freeze({ aiFeedbackStatus: "DEAD" }),
      raw: Object.freeze({ aiFeedbackStatus: "PENDING" }),
    });
    const before = structuredClone(source);
    const detail = toSubmissionDetailResponse(source);

    expect(detail.id).toBe("s");
    expect(detail.aiFeedbackStatus).toBe(status);
    expect(normalizeAiStatus(detail.aiFeedbackStatus)).toBe(status);
    expect(detail.raw).toBe(source);
    expect(source).toStrictEqual(before);
  }
  for (const status of [
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "DEAD",
    "UNKNOWN",
  ]) {
    const source = Object.freeze({
      submissionId: "s",
      jobId: "j",
      status,
      aiFeedbackStatus: status,
      data: Object.freeze({ status: "DEAD", aiFeedbackStatus: "DEAD" }),
      raw: Object.freeze({ status: "PENDING", aiFeedbackStatus: "PENDING" }),
    });
    const before = structuredClone(source);
    const result = toRequestAiFeedbackResponse(source);

    expect(result.submissionId).toBe("s");
    expect(result.jobId).toBe("j");
    expect(result.status).toBe(status);
    expect(result.aiFeedbackStatus).toBe(status);
    expect(normalizeAiStatus(result.status)).toBe(status);
    expect(normalizeAiStatus(result.aiFeedbackStatus)).toBe(status);
    expect(result.raw).toBe(source);
    expect(source).toStrictEqual(before);
  }
});

test("the three AI confirmation fields keep raw strings and reject nonstrings without old-source rescue", () => {
  for (const [value, expected] of [
    ["", ""],
    [" \t\n ", " \t\n "],
    ["unknown", "unknown"],
    [" UNKNOWN ", " UNKNOWN "],
    ["\tPENDING\n", "\tPENDING\n"],
    ["PeNdInG", "PeNdInG"],
    ["FUTURE", "FUTURE"],
    [undefined, undefined],
    [null, undefined],
    [42, undefined],
    [false, undefined],
    [Object.freeze(["UNKNOWN"]), undefined],
    [Object.freeze({ status: "UNKNOWN" }), undefined],
  ] as const) {
    const source = Object.freeze({
      id: "s",
      submissionId: "s",
      jobId: "j",
      ...(value === undefined ? {} : { status: value, aiFeedbackStatus: value }),
      data: Object.freeze({ status: "UNKNOWN", aiFeedbackStatus: "UNKNOWN" }),
      raw: Object.freeze({ status: "PENDING", aiFeedbackStatus: "PENDING" }),
    });
    const before = structuredClone(source);
    const detail = toSubmissionDetailResponse(source);
    const result = toRequestAiFeedbackResponse(source);

    expect(detail.aiFeedbackStatus).toBe(expected);
    expect(result.status).toBe(expected);
    expect(result.aiFeedbackStatus).toBe(expected);
    expect(normalizeAiStatus(detail.aiFeedbackStatus)).toBeUndefined();
    expect(normalizeAiStatus(result.status)).toBeUndefined();
    expect(normalizeAiStatus(result.aiFeedbackStatus)).toBeUndefined();
    expect(detail.raw).toBe(source);
    expect(result.raw).toBe(source);
    expect(source).toStrictEqual(before);
  }
});

test("adapts all public AI fields and retains reported usage", () => {
  expect(
    toSubmissionDetailResponse({
      aiFeedbackStatus: "SUCCEEDED",
      aiReview: known,
    }).aiReview,
  ).toEqual(known);
});

test("maps nonzero cached input and all reported breakdown fields independently", () => {
  const usage = {
    reservedRequests: 3,
    reportedRequests: 3,
    unreportedRequests: 0,
    promptTokens: 100,
    inputTextTokens: 91,
    cachedInputTokens: 30,
    uncachedInputTokens: 70,
    completionTokens: 20,
    outputTextTokens: 12,
    reasoningTokens: 5,
    answerTokens: 7,
    totalTokens: 120,
  };
  expect(toAiReview({ ...known, usage })?.usage).toEqual(usage);
});

test("retains reported calculated values without computing them from other fields", () => {
  expect(
    toAiReview({
      ...known,
      usage: {
        answerTokens: 402,
        uncachedInputTokens: 12993,
        unreportedRequests: 2,
      },
    })?.usage,
  ).toEqual({
    reservedRequests: null,
    reportedRequests: null,
    unreportedRequests: 2,
    promptTokens: null,
    inputTextTokens: null,
    cachedInputTokens: null,
    uncachedInputTokens: 12993,
    completionTokens: null,
    outputTextTokens: null,
    reasoningTokens: null,
    answerTokens: 402,
    totalTokens: null,
  });
});

test("preserves explicit zero and isolates invalid or missing usage details", () => {
  for (const field of usageDetailFields) {
    expect(
      toAiReview({ ...known, usage: { ...known.usage, [field]: 0 } })?.usage,
    ).toEqual({ ...known.usage, [field]: 0 });
    for (const value of [
      undefined,
      null,
      "0",
      -1,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        toAiReview({ ...known, usage: { ...known.usage, [field]: value } })
          ?.usage,
      ).toEqual({ ...known.usage, [field]: null });
    }
  }
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(displayAiUsage(value)).toBe("未知");
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
    ...unknownUsageDetails,
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
    ...unknownUsageDetails,
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
    "UNKNOWN",
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
    unreportedRequests: 0,
    promptTokens: 0,
    inputTextTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    completionTokens: 0,
    outputTextTokens: 0,
    reasoningTokens: 0,
    answerTokens: 0,
    totalTokens: 0,
  },
};
const makeDetail = (status = "NOT_REQUESTED", canRequest: unknown = true) =>
  toSubmissionDetailResponse({
    id: "s",
    contentRevision: 0,
    aiFeedbackStatus: status,
    aiReview: { ...requestable, canRequest },
  });
const makeOperations = () =>
  new SubmissionAiOperations("s", "NOT_REQUESTED", makeDetail().aiReview, 0);
const postResult = (status: string) =>
  toRequestAiFeedbackResponse({
    submissionId: "s",
    jobId: "j",
    status,
    aiFeedbackStatus: status,
  });

test("orders local reads and POST, and exposes only the real confirmed POST status", () => {
  for (const status of [
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "DEAD",
    "UNKNOWN",
  ]) {
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
    expect(operations.beginRequest()).toBeNull();
  }
  const operations = makeOperations(),
    read = operations.beginRead(true);
  expect(operations.beginRequest()).toBeNull();
  expect(operations.finishRead(read!, makeDetail())).toBe(true);
  expect(operations.view.canRequest).toBe(true);
});

test("POST confirmation preserves preferred-status and fallback precedence without requiring equal fields", () => {
  for (const [status, aiFeedbackStatus, expected] of [
    ["DEAD", "UNKNOWN", "UNKNOWN"],
    ["UNKNOWN", "PENDING", "PENDING"],
    ["UNKNOWN", " unknown ", "UNKNOWN"],
    [undefined, "UNKNOWN", "UNKNOWN"],
    ["RUNNING", undefined, "RUNNING"],
  ] as const) {
    const source = Object.freeze({
      submissionId: "s",
      jobId: "j",
      status,
      aiFeedbackStatus,
    });
    const before = structuredClone(source);
    const result = toRequestAiFeedbackResponse(source);
    const operations = makeOperations();

    expect(result.status).toBe(status);
    expect(result.aiFeedbackStatus).toBe(aiFeedbackStatus);
    expect(
      operations.finishRequest(operations.beginRequest()!, result),
    ).toBe(true);
    expect(operations.view.status).toBe(expected);
    expect(operations.view.confirmedJob).toBe(true);
    expect(operations.beginRequest()).toBeNull();
    expect(result.raw).toBe(source);
    expect(source).toStrictEqual(before);
  }
});

test("nonexact POST states cannot be trimmed into confirmation when both fields are invalid or the fallback is absent", () => {
  for (const fields of [
    { status: " UNKNOWN ", aiFeedbackStatus: " UNKNOWN " },
    { aiFeedbackStatus: "unknown" },
    { status: "\tPENDING\n" },
  ]) {
    const source = Object.freeze({ submissionId: "s", jobId: "j", ...fields });
    const before = structuredClone(source);
    const result = toRequestAiFeedbackResponse(source);
    const operations = makeOperations();

    expect(
      operations.finishRequest(operations.beginRequest()!, result),
    ).toBe(false);
    expect(operations.view).toMatchObject({
      status: "NOT_REQUESTED",
      confirmedJob: false,
      needsConfirmation: true,
      busy: null,
      canRequest: false,
    });
    expect(operations.beginRequest()).toBeNull();
    expect(operations.beginRead(false)).toBeNull();
    expect(result.raw).toBe(source);
    expect(source).toStrictEqual(before);
  }
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

test("only a complete explicit UNKNOWN detail recovers an uncertain POST and never confirms a new Job or reopens requests", () => {
  const operations = makeOperations();
  const previousReview = operations.view.review;
  expect(operations.finishRequest(operations.beginRequest()!)).toBe(false);
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();

  const source = Object.freeze({
    id: "s",
    contentRevision: 0,
    aiFeedbackStatus: "UNKNOWN",
    aiReview: Object.freeze({ ...known, inputCoverage: "UNKNOWN" }),
  });
  const before = structuredClone(source);
  const nonexact = toSubmissionDetailResponse({
    ...source,
    aiFeedbackStatus: " UNKNOWN ",
  });
  expect(
    operations.finishRead(operations.beginRead(true)!, nonexact),
  ).toBe(false);
  expect(operations.view.needsConfirmation).toBe(true);
  expect(operations.view.confirmedJob).toBe(false);
  expect(operations.beginRead(false)).toBeNull();

  const usage: Partial<typeof known.usage> = { ...known.usage };
  delete usage.reasoningTokens;
  const incompleteSource = Object.freeze({
    ...source,
    aiReview: Object.freeze({ ...source.aiReview, usage }),
  });
  const incomplete = toSubmissionDetailResponse(incompleteSource);
  expect(incomplete.raw).toBe(incompleteSource);
  expect(incomplete.raw).not.toHaveProperty("aiReview.usage.reasoningTokens");
  expect(incomplete.aiReview?.usage.reasoningTokens).toBeNull();
  expect(
    operations.finishRead(operations.beginRead(true)!, incomplete),
  ).toBe(false);
  expect(operations.view).toMatchObject({
    status: "NOT_REQUESTED",
    confirmedJob: false,
    needsConfirmation: true,
    busy: null,
    canRequest: false,
  });
  expect(operations.view.review).toBe(previousReview);
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();

  const complete = toSubmissionDetailResponse(source);
  expect(
    operations.finishRead(operations.beginRead(true)!, complete),
  ).toBe(true);
  expect(operations.view).toMatchObject({
    status: "UNKNOWN",
    contentRevision: 0,
    displayedRevision: 0,
    confirmedJob: false,
    needsConfirmation: false,
    busy: null,
    canRequest: false,
  });
  expect(operations.view.review).toEqual({ ...known, inputCoverage: "UNKNOWN" });
  expect(operations.beginRequest()).toBeNull();
  expect(complete.raw).toBe(source);
  expect(source).toStrictEqual(before);
});

test("each missing current usage field rejects explicit confirmation despite mapper null defaults", () => {
  for (const field of usageDetailFields) {
    const usage: Partial<typeof known.usage> = { ...known.usage };
    delete usage[field];
    const source = {
      id: "s",
      contentRevision: 2,
      aiFeedbackStatus: "SUCCEEDED",
      aiReview: { ...known, usage },
    };
    const detail = toSubmissionDetailResponse(source);
    expect(Object.hasOwn(usage, field)).toBe(false);
    expect(detail.raw).toBe(source);
    expect(detail.raw).not.toHaveProperty(`aiReview.usage.${field}`);
    expect(detail.aiReview?.usage[field]).toBeNull();

    const operations = makeOperations();
    const previousReview = operations.view.review;
    expect(operations.finishRead(operations.beginRead(true)!, detail)).toBe(
      false,
    );
    expect(operations.view).toMatchObject({
      status: "NOT_REQUESTED",
      contentRevision: 0,
      displayedRevision: 0,
      needsConfirmation: true,
      busy: null,
      canRequest: false,
    });
    expect(operations.view.review).toBe(previousReview);
    expect(operations.beginRequest()).toBeNull();
    expect(operations.beginRead(false)).toBeNull();
  }
});

test("a legacy five-field detail cannot confirm an uncertain POST and a complete explicit read restores eligibility", () => {
  const legacyUsage = {
    reservedRequests: 0,
    reportedRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const field of usageDetailFields)
    expect(legacyUsage).not.toHaveProperty(field);
  const detail = toSubmissionDetailResponse({
    id: "s",
    contentRevision: 0,
    aiFeedbackStatus: "NOT_REQUESTED",
    aiReview: { ...requestable, usage: legacyUsage },
  });
  expect(detail.aiReview?.usage).toEqual({
    ...legacyUsage,
    ...unknownUsageDetails,
  });
  const operations = makeOperations();
  const previousReview = operations.view.review;
  expect(operations.finishRequest(operations.beginRequest()!)).toBe(false);
  expect(operations.view.needsConfirmation).toBe(true);
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();
  expect(operations.finishRead(operations.beginRead(true)!, detail)).toBe(false);
  expect(operations.view).toMatchObject({
    status: "NOT_REQUESTED",
    contentRevision: 0,
    displayedRevision: 0,
    needsConfirmation: true,
    busy: null,
    canRequest: false,
  });
  expect(operations.view.review).toBe(previousReview);
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();

  expect(
    operations.finishRead(operations.beginRead(true)!, makeDetail()),
  ).toBe(true);
  expect(operations.view.needsConfirmation).toBe(false);
  expect(operations.view.review?.usage).toEqual(requestable.usage);
  expect(operations.view.canRequest).toBe(true);
  expect(operations.view.busy).toBeNull();
  expect(operations.beginRequest()?.expectedRevision).toBe(0);
});

test("an ordinary automatic read also rejects a missing usage field and requires explicit confirmation", () => {
  const usage: Partial<typeof known.usage> = { ...known.usage };
  delete usage.inputTextTokens;
  const detail = toSubmissionDetailResponse({
    id: "s",
    contentRevision: 1,
    aiFeedbackStatus: "SUCCEEDED",
    aiReview: { ...known, usage },
  });
  const operations = makeOperations();
  const previousReview = operations.view.review;
  const read = operations.beginRead(false)!;
  expect(operations.finishRead(read, detail)).toBe(false);
  expect(operations.view).toMatchObject({
    status: "NOT_REQUESTED",
    contentRevision: 0,
    displayedRevision: 0,
    needsConfirmation: true,
    busy: null,
    canRequest: false,
  });
  expect(operations.view.review).toBe(previousReview);
  expect(operations.beginRead(false)).toBeNull();
  expect(operations.beginRequest()).toBeNull();
  expect(
    operations.finishRead(operations.beginRead(true)!, makeDetail()),
  ).toBe(true);
  expect(operations.view.needsConfirmation).toBe(false);
  expect(operations.view.busy).toBeNull();
});

test("complete unknown usage can confirm a historical terminal job without enabling a new request", () => {
  const usage = {
    reservedRequests: null,
    reportedRequests: null,
    unreportedRequests: null,
    promptTokens: null,
    inputTextTokens: null,
    cachedInputTokens: null,
    uncachedInputTokens: null,
    completionTokens: null,
    outputTextTokens: null,
    reasoningTokens: null,
    answerTokens: null,
    totalTokens: null,
  };
  const detail = toSubmissionDetailResponse({
    id: "s",
    contentRevision: 0,
    aiFeedbackStatus: "SUCCEEDED",
    aiReview: {
      ...known,
      provider: null,
      inputCoverage: "UNKNOWN",
      canRequest: false,
      usage,
    },
  });
  const operations = makeOperations();
  expect(operations.finishRead(operations.beginRead(true)!, detail)).toBe(true);
  expect(operations.view).toMatchObject({
    status: "SUCCEEDED",
    needsConfirmation: false,
    busy: null,
    canRequest: false,
  });
  expect(operations.view.review).toMatchObject({
    provider: null,
    inputCoverage: "UNKNOWN",
    usage,
  });
  expect(operations.beginRequest()).toBeNull();
});
test("failed, incomplete or non-true confirmation cannot unlock an uncertain request", () => {
  for (const detail of [
    undefined,
    toSubmissionDetailResponse({ id: "s" }),
    toSubmissionDetailResponse({
      id: "s",
      contentRevision: 0,
      aiFeedbackStatus: "NOT_REQUESTED",
      aiReview: { canRequest: true },
    }),
    toSubmissionDetailResponse({
      id: "other",
      contentRevision: 0,
      aiFeedbackStatus: "NOT_REQUESTED",
      aiReview: requestable,
    }),
    ...[false, "true", 1, null, undefined].map((value) =>
      toSubmissionDetailResponse({
        id: "s",
        contentRevision: 0,
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
    contentRevision: 0,
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
    0,
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

test("AI requests require the displayed work revision and polling cannot silently upgrade it", () => {
  for (const revision of [undefined, null, -1, 1.5]) {
    const operations = new SubmissionAiOperations(
      "s",
      "NOT_REQUESTED",
      makeDetail().aiReview,
      revision,
    );
    expect(operations.beginRequest()).toBeNull();
  }
  const operations = makeOperations();
  const newer = toSubmissionDetailResponse({
    id: "s",
    contentRevision: 1,
    aiFeedbackStatus: "NOT_REQUESTED",
    aiReview: requestable,
  });
  expect(operations.finishRead(operations.beginRead(false)!, newer)).toBe(true);
  expect(operations.view.status).toBe("NOT_REQUESTED");
  expect(operations.view.review).toMatchObject({
    provider: null,
    inputCoverage: "NOT_SENT",
    canRequest: true,
    usage: {
      reservedRequests: 0,
      reportedRequests: 0,
      unreportedRequests: 0,
      promptTokens: 0,
      inputTextTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      completionTokens: 0,
      outputTextTokens: 0,
      reasoningTokens: 0,
      answerTokens: 0,
      totalTokens: 0,
    },
  });
  expect(operations.view.contentRevision).toBe(1);
  expect(operations.view.displayedRevision).toBe(0);
  expect(operations.beginRequest()).toBeNull();
  expect(operations.confirmDisplayedRevision(0)).toBe(false);
  expect(operations.confirmDisplayedRevision(1)).toBe(true);
  const request = operations.beginRequest()!;
  expect(request.expectedRevision).toBe(1);
  expect(operations.confirmDisplayedRevision(2)).toBe(false);
});

test("uncertain AI writes require an explicit read and still require viewing a changed revision", () => {
  const operations = makeOperations();
  const request = operations.beginRequest()!;
  expect(request.expectedRevision).toBe(0);
  operations.finishRequest(request);
  expect(operations.beginRequest()).toBeNull();
  const newer = toSubmissionDetailResponse({
    id: "s",
    contentRevision: 2,
    aiFeedbackStatus: "NOT_REQUESTED",
    aiReview: requestable,
  });
  expect(operations.finishRead(operations.beginRead(true)!, newer)).toBe(true);
  expect(operations.beginRequest()).toBeNull();
  expect(operations.view.busy).toBeNull();
  expect(operations.confirmDisplayedRevision(2)).toBe(true);
  expect(operations.beginRequest()?.expectedRevision).toBe(2);
});
