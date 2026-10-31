import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { envValidationSchema } from '../../../../../config/env.validation';
import { AiFeedbackExecution } from '../../interfaces/ai-feedback-provider.interface';
import { AiSubmissionAnalysisContext } from '../../interfaces/ai-submission-analysis-context.interface';
import { DefaultStubAiFeedbackProvider } from '../../services/default-stub-ai-feedback.provider';
import { AiFeedbackRequestBodyDumper } from '../../lib/ai-feedback-request-body-dumper';
import { compactAiFeedbackItems } from '../../lib/feedback-item-compactor';
import { buildSystemPrompt } from '../../prompts/ai-feedback.prompt';
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

type DiagnosticHandle = Parameters<
  NonNullable<AiFeedbackExecution['onDiagnosticHandle']>
>[0];

function diagnosticResponseBody(content: string, finishReason = 'stop') {
  return JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
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

  async function diagnosticProvider(overrides: Record<string, unknown> = {}) {
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
        ...overrides,
      }),
    );
    const directory = await useTestDumpDirectory(provider);
    const handles: DiagnosticHandle[] = [];
    const hooks = execution();
    hooks.onDiagnosticHandle = jest.fn((handle: DiagnosticHandle) => {
      handles.push(handle);
    });
    return { provider, directory, handles, hooks };
  }

  async function readResponseDiagnostic(
    directory: string,
    handle: DiagnosticHandle,
  ) {
    return JSON.parse(
      await fs.readFile(
        resolve(directory, 'diagnostics', `${handle.traceId}.response.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
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
        enable_thinking: true,
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
      const createHandle = jest.spyOn(
        AiFeedbackRequestBodyDumper.prototype,
        'createHandle',
      );
      const save = jest
        .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
        .mockResolvedValue(undefined);
      const saveResponse = jest
        .spyOn(AiFeedbackRequestBodyDumper.prototype, 'saveResponse')
        .mockResolvedValue(undefined);
      const saveCompaction = jest
        .spyOn(AiFeedbackRequestBodyDumper.prototype, 'saveCompaction')
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

      const hooks = execution();
      hooks.onDiagnosticHandle = jest.fn();
      await expect(provider.analyzeSubmission(context, hooks)).resolves.toEqual(
        [],
      );

      expect(createHandle).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(saveResponse).not.toHaveBeenCalled();
      expect(saveCompaction).not.toHaveBeenCalled();
      expect(hooks.onDiagnosticHandle).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retain a preflight, budget rejection, or failed reservation', async () => {
    const createHandle = jest.spyOn(
      AiFeedbackRequestBodyDumper.prototype,
      'createHandle',
    );
    const save = jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
      .mockResolvedValue(undefined);
    const saveResponse = jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'saveResponse')
      .mockResolvedValue(undefined);
    const mkdir = jest.spyOn(fs, 'mkdir');
    const writeFile = jest.spyOn(fs, 'writeFile');
    const provider = new BailianFeedbackProvider(
      configService({
        NODE_ENV: 'development',
        AI_FEEDBACK_DUMP_REQUEST_BODY: true,
        AI_FEEDBACK_MAX_INPUT_BYTES: 16384,
      }),
    );
    provider.assertInputEligible(context);
    const budgetHooks = execution();
    budgetHooks.onDiagnosticHandle = jest.fn();
    await expect(
      provider.analyzeSubmission(
        { ...context, codeText: '中'.repeat(10000) },
        budgetHooks,
      ),
    ).rejects.toMatchObject({ code: 'INPUT_BUDGET_EXCEEDED' });
    const hooks = execution();
    hooks.onDiagnosticHandle = jest.fn();
    const failure = new Error('synthetic reservation failure');
    hooks.reserveRequest = jest.fn().mockRejectedValue(failure);
    await expect(provider.analyzeSubmission(context, hooks)).rejects.toBe(
      failure,
    );

    expect(createHandle).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(saveResponse).not.toHaveBeenCalled();
    expect(budgetHooks.onDiagnosticHandle).not.toHaveBeenCalled();
    expect(hooks.onDiagnosticHandle).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
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
    await useTestDumpDirectory(provider);
    let finishRetention: (() => void) | undefined;
    let beginRetention: (() => void) | undefined;
    const retentionStarted = new Promise<void>((resolve) => {
      beginRetention = resolve;
    });
    const save = jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'save')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRetention = resolve;
            beginRetention?.();
          }),
      );
    fetchMock.mockImplementation(() => {
      expect(jest.getTimerCount()).toBe(1);
      return Promise.resolve(chatResponse(JSON.stringify({ items: [item] })));
    });
    const pending = provider.analyzeSubmission(context, execution());
    await retentionStarted;
    expect(save).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    if (!finishRetention) throw new Error('Retention did not begin');
    finishRetention();

    await expect(pending).resolves.toMatchObject([item]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains raw response text and distinct validation, normalization and cap stages', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    const upstreamItems = [
      {
        type: 'OTHER',
        severity: 'INFO',
        message: '结论：空集合返回空结果。\n\n依据：保留首次出现次序。',
        tags: ['correctness', 'correctness'],
      },
      { ...item, message: '第二条合成反馈。' },
      { ...item, message: '第三条合成反馈。' },
    ];
    const rawResponseBody =
      ' \n' +
      diagnosticResponseBody(JSON.stringify({ items: upstreamItems })) +
      '\n ';
    const response = new Response(rawResponseBody, { status: 200 });
    const readText = jest.spyOn(response, 'text');
    const readJson = jest.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);

    const result = await provider.analyzeSubmission(context, hooks);

    expect(handles).toHaveLength(1);
    const handle = handles[0];
    const saved = await readResponseDiagnostic(directory, handle);
    const normalized = [
      { ...upstreamItems[0], tags: ['correctness'] },
      upstreamItems[1],
      upstreamItems[2],
    ];
    expect(saved).toMatchObject({
      traceId: handle.traceId,
      submissionId: context.submissionId,
      requestFileName: handle.requestFileName,
      requestSaved: true,
      createdAt: handle.createdAt,
      httpStatus: 200,
      rawResponseBody,
      validatedItemsBeforeNormalize: upstreamItems,
      normalizedItemsBeforeCap: normalized,
      providerItemsAfterCap: normalized.slice(0, 2),
      reachedStage: 'provider_capped',
      failureCode: null,
    });
    expect(typeof saved.recordedAt).toBe('string');
    expect(result).toMatchObject(normalized.slice(0, 2));
    expect(result).toHaveLength(2);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(readJson).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(handle.requestFileName).toBe(`${handle.traceId}.json`);
    const [, init] = fetchMock.mock.calls[0];
    if (typeof init?.body !== 'string')
      throw new Error('Expected request body');
    expect(init.body).not.toContain(handle.traceId);
    expect(init.body).not.toContain('traceId');
    expect(
      await fs.readFile(resolve(directory, handle.requestFileName)),
    ).toEqual(Buffer.from(init.body, 'utf8'));
    expect(await fs.readdir(resolve(directory, 'diagnostics'))).toEqual([
      `${handle.traceId}.response.json`,
    ]);
  });

  it.each([
    {
      label: 'HTTP rejection',
      status: 429,
      body: diagnosticResponseBody(JSON.stringify({ items: [item] })),
      code: 'RATE_LIMIT_UPSTREAM',
      retryable: true,
      stage: 'response_parsed',
      hasUsage: true,
    },
    {
      label: 'HTTP rejection with non-JSON text',
      status: 401,
      body: 'unauthorized 合成响应\n',
      code: 'UNAUTHORIZED',
      retryable: false,
      stage: 'response_body_read',
      hasUsage: false,
    },
    {
      label: 'output limit',
      status: 200,
      body: diagnosticResponseBody(JSON.stringify({ items: [item] }), 'length'),
      code: 'OUTPUT_LIMIT_REACHED',
      retryable: false,
      stage: 'response_parsed',
      hasUsage: true,
    },
    {
      label: 'malformed response JSON',
      status: 200,
      body: '{"choices":',
      code: 'BAD_RESPONSE',
      retryable: false,
      stage: 'response_body_read',
      hasUsage: false,
    },
    {
      label: 'malformed feedback JSON',
      status: 200,
      body: diagnosticResponseBody('not-feedback-json'),
      code: 'BAD_RESPONSE',
      retryable: false,
      stage: 'response_parsed',
      hasUsage: true,
    },
    {
      label: 'invalid feedback structure',
      status: 200,
      body: diagnosticResponseBody(JSON.stringify({ items: 'invalid' })),
      code: 'BAD_RESPONSE',
      retryable: false,
      stage: 'response_parsed',
      hasUsage: true,
    },
    {
      label: 'a later invalid item',
      status: 200,
      body: diagnosticResponseBody(
        JSON.stringify({ items: [item, { ...item, unexpected: true }] }),
      ),
      code: 'BAD_RESPONSE',
      retryable: false,
      stage: 'response_parsed',
      hasUsage: true,
    },
  ])(
    'retains raw text for $label without inventing uncompleted item stages',
    async ({ status, body, code, retryable, stage, hasUsage }) => {
      const { provider, directory, handles, hooks } =
        await diagnosticProvider();
      fetchMock.mockResolvedValue(new Response(body, { status }));

      await expect(
        provider.analyzeSubmission(context, hooks),
      ).rejects.toMatchObject({ code, retryable });

      expect(handles).toHaveLength(1);
      const saved = await readResponseDiagnostic(directory, handles[0]);
      expect(saved).toMatchObject({
        requestSaved: true,
        httpStatus: status,
        rawResponseBody: body,
        validatedItemsBeforeNormalize: null,
        normalizedItemsBeforeCap: null,
        providerItemsAfterCap: null,
        reachedStage: stage,
        failureCode: code,
      });
      expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
      expect(hooks.reportUsage).toHaveBeenCalledWith(
        hasUsage
          ? { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
          : null,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('distinguishes a valid empty response from stages that were not completed', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    const rawResponseBody = diagnosticResponseBody('{"items":[]}');
    fetchMock.mockResolvedValue(new Response(rawResponseBody, { status: 200 }));

    await expect(provider.analyzeSubmission(context, hooks)).resolves.toEqual(
      [],
    );

    expect(await readResponseDiagnostic(directory, handles[0])).toMatchObject({
      rawResponseBody,
      validatedItemsBeforeNormalize: [],
      normalizedItemsBeforeCap: [],
      providerItemsAfterCap: [],
      reachedStage: 'provider_capped',
      failureCode: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records unavailable raw response and null stages after a network failure', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    fetchMock.mockRejectedValue({ name: 'AbortError' });

    await expect(
      provider.analyzeSubmission(context, hooks),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });

    expect(await readResponseDiagnostic(directory, handles[0])).toMatchObject({
      httpStatus: null,
      rawResponseBody: null,
      validatedItemsBeforeNormalize: null,
      normalizedItemsBeforeCap: null,
      providerItemsAfterCap: null,
      reachedStage: 'request_ready',
      failureCode: 'TIMEOUT',
    });
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent traces separate for the same submission', async () => {
    const { provider, directory } = await diagnosticProvider();
    const handles: DiagnosticHandle[] = [];
    const hooks = [execution(), execution()];
    hooks.forEach((hook, index) => {
      hook.onDiagnosticHandle = jest.fn((handle: DiagnosticHandle) => {
        handles[index] = handle;
      });
    });
    const messages = ['first synthetic response', 'second synthetic response'];
    const rawBodies = messages.map((message) =>
      diagnosticResponseBody(JSON.stringify({ items: [{ ...item, message }] })),
    );
    fetchMock.mockImplementation((_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected body');
      const index = init.body.includes('CONCURRENT_FIRST_SOURCE') ? 0 : 1;
      return Promise.resolve(new Response(rawBodies[index], { status: 200 }));
    });

    const results = await Promise.all(
      hooks.map((hook, index) =>
        provider.analyzeSubmission(
          {
            ...context,
            codeText:
              index === 0
                ? 'CONCURRENT_FIRST_SOURCE'
                : 'CONCURRENT_SECOND_SOURCE',
          },
          hook,
        ),
      ),
    );

    expect(handles).toHaveLength(2);
    expect(handles[0].traceId).not.toBe(handles[1].traceId);
    for (let index = 0; index < 2; index++) {
      expect(results[index]).toMatchObject([
        { ...item, message: messages[index] },
      ]);
      expect(
        await readResponseDiagnostic(directory, handles[index]),
      ).toMatchObject({
        traceId: handles[index].traceId,
        requestFileName: handles[index].requestFileName,
        rawResponseBody: rawBodies[index],
        providerItemsAfterCap: [{ ...item, message: messages[index] }],
      });
      expect(hooks[index].reportUsage).toHaveBeenCalledTimes(1);
    }
    expect(
      (await fs.readdir(directory)).filter((name) => name.endsWith('.json')),
    ).toHaveLength(2);
    expect(
      (await fs.readdir(resolve(directory, 'diagnostics'))).sort(),
    ).toEqual(
      handles.map((handle) => `${handle.traceId}.response.json`).sort(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains a correlated response after request-file writing fails', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    const writeFile = fs.writeFile;
    jest.spyOn(fs, 'writeFile').mockImplementation((file, data, options) => {
      if (typeof file === 'string' && dirname(file) === directory) {
        return Promise.reject(new Error('synthetic request write failure'));
      }
      return writeFile(file, data, options);
    });
    const rawResponseBody = diagnosticResponseBody(
      JSON.stringify({ items: [item] }),
    );
    fetchMock.mockResolvedValue(new Response(rawResponseBody, { status: 200 }));

    await expect(
      provider.analyzeSubmission(context, hooks),
    ).resolves.toMatchObject([item]);

    expect(handles).toHaveLength(1);
    expect(await readResponseDiagnostic(directory, handles[0])).toMatchObject({
      traceId: handles[0].traceId,
      requestFileName: handles[0].requestFileName,
      requestSaved: false,
      rawResponseBody,
      reachedStage: 'provider_capped',
      failureCode: null,
    });
    expect(
      (await fs.readdir(directory)).filter((name) => name.endsWith('.json')),
    ).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      'AI feedback request body retention failed: submissionId=unit-submission',
    );
  });

  it.each([
    'initialization',
    'callback',
    'response write',
    'serialization',
    'snapshot',
  ])(
    'keeps one fetch and usage result when diagnostic %s fails',
    async (failurePoint) => {
      const { provider, directory, handles, hooks } =
        await diagnosticProvider();
      const rawResponseBody = diagnosticResponseBody(
        JSON.stringify({ items: [item] }),
      );
      fetchMock.mockResolvedValue(
        new Response(rawResponseBody, { status: 200 }),
      );
      const diagnosticFailure = new Error('synthetic diagnostic-only failure');
      if (failurePoint === 'initialization') {
        jest
          .spyOn(AiFeedbackRequestBodyDumper.prototype, 'createHandle')
          .mockImplementation(() => {
            throw diagnosticFailure;
          });
      } else if (failurePoint === 'callback') {
        hooks.onDiagnosticHandle = jest
          .fn()
          .mockRejectedValue(diagnosticFailure);
      } else if (failurePoint === 'response write') {
        const writeFile = fs.writeFile;
        jest
          .spyOn(fs, 'writeFile')
          .mockImplementation((file, data, options) => {
            if (typeof file === 'string' && file.endsWith('.response.json')) {
              return Promise.reject(diagnosticFailure);
            }
            return writeFile(file, data, options);
          });
      } else if (failurePoint === 'serialization') {
        const stringify = JSON.stringify;
        jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
          if (
            value &&
            typeof value === 'object' &&
            'rawResponseBody' in value
          ) {
            throw diagnosticFailure;
          }
          return stringify(value);
        });
      } else {
        jest.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
          throw diagnosticFailure;
        });
      }

      await expect(
        provider.analyzeSubmission(context, hooks),
      ).resolves.toMatchObject([item]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
      expect(hooks.reportUsage).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(warnMock).not.toHaveBeenCalledWith(
        expect.stringContaining('synthetic diagnostic-only failure'),
      );
      if (
        failurePoint === 'response write' ||
        failurePoint === 'serialization'
      ) {
        expect(
          (await fs.readdir(directory)).filter((name) =>
            name.endsWith('.json'),
          ),
        ).toHaveLength(1);
        if (failurePoint === 'response write') {
          expect(await fs.readdir(resolve(directory, 'diagnostics'))).toEqual(
            [],
          );
        } else {
          await expect(
            fs.readdir(resolve(directory, 'diagnostics')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(warnMock).toHaveBeenCalledWith(
          'AI feedback response diagnostics retention failed: submissionId=unit-submission',
        );
      }
      if (failurePoint === 'snapshot') {
        expect(handles).toHaveLength(1);
        const saved = await readResponseDiagnostic(directory, handles[0]);
        expect(saved).toMatchObject({
          captureFailed: true,
          validatedItemsBeforeNormalize: null,
          normalizedItemsBeforeCap: [item],
          providerItemsAfterCap: [item],
          reachedStage: 'provider_capped',
          failureCode: null,
        });
      }
    },
  );

  it('keeps the original Provider error when response diagnostics fail', async () => {
    const { provider, hooks } = await diagnosticProvider();
    jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'saveResponse')
      .mockRejectedValue(new Error('synthetic diagnostic save failure'));
    fetchMock.mockResolvedValue(
      new Response(diagnosticResponseBody(JSON.stringify({ items: [item] })), {
        status: 429,
      }),
    );

    await expect(
      provider.analyzeSubmission(context, hooks),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_UPSTREAM',
      retryable: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('preserves usage persistence errors with response retention enabled', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    const rawResponseBody = diagnosticResponseBody(
      JSON.stringify({ items: [item] }),
    );
    const failure = new Error('synthetic usage persistence failure');
    hooks.reportUsage = jest.fn().mockRejectedValue(failure);
    fetchMock.mockResolvedValue(new Response(rawResponseBody, { status: 200 }));

    await expect(provider.analyzeSubmission(context, hooks)).rejects.toBe(
      failure,
    );

    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readResponseDiagnostic(directory, handles[0])).toMatchObject({
      rawResponseBody,
      reachedStage: 'response_parsed',
      validatedItemsBeforeNormalize: null,
      normalizedItemsBeforeCap: null,
      providerItemsAfterCap: null,
    });
  });

  it('clears the HTTP timer before awaiting response diagnostic I/O', async () => {
    const { provider, hooks } = await diagnosticProvider({
      BAILIAN_TIMEOUT_MS: 1000,
    });
    let enterRetention: (() => void) | undefined;
    let finishRetention: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterRetention = resolve;
    });
    jest
      .spyOn(AiFeedbackRequestBodyDumper.prototype, 'saveResponse')
      .mockImplementation(() => {
        enterRetention?.();
        return new Promise<void>((resolve) => {
          finishRetention = resolve;
        });
      });
    fetchMock.mockResolvedValue(
      chatResponse(JSON.stringify({ items: [item] })),
    );
    const pending = provider.analyzeSubmission(context, hooks);
    try {
      await entered;
      expect(jest.getTimerCount()).toBe(0);
      const signal = fetchMock.mock.calls[0][1]?.signal;
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(5000);
      expect(signal?.aborted).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      finishRetention?.();
    }
    await expect(pending).resolves.toMatchObject([item]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps response text reading inside the HTTP timeout', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider({
      BAILIAN_TIMEOUT_MS: 1000,
    });
    let enterBodyRead: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterBodyRead = resolve;
    });
    fetchMock.mockImplementation((_url, init) => {
      const response = chatResponse(JSON.stringify({ items: [item] }));
      jest.spyOn(response, 'text').mockImplementation(
        () =>
          new Promise<string>((_resolve, reject) => {
            const abortError = new Error('synthetic response body abort');
            abortError.name = 'AbortError';
            init?.signal?.addEventListener('abort', () => reject(abortError), {
              once: true,
            });
            enterBodyRead?.();
          }),
      );
      return Promise.resolve(response);
    });
    const assertion = expect(
      provider.analyzeSubmission(context, hooks),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    await entered;
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(await readResponseDiagnostic(directory, handles[0])).toMatchObject({
      httpStatus: 200,
      rawResponseBody: null,
      reachedStage: 'http_response',
      validatedItemsBeforeNormalize: null,
      normalizedItemsBeforeCap: null,
      providerItemsAfterCap: null,
      failureCode: 'TIMEOUT',
    });
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith(null);
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
      enable_thinking: true,
    });
    expect(payload.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
    ]);
    expect(typeof payload.messages[0].content).toBe('string');
    expect(payload.messages[1].content).toContain(context.codeText);
  });

  it('uses only final content while retaining raw reasoning and reported usage', async () => {
    const { provider, directory, handles, hooks } = await diagnosticProvider();
    const finalItem = {
      type: 'OTHER',
      severity: 'INFO',
      message: '源码为空输入返回空结果，符合任务要求。',
      tags: ['correctness'],
    };
    const reasoningItem = {
      type: 'BUG',
      severity: 'ERROR',
      message: '合成思考内容，不得作为最终反馈。',
    };
    const rawResponse = JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            reasoning_content: JSON.stringify({ items: [reasoningItem] }),
            content: JSON.stringify({ items: [finalItem] }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
        completion_tokens_details: { reasoning_tokens: 6 },
      },
    });
    fetchMock.mockResolvedValue(new Response(rawResponse));

    const result = await provider.analyzeSubmission(context, hooks);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(finalItem);
    expect(result[0].message).toBe(finalItem.message);
    expect(result[0]).not.toHaveProperty('reasoning_content');
    expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
    expect(hooks.reportUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 8,
      totalTokens: 18,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(1);
    const saved = await readResponseDiagnostic(directory, handles[0]);
    expect(saved.rawResponseBody).toBe(rawResponse);
    expect(saved.providerItemsAfterCap).toEqual([finalItem]);
  });

  it.each([undefined, 'not valid feedback JSON'])(
    'rejects content=%p without using valid-looking reasoning as a fallback',
    async (content) => {
      const provider = new BailianFeedbackProvider(configService());
      const hooks = execution();
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content,
                  reasoning_content: JSON.stringify({ items: [item] }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 8,
              total_tokens: 18,
              completion_tokens_details: { reasoning_tokens: 6 },
            },
          }),
        ),
      );

      await expect(
        provider.analyzeSubmission(context, hooks),
      ).rejects.toMatchObject({ code: 'BAD_RESPONSE', retryable: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(hooks.reportUsage).toHaveBeenCalledTimes(1);
      expect(hooks.reportUsage).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
      });
    },
  );

  it.each([
    { prefix: 'Valid shape example A', count: 1 },
    { prefix: 'Valid shape example B', count: 2 },
    { prefix: 'Valid boundary example C', count: 1 },
    { prefix: 'Schema example:', count: 1 },
  ])(
    'parses the actual $prefix JSON example through fake-fetch Provider',
    async ({ prefix, count }) => {
      const exampleLine = buildSystemPrompt()
        .split('\n')
        .find((line) => line.startsWith(prefix));
      if (!exampleLine) throw new Error('Expected a prompt JSON example');
      const separator = exampleLine.indexOf(': ');
      expect(separator).toBeGreaterThanOrEqual(0);
      fetchMock.mockResolvedValue(
        chatResponse(exampleLine.slice(separator + 2)),
      );

      const parsed = await new BailianFeedbackProvider(
        configService(),
      ).analyzeSubmission(context, execution());

      expect(parsed).toHaveLength(count);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves synthetic dimension paragraphs and evidence boundaries through parsing and compaction', async () => {
    const provider = new BailianFeedbackProvider(configService());
    const syntheticContext: AiSubmissionAnalysisContext = {
      ...context,
      language: 'python',
      taskTitle: '标签去重与协作实践',
      taskDescription:
        '保持首次出现次序并去重；记录真实协作，给出本人独立解释及亲手变式。',
      taskRubric: {
        notes:
          '评价作品行为、运行依据、真实协作和本人实践；不复述内部参考资料。',
      },
      codeText:
        'def unique_labels(labels):\n    return list(dict.fromkeys(labels))',
      submissionNote:
        '助手报告空列表及重复标签检查通过，属于工具代跑。任务卡和采纳记录为教学模拟；尚未提供本人独立解释和亲手变式。',
      aiUsageDeclaration: '助手代跑检查；协作材料为教学模拟。',
    };
    // This response is synthetic text, not evidence of real-model quality.
    const syntheticMessage = [
      '作品行为：源码用 dict.fromkeys 去重并保留首次出现次序，空列表返回空列表。',
      '运行依据：助手报告空列表及重复标签检查通过，属于工具代跑；平台未执行，不能据此确认本人运行。',
      '真实协作：任务卡和采纳记录明确标为教学模拟，内容可供核对，但不足以确认任务要求的真实协作。',
      '本人实践：提交说明明确尚未提供独立解释和亲手变式，任务所需本人实践证据不足；代码正确不能单独证明本人掌握，也不据此推断作弊。',
    ].join('\n\n');
    const syntheticItem = {
      type: 'OTHER',
      severity: 'WARN',
      message: syntheticMessage,
      suggestion:
        '按任务要求补充真实协作材料及本人解释、亲手变式的实际记录；未完成的如实说明。',
      tags: ['correctness', 'documentation'],
    };
    fetchMock.mockResolvedValue(
      chatResponse(JSON.stringify({ items: [syntheticItem] })),
    );

    const parsed = await provider.analyzeSubmission(
      syntheticContext,
      execution(),
    );
    const compacted = compactAiFeedbackItems(parsed);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject(syntheticItem);
    expect(parsed[0].message).toBe(syntheticMessage);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject(syntheticItem);
    expect(compacted[0].message).toBe(syntheticMessage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', ' \t '])(
    'rejects a missing or blank key (%p) before fetch',
    async (apiKey) => {
      const { provider, directory, handles, hooks } = await diagnosticProvider({
        BAILIAN_API_KEY: apiKey,
      });

      await expect(
        provider.analyzeSubmission(context, hooks),
      ).rejects.toMatchObject({
        code: 'MISSING_API_KEY',
        retryable: false,
      });
      expect(handles).toEqual([]);
      expect(hooks.onDiagnosticHandle).not.toHaveBeenCalled();
      expect(hooks.reserveRequest).not.toHaveBeenCalled();
      await expect(fs.readdir(directory)).rejects.toMatchObject({
        code: 'ENOENT',
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
