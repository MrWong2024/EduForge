import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiFeedbackProcessor } from './ai-feedback-processor.service';

type WorkerTickResult = Awaited<ReturnType<AiFeedbackProcessor['processOnce']>>;

@Injectable()
export class AiFeedbackWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiFeedbackWorker.name);
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly processor: AiFeedbackProcessor,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.configService.getOrThrow<boolean>('AI_FEEDBACK_WORKER_ENABLED')) {
      return;
    }

    const intervalMs = this.configService.getOrThrow<number>(
      'AI_FEEDBACK_WORKER_INTERVAL_MS',
    );
    const batchSize = this.configService.getOrThrow<number>(
      'AI_FEEDBACK_WORKER_BATCH_SIZE',
    );

    this.logger.log(
      `AI Feedback Worker enabled (intervalMs=${intervalMs}, batchSize=${batchSize})`,
    );

    this.intervalId = setInterval(() => {
      void this.tick(batchSize);
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async tick(batchSize: number) {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      const result = await this.processor.processOnce(batchSize);
      if (!this.isEmptyTickResult(result)) {
        this.logger.debug(
          `AI Feedback Worker tick result: processed=${result.processed}, succeeded=${result.succeeded}, failed=${result.failed}, dead=${result.dead}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`AI Feedback Worker tick failed: ${message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private isEmptyTickResult(result: WorkerTickResult) {
    return (
      result.processed === 0 &&
      result.succeeded === 0 &&
      result.failed === 0 &&
      result.dead === 0
    );
  }
}
