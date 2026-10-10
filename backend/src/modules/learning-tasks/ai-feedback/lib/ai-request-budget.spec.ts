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
    ).toEqual({ promptTokens: 10, completionTokens: 8, totalTokens: 18 });
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
        prompt_tokens: Infinity,
        completion_tokens: 1,
        total_tokens: Infinity,
      },
    },
  ])('returns unknown for %p', (data) =>
    expect(readReportedUsage(data)).toBeNull(),
  );
});
