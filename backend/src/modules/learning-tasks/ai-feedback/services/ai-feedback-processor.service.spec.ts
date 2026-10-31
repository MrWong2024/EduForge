import { AiContextError } from '../../ai-context/ai-context.types';
import { DefaultStubAiFeedbackProvider } from './default-stub-ai-feedback.provider';
import { AiContextReaderService } from '../../ai-context/ai-context-reader.service';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types, Mongoose } from 'mongoose';
import fs from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { AiFeedbackProcessor } from './ai-feedback-processor.service';
import { AiFeedbackGuardsService } from './ai-feedback-guards.service';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../schemas/ai-feedback-job.schema';
import { Submission } from '../../schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackType,
} from '../../schemas/feedback.schema';
import { ClassroomTask } from '../../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { AI_FEEDBACK_PROVIDER_TOKEN } from '../interfaces/ai-feedback-provider.interface';
import type {
  AiFeedbackCompactionDiagnostic,
  AiFeedbackDiagnosticHandle,
  AiFeedbackItem,
} from '../interfaces/ai-feedback-provider.interface';
import { BailianFeedbackProvider } from '../providers/real/bailian-feedback.provider';
import { AiFeedbackRequestBodyDumper } from '../lib/ai-feedback-request-body-dumper';
import { AiFeedbackProviderError } from '../interfaces/ai-feedback-provider.error';
import * as compactor from '../lib/feedback-item-compactor';
const query = <T>(value: T) => {
  const q = { exec: jest.fn().mockResolvedValue(value), lean: jest.fn() };
  q.lean.mockReturnValue(q);
  return q;
};
async function harness() {
  const job = {
    _id: new Types.ObjectId(),
    submissionId: new Types.ObjectId(),
    taskId: new Types.ObjectId(),
    classroomTaskId: new Types.ObjectId(),
    status: 'RUNNING',
    budgetVersion: 1,
    attempts: 1,
    maxAttempts: 3,
    lockOwner: 'unit-claim',
  };
  const jobModel = {
    findOneAndUpdate: jest
      .fn<
        ReturnType<typeof query<unknown>>,
        [
          Record<string, unknown>,
          Record<string, unknown>,
          Record<string, unknown>?,
        ]
      >()
      .mockReturnValue(query(null)),
    updateOne: jest.fn().mockReturnValue(query({ matchedCount: 1 })),
    exists: jest.fn().mockResolvedValue({ _id: job._id }),
  };
  jobModel.findOneAndUpdate
    .mockReturnValueOnce(query(null))
    .mockReturnValueOnce(query(job));
  const feedback = { insertMany: jest.fn().mockResolvedValue([]) };
  const release = jest.fn();
  const guards = {
    tryConsume: jest.fn().mockReturnValue(true),
    acquire: jest.fn().mockResolvedValue(release),
  };
  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    AI_FEEDBACK_DUMP_REQUEST_BODY: false,
    AI_FEEDBACK_MAX_INPUT_BYTES: 65536,
    AI_FEEDBACK_PROVIDER: 'bailian',
    BAILIAN_API_KEY: 'synthetic-unit-key',
    BAILIAN_BASE_URL: 'http://127.0.0.1:1',
  };
  const config = new ConfigService(values);
  // ConfigService.set also writes process.env; keep this harness entirely local.
  jest
    .spyOn(config, 'get')
    .mockImplementation((property: string) => values[property]);
  jest
    .spyOn(config, 'set')
    .mockImplementation((property: string, value: unknown) => {
      values[property] = value;
    });
  const provider = new BailianFeedbackProvider(config);
  const module = await Test.createTestingModule({
    providers: [
      AiFeedbackProcessor,
      AiContextReaderService,
      { provide: ConfigService, useValue: config },
      { provide: AiFeedbackGuardsService, useValue: guards },
      {
        provide: AI_FEEDBACK_PROVIDER_TOKEN,
        useValue: provider,
      },
      { provide: getModelToken(AiFeedbackJob.name), useValue: jobModel },
      { provide: getModelToken(Feedback.name), useValue: feedback },
      {
        provide: getModelToken(Submission.name),
        useValue: {
          findById: jest.fn().mockReturnValue(
            query({
              _id: job.submissionId,
              taskId: job.taskId,
              classroomTaskId: job.classroomTaskId,
              attemptNo: 1,
              content: {
                codeText: 'console.log("unit");',
                submissionNote: 'unit note',
              },
            }),
          ),
        },
      },
      {
        provide: getModelToken(ClassroomTask.name),
        useValue: {
          findById: jest.fn().mockReturnValue(
            query({
              taskId: job.taskId,
              taskSnapshot: {
                title: 'unit',
                description: 'fixture',
                rubric: { requirement: 'unit' },
              },
            }),
          ),
        },
      },
    ],
  }).compile();
  return {
    config,
    module,
    processor: module.get(AiFeedbackProcessor),
    job,
    jobModel,
    feedback,
    guards,
    release,
    provider,
  };
}

