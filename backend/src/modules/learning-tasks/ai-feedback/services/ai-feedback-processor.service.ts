import { AiContextReaderService } from '../../ai-context/ai-context-reader.service';
import { AiContextError } from '../../ai-context/ai-context.types';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, Model } from 'mongoose';
import { Feedback, FeedbackSource } from '../../schemas/feedback.schema';
import { Submission } from '../../schemas/submission.schema';
import { ClassroomTask } from '../../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { TaskSnapshot } from '../../../classrooms/classroom-tasks/classroom-task-content';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../schemas/ai-feedback-job.schema';
import { AI_FEEDBACK_PROVIDER_TOKEN } from '../interfaces/ai-feedback-provider.interface';
import type {
  AiFeedbackCompactionDiagnostic,
  AiFeedbackDiagnosticHandle,
  AiFeedbackExecution,
  AiFeedbackItem,
  AiFeedbackProvider,
} from '../interfaces/ai-feedback-provider.interface';
import { AiFeedbackProviderError } from '../interfaces/ai-feedback-provider.error';
import { AI_FEEDBACK_ERROR_CODES } from '../interfaces/ai-feedback-provider.error-codes';
import { AiFeedbackGuardsService } from './ai-feedback-guards.service';
import { WithId } from '../../../../common/types/with-id.type';
import { WithTimestamps } from '../../../../common/types/with-timestamps.type';
import { AiSubmissionAnalysisContext } from '../interfaces/ai-submission-analysis-context.interface';
import { AiReviewFailureCode } from '../lib/ai-review-summary';
import { compactAiFeedbackItems } from '../lib/feedback-item-compactor';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  runClassroomTaskTransaction,
  UnconfirmedClassroomTaskCommitError,
  type ClassroomTaskTransaction,
} from '../../../../lib/classroom-task-transaction';
import { withMongoOperationDeadline } from '../../../../lib/mongo-operation-deadline';

type AiFeedbackJobWithMeta = AiFeedbackJob & WithId & WithTimestamps;
type ProcessResult = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};
type SubmissionAnalysisSource = Pick<
  Submission,
  'taskId' | 'classroomTaskId' | 'attemptNo' | 'content' | 'meta'
> &
  WithId;
type ClassroomTaskAnalysisSource = Pick<
  ClassroomTask,
  'taskId' | 'taskSnapshot'
>;
class AiFeedbackEligibilityError extends Error {}
type TaskAnalysisSource = Pick<
  TaskSnapshot,
  'title' | 'description' | 'rubric'
>;
type FeedbackIdentity = Pick<Feedback, 'type' | 'severity' | 'message'>;
const feedbackIdentity = ({ type, severity, message }: FeedbackIdentity) =>
  JSON.stringify([type, severity, message]);

@Injectable()
export class AiFeedbackProcessor {
  private static readonly DEFAULT_BATCH_SIZE = 5;
  private static readonly DEFAULT_MAX_ITEMS = 20;
  private static readonly LOCK_TTL_MS = 5 * 60 * 1000;
  private static readonly BASE_BACKOFF_MS = 30 * 1000;
  private static readonly MAX_BACKOFF_MS = 10 * 60 * 1000;
  private static readonly LOCK_OWNER_PREFIX = 'ai-feedback-processor';
  private readonly logger = new Logger(AiFeedbackProcessor.name);
  private readonly inFlight = new Set<Promise<ProcessResult>>();
  private shutdown?: Promise<void>;

  constructor(
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    @Inject(AI_FEEDBACK_PROVIDER_TOKEN)
    private readonly aiFeedbackProvider: AiFeedbackProvider,
    private readonly aiFeedbackGuards: AiFeedbackGuardsService,
    private readonly configService: ConfigService,
    private readonly aiContextReader: AiContextReaderService,
    @InjectConnection(CLASSROOM_TASK_TRANSACTION_CONNECTION)
    private readonly transactionConnection: Connection,
  ) {}

