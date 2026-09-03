import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envValidationSchema } from '../../../../../config/env.validation';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';
import { DefaultStubAiFeedbackProvider } from '../../services/default-stub-ai-feedback.provider';
import { BailianFeedbackProvider } from './bailian-feedback.provider';

const context: AiSubmissionAnalysisContext = {
  submissionId: 'unit-submission',
  taskId: 'unit-task',
  taskTitle: 'Return a number',
  taskDescription: 'Implement the function.',
  attemptNo: 1,
  language: 'typescript',
  codeText: 'function answer() { return 1; }',
};

const item = {
  type: 'STYLE',
  severity: 'WARN',
  message: 'Use a descriptive name.',
};

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200 },
  );
}

function configService(overrides: Record<string, unknown> = {}) {
  const result = envValidationSchema.validate({
    NODE_ENV: 'test',
    MAIL_FROM: 'unit@example.invalid',
    MONGO_URI: 'mongodb://127.0.0.1:1/ai_feedback_unit',
    AI_FEEDBACK_PROVIDER: 'bailian',
    BAILIAN_API_KEY: 'synthetic-unit-key',
  });
  if (result.error) throw result.error;
  const values = { ...(result.value as Record<string, unknown>), ...overrides };
  const config = new ConfigService(values);
  // Keep absent-key defense tests independent of the host environment.
  jest
    .spyOn(config, 'get')
    .mockImplementation((property: string) => values[property]);
  return config;
}

describe('AI Feedback providers (fake fetch only)', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected fetch in unit test'));
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    const remainingTimers = jest.getTimerCount();
    jest.useRealTimers();
    jest.restoreAllMocks();
    expect(remainingTimers).toBe(0);
  });

  it('runs stub without API keys or network access', async () => {
    const provider = new DefaultStubAiFeedbackProvider();

    await expect(provider.analyzeSubmission(context)).resolves.toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Bailian with validated defaults while the worker is disabled', async () => {
    const config = configService();
    expect(config.get<boolean>('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    const provider = new BailianFeedbackProvider(config);
    fetchMock.mockResolvedValue(
      chatResponse(JSON.stringify({ items: [item] })),
    );

    await expect(provider.analyzeSubmission(context)).resolves.toMatchObject([
      item,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer synthetic-unit-key',
      'Content-Type': 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (typeof init?.body !== 'string')
      throw new Error('Expected a JSON string request body');
    const payload = JSON.parse(init.body) as {
      model: string;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(Object.keys(payload).sort()).toEqual([
      'messages',
      'model',
      'temperature',
    ]);
    expect(payload).toMatchObject({ model: 'qwen-plus', temperature: 0.2 });
    expect(payload.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
    ]);
    expect(typeof payload.messages[0].content).toBe('string');
    expect(payload.messages[1].content).toContain(context.codeText);
  });

  it.each([undefined, '', ' \t '])(
    'rejects a missing or blank key (%p) before fetch',
    async (apiKey) => {
      const provider = new BailianFeedbackProvider(
        configService({ BAILIAN_API_KEY: apiKey }),
      );

      await expect(provider.analyzeSubmission(context)).rejects.toMatchObject({
        code: 'MISSING_API_KEY',
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves the non-retryable unauthorized error', async () => {
    const provider = new BailianFeedbackProvider(configService());
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(provider.analyzeSubmission(context)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses fenced structured JSON and preserves the two-item protocol cap', async () => {
    const provider = new BailianFeedbackProvider(configService());
    const fence = String.fromCharCode(96).repeat(3);
    fetchMock.mockResolvedValue(
      chatResponse(
        fence +
          'json\n' +
          JSON.stringify({
            items: [
              item,
              { ...item, message: 'Second issue.' },
              { ...item, message: 'Third issue.' },
            ],
          }) +
          '\n' +
          fence,
      ),
    );

    await expect(provider.analyzeSubmission(context)).resolves.toMatchObject([
      item,
      { ...item, message: 'Second issue.' },
    ]);
  });

  it.each([
    'not-json',
    JSON.stringify({ items: [{ ...item, unexpected: true }] }),
    JSON.stringify({ items: 'invalid' }),
  ])(
    'rejects malformed structured responses without retry (%#)',
    async (content) => {
      const provider = new BailianFeedbackProvider(configService());
      fetchMock.mockResolvedValue(chatResponse(content));

      await expect(provider.analyzeSubmission(context)).rejects.toMatchObject({
        code: 'BAD_RESPONSE',
        retryable: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the configured retry count and backoff before a successful response', async () => {
    const provider = new BailianFeedbackProvider(
      configService({ BAILIAN_MAX_RETRIES: 1 }),
    );
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ items: [item] })));
    const pending = provider.analyzeSubmission(context);
    const assertion = expect(pending).resolves.toMatchObject([item]);

    await jest.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured retry budget is exhausted', async () => {
    const provider = new BailianFeedbackProvider(
      configService({ BAILIAN_MAX_RETRIES: 1 }),
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const assertion = expect(
      provider.analyzeSubmission(context),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_5XX',
      retryable: true,
    });

    await jest.advanceTimersByTimeAsync(200);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts timed-out requests and applies only the configured retry budget', async () => {
    const provider = new BailianFeedbackProvider(
      configService({
        BAILIAN_TIMEOUT_MS: 1000,
        BAILIAN_MAX_RETRIES: 1,
      }),
    );
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Request aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const assertion = expect(
      provider.analyzeSubmission(context),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });

    await jest.advanceTimersByTimeAsync(2200);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
    ).toBe(true);
  });
});