function diagnosticFor(submissionId: string) {
  const saveCompaction = jest
    .fn<Promise<void>, [AiFeedbackCompactionDiagnostic]>()
    .mockResolvedValue(undefined);
  const handle: AiFeedbackDiagnosticHandle = {
    traceId: 'synthetic-processor-trace',
    submissionId,
    requestFileName: 'synthetic-processor-request.json',
    createdAt: '2026-11-01T00:00:00.000Z',
    requestSaved: true,
    saveCompaction,
  };
  return { handle, saveCompaction };
}

async function removeOwnedDiagnosticDirectory(
  directory: string | undefined,
  parent: string,
): Promise<void> {
  if (!directory) return;
  if (
    dirname(directory) !== parent ||
    !basename(directory).startsWith('.tmp-ai-processor-diagnostics-')
  ) {
    throw new Error('Refusing cleanup outside the owned temporary directory');
  }
  await fs.rm(directory, { recursive: true, force: true });
}
describe('claim and paid request persistence gates (no database)', () => {
  afterEach(() => jest.restoreAllMocks());
  it('does not hydrate historical jobs with budgetVersion=1', () => {
    const model = new Mongoose().model(AiFeedbackJob.name, AiFeedbackJobSchema);
    const historical = new model({ status: 'SUCCEEDED' });
    expect(historical.budgetVersion).toBeUndefined();
    expect(historical.requests).toBeUndefined();
  });
  it.each(['unmatched', 'database failure'])(
    'blocks fetch when reservation is %s and never schedules a paid replay',
    async (mode) => {
      const h = await harness();
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Unexpected fetch'));
      h.jobModel.updateOne.mockReturnValueOnce(query({ matchedCount: 1 }));
      const reserve = query({ matchedCount: 0 });
      if (mode === 'database failure')
        reserve.exec.mockRejectedValue(new Error('synthetic write failure'));
      h.jobModel.updateOne.mockReturnValueOnce(reserve);
      try {
        expect(await h.processor.processOnce(1)).toEqual({
          processed: 1,
          succeeded: 0,
          failed: 0,
          dead: 1,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        const claim = h.jobModel.findOneAndUpdate.mock.calls[1];
        expect(claim[0]).toMatchObject({
          budgetVersion: 1,
          status: { $in: ['PENDING', 'FAILED'] },
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
        });
        expect(claim[1]).toMatchObject({
          $inc: { attempts: 1 },
          $set: { status: 'RUNNING' },
        });
        const final = h.jobModel.findOneAndUpdate.mock.calls[2];
        expect(final[0]).toMatchObject({
          _id: h.job._id,
          status: 'RUNNING',
          attempts: 1,
          lockOwner: 'unit-claim',
        });
        expect(final[1]).toMatchObject({
          $set: {
            status: 'DEAD',
            failureCode: 'INTERNAL_ERROR',
            notBefore: null,
          },
        });
        expect(final[1]).not.toHaveProperty('$inc');
      } finally {
        await h.module.close();
      }
    },
  );
  it.each(['usage', 'feedback'])(
    'does not retry HTTP when %s persistence fails after a response',
    async (stage) => {
      const h = await harness();
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    items: [
                      { type: 'STYLE', severity: 'WARN', message: 'fixture' },
                    ],
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
            },
          }),
        ),
      );
      if (stage === 'usage') {
        h.jobModel.updateOne
          .mockReturnValueOnce(query({ matchedCount: 1 }))
          .mockReturnValueOnce(query({ matchedCount: 1 }));
        const failure = query({ matchedCount: 1 });
        failure.exec.mockRejectedValue(new Error('usage write failed'));
        h.jobModel.updateOne.mockReturnValueOnce(failure);
      } else
        h.feedback.insertMany.mockRejectedValue(
          new Error('feedback write failed'),
        );
      try {
        expect(await h.processor.processOnce(1)).toMatchObject({
          dead: 1,
          failed: 0,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(h.jobModel.findOneAndUpdate.mock.calls[2][1]).toMatchObject({
          $set: { failureCode: 'INTERNAL_ERROR', status: 'DEAD' },
        });
      } finally {
        await h.module.close();
      }
    },
  );
  it('consumes the claim but reserves no request when locally rate limited', async () => {
    const h = await harness();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected fetch'));
    h.guards.tryConsume.mockReturnValue(false);
    try {
      expect(await h.processor.processOnce(1)).toMatchObject({ failed: 1 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(h.jobModel.updateOne).toHaveBeenCalledTimes(1);
      expect(h.jobModel.findOneAndUpdate.mock.calls[2][1]).toMatchObject({
        $set: { status: 'FAILED', failureCode: 'RATE_LIMITED' },
      });
    } finally {
      await h.module.close();
    }
  });
  it('rejects oversized material as DEAD even when the local limiter would reject', async () => {
    const h = await harness();
    h.config.set('AI_FEEDBACK_MAX_INPUT_BYTES', 16384);
    h.guards.tryConsume.mockReturnValue(false);
    const classroomModel = h.module.get<{ findById: jest.Mock }>(
      getModelToken(ClassroomTask.name),
    );
    classroomModel.findById.mockReturnValue(
      query({
        taskId: h.job.taskId,
        taskSnapshot: { title: 'unit', description: '中'.repeat(20000) },
      }),
    );
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected fetch'));
    try {
      expect(await h.processor.processOnce(1)).toMatchObject({
        dead: 1,
        failed: 0,
      });
      expect(h.guards.tryConsume).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(h.jobModel.findOneAndUpdate.mock.calls[2][1]).toMatchObject({
        $set: { failureCode: 'INPUT_BUDGET_EXCEEDED' },
      });
    } finally {
      await h.module.close();
    }
  });
});

describe('claim-local pre-persistence compaction diagnostics (no database)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('correlates real request, response and compaction files for a merged fake-fetch result', async () => {
    const h = await harness();
    const temporaryParent = resolve(
      __dirname,
      '../../../../../..',
      '.local/deliverables',
    );
    let ownedDirectory: string | undefined;
    try {
      await fs.mkdir(temporaryParent, { recursive: true });
      const directory = await fs.mkdtemp(
        resolve(temporaryParent, '.tmp-ai-processor-diagnostics-'),
      );
      ownedDirectory = directory;
      const dumper = new AiFeedbackRequestBodyDumper(
        { log: jest.fn(), warn: jest.fn() },
        directory,
      );
      Object.defineProperty(h.provider, 'requestBodyDumper', { value: dumper });
      const createHandle = jest.spyOn(dumper, 'createHandle');
      h.config.set('NODE_ENV', 'development');
      h.config.set('AI_FEEDBACK_DUMP_REQUEST_BODY', true);
      const rawResponse = JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: [
                  {
                    type: 'SYNTAX',
                    severity: 'ERROR',
                    message: '第 12 行缺少分号',
                    suggestion: '在 `foo()` 后补齐分号。',
                  },
                  {
                    type: 'SYNTAX',
                    severity: 'ERROR',
                    message: '第 26 行缺少分号',
                    suggestion: '在 `Foo()` 后补齐分号。',
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(rawResponse));
      expect(await h.processor.processOnce(1)).toMatchObject({ succeeded: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(createHandle).toHaveBeenCalledTimes(1);
      const createdHandle = createHandle.mock.results[0];
      if (!createdHandle || createdHandle.type !== 'return') {
        throw new Error('Expected one returned diagnostic handle');
      }
      const handle = createdHandle.value;
      expect(
        await fs.readFile(resolve(directory, handle.requestFileName), 'utf8'),
      ).toBe(fetchMock.mock.calls[0][1]?.body);
      const response: unknown = JSON.parse(
        await fs.readFile(
          resolve(directory, 'diagnostics', `${handle.traceId}.response.json`),
          'utf8',
        ),
      );
      const compaction: unknown = JSON.parse(
        await fs.readFile(
          resolve(
            directory,
            'diagnostics',
            `${handle.traceId}.compaction.json`,
          ),
          'utf8',
        ),
      );
      for (const record of [response, compaction]) {
        expect(record).toMatchObject({
          traceId: handle.traceId,
          submissionId: h.job.submissionId.toString(),
          requestFileName: handle.requestFileName,
          requestSaved: true,
        });
      }
      expect(response).toMatchObject({
        rawResponseBody: rawResponse,
        reachedStage: 'provider_capped',
      });
      expect(compaction).toMatchObject({
        jobId: h.job._id.toString(),
        claimNo: 1,
        resultMeaning: 'pre_persistence_candidates',
        compactionReached: true,
        compactorInput: [
          { message: '第 12 行缺少分号' },
          { message: '第 26 行缺少分号' },
        ],
        compactorOutput: [
          {
            message:
              '存在多处语句末尾缺少分号的问题，导致代码无法稳定编译或运行。',
            suggestion: '在 `foo()` 后补齐分号。；在 `Foo()` 后补齐分号。',
          },
        ],
        reason: null,
      });
      expect(h.feedback.insertMany).toHaveBeenCalledTimes(1);
      expect(h.release).toHaveBeenCalledTimes(1);
    } finally {
      try {
        await h.module.close();
      } finally {
        await removeOwnedDiagnosticDirectory(ownedDirectory, temporaryParent);
      }
    }
  });

  it('captures independent snapshots before persistence can mutate the candidates', async () => {
    const h = await harness();
    const diagnostic = diagnosticFor(h.job.submissionId.toString());
    const items: AiFeedbackItem[] = [
      {
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 12 行缺少分号',
        suggestion: '在 `foo()` 后补齐分号。',
      },
      {
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 26 行缺少分号',
        suggestion: '在 `Foo()` 后补齐分号。',
      },
    ];
    const originalItems = structuredClone(items);
    jest
      .spyOn(h.provider, 'analyzeSubmission')
      .mockImplementation(async (_context, execution) => {
        await execution.onDiagnosticHandle?.(diagnostic.handle);
        return items;
      });
    h.feedback.insertMany.mockImplementation((documents: AiFeedbackItem[]) => {
      items[0].message = 'synthetic mutation after compaction';
      documents[0].message = 'synthetic persistence mutation';
      return Promise.resolve([]);
    });

    try {
      expect(await h.processor.processOnce(1)).toMatchObject({ succeeded: 1 });
      expect(diagnostic.saveCompaction).toHaveBeenCalledTimes(1);
      expect(diagnostic.saveCompaction).toHaveBeenCalledWith({
        jobId: h.job._id.toString(),
        claimNo: 1,
        compactionReached: true,
        compactorInput: originalItems,
        compactorOutput: [
          expect.objectContaining({
            type: FeedbackType.Syntax,
            severity: FeedbackSeverity.Error,
            message:
              '存在多处语句末尾缺少分号的问题，导致代码无法稳定编译或运行。',
            suggestion: '在 `foo()` 后补齐分号。；在 `Foo()` 后补齐分号。',
          }),
        ],
        reason: null,
        captureFailed: false,
      });
      expect(h.release).toHaveBeenCalledTimes(1);
    } finally {
      await h.module.close();
    }
  });

  it.each(['provider', 'claim', 'compactor'] as const)(
    'records an unreached output when %s fails without changing the business failure',
    async (stage) => {
      const h = await harness();
      const diagnostic = diagnosticFor(h.job.submissionId.toString());
      const items: AiFeedbackItem[] = [
        {
          type: FeedbackType.Other,
          severity: FeedbackSeverity.Warn,
          message: '合成问题',
        },
      ];
      jest
        .spyOn(h.provider, 'analyzeSubmission')
        .mockImplementation(async (_context, execution) => {
          await execution.onDiagnosticHandle?.(diagnostic.handle);
          if (stage === 'provider') {
            throw new AiFeedbackProviderError(
              'TIMEOUT',
              true,
              'synthetic timeout',
            );
          }
          return items;
        });
      if (stage === 'claim') h.jobModel.exists.mockResolvedValue(null);
      if (stage === 'compactor') {
        jest
          .spyOn(compactor, 'compactAiFeedbackItems')
          .mockImplementation(() => {
            throw new Error('synthetic compactor failure');
          });
      }

      try {
        expect(await h.processor.processOnce(1)).toMatchObject(
          stage === 'provider'
            ? { failed: 1, dead: 0 }
            : { failed: 0, dead: 1 },
        );
        expect(diagnostic.saveCompaction).toHaveBeenCalledWith({
          jobId: h.job._id.toString(),
          claimNo: 1,
          compactionReached: stage === 'compactor',
          compactorInput: stage === 'compactor' ? items : null,
          compactorOutput: null,
          reason:
            stage === 'provider'
              ? 'PROVIDER_NOT_COMPLETED'
              : stage === 'claim'
                ? 'CLAIM_NOT_VALIDATED'
                : 'COMPACTION_NOT_COMPLETED',
          captureFailed: false,
        });
        expect(h.feedback.insertMany).not.toHaveBeenCalled();
        expect(h.release).toHaveBeenCalledTimes(1);
        expect(h.jobModel.findOneAndUpdate.mock.calls[2][1]).toMatchObject({
          $set: {
            failureCode:
              stage === 'provider' ? 'UPSTREAM_UNAVAILABLE' : 'INTERNAL_ERROR',
          },
        });
      } finally {
        await h.module.close();
      }
    },
  );

  it('awaits the diagnostic for a legitimate empty result before releasing the guard', async () => {
    const h = await harness();
    const diagnostic = diagnosticFor(h.job.submissionId.toString());
    let finishSave: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const saveFinished = new Promise<void>((resolveSaved) => {
      finishSave = resolveSaved;
    });
    const saveStarted = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    diagnostic.saveCompaction.mockImplementation(async () => {
      markStarted();
      await saveFinished;
    });
    jest
      .spyOn(h.provider, 'analyzeSubmission')
      .mockImplementation(async (_context, execution) => {
        await execution.onDiagnosticHandle?.(diagnostic.handle);
        return [];
      });
    const processing = h.processor.processOnce(1);
    try {
      await Promise.race([
        saveStarted,
        processing.then((result) => {
          throw new Error(
            `Processor completed before compaction diagnostics: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      expect(diagnostic.saveCompaction).toHaveBeenCalledWith(
        expect.objectContaining({
          compactionReached: true,
          compactorInput: [],
          compactorOutput: [],
          reason: null,
        }),
      );
      expect(h.feedback.insertMany).not.toHaveBeenCalled();
      expect(h.release).not.toHaveBeenCalled();
      finishSave();
      expect(await processing).toMatchObject({ succeeded: 1, dead: 0 });
      expect(h.release).toHaveBeenCalledTimes(1);
    } finally {
      finishSave();
      try {
        await processing;
      } finally {
        await h.module.close();
      }
    }
  });

  it('marks a failed input snapshot without changing compaction or persistence', async () => {
    const h = await harness();
    const diagnostic = diagnosticFor(h.job.submissionId.toString());
    const items: AiFeedbackItem[] = [
      {
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: '有具体依据的肯定',
      },
    ];
    jest
      .spyOn(h.provider, 'analyzeSubmission')
      .mockImplementation(async (_context, execution) => {
        await execution.onDiagnosticHandle?.(diagnostic.handle);
        return items;
      });
    jest.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
      throw new Error('synthetic clone failure');
    });
    try {
      expect(await h.processor.processOnce(1)).toMatchObject({ succeeded: 1 });
      expect(diagnostic.saveCompaction).toHaveBeenCalledWith(
        expect.objectContaining({
          compactionReached: true,
          compactorInput: null,
          compactorOutput: [expect.objectContaining(items[0])],
          reason: null,
          captureFailed: true,
        }),
      );
      expect(h.feedback.insertMany).toHaveBeenCalledTimes(1);
      expect(h.release).toHaveBeenCalledTimes(1);
    } finally {
      await h.module.close();
    }
  });

  it.each([false, true])(
    'isolates compaction write and logging failures when providerFailed=%s',
    async (providerFailed) => {
      const h = await harness();
      const diagnostic = diagnosticFor(h.job.submissionId.toString());
      diagnostic.saveCompaction.mockRejectedValue(
        new Error('private synthetic diagnostic error'),
      );
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
        throw new Error('synthetic diagnostic logger failure');
      });
      const analyze = jest
        .spyOn(h.provider, 'analyzeSubmission')
        .mockImplementation(async (_context, execution) => {
          await execution.onDiagnosticHandle?.(diagnostic.handle);
          if (providerFailed) {
            throw new AiFeedbackProviderError(
              'TIMEOUT',
              true,
              'synthetic timeout',
            );
          }
          return [];
        });
      try {
        expect(await h.processor.processOnce(1)).toMatchObject(
          providerFailed ? { failed: 1, dead: 0 } : { succeeded: 1, dead: 0 },
        );
        expect(analyze).toHaveBeenCalledTimes(1);
        expect(h.release).toHaveBeenCalledTimes(1);
        expect(h.feedback.insertMany).not.toHaveBeenCalled();
      } finally {
        await h.module.close();
      }
    },
  );
});

describe('reference failures are terminal before every provider, including stub', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['AI_CONTEXT_UNAVAILABLE', 'AI_CONTEXT_LIMIT_EXCEEDED'] as const)(
    'terminates %s without request reservation or feedback',
    async (code) => {
      const h = await harness();
      const stub = new DefaultStubAiFeedbackProvider();
      const provider = h.module.get<BailianFeedbackProvider>(
        AI_FEEDBACK_PROVIDER_TOKEN,
      );
      const analyze = jest
        .spyOn(provider, 'analyzeSubmission')
        .mockImplementation((context) => stub.analyzeSubmission(context));
      h.config.set('AI_FEEDBACK_PROVIDER', 'stub');
      jest
        .spyOn(h.module.get(AiContextReaderService), 'read')
        .mockRejectedValue(new AiContextError(code, '安全原因', 1, 2));
      const fetch = jest.spyOn(globalThis, 'fetch');
      try {
        expect(await h.processor.processOnce(1)).toEqual({
          processed: 1,
          succeeded: 0,
          failed: 0,
          dead: 1,
        });
        expect(analyze).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(h.jobModel.updateOne).not.toHaveBeenCalled();
        expect(h.feedback.insertMany).not.toHaveBeenCalled();
        expect(h.jobModel.findOneAndUpdate.mock.calls[2][1]).toMatchObject({
          $set: {
            status: 'DEAD',
            failureCode: code,
            lastError: 'AI_FEEDBACK: ' + code,
            notBefore: null,
            lockedAt: null,
            lockOwner: null,
          },
        });
      } finally {
        await h.module.close();
      }
    },
  );
});
