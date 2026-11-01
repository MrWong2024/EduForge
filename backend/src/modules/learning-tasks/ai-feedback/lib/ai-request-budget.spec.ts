import { checkInputBudget, readReportedUsage } from './ai-request-budget';
describe('complete message UTF-8 budget', () => {
  // The JSON envelope contributes 30 bytes; fixtures include JSON escaping.
  it.each([
    ['A', 31],
    ['中', 33],
    ['😀', 34],
    ['\n', 32],
    ['"', 32],
    ['\\', 32],
    ['A中😀\n"\\', 44],
  ])('counts %p as %i bytes and admits exactly the limit', (content, bytes) => {
    const messages = [{ role: 'user' as const, content }];
    expect(checkInputBudget(messages, bytes)).toBe(bytes);
    expect(() => checkInputBudget(messages, bytes - 1)).toThrow(
      'INPUT_BUDGET_EXCEEDED',
    );
  });
  it('includes all system and user message structure', () => {
    const messages = [
      { role: 'system' as const, content: '中' },
      { role: 'user' as const, content: '😀' },
    ];
    expect(checkInputBudget(messages, 68)).toBe(68);
    expect(() => checkInputBudget(messages, 67)).toThrow();
  });
});
describe('upstream usage only', () => {
  it('accepts reported counters without adding reasoning detail', () => {
    expect(
      readReportedUsage({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
          completion_tokens_details: { reasoning_tokens: 6 },
        },
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 8,
      totalTokens: 18,
      inputTextTokens: null,
      cachedInputTokens: null,
      outputTextTokens: null,
      reasoningTokens: 6,
    });
  });
  it('preserves the fixed reported text, cache and thinking counters', () => {
    expect(
      readReportedUsage({
        usage: {
          prompt_tokens: 12993,
          completion_tokens: 3632,
          total_tokens: 16625,
          prompt_tokens_details: { text_tokens: 12993, cached_tokens: 0 },
          completion_tokens_details: {
            text_tokens: 3632,
            reasoning_tokens: 3230,
          },
        },
      }),
    ).toEqual({
      promptTokens: 12993,
      completionTokens: 3632,
      totalTokens: 16625,
      inputTextTokens: 12993,
      cachedInputTokens: 0,
      outputTextTokens: 3632,
      reasoningTokens: 3230,
    });
  });
  it('retains explicit zero for every counter', () => {
    expect(
      readReportedUsage({
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          prompt_tokens_details: { text_tokens: 0, cached_tokens: 0 },
          completion_tokens_details: { text_tokens: 0, reasoning_tokens: 0 },
        },
      }),
    ).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      inputTextTokens: 0,
      cachedInputTokens: 0,
      outputTextTokens: 0,
      reasoningTokens: 0,
    });
  });
  it.each([undefined, null, 'invalid', 5, {}])(
    'keeps valid primary usage when both detail groups are %p',
    (details) => {
      expect(
        readReportedUsage({
          usage: {
            prompt_tokens: 10,
            completion_tokens: 8,
            total_tokens: 18,
            prompt_tokens_details: details,
            completion_tokens_details: details,
          },
        }),
      ).toEqual({
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
        inputTextTokens: null,
        cachedInputTokens: null,
        outputTextTokens: null,
        reasoningTokens: null,
      });
    },
  );
  describe.each([
    ['inputTextTokens', 'prompt_tokens_details', 'text_tokens'],
    ['cachedInputTokens', 'prompt_tokens_details', 'cached_tokens'],
    ['outputTextTokens', 'completion_tokens_details', 'text_tokens'],
    ['reasoningTokens', 'completion_tokens_details', 'reasoning_tokens'],
  ] as const)('%s detail isolation', (field, group, key) => {
    it.each([
      undefined,
      null,
      '1',
      true,
      {},
      -1,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      11,
    ])('invalid %p only makes this detail unknown', (value) => {
      const usage = {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
        prompt_tokens_details: { text_tokens: 10, cached_tokens: 3 },
        completion_tokens_details: { text_tokens: 8, reasoning_tokens: 6 },
      };
      expect(
        readReportedUsage({
          usage: {
            ...usage,
            [group]: { ...usage[group], [key]: value },
          },
        }),
      ).toEqual({
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
        inputTextTokens: 10,
        cachedInputTokens: 3,
        outputTextTokens: 8,
        reasoningTokens: 6,
        [field]: null,
      });
    });
  });
  it.each([
    null,
    {},
    { usage: null },
    { usage: {} },
    { usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 } },
    { usage: { prompt_tokens: 1.5, completion_tokens: 1, total_tokens: 2.5 } },
    { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 } },
    { usage: { prompt_tokens: '1', completion_tokens: 1, total_tokens: 2 } },
    {
      usage: {
        prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
        completion_tokens: 0,
        total_tokens: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    {
      usage: {
        prompt_tokens: Infinity,
        completion_tokens: 1,
        total_tokens: Infinity,
      },
    },
  ])('returns unknown for %p', (data) =>
    expect(readReportedUsage(data)).toBeNull(),
  );
});