  async processOnce(batchSize = AiFeedbackProcessor.DEFAULT_BATCH_SIZE) {
    const results: ProcessResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    if (this.shutdown) return results;

    const batch = this.processBatch(batchSize, results);
    this.inFlight.add(batch);
    try {
      return await batch;
    } finally {
      this.inFlight.delete(batch);
    }
  }

  stopAndDrain(): Promise<void> {
    this.shutdown ??= Promise.allSettled(this.inFlight).then(() => undefined);
    return this.shutdown;
  }

  private async processBatch(batchSize: number, results: ProcessResult) {
    for (let index = 0; index < batchSize && !this.shutdown; index += 1) {
      const retired = await this.terminateUnsupportedJob();
      if (retired) {
        results.processed += 1;
        results.dead += 1;
        continue;
      }
      if (this.shutdown) break;
      const job = await this.claimNextJob();
      if (!job) {
        break;
      }
      results.processed += 1;

      try {
        const submission = await this.submissionModel
          .findById(job.submissionId)
          .lean<SubmissionAnalysisSource>()
          .exec();
        if (!submission) {
          throw new Error('Submission not found');
        }
        if (
          !submission.classroomTaskId ||
          !job.classroomTaskId ||
          submission.classroomTaskId.toString() !==
            job.classroomTaskId.toString()
        ) {
          throw new AiFeedbackEligibilityError(
            'AI_ELIGIBILITY: CLASSROOM_TASK_ASSOCIATION_INVALID',
          );
        }
        const classroomTask = await this.classroomTaskModel
          .findById(submission.classroomTaskId)
          .lean<ClassroomTaskAnalysisSource>()
          .exec();
        if (
          !classroomTask ||
          classroomTask.taskId.toString() !== submission.taskId.toString()
        ) {
          throw new AiFeedbackEligibilityError(
            'AI_ELIGIBILITY: CLASSROOM_TASK_ASSOCIATION_INVALID',
          );
        }
        if (!classroomTask.taskSnapshot) {
          throw new AiFeedbackEligibilityError(
            'AI_ELIGIBILITY: TASK_SNAPSHOT_MISSING',
          );
        }
        const analysisContext = this.buildAnalysisContext(
          submission,
          classroomTask.taskSnapshot,
        );
        analysisContext.referenceFiles = await this.aiContextReader.read(
          classroomTask.taskSnapshot.aiContextRefs,
        );
        const provider =
          this.configService.get<string>('AI_FEEDBACK_PROVIDER') === 'bailian'
            ? 'bailian'
            : 'stub';
        const assigned = await this.aiFeedbackJobModel
          .updateOne(this.claimFilter(job), { $set: { provider } })
          .exec();
        if (assigned.matchedCount !== 1)
          throw new Error('Claim no longer current');
        // Oversized complete input is terminal, including when locally throttled.
        this.aiFeedbackProvider.assertInputEligible?.(analysisContext);
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
        let diagnosticHandle: AiFeedbackDiagnosticHandle | undefined;
        let compactionDiagnostic: AiFeedbackCompactionDiagnostic | undefined;
        try {
          items = await this.aiFeedbackProvider.analyzeSubmission(
            analysisContext,
            this.executionFor(job, (handle) => {
              try {
                const record: AiFeedbackCompactionDiagnostic = {
                  jobId: job._id.toString(),
                  claimNo: job.attempts,
                  compactionReached: false,
                  compactorInput: null,
                  compactorOutput: null,
                  reason: 'PROVIDER_NOT_COMPLETED',
                  captureFailed: false,
                };
                diagnosticHandle = handle;
                compactionDiagnostic = record;
              } catch {
                this.warnCompactionDiagnostic(job, 'INITIALIZATION_FAILED');
              }
            }),
          );
          if (compactionDiagnostic)
            compactionDiagnostic.reason = 'CLAIM_NOT_VALIDATED';
          await this.requireCurrentClaim(job);
          if (compactionDiagnostic) {
            compactionDiagnostic.reason = 'COMPACTION_NOT_COMPLETED';
            compactionDiagnostic.compactorInput = this.snapshotCompactionItems(
              items,
              compactionDiagnostic,
              job,
              'INPUT_CLONE_FAILED',
            );
          }
          if (compactionDiagnostic)
            compactionDiagnostic.compactionReached = true;
          const compactedItems = compactAiFeedbackItems(items, {
            maxItems: this.getMaxItems(),
          });
          if (compactionDiagnostic) {
            compactionDiagnostic.reason = null;
            compactionDiagnostic.compactorOutput = this.snapshotCompactionItems(
              compactedItems,
              compactionDiagnostic,
              job,
              'OUTPUT_CLONE_FAILED',
            );
          }
          if (compactedItems.length !== items.length) {
            this.logger.debug(
              `AI feedback compacted before persistence: jobId=${job._id.toString()}, submissionId=${job.submissionId.toString()}, originalItems=${items.length}, compactedItems=${compactedItems.length}`,
            );
          }
          if (await this.commitResult(job, compactedItems)) {
            results.succeeded += 1;
          }
        } finally {
          try {
            if (diagnosticHandle && compactionDiagnostic) {
              try {
                await diagnosticHandle.saveCompaction(compactionDiagnostic);
              } catch {
                this.warnCompactionDiagnostic(job, 'SAVE_FAILED');
              }
            }
          } finally {
            release();
          }
        }
      } catch (error) {
        if (error instanceof UnconfirmedClassroomTaskCommitError) throw error;
        const handled = await this.handleJobFailure(job, error);
        if (handled === AiFeedbackJobStatus.Dead) {
          results.dead += 1;
        } else if (handled === AiFeedbackJobStatus.Failed) {
          results.failed += 1;
        }
      }
    }

    return results;
  }

