import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envValidationSchema } from '../../../../../config/env.validation';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';
import { DefaultStubAiFeedbackProvider } from '../../services/default-stub-ai-feedback.provider';
import { BailianFeedbackProvider } from './bailian-feedback.provider';
import { OpenRouterFeedbackProvider } from './openrouter-feedback.provider';

const context: AiSubmissionAnalysisContext = {
  submissionId: 'unit-submission',
  taskId: 'unit-task',
  taskTitle: 'Return a number',
  taskDescription: 'Implement the function.',
  attemptNo: 1,
  language: 'typescript',
  codeText: 'function answer() { return 1; }',
};

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

  describe.each([
    {
      name: 'bailian',
      Provider: BailianFeedbackProvider,
      key: 'BAILIAN_API_KEY',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    },
    {
      name: 'openrouter',
      Provider: OpenRouterFeedbackProvider,
      key: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
    },
  ])('$name', ({ name, Provider, key, baseUrl, model }) => {
    function configService(overrides: Record<string, unknown> = {}) {
      const result = envValidationSchema.validate({
        NODE_ENV: 'test',
        MAIL_FROM: 'unit@example.invalid',
        MONGO_URI: 'mongodb://127.0.0.1:1/ai_feedback_unit',
        AI_FEEDBACK_PROVIDER: name,
        [key]: 'synthetic-unit-key',
      });
      if (result.error) throw result.error;
      const values = {
        ...(result.value as Record<string, unknown>),
        ...overrides,
      };
      const config = new ConfigService(values);
      // Keep absent-key defense tests independent of the host environment.
      jest
        .spyOn(config, 'get')
        .mockImplementation((property: string) => values[property]);
      return config;
    }

    it('calls the selected provider with validated defaults while the worker is disabled', async () => {
      const config = configService();
      expect(config.get<boolean>('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
      const provider = new Provider(config);
      const item = {
        type: 'STYLE',
        severity: 'WARN',
        message: 'Use a descriptive name.',
      };
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ items: [item] }) } },
            ],
          }),
          { status: 200 },
        ),
      );

      await expect(provider.analyzeSubmission(context)).resolves.toMatchObject([
        item,
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetchMock.mock.calls[0];
      expect(endpoint).toBe(baseUrl + '/chat/completions');
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: 'Bearer synthetic-unit-key',
          'Content-Type': 'application/json',
        },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (typeof init?.body !== 'string') {
        throw new Error('Expected a JSON string request body');
      }
      const payload = JSON.parse(init.body) as {
        model: string;
        temperature: number;
        messages: Array<{ role: string; content: string }>;
        response_format?: unknown;
      };
      expect(payload).toMatchObject({ model, temperature: 0.2 });
      expect(payload.messages.map((message) => message.role)).toEqual([
        'system',
        'user',
      ]);
      expect(typeof payload.messages[0].content).toBe('string');
      expect(payload.messages[1].content).toContain(context.codeText);
      if (name === 'openrouter') {
        expect(init?.headers).toMatchObject({
          'HTTP-Referer': 'https://eduforge.local',
          'X-Title': 'EduForge',
        });
        expect(payload.response_format).toEqual({ type: 'json_object' });
      } else {
        expect(init?.headers).not.toHaveProperty('HTTP-Referer');
        expect(init?.headers).not.toHaveProperty('X-Title');
        expect(payload).not.toHaveProperty('response_format');
      }
    });

    it.each([undefined, '', ' \t '])(
      'rejects a missing or blank key (%p) before fetch',
      async (apiKey) => {
        const provider = new Provider(configService({ [key]: apiKey }));

        await expect(provider.analyzeSubmission(context)).rejects.toMatchObject(
          {
            code: 'MISSING_API_KEY',
            retryable: false,
          },
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('preserves the non-retryable unauthorized error', async () => {
      const provider = new Provider(configService());
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

      await expect(provider.analyzeSubmission(context)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        retryable: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
