import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../schemas/ai-feedback-job.schema';
import { Submission } from '../../schemas/submission.schema';
import { AiFeedbackStatus } from '../interfaces/ai-feedback-status.enum';
import { WithId } from '../../../../common/types/with-id.type';
import { WithTimestamps } from '../../../../common/types/with-timestamps.type';

export type AiFeedbackJobListItem = {
  id: string;
  submissionId: string;
  status: AiFeedbackJobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore?: Date | null;
  lockedAt?: Date | null;
  lockOwner?: string | null;
  lastError?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

type AiFeedbackJobLean = AiFeedbackJob & WithId & WithTimestamps;
type AiFeedbackJobIdAndStatus = Pick<AiFeedbackJob, 'status'> & WithId;
export type AiFeedbackJobEnsureResult = {
  jobId: string;
  status: AiFeedbackJobStatus;
};

@Injectable()
export class AiFeedbackJobService {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private static readonly DEFAULT_LIST_LIMIT = 20;
  private static readonly MAX_LIST_LIMIT = 100;
  private readonly logger = new Logger(AiFeedbackJobService.name);

  constructor(
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
  ) {}

  async enqueue(submission: Submission & { _id: Types.ObjectId }) {
    try {
      await this.aiFeedbackJobModel.create(this.toNewJobDocument(submission));
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        this.logger.debug(
          `AiFeedbackJob already exists for submissionId=${submission._id.toString()}`,
        );
        return;
      }
      this.logger.error(
        `Failed to enqueue AiFeedbackJob for submissionId=${submission._id.toString()}`,
        error as Error,
      );
    }
  }

  async ensureJobForSubmission(
    submission: Submission & { _id: Types.ObjectId },
  ): Promise<AiFeedbackJobEnsureResult> {
    const existing = await this.findJobBySubmissionId(submission._id);
    if (existing) {
      return existing;
    }

    try {
      const created = await this.aiFeedbackJobModel.create(
        this.toNewJobDocument(submission),
      );
      return {
        jobId: created._id.toString(),
        status: created.status,
      };
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code !== 11000) {
        throw error;
      }
      const duplicated = await this.findJobBySubmissionId(submission._id);
      if (duplicated) {
        return duplicated;
      }
      throw error;
    }
  }

  async listJobs(params: { status?: AiFeedbackJobStatus; limit?: number }) {
    const rawLimit = params.limit ?? AiFeedbackJobService.DEFAULT_LIST_LIMIT;
    const limit = Math.max(
      1,
      Math.min(rawLimit, AiFeedbackJobService.MAX_LIST_LIMIT),
    );
    const filter: Record<string, unknown> = {};
    if (params.status) {
      filter.status = params.status;
    }

    const jobs = await this.aiFeedbackJobModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<AiFeedbackJobLean[]>()
      .exec();

    return jobs.map((job) => ({
      id: job._id.toString(),
      submissionId: job.submissionId.toString(),
      status: job.status,
      attempts: job.attempts ?? 0,
      maxAttempts: job.maxAttempts ?? AiFeedbackJobService.DEFAULT_MAX_ATTEMPTS,
      notBefore: job.notBefore ?? null,
      lockedAt: job.lockedAt ?? null,
      lockOwner: job.lockOwner ?? null,
      lastError: job.lastError,
      createdAt: job.createdAt ?? null,
      updatedAt: job.updatedAt ?? null,
    })) as AiFeedbackJobListItem[];
  }

  async getStatusMapBySubmissionIds(
    ids: Types.ObjectId[],
  ): Promise<Map<string, AiFeedbackStatus>> {
    const statusMap = new Map<string, AiFeedbackStatus>();
    if (ids.length === 0) {
      return statusMap;
    }
    const jobs = await this.aiFeedbackJobModel
      .find({ submissionId: { $in: ids } })
      .select('submissionId status')
      .lean()
      .exec();

    for (const job of jobs) {
      statusMap.set(
        job.submissionId.toString(),
        this.mapAiFeedbackStatus(job.status),
      );
    }

    return statusMap;
  }

  private mapAiFeedbackStatus(status: AiFeedbackJobStatus) {
    const mapped = {
      [AiFeedbackJobStatus.Pending]: AiFeedbackStatus.Pending,
      [AiFeedbackJobStatus.Running]: AiFeedbackStatus.Running,
      [AiFeedbackJobStatus.Succeeded]: AiFeedbackStatus.Succeeded,
      [AiFeedbackJobStatus.Failed]: AiFeedbackStatus.Failed,
      [AiFeedbackJobStatus.Dead]: AiFeedbackStatus.Dead,
    }[status];

    if (!mapped) {
      this.logger.debug(`Unknown aiFeedback job status: ${String(status)}`);
      return AiFeedbackStatus.NotRequested;
    }

    return mapped;
  }

  private async findJobBySubmissionId(submissionId: Types.ObjectId) {
    const existing = await this.aiFeedbackJobModel
      .findOne({ submissionId })
      .select('_id status')
      .lean<AiFeedbackJobIdAndStatus>()
      .exec();
    if (!existing) {
      return null;
    }
    return {
      jobId: existing._id.toString(),
      status: existing.status,
    } as AiFeedbackJobEnsureResult;
  }

  private toNewJobDocument(submission: Submission & { _id: Types.ObjectId }) {
    return {
      submissionId: submission._id,
      taskId: submission.taskId,
      classroomTaskId: submission.classroomTaskId,
      studentId: submission.studentId,
      status: AiFeedbackJobStatus.Pending,
      attempts: 0,
      maxAttempts: AiFeedbackJobService.DEFAULT_MAX_ATTEMPTS,
      notBefore: new Date(),
    };
  }
}