  private getMaxItems() {
    const raw = this.configService.get<string>('AI_FEEDBACK_MAX_ITEMS');
    if (!raw) {
      return AiFeedbackProcessor.DEFAULT_MAX_ITEMS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return AiFeedbackProcessor.DEFAULT_MAX_ITEMS;
    }
    return parsed;
  }

  private buildAnalysisContext(
    submission: SubmissionAnalysisSource,
    task: TaskAnalysisSource,
  ): AiSubmissionAnalysisContext {
    return {
      submissionId: submission._id.toString(),
      classroomTaskId: submission.classroomTaskId?.toString?.(),
      attemptNo: submission.attemptNo,
      language: submission.content?.language ?? 'unknown',
      codeText: submission.content?.codeText ?? '',
      submissionNote: submission.content?.submissionNote ?? '',
      aiUsageDeclaration: submission.meta?.aiUsageDeclaration,
      taskId: submission.taskId.toString(),
      taskTitle: task.title,
      taskDescription: task.description,
      taskRubric: task.rubric,
    };
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
          budgetVersion: 1,
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
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
          $inc: { attempts: 1 },
          $set: {
            status: AiFeedbackJobStatus.Running,
            lockedAt: now,
            lockOwner,
          },
        },
        {
          returnDocument: 'after',
          sort: { createdAt: 1 },
        },
      )
      .exec();
  }

  private async commitResult(
    job: AiFeedbackJobWithMeta,
    items: AiFeedbackItem[],
  ): Promise<boolean> {
    try {
      return await runClassroomTaskTransaction(
        this.transactionConnection,
        async (transaction) => {
          const result = await transaction
            .model(this.aiFeedbackJobModel)
            .updateOne(
              this.claimFilter(job),
              {
                $set: {
                  status: AiFeedbackJobStatus.Succeeded,
                  lockedAt: null,
                  lockOwner: null,
                  notBefore: null,
                  lastError: null,
                  failureCode: null,
                },
              },
              { session: transaction.session, ...transaction.readOptions() },
            )
            .exec();
          if (result.matchedCount !== 1) return false;

          await this.persistFeedback(job, items, transaction);
          return true;
        },
        { distinguishUnconfirmedCommit: true },
      );
    } catch (error) {
      if (!(error instanceof UnconfirmedClassroomTaskCommitError)) throw error;

      // Durable success at the same attempt confirms this claim. RUNNING does
      // not establish that the commit was rolled back.
      const confirmed = await withMongoOperationDeadline(3000, (deadline) =>
        this.aiFeedbackJobModel
          .exists({
            _id: job._id,
            attempts: job.attempts,
            status: AiFeedbackJobStatus.Succeeded,
          })
          .read('primary')
          .readConcern('majority')
          .setOptions({
            signal: deadline.signal,
            maxTimeMS: deadline.remainingMs(),
          })
          .exec(),
      ).catch(() => null);
      if (confirmed) return true;
      throw error;
    }
  }

  private async persistFeedback(
    job: AiFeedbackJobWithMeta,
    items: AiFeedbackItem[],
    transaction: ClassroomTaskTransaction,
  ) {
    if (items.length === 0) {
      return;
    }

    const scope = { submissionId: job.submissionId, source: FeedbackSource.AI };
    const feedbackModel = transaction.model(this.feedbackModel);
    const existing = await feedbackModel
      .find({
        ...scope,
        $or: items.map(({ type, severity, message }) => ({
          type,
          severity,
          message,
        })),
      })
      .select('type severity message')
      .session(transaction.session)
      .read('primary')
      .setOptions(transaction.readOptions())
      .lean<FeedbackIdentity[]>()
      .exec();
    const known = new Set(existing.map(feedbackIdentity));
    const missing = items.filter((item) => {
      const key = feedbackIdentity(item);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (missing.length === 0) return;

    transaction.remainingMs();
    const docs = missing.map((item) => ({
      ...scope,
      type: item.type,
      severity: item.severity,
      message: item.message,
      suggestion: item.suggestion,
      tags: item.tags,
      scoreHint: item.scoreHint,
    }));

    await feedbackModel.insertMany(docs, { session: transaction.session });
  }

  private claimFilter(job: AiFeedbackJobWithMeta) {
    return {
      _id: job._id,
      status: AiFeedbackJobStatus.Running,
      attempts: job.attempts,
      lockOwner: job.lockOwner,
    };
  }

  private async requireCurrentClaim(job: AiFeedbackJobWithMeta) {
    if (!(await this.aiFeedbackJobModel.exists(this.claimFilter(job))))
      throw new Error('Claim no longer current');
  }

  private snapshotCompactionItems(
    items: AiFeedbackItem[],
    diagnostic: AiFeedbackCompactionDiagnostic,
    job: AiFeedbackJobWithMeta,
    reason: 'INPUT_CLONE_FAILED' | 'OUTPUT_CLONE_FAILED',
  ): AiFeedbackItem[] | null {
    try {
      return structuredClone(items);
    } catch {
      diagnostic.captureFailed = true;
      this.warnCompactionDiagnostic(job, reason);
      return null;
    }
  }

  private warnCompactionDiagnostic(
    job: AiFeedbackJobWithMeta,
    reason:
      | 'INITIALIZATION_FAILED'
      | 'INPUT_CLONE_FAILED'
      | 'OUTPUT_CLONE_FAILED'
      | 'SAVE_FAILED',
  ): void {
    try {
      this.logger.warn(
        `AI feedback compaction diagnostic failed: jobId=${job._id.toString()}, submissionId=${job.submissionId.toString()}, reason=${reason}`,
      );
    } catch {
      // Diagnostic logging must not replace the business result or exception.
    }
  }

  private executionFor(
    job: AiFeedbackJobWithMeta,
    onDiagnosticHandle?: AiFeedbackExecution['onDiagnosticHandle'],
  ): AiFeedbackExecution {
    return {
      onDiagnosticHandle,
      reserveRequest: async (request) => {
        const result = await this.aiFeedbackJobModel
          .updateOne(
            {
              ...this.claimFilter(job),
              budgetVersion: 1,
              'requests.claimNo': { $ne: job.attempts },
              $expr: { $lt: [{ $size: { $ifNull: ['$requests', []] } }, 3] },
            },
            {
              $push: {
                requests: { ...request, claimNo: job.attempts, usage: null },
              },
            },
          )
          .exec();
        if (result.matchedCount !== 1)
          throw new Error('Request reservation not persisted');
      },
      reportUsage: async (usage) => {
        const result = await this.aiFeedbackJobModel
          .updateOne(
            {
              ...this.claimFilter(job),
              'requests.claimNo': job.attempts,
            },
            { $set: { 'requests.$.usage': usage } },
          )
          .exec();
        if (result.matchedCount !== 1)
          throw new Error('Request usage not persisted');
      },
    };
  }

  private async terminateUnsupportedJob() {
    // Legacy RUNNING is terminated, never taken over or replayed. Terminal jobs
    // remain untouched, including documents without budgetVersion.
    return this.aiFeedbackJobModel
      .findOneAndUpdate(
        {
          budgetVersion: { $ne: 1 },
          status: {
            $in: [
              AiFeedbackJobStatus.Pending,
              AiFeedbackJobStatus.Failed,
              AiFeedbackJobStatus.Running,
            ],
          },
        },
        {
          $set: {
            status: AiFeedbackJobStatus.Dead,
            failureCode: 'LEGACY_JOB_UNSUPPORTED',
            lastError: 'AI_FEEDBACK: LEGACY_JOB_UNSUPPORTED',
            notBefore: null,
            lockedAt: null,
            lockOwner: null,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  private async handleJobFailure(job: AiFeedbackJobWithMeta, error: unknown) {
    const providerCode =
      error instanceof AiFeedbackProviderError ? error.code : null;
    const failureCode: AiReviewFailureCode =
      error instanceof AiContextError
        ? error.code
        : error instanceof AiFeedbackEligibilityError
          ? 'TASK_INELIGIBLE'
          : providerCode === 'INPUT_BUDGET_EXCEEDED'
            ? 'INPUT_BUDGET_EXCEEDED'
            : providerCode === 'OUTPUT_LIMIT_REACHED'
              ? 'OUTPUT_LIMIT_REACHED'
              : ['UNAUTHORIZED', 'MISSING_API_KEY', 'UPSTREAM_4XX'].includes(
                    providerCode ?? '',
                  )
                ? 'PROVIDER_CONFIGURATION'
                : ['RATE_LIMIT_UPSTREAM', 'RATE_LIMIT_LOCAL'].includes(
                      providerCode ?? '',
                    )
                  ? 'RATE_LIMITED'
                  : ['TIMEOUT', 'UPSTREAM_5XX'].includes(providerCode ?? '')
                    ? 'UPSTREAM_UNAVAILABLE'
                    : providerCode === 'BAD_RESPONSE'
                      ? 'INVALID_RESPONSE'
                      : 'INTERNAL_ERROR';
    if (error instanceof AiContextError) {
      this.logger.warn(
        `AI context rejected: jobId=${job._id.toString()}, submissionId=${job.submissionId.toString()}, code=${error.code}, reason=${error.message}`,
      );
    }
    const retryable =
      error instanceof AiFeedbackProviderError &&
      error.retryable &&
      [
        'RATE_LIMIT_UPSTREAM',
        'RATE_LIMIT_LOCAL',
        'UPSTREAM_5XX',
        'TIMEOUT',
      ].includes(error.code);
    const dead = !retryable || job.attempts >= job.maxAttempts;
    const status = dead ? AiFeedbackJobStatus.Dead : AiFeedbackJobStatus.Failed;
    const backoff = Math.min(
      AiFeedbackProcessor.MAX_BACKOFF_MS,
      AiFeedbackProcessor.BASE_BACKOFF_MS * Math.pow(2, job.attempts - 1),
    );
    const updated = await this.aiFeedbackJobModel
      .findOneAndUpdate(this.claimFilter(job), {
        $set: {
          status,
          notBefore: dead ? null : new Date(Date.now() + backoff),
          lockedAt: null,
          lockOwner: null,
          lastError: 'AI_FEEDBACK: ' + (providerCode ?? failureCode),
          failureCode,
        },
      })
      .exec();
    return updated ? status : null;
  }
}
