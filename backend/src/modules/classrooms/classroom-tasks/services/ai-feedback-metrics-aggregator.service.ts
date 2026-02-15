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
  total: number;
  avgAttempts: number | null;
};

type AiJobStatusAgg = {
  _id: unknown;
  count: number;
};

type AiJobErrorAgg = {
  _id: unknown;
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
    const empty = {
      jobs: {
        total: 0,
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
      },
      avgAttempts: 0,
      errors: [] as Array<{ code: string; count: number }>,
    };
    if (classroomTaskIds.length === 0) {
      return empty;
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
                _id: null,
                total: { $sum: 1 },
                avgAttempts: { $avg: '$attempts' },
              },
            },
          ],
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          errors: [
            { $match: { lastError: { $exists: true, $nin: [null, ''] } } },
            { $group: { _id: '$lastError', count: { $sum: 1 } } },
          ],
        },
      },
    ];

    const aggregated = await this.aiFeedbackJobModel
      .aggregate<AiJobsAggregationResult>(pipeline)
      .exec();
    const row = aggregated[0] ?? { summary: [], statusCounts: [], errors: [] };
    const jobs = {
      total: row.summary[0]?.total ?? 0,
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };

    for (const bucket of row.statusCounts) {
      const mapped = this.mapJobStatus(bucket._id);
      if (!mapped) {
        continue;
      }
      jobs[mapped] += bucket.count;
    }

    const errorCountMap = new Map<string, number>();
    for (const bucket of row.errors) {
      const code = this.extractErrorCode(bucket._id);
      if (!code) {
        continue;
      }
      const count = errorCountMap.get(code) ?? 0;
      errorCountMap.set(code, count + bucket.count);
    }

    const errors = Array.from(errorCountMap.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) =>
        left.count === right.count
          ? left.code.localeCompare(right.code)
          : right.count - left.count,
      );

    return { jobs, avgAttempts: row.summary[0]?.avgAttempts ?? 0, errors };
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
