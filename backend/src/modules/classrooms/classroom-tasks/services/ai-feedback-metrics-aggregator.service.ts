import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../../../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  AI_FEEDBACK_ERROR_CODES,
  AiFeedbackProviderErrorCode,
} from '../../../learning-tasks/ai-feedback/interfaces/ai-feedback-provider.error-codes';
import {
  Feedback,
  FeedbackSource,
} from '../../../learning-tasks/schemas/feedback.schema';

type AiJobSummaryAgg = {
  _id: Types.ObjectId;
  total: number;
  avgAttempts: number | null;
};

type AiJobStatusAgg = {
  _id: { classroomTaskId: Types.ObjectId; status: unknown };
  count: number;
};

type AiJobErrorAgg = {
  _id: { classroomTaskId: Types.ObjectId; lastError: unknown };
  count: number;
};

type AiJobsAggregationResult = {
  summary: AiJobSummaryAgg[];
  statusCounts: AiJobStatusAgg[];
  errors: AiJobErrorAgg[];
};

type TopTagAgg = {
  tag: string;
  count: number;
};

type NormalizedJobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead';

export type AiFeedbackAggregatedJobMetrics = {
  jobs: {
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    dead: number;
  };
  avgAttempts: number;
  errors: Array<{ code: string; count: number }>;
};

@Injectable()
export class AiFeedbackMetricsAggregator {
  private static readonly KNOWN_ERROR_CODES: AiFeedbackProviderErrorCode[] =
    Object.values(AI_FEEDBACK_ERROR_CODES);

  constructor(
    @InjectModel(AiFeedbackJob.name)
    private readonly aiFeedbackJobModel: Model<AiFeedbackJob>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
  ) {}

  async aggregateJobsByClassroomTaskIds(
    classroomTaskIds: Types.ObjectId[],
    lowerBound: Date,
    timeField: 'createdAt' | 'updatedAt' = 'createdAt',
  ) {
    const grouped = await this.aggregateJobsGroupedByClassroomTaskIds(
      classroomTaskIds,
      lowerBound,
      timeField,
    );
    const jobs = this.createEmptyJobs();
    let weightedAttempts = 0;
    let totalForAttempts = 0;
    const errorCountMap = new Map<string, number>();

    for (const metrics of grouped.values()) {
      jobs.total += metrics.jobs.total;
      jobs.pending += metrics.jobs.pending;
      jobs.running += metrics.jobs.running;
      jobs.succeeded += metrics.jobs.succeeded;
      jobs.failed += metrics.jobs.failed;
      jobs.dead += metrics.jobs.dead;
      weightedAttempts += metrics.avgAttempts * metrics.jobs.total;
      totalForAttempts += metrics.jobs.total;

      for (const error of metrics.errors) {
        const count = errorCountMap.get(error.code) ?? 0;
        errorCountMap.set(error.code, count + error.count);
      }
    }

    const errors = this.toSortedErrors(errorCountMap);
    return {
      jobs,
      avgAttempts:
        totalForAttempts > 0 ? weightedAttempts / totalForAttempts : 0,
      errors,
    };
  }

