import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { envValidationSchema } from '../../../../config/env.validation';
import { AiFeedbackProcessor } from './ai-feedback-processor.service';
import { AiFeedbackWorker } from './ai-feedback-worker.service';

type TickResult = Awaited<ReturnType<AiFeedbackProcessor['processOnce']>>;
const emptyResult: TickResult = {
  processed: 0,
  succeeded: 0,
  failed: 0,
  dead: 0,
};

describe('AiFeedbackWorker', () => {
  let module: TestingModule | undefined;
  let worker: AiFeedbackWorker;
  let processOnce: jest.MockedFunction<AiFeedbackProcessor['processOnce']>;
  let logSpy: jest.SpiedFunction<Logger['log']>;
  let debugSpy: jest.SpiedFunction<Logger['debug']>;
  let errorSpy: jest.SpiedFunction<Logger['error']>;

  async function createWorker(overrides: Record<string, unknown> = {}) {
    const result = envValidationSchema.validate({
      NODE_ENV: 'test',
      MAIL_FROM: 'unit@example.invalid',
      MONGO_URI: 'mongodb://127.0.0.1:1/ai_feedback_unit',
      ...overrides,
    });
    if (result.error) throw result.error;
    const values = result.value as Record<string, unknown>;
    module = await Test.createTestingModule({
      providers: [
        AiFeedbackWorker,
        { provide: ConfigService, useValue: new ConfigService(values) },
        { provide: AiFeedbackProcessor, useValue: { processOnce } },
      ],
    }).compile();
    worker = module.get(AiFeedbackWorker);
    await module.init();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    processOnce = jest
      .fn<ReturnType<AiFeedbackProcessor['processOnce']>, [number?]>()
      .mockResolvedValue(emptyResult);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
    const remainingTimers = jest.getTimerCount();
    jest.useRealTimers();
    jest.restoreAllMocks();
    expect(remainingTimers).toBe(0);
  });

  it('creates no interval when disabled by validated defaults', async () => {
    await createWorker();
    await jest.advanceTimersByTimeAsync(30000);

    expect(jest.getTimerCount()).toBe(0);
    expect(processOnce).not.toHaveBeenCalled();
  });

  it('uses the validated interval and batch without an immediate tick', async () => {
    await createWorker({
      AI_FEEDBACK_WORKER_ENABLED: 'true',
      AI_FEEDBACK_WORKER_INTERVAL_MS: '250',
      AI_FEEDBACK_WORKER_BATCH_SIZE: '3',
    });

    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(249);
    expect(processOnce).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(processOnce).toHaveBeenCalledTimes(1);
    expect(processOnce).toHaveBeenCalledWith(3);
    expect(logSpy).toHaveBeenCalledWith(
      'AI Feedback Worker enabled (intervalMs=250, batchSize=3)',
    );
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('uses the validated default interval and batch when enabled', async () => {
    await createWorker({ AI_FEEDBACK_WORKER_ENABLED: 'true' });

    await jest.advanceTimersByTimeAsync(9999);
    expect(processOnce).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(processOnce).toHaveBeenCalledWith(5);
  });

  it('keeps one tick in flight and resumes after completion', async () => {
    let finishTick: ((result: TickResult) => void) | undefined;
    const pendingTick = new Promise<TickResult>((resolve) => {
      finishTick = resolve;
    });
    processOnce.mockReturnValueOnce(pendingTick);
    try {
      await createWorker({
        AI_FEEDBACK_WORKER_ENABLED: 'true',
        AI_FEEDBACK_WORKER_INTERVAL_MS: '100',
      });
      await jest.advanceTimersByTimeAsync(300);
      expect(processOnce).toHaveBeenCalledTimes(1);

      finishTick?.(emptyResult);
      await pendingTick;
      await jest.advanceTimersByTimeAsync(100);
      expect(processOnce).toHaveBeenCalledTimes(2);
    } finally {
      finishTick?.(emptyResult);
      await pendingTick;
    }
  });

  it('logs failures, releases single-flight and logs a later non-empty tick', async () => {
    processOnce
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValueOnce({
        processed: 1,
        succeeded: 1,
        failed: 0,
        dead: 0,
      });
    await createWorker({
      AI_FEEDBACK_WORKER_ENABLED: 'true',
      AI_FEEDBACK_WORKER_INTERVAL_MS: '100',
    });

    await jest.advanceTimersByTimeAsync(200);

    expect(processOnce).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      'AI Feedback Worker tick failed: synthetic failure',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'AI Feedback Worker tick result: processed=1, succeeded=1, failed=0, dead=0',
    );
  });

  it('clears its interval on destroy, including repeated destroy', async () => {
    await createWorker({ AI_FEEDBACK_WORKER_ENABLED: 'true' });

    worker.onModuleDestroy();
    worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(20000);

    expect(jest.getTimerCount()).toBe(0);
    expect(processOnce).not.toHaveBeenCalled();
  });
});
