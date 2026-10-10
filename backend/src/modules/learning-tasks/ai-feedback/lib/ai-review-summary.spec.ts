import { buildAiReviewSummary, AiReviewJob } from './ai-review-summary';
import { AiFeedbackJobStatus } from '../schemas/ai-feedback-job.schema';
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
describe('public AI review summary', () => {
  it('sums every reported request, including failures preceding success', () => {
    expect(buildAiReviewSummary(job, null, false)).toMatchObject({
      provider: 'bailian',
      canRequest: false,
      inputCoverage: 'FULL',
      usage: {
        reservedRequests: 2,
        reportedRequests: 2,
        promptTokens: 30,
        completionTokens: 12,
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
      promptTokens: null,
      completionTokens: null,
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
        promptTokens: null,
        completionTokens: null,
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
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
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