  async aggregateJobsGroupedByClassroomTaskIds(
    classroomTaskIds: Types.ObjectId[],
    lowerBound: Date,
    timeField: 'createdAt' | 'updatedAt' = 'createdAt',
    topErrorsLimit?: number,
  ) {
    const result = new Map<string, AiFeedbackAggregatedJobMetrics>();
    if (classroomTaskIds.length === 0) {
      return result;
    }

    const uniqueTaskIds = Array.from(
      new Set(classroomTaskIds.map((id) => id.toString())),
    );
    for (const taskId of uniqueTaskIds) {
      result.set(taskId, this.createEmptyMetrics());
    }

    const match: Record<string, unknown> = {
      classroomTaskId: { $in: classroomTaskIds },
    };
    match[timeField] = { $gte: lowerBound };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: '$classroomTaskId',
                total: { $sum: 1 },
                avgAttempts: { $avg: '$attempts' },
              },
            },
          ],
          statusCounts: [
            {
              $group: {
                _id: { classroomTaskId: '$classroomTaskId', status: '$status' },
                count: { $sum: 1 },
              },
            },
          ],
          errors: [
            { $match: { lastError: { $exists: true, $nin: [null, ''] } } },
            {
              $group: {
                _id: {
                  classroomTaskId: '$classroomTaskId',
                  lastError: '$lastError',
                },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const aggregated = await this.aiFeedbackJobModel
      .aggregate<AiJobsAggregationResult>(pipeline)
      .exec();
    const row = aggregated[0] ?? { summary: [], statusCounts: [], errors: [] };

    for (const bucket of row.summary) {
      const taskId = bucket._id.toString();
      const current = result.get(taskId) ?? this.createEmptyMetrics();
      current.jobs.total = bucket.total;
      current.avgAttempts = bucket.avgAttempts ?? 0;
      result.set(taskId, current);
    }

    for (const bucket of row.statusCounts) {
      const taskId = bucket._id.classroomTaskId.toString();
      const current = result.get(taskId) ?? this.createEmptyMetrics();
      const mapped = this.mapJobStatus(bucket._id.status);
      if (!mapped) {
        continue;
      }
      current.jobs[mapped] += bucket.count;
      result.set(taskId, current);
    }

    const taskErrorMap = new Map<string, Map<string, number>>();
    for (const bucket of row.errors) {
      const taskId = bucket._id.classroomTaskId.toString();
      const code = this.extractErrorCode(bucket._id.lastError);
      if (!code) {
        continue;
      }
      const current = taskErrorMap.get(taskId) ?? new Map<string, number>();
      const count = current.get(code) ?? 0;
      current.set(code, count + bucket.count);
      taskErrorMap.set(taskId, current);
    }

    for (const [taskId, codeCountMap] of taskErrorMap.entries()) {
      const current = result.get(taskId) ?? this.createEmptyMetrics();
      const errors = this.toSortedErrors(codeCountMap);
      current.errors =
        typeof topErrorsLimit === 'number' && topErrorsLimit > 0
          ? errors.slice(0, topErrorsLimit)
          : errors;
      result.set(taskId, current);
    }

    return result;
  }

  async aggregateTopTagsByClassroomTaskIds(
    classroomTaskIds: Types.ObjectId[],
    lowerBound: Date,
    limit: number,
  ) {
    if (classroomTaskIds.length === 0 || limit <= 0) {
      return [] as TopTagAgg[];
    }

    const rows = await this.feedbackModel
      .aggregate<TopTagAgg>([
        {
          $match: {
            source: FeedbackSource.AI,
            tags: { $exists: true, $ne: [] },
            createdAt: { $gte: lowerBound },
          },
        },
        {
          $lookup: {
            from: 'submissions',
            localField: 'submissionId',
            foreignField: '_id',
            pipeline: [
              { $match: { classroomTaskId: { $in: classroomTaskIds } } },
              { $project: { _id: 1 } },
            ],
            as: 'submission',
          },
        },
        { $match: { submission: { $ne: [] } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
        { $project: { _id: 0, tag: '$_id', count: 1 } },
      ])
      .exec();

    return rows;
  }

  // Errors are only normalized from concise metadata (`code`) or known tokens.
  // This avoids parsing potentially long free-form messages.
  private extractErrorCode(lastError: unknown): string | null {
    if (typeof lastError === 'object' && lastError !== null) {
      const code = (lastError as { code?: unknown }).code;
      return typeof code === 'string' && code.trim().length > 0 ? code : null;
    }

    if (typeof lastError !== 'string') {
      return null;
    }

    const trimmed = lastError.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (trimmed.length <= 256 && trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { code?: unknown };
        if (typeof parsed.code === 'string' && parsed.code.trim().length > 0) {
          return parsed.code;
        }
      } catch {
        // Keep fallback extraction below.
      }
    }

    return (
      AiFeedbackMetricsAggregator.KNOWN_ERROR_CODES.find((code) =>
        trimmed.includes(code),
      ) ?? null
    );
  }

  private createEmptyJobs() {
    return {
      total: 0,
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
  }

  private createEmptyMetrics(): AiFeedbackAggregatedJobMetrics {
    return {
      jobs: this.createEmptyJobs(),
      avgAttempts: 0,
      errors: [],
    };
  }

  private toSortedErrors(errorCountMap: Map<string, number>) {
    return Array.from(errorCountMap.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) =>
        left.count === right.count
          ? left.code.localeCompare(right.code)
          : right.count - left.count,
      );
  }

  private mapJobStatus(status: unknown): NormalizedJobStatus | null {
    if (status === AiFeedbackJobStatus.Pending) {
      return 'pending';
    }
    if (status === AiFeedbackJobStatus.Running) {
      return 'running';
    }
    if (status === AiFeedbackJobStatus.Succeeded) {
      return 'succeeded';
    }
    if (status === AiFeedbackJobStatus.Failed) {
      return 'failed';
    }
    if (status === AiFeedbackJobStatus.Dead) {
      return 'dead';
    }
    return null;
  }
}
