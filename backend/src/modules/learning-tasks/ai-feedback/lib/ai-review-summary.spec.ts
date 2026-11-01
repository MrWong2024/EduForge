import { buildAiReviewSummary, AiReviewJob } from './ai-review-summary';
import { AiFeedbackJobStatus } from '../schemas/ai-feedback-job.schema';
import type { AiTokenUsage } from '../interfaces/ai-feedback-provider.interface';
const job: AiReviewJob = {
  budgetVersion: 1,
  status: AiFeedbackJobStatus.Succeeded,
  attempts: 2,
  maxAttempts: 3,
  provider: 'bailian',
  requests: [
    {
      claimNo: 1,
      provider: 'bailian',
      model: 'fixture',
      inputBytes: 12345,
      maxOutputTokens: 2048,
      reservedAt: new Date(0),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
    {
      claimNo: 2,
      provider: 'bailian',
      model: 'fixture',
      inputBytes: 12345,
      maxOutputTokens: 2048,
      reservedAt: new Date(1),
      usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 },
    },
  ],
};
function summarize(...usages: Array<AiTokenUsage | null>) {
  return buildAiReviewSummary(
    {
      ...job,
      requests: usages.map((usage, index) => ({
        claimNo: index + 1,
        provider: 'bailian',
        model: 'fixture',
        inputBytes: 12345,
        maxOutputTokens: 2048,
        reservedAt: new Date(index),
        usage,
      })),
    },
    null,
    false,
  ).usage;
}
const detailedUsage: AiTokenUsage = {
  promptTokens: 12993,
  completionTokens: 3632,
  totalTokens: 16625,
  inputTextTokens: 12993,
  cachedInputTokens: 0,
  outputTextTokens: 3632,
  reasoningTokens: 3230,
};
describe('public AI review summary', () => {
  it('sums every reported request, including failures preceding success', () => {
    expect(buildAiReviewSummary(job, null, false)).toMatchObject({
      provider: 'bailian',
      canRequest: false,
      inputCoverage: 'FULL',
      usage: {
        reservedRequests: 2,
        reportedRequests: 2,
        unreportedRequests: 0,
        promptTokens: 30,
        inputTextTokens: null,
        cachedInputTokens: null,
        uncachedInputTokens: null,
        completionTokens: 12,
        outputTextTokens: null,
        reasoningTokens: null,
        answerTokens: null,
        totalTokens: 42,
      },
    });
  });
  it('keeps counts but all token totals unknown when any usage is missing', () => {
    expect(
      buildAiReviewSummary(
        {
          ...job,
          requests: job.requests?.map((r, i) =>
            i === 0 ? { ...r, usage: null } : r,
          ),
        },
        null,
        false,
      ).usage,
    ).toEqual({
      reservedRequests: 2,
      reportedRequests: 1,
      unreportedRequests: 1,
      promptTokens: null,
      inputTextTokens: null,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      completionTokens: null,
      outputTextTokens: null,
      reasoningTokens: null,
      answerTokens: null,
      totalTokens: null,
    });
  });
  it('keeps historical unknowns distinct from new zero usage', () => {
    expect(
      buildAiReviewSummary({ ...job, budgetVersion: undefined }, null, false),
    ).toMatchObject({
      provider: null,
      inputCoverage: 'UNKNOWN',
      usage: {
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
      },
    });
    for (const candidate of [
      null,
      { ...job, provider: 'stub' as const, requests: [] },
    ])
      expect(buildAiReviewSummary(candidate, null, false)).toMatchObject({
        inputCoverage: 'NOT_SENT',
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
  });
  it('derives the fixed sample per request without adding reasoning to totals', () => {
    expect(summarize(detailedUsage)).toEqual({
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
    });
    expect(summarize(detailedUsage, detailedUsage)).toEqual({
      reservedRequests: 2,
      reportedRequests: 2,
      unreportedRequests: 0,
      promptTokens: 25986,
      inputTextTokens: 25986,
      cachedInputTokens: 0,
      uncachedInputTokens: 25986,
      completionTokens: 7264,
      outputTextTokens: 7264,
      reasoningTokens: 6460,
      answerTokens: 804,
      totalTokens: 33250,
    });
  });
  it('derives nonzero cache and preserves zero answer usage', () => {
    expect(
      summarize({
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        inputTextTokens: 100,
        cachedInputTokens: 30,
        outputTextTokens: 20,
        reasoningTokens: 20,
      }),
    ).toMatchObject({
      cachedInputTokens: 30,
      uncachedInputTokens: 70,
      answerTokens: 0,
    });
  });
  it('keeps other totals known when a reported request lacks only reasoning', () => {
    expect(
      summarize(detailedUsage, {
        ...detailedUsage,
        reasoningTokens: undefined,
      }),
    ).toEqual({
      reservedRequests: 2,
      reportedRequests: 2,
      unreportedRequests: 0,
      promptTokens: 25986,
      inputTextTokens: 25986,
      cachedInputTokens: 0,
      uncachedInputTokens: 25986,
      completionTokens: 7264,
      outputTextTokens: 7264,
      reasoningTokens: null,
      answerTokens: null,
      totalTokens: 33250,
    });
  });
  it.each([undefined, null])(
    'does not replace missing output text (%p) with completion tokens',
    (outputTextTokens) => {
      expect(summarize({ ...detailedUsage, outputTextTokens })).toMatchObject({
        completionTokens: 3632,
        outputTextTokens: null,
        reasoningTokens: 3230,
        answerTokens: null,
      });
    },
  );
  it('rejects each contradictory answer before summing, even if another difference offsets it', () => {
    expect(
      summarize(
        {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          outputTextTokens: 2,
          reasoningTokens: 3,
        },
        {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          outputTextTokens: 8,
          reasoningTokens: 1,
        },
      ),
    ).toMatchObject({
      reportedRequests: 2,
      outputTextTokens: 10,
      reasoningTokens: 4,
      answerTokens: null,
    });
  });
  it('rejects a per-request cache contradiction before another request can offset it', () => {
    expect(
      summarize(
        {
          promptTokens: 10,
          completionTokens: 0,
          totalTokens: 10,
          inputTextTokens: 10,
          cachedInputTokens: 11,
        },
        {
          promptTokens: 10,
          completionTokens: 0,
          totalTokens: 10,
          inputTextTokens: 10,
          cachedInputTokens: 0,
        },
      ),
    ).toMatchObject({
      reportedRequests: 2,
      promptTokens: 20,
      inputTextTokens: 20,
      cachedInputTokens: null,
      uncachedInputTokens: null,
    });
  });
  it.each([
    { inputTextTokens: -1 },
    { cachedInputTokens: 0.5 },
    { outputTextTokens: Infinity },
    { reasoningTokens: Number.MAX_SAFE_INTEGER + 1 },
  ])('keeps malformed optional historical detail isolated: %p', (invalid) => {
    const usage = summarize({ ...detailedUsage, ...invalid });
    expect(usage).toMatchObject({
      reportedRequests: 1,
      unreportedRequests: 0,
      promptTokens: 12993,
      completionTokens: 3632,
      totalTokens: 16625,
    });
    expect(usage[Object.keys(invalid)[0] as keyof typeof usage]).toBeNull();
  });
  it('returns null for new totals that overflow safe integers, independently', () => {
    const input: AiTokenUsage = {
      promptTokens: Number.MAX_SAFE_INTEGER,
      completionTokens: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
      inputTextTokens: Number.MAX_SAFE_INTEGER,
      cachedInputTokens: Number.MAX_SAFE_INTEGER - 1,
      outputTextTokens: 0,
      reasoningTokens: 0,
    };
    expect(summarize(input, input)).toMatchObject({
      inputTextTokens: null,
      cachedInputTokens: null,
      uncachedInputTokens: 2,
      outputTextTokens: 0,
      reasoningTokens: 0,
      answerTokens: 0,
    });
    expect(
      summarize(
        { ...input, cachedInputTokens: 0 },
        { ...input, cachedInputTokens: 0 },
      ),
    ).toMatchObject({
      cachedInputTokens: 0,
      uncachedInputTokens: null,
    });
    const output: AiTokenUsage = {
      promptTokens: 0,
      completionTokens: Number.MAX_SAFE_INTEGER,
      totalTokens: Number.MAX_SAFE_INTEGER,
      inputTextTokens: 0,
      cachedInputTokens: 0,
      outputTextTokens: Number.MAX_SAFE_INTEGER,
      reasoningTokens: Number.MAX_SAFE_INTEGER - 1,
    };
    expect(summarize(output, output)).toMatchObject({
      inputTextTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTextTokens: null,
      reasoningTokens: null,
      answerTokens: 2,
    });
    expect(
      summarize(
        { ...output, reasoningTokens: 0 },
        { ...output, reasoningTokens: 0 },
      ),
    ).toMatchObject({
      reasoningTokens: 0,
      answerTokens: null,
    });
  });
  it('allows one new eligible request and never resets existing jobs', () => {
    expect(buildAiReviewSummary(null, null, false).canRequest).toBe(true);
    expect(
      buildAiReviewSummary(null, '当前策略不允许申请', false),
    ).toMatchObject({
      canRequest: false,
      requestBlockReason: '当前策略不允许申请',
    });
    expect(buildAiReviewSummary(job, null, false).canRequest).toBe(false);
  });
  it('advertises scheduling only for current FAILED with remaining attempts, date and enabled worker', () => {
    const failed = {
      ...job,
      status: AiFeedbackJobStatus.Failed,
      notBefore: new Date('2026-10-10T00:00:00Z'),
    };
    expect(buildAiReviewSummary(failed, null, true)).toMatchObject({
      retryScheduled: true,
      nextRetryAt: '2026-10-10T00:00:00.000Z',
    });
    for (const candidate of [
      job,
      { ...failed, budgetVersion: undefined },
      { ...failed, attempts: 3 },
      { ...failed, notBefore: null },
    ])
      expect(buildAiReviewSummary(candidate, null, true)).toMatchObject({
        retryScheduled: false,
        nextRetryAt: null,
      });
    expect(buildAiReviewSummary(failed, null, false)).toMatchObject({
      retryScheduled: false,
      nextRetryAt: null,
    });
  });
  it('uses only server-controlled safe Chinese failure messages', () => {
    const review = buildAiReviewSummary(
      {
        ...job,
        status: AiFeedbackJobStatus.Dead,
        requests: [],
        failureCode: 'INPUT_BUDGET_EXCEEDED',
      },
      null,
      false,
    );
    expect(review.failure).toEqual({
      code: 'INPUT_BUDGET_EXCEEDED',
      message: '作业已保存，完整内容超过 AI 输入限额，本次未生成 AI 反馈。',
    });
    expect(review.inputCoverage).toBe('NOT_SENT');
    expect(Object.keys(review).sort()).toEqual([
      'canRequest',
      'failure',
      'inputCoverage',
      'nextRetryAt',
      'provider',
      'requestBlockReason',
      'retryScheduled',
      'usage',
    ]);
  });
});
