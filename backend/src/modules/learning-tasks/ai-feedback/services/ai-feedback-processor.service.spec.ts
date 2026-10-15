import { AiContextError } from '../../ai-context/ai-context.types';
import { DefaultStubAiFeedbackProvider } from './default-stub-ai-feedback.provider';
import { AiContextReaderService } from '../../ai-context/ai-context-reader.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types, Mongoose } from 'mongoose';
import { AiFeedbackProcessor } from './ai-feedback-processor.service';
import { AiFeedbackGuardsService } from './ai-feedback-guards.service';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../schemas/ai-feedback-job.schema';
import { Submission } from '../../schemas/submission.schema';
import { Feedback } from '../../schemas/feedback.schema';
import { ClassroomTask } from '../../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { AI_FEEDBACK_PROVIDER_TOKEN } from '../interfaces/ai-feedback-provider.interface';
import { BailianFeedbackProvider } from '../providers/real/bailian-feedback.provider';
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
  const guards = {
    tryConsume: jest.fn().mockReturnValue(true),
    acquire: jest.fn().mockResolvedValue(jest.fn()),
  };
  const config = new ConfigService({
    AI_FEEDBACK_PROVIDER: 'bailian',
    BAILIAN_API_KEY: 'synthetic-unit-key',
    BAILIAN_BASE_URL: 'http://127.0.0.1:1',
  });
  const module = await Test.createTestingModule({
    providers: [
      AiFeedbackProcessor,
      AiContextReaderService,
      { provide: ConfigService, useValue: config },
      { provide: AiFeedbackGuardsService, useValue: guards },
      {
        provide: AI_FEEDBACK_PROVIDER_TOKEN,
        useValue: new BailianFeedbackProvider(config),
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
  };
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
