import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Feedback, FeedbackSource } from '../../schemas/feedback.schema';
import { Submission } from '../../schemas/submission.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../schemas/ai-feedback-job.schema';
import { AI_FEEDBACK_PROVIDER_TOKEN } from '../interfaces/ai-feedback-provider.interface';
import type {
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../interfaces/ai-feedback-provider.interface';
import { AiFeedbackProviderError } from '../interfaces/ai-feedback-provider.error';
import { AI_FEEDBACK_ERROR_CODES } from '../interfaces/ai-feedback-provider.error-codes';
import { AiFeedbackGuardsService } from './ai-feedback-guards.service';
import { WithId } from '../../../../common/types/with-id.type';
import { WithTimestamps } from '../../../../common/types/with-timestamps.type';

type AiFeedbackJobWithMeta = AiFeedbackJob & WithId & WithTimestamps;

@Injectable()
export class AiFeedbackProcessor {
  private static readonly DEFAULT_BATCH_SIZE = 5;
  private static readonly LOCK_TTL_MS = 5 * 60 * 1000;
  private static readonly BASE_BACKOFF_MS = 30 * 1000;
  private static readonly MAX_BACKOFF_MS = 10 * 60 * 1000;
  private static readonly LOCK_OWNER_PREFIX = 'ai-feedback-processor';
  private readonly logger = new Logger(AiFeedbackProcessor.name);

  constructor(
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    @Inject(AI_FEEDBACK_PROVIDER_TOKEN)
    private readonly aiFeedbackProvider: AiFeedbackProvider,
    private readonly aiFeedbackGuards: AiFeedbackGuardsService,
  ) {}

  async processOnce(batchSize = AiFeedbackProcessor.DEFAULT_BATCH_SIZE) {
    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };

    for (let index = 0; index < batchSize; index += 1) {
      const job = await this.claimNextJob();
      if (!job) {
        break;
      }
      results.processed += 1;

      try {
        const submission = await this.submissionModel
          .findById(job.submissionId)
          .lean()
          .exec();
        if (!submission) {
          throw new Error('Submission not found');
        }
        const bucketKey = job.classroomTaskId?.toString();
        if (!this.aiFeedbackGuards.tryConsume(bucketKey)) {
          this.logger.debug(
            `AI feedback rate-limited locally: jobId=${job._id.toString()}, submissionId=${job.submissionId.toString()}, classroomTaskId=${bucketKey ?? 'n/a'}, code=${AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_LOCAL}`,
          );
          throw new AiFeedbackProviderError(
            AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_LOCAL,
            true,
            'AI_FEEDBACK_PROVIDER: RATE_LIMIT_LOCAL',
          );
        }
        const release = await this.aiFeedbackGuards.acquire();
        let items: AiFeedbackItem[] = [];
        try {
          items = await this.aiFeedbackProvider.analyzeSubmission(
            submission as Submission,
          );
          await this.persistFeedback(job, items);
        } finally {
          release();
        }
        await this.aiFeedbackJobModel
          .findOneAndUpdate(
            { _id: job._id, lockOwner: job.lockOwner },
            {
              status: AiFeedbackJobStatus.Succeeded,
              lockedAt: null,
              lockOwner: null,
              notBefore: null,
              lastError: null,
            },
          )
          .exec();
        results.succeeded += 1;
      } catch (error) {
        const handled = await this.handleJobFailure(job, error);
        if (handled === AiFeedbackJobStatus.Dead) {
          results.dead += 1;
        } else {
          results.failed += 1;
        }
      }
    }

    return results;
  }

  private async claimNextJob(): Promise<AiFeedbackJobWithMeta | null> {
    const now = new Date();
    const lockExpiredAt = new Date(
      now.getTime() - AiFeedbackProcessor.LOCK_TTL_MS,
    );
    const lockOwner = `${AiFeedbackProcessor.LOCK_OWNER_PREFIX}:${process.pid}`;

    return this.aiFeedbackJobModel
      .findOneAndUpdate(
        {
          status: {
            $in: [AiFeedbackJobStatus.Pending, AiFeedbackJobStatus.Failed],
          },
          $and: [
            {
              $or: [
                { notBefore: { $lte: now } },
                { notBefore: null },
                { notBefore: { $exists: false } },
              ],
            },
            {
              $or: [
                { lockedAt: { $exists: false } },
                { lockedAt: null },
                { lockedAt: { $lte: lockExpiredAt } },
              ],
            },
          ],
        },
        {
          $set: {
            status: AiFeedbackJobStatus.Running,
            lockedAt: now,
            lockOwner,
          },
        },
        {
          new: true,
          sort: { createdAt: 1 },
        },
      )
      .exec() as Promise<AiFeedbackJobWithMeta | null>;
  }

  private async persistFeedback(
    job: AiFeedbackJobWithMeta,
    items: AiFeedbackItem[],
  ) {
    if (items.length === 0) {
      return;
    }

    const docs = items.map((item) => ({
      submissionId: job.submissionId,
      source: FeedbackSource.AI,
      type: item.type,
      severity: item.severity,
      message: item.message,
      suggestion: item.suggestion,
      tags: item.tags,
      scoreHint: item.scoreHint,
    }));

    try {
      await this.feedbackModel.insertMany(docs, { ordered: false });
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code !== 11000) {
        throw error;
      }
      this.logger.debug(
        `Duplicate AI feedback ignored: jobId=${job._id.toString()}, submissionId=${job.submissionId.toString()}, items=${items.length}, duplicateKey=true`,
      );
    }
  }

  private async handleJobFailure(job: AiFeedbackJobWithMeta, error: unknown) {
    const isProviderError = error instanceof AiFeedbackProviderError;
    const providerCode = isProviderError ? error.code : null;
    const lastError = isProviderError
      ? error.message
      : 'AI_FEEDBACK_PROVIDER: UNKNOWN';
    const shouldDeadImmediately =
      providerCode === AI_FEEDBACK_ERROR_CODES.UNAUTHORIZED ||
      providerCode === AI_FEEDBACK_ERROR_CODES.MISSING_API_KEY ||
      providerCode === AI_FEEDBACK_ERROR_CODES.REAL_DISABLED;
    const isRateLimit =
      providerCode === AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_UPSTREAM ||
      providerCode === AI_FEEDBACK_ERROR_CODES.RATE_LIMIT_LOCAL;
    const attempts = job.attempts ?? 0;
    const maxAttempts = job.maxAttempts ?? 3;
    const nextAttempts = attempts + 1;
    const shouldDead = shouldDeadImmediately || nextAttempts >= maxAttempts;
    const status = shouldDead
      ? AiFeedbackJobStatus.Dead
      : AiFeedbackJobStatus.Failed;
    const baseBackoffMs = shouldDead
      ? 0
      : Math.min(
          AiFeedbackProcessor.MAX_BACKOFF_MS,
          AiFeedbackProcessor.BASE_BACKOFF_MS * Math.pow(2, nextAttempts - 1),
        );
    const backoffMs = isRateLimit
      ? Math.max(baseBackoffMs, 30000)
      : baseBackoffMs;
    const notBefore = shouldDead ? null : new Date(Date.now() + backoffMs);

    await this.aiFeedbackJobModel
      .findByIdAndUpdate(job._id, {
        status,
        attempts: nextAttempts,
        notBefore,
        lockedAt: null,
        lockOwner: null,
        lastError,
      })
      .exec();

    return status;
  }
}
