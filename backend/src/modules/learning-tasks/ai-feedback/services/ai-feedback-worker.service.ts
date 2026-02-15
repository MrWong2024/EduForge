import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AiFeedbackProcessor } from './ai-feedback-processor.service';

@Injectable()
export class AiFeedbackWorker implements OnModuleInit, OnModuleDestroy {
  private static readonly DEFAULT_INTERVAL_MS = 3000;
  private readonly logger = new Logger(AiFeedbackWorker.name);
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(private readonly processor: AiFeedbackProcessor) {}

  onModuleInit() {
    if (process.env.AI_FEEDBACK_WORKER_ENABLED !== 'true') {
      return;
    }

    const intervalMs = this.getIntervalMs();
    const batchSize = this.getBatchSize();
    const batchSizeLabel =
      batchSize === undefined ? 'default' : String(batchSize);

    this.logger.log(
      `AI Feedback Worker enabled (intervalMs=${intervalMs}, batchSize=${batchSizeLabel})`,
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

  private getIntervalMs() {
    const raw = process.env.AI_FEEDBACK_WORKER_INTERVAL_MS;
    if (!raw) {
      return AiFeedbackWorker.DEFAULT_INTERVAL_MS;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return AiFeedbackWorker.DEFAULT_INTERVAL_MS;
    }
    return Math.floor(parsed);
  }

  private getBatchSize() {
    const raw = process.env.AI_FEEDBACK_WORKER_BATCH_SIZE;
    if (!raw) {
      return undefined;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  private async tick(batchSize?: number) {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      const result =
        batchSize === undefined
          ? await this.processor.processOnce()
          : await this.processor.processOnce(batchSize);
      this.logger.debug(
        `AI Feedback Worker tick result: processed=${result.processed}, succeeded=${result.succeeded}, failed=${result.failed}, dead=${result.dead}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`AI Feedback Worker tick failed: ${message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
