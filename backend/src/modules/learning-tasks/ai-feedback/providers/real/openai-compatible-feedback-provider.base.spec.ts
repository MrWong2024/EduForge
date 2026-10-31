import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { envValidationSchema } from '../../../../../config/env.validation';
import { AiFeedbackExecution } from '../../interfaces/ai-feedback-provider.interface';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';
import { DefaultStubAiFeedbackProvider } from '../../services/default-stub-ai-feedback.provider';
import { AiFeedbackRequestBodyDumper } from '../../lib/ai-feedback-request-body-dumper';
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
      choices: [{ finish_reason: 'stop', message: { content } }],
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

function execution(): AiFeedbackExecution {
  return {
    reserveRequest: jest.fn().mockResolvedValue(undefined),
    reportUsage: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AI Feedback providers (fake fetch only)', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let logMock: jest.SpiedFunction<Logger['log']>;
  let warnMock: jest.SpiedFunction<Logger['warn']>;
  let temporaryDirectory: string | undefined;
  const temporaryParent = resolve(
    __dirname,
    '../../../../../../../.local/deliverables',
  );

  async function useTestDumpDirectory(provider: BailianFeedbackProvider) {
    await fs.mkdir(temporaryParent, { recursive: true });
    temporaryDirectory = await fs.mkdtemp(
      resolve(temporaryParent, '.tmp-ai-request-tests-'),
    );
    const directory = resolve(temporaryDirectory, 'requests');
    Object.defineProperty(provider, 'requestBodyDumper', {
      value: new AiFeedbackRequestBodyDumper(new Logger('unit'), directory),
    });
    return directory;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected fetch in unit test'));
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warnMock = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    logMock = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    const remainingTimers = jest.getTimerCount();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (temporaryDirectory) {
      if (
        dirname(temporaryDirectory) !== temporaryParent ||
        !basename(temporaryDirectory).startsWith('.tmp-ai-request-tests-')
      ) {
        throw new Error(
          'Refusing cleanup outside the owned temporary directory',
        );
      }
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
    expect(remainingTimers).toBe(0);
  });

  it('retains exactly the complete string handed to fake fetch after reservation', async () => {
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
      }),
    );
    const directory = await useTestDumpDirectory(provider);
    const completeContext: AiSubmissionAnalysisContext = {
      ...context,
      taskTitle: '合成统计任务',
      taskDescription: '保持空集合行为，并解释过滤条件。完整任务尾部。',
      taskRubric: {
        criteria: ['结果正确', '说明依据'],
        note: '完整 rubric 尾部',
      },
      codeText: 'def total(values):\n    return sum(values)\n# 学生源码尾部',
      submissionNote: '学生报告：使用示例数据检查了空集合。说明尾部。',
      aiUsageDeclaration: 'AI 工具仅提供检查建议，未代跑。声明尾部。',
      referenceFiles: [
        {
          referenceNo: 1,
          entryPath: 'guide/a.md',
          text: '参考 A\n完整 A 尾部',
        },
        {
          referenceNo: 2,
          entryPath: 'checks/b.py',
          text: '# 参考 B\nassert True\n完整 B 尾部',
        },
      ],
    };
    const hooks = execution();
    const successfulResponse = chatResponse(JSON.stringify({ items: [item] }));
    const stringify = jest.spyOn(JSON, 'stringify');
    fetchMock.mockImplementation(async (_url, init) => {
      expect(hooks.reserveRequest).toHaveBeenCalledTimes(1);
      if (typeof init?.body !== 'string')
        throw new Error('Expected string body');
      const files = await fs.readdir(directory);
      expect(files).toHaveLength(1);
      const saved = await fs.readFile(resolve(directory, files[0]));
      expect(saved).toEqual(Buffer.from(init.body, 'utf8'));
      expect(saved.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(init.body.endsWith('}')).toBe(true);
      expect(init.body).not.toContain('synthetic-unit-key');
      expect(init.body).not.toContain('Authorization');
      const payload = JSON.parse(init.body) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
        max_tokens: number;
        enable_thinking: boolean;
      };
      expect(Object.keys(payload).sort()).toEqual([
        'enable_thinking',
        'max_tokens',
        'messages',
        'model',
        'temperature',
      ]);
      expect(payload).toMatchObject({
        model: 'qwen-plus',
        temperature: 0.2,
        max_tokens: 2048,
        enable_thinking: false,
      });
      const userMessage = payload.messages[1].content;
      for (const material of [
        completeContext.taskTitle,
        completeContext.taskDescription,
        JSON.stringify(completeContext.taskRubric),
        completeContext.codeText,
        completeContext.submissionNote,
        completeContext.aiUsageDeclaration,
        ...(completeContext.referenceFiles ?? []).map((file) => file.text),
      ]) {
        expect(userMessage).toContain(material);
      }
      return successfulResponse;
    });

    await expect(
      provider.analyzeSubmission(completeContext, hooks),
    ).resolves.toMatchObject([item]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      stringify.mock.calls.filter(
        ([value]) =>
          typeof value === 'object' && value !== null && 'messages' in value,
      ),
    ).toHaveLength(1);
    expect(logMock).toHaveBeenCalledWith(
      expect.stringContaining(context.submissionId),
    );
    expect(logMock).toHaveBeenCalledWith(expect.stringContaining(directory));
    expect(logMock).not.toHaveBeenCalledWith(
      expect.stringContaining(completeContext.codeText),
    );
  });

  it.each([
    ['development', undefined],
    ['development', false],
    ['development', 'false'],
    ['development', 'true'],
    ['test', true],
    ['browser_acceptance', true],
    ['production', true],
  ])(
    'does not touch files for environment %s and flag %p',
    async (nodeEnv, flag) => {
      const save = jest
        .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
        .mockResolvedValue(undefined);
      const mkdir = jest.spyOn(fs, 'mkdir');
      const writeFile = jest.spyOn(fs, 'writeFile');
      fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ items: [] })));
      const provider = new BailianFeedbackProvider(
        configService({
          NODE_ENV: nodeEnv,
          AI_FEEDBACK_DUMP_REQUEST_BODY: flag,
          EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
        }),
      );

      await expect(
        provider.analyzeSubmission(context, execution()),
      ).resolves.toEqual([]);

      expect(save).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retain a preflight, budget rejection, or failed reservation', async () => {
    const save = jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
      .mockResolvedValue(undefined);
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
        AI_FEEDBACK_MAX_INPUT_BYTES: 16384,
      }),
    );
    provider.assertInputEligible(context);
    await expect(
      provider.analyzeSubmission(
        { ...context, codeText: '中'.repeat(10000) },
        execution(),
      ),
    ).rejects.toMatchObject({ code: 'INPUT_BUDGET_EXCEEDED' });
    const hooks = execution();
    const failure = new Error('synthetic reservation failure');
    hooks.reserveRequest = jest.fn().mockRejectedValue(failure);
    await expect(provider.analyzeSubmission(context, hooks)).rejects.toBe(
      failure,
    );

    expect(save).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues one fetch when the owned retention path cannot be written', async () => {
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
      }),
    );
    const directory = await useTestDumpDirectory(provider);
    await fs.writeFile(directory, 'owned blocking file');
    fetchMock.mockResolvedValue(
      chatResponse(JSON.stringify({ items: [item] })),
    );

    await expect(
      provider.analyzeSubmission(context, execution()),
    ).resolves.toMatchObject([item]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      'AI feedback request body retention failed: submissionId=unit-submission',
    );
  });

  it('starts HTTP timing only after the retention attempt settles', async () => {
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
      }),
    );
    let finishRetention: (() => void) | undefined;
    const save = jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRetention = resolve;
          }),
      );
    fetchMock.mockImplementation(() => {
      expect(jest.getTimerCount()).toBe(1);
      return Promise.resolve(chatResponse(JSON.stringify({ items: [item] })));
    });
    const pending = provider.analyzeSubmission(context, execution());
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    if (!finishRetention) throw new Error('Retention did not begin');
    finishRetention();

    await expect(pending).resolves.toMatchObject([item]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    await expect(
      provider.analyzeSubmission(context, execution()),
    ).resolves.toMatchObject([item]);
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
      'enable_thinking',
      'max_tokens',
      'messages',
      'model',
      'temperature',
    ]);
    expect(payload).toMatchObject({
      model: 'qwen-plus',
      temperature: 0.2,
      max_tokens: 2048,
      enable_thinking: false,
    });
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

      await expect(
        provider.analyzeSubmission(context, execution()),
      ).rejects.toMatchObject({
        code: 'MISSING_API_KEY',
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves the non-retryable unauthorized error', async () => {
    const provider = new BailianFeedbackProvider(configService());
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      provider.analyzeSubmission(context, execution()),
    ).rejects.toMatchObject({
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

    await expect(
      provider.analyzeSubmission(context, execution()),
    ).resolves.toMatchObject([item, { ...item, message: 'Second issue.' }]);
  });

  it.each([
    'not-json',
    JSON.stringify({ items: [{ ...item, unexpected: true }] }),
    JSON.stringify({ items: 'invalid' }),
    JSON.stringify({ items: [{ ...item, type: 'INVALID' }] }),
    JSON.stringify({ items: [{ ...item, severity: 'INVALID' }] }),
    JSON.stringify({ items: [{ ...item, suggestion: {} }] }),
    JSON.stringify({ items: [{ ...item, tags: ['unsupported-tag'] }] }),
    JSON.stringify({ items: [{ ...item, scoreHint: '99' }] }),
  ])(
    'rejects malformed structured responses without retry (%#)',
    async (content) => {
      const provider = new BailianFeedbackProvider(configService());
      fetchMock.mockResolvedValue(chatResponse(content));

      await expect(
        provider.analyzeSubmission(context, execution()),
      ).rejects.toMatchObject({
        code: 'BAD_RESPONSE',
        retryable: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry even when the retired provider retry setting is present', async () => {
    const provider = new BailianFeedbackProvider(
      configService({ BAILIAN_MAX_RETRIES: 99 }),
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      provider.analyzeSubmission(context, execution()),
    ).rejects.toMatchObject({ code: 'UPSTREAM_5XX', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts one timed-out request without Provider retries', async () => {
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
      provider.analyzeSubmission(context, execution()),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });

    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
    ).toBe(true);
  });
  it('requires a persisted reservation before fetch and leaves DB failures internal', async () => {
    const provider = new BailianFeedbackProvider(configService());
    const hooks = execution();
    const failure = new Error('synthetic persistence failure');
    hooks.reserveRequest = jest.fn().mockRejectedValue(failure);
    await expect(provider.analyzeSubmission(context, hooks)).rejects.toBe(
      failure,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects oversized complete messages before reservation or fetch', async () => {
    const provider = new BailianFeedbackProvider(
      configService({
        AI_FEEDBACK_MAX_INPUT_BYTES: 16384,
        AI_FEEDBACK_MAX_CODE_CHARS: 1,
      }),
    );
    const hooks = execution();
    await expect(
      provider.analyzeSubmission(
        { ...context, codeText: '中'.repeat(10000) },
        hooks,
      ),
    ).rejects.toMatchObject({
      code: 'INPUT_BUDGET_EXCEEDED',
      retryable: false,
    });
    expect(hooks.reserveRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [200, 'length', JSON.stringify({ items: [item] }), 'OUTPUT_LIMIT_REACHED'],
    [200, undefined, JSON.stringify({ items: [item] }), 'BAD_RESPONSE'],
    [200, 'tool_calls', JSON.stringify({ items: [item] }), 'BAD_RESPONSE'],
    [200, 'stop', 'bad-json', 'BAD_RESPONSE'],
    [429, 'stop', '', 'RATE_LIMIT_UPSTREAM'],
    [500, 'stop', '', 'UPSTREAM_5XX'],
  ])(
    'persists valid usage before handling status %i / finish %p',
    async (status, finish, content, code) => {
      const hooks = execution();
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: finish, message: { content } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
          { status },
        ),
      );
      await expect(
        new BailianFeedbackProvider(configService()).analyzeSubmission(
          context,
          hooks,
        ),
      ).rejects.toMatchObject({ code });
      expect(hooks.reportUsage).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps usage persistence errors internal after one successful response', async () => {
    const hooks = execution();
    const failure = new Error('usage write failed');
    hooks.reportUsage = jest.fn().mockRejectedValue(failure);
    fetchMock.mockResolvedValue(
      chatResponse(JSON.stringify({ items: [item] })),
    );
    await expect(
      new BailianFeedbackProvider(configService()).analyzeSubmission(
        context,
        hooks,
      ),
    ).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('classifies native abort errors across realms without relying on instanceof Error', async () => {
    const hooks = execution();
    fetchMock.mockRejectedValue({ name: 'AbortError' });
    await expect(
      new BailianFeedbackProvider(configService()).analyzeSubmission(
        context,
        hooks,
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect(hooks.reportUsage).toHaveBeenCalledWith(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
