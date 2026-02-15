import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import {
  Feedback,
  FeedbackSource,
} from '../../../learning-tasks/schemas/feedback.schema';
import { AiFeedbackMetricsAggregator } from './ai-feedback-metrics-aggregator.service';
import {
  AiMetricsWindow,
  AI_METRICS_WINDOWS,
} from '../dto/query-ai-metrics.dto';

type FeedbackSummaryAgg = {
  _id: null;
  totalItems: number;
  submissionsCount: number;
};

type FeedbackAggregationResult = {
  summary: FeedbackSummaryAgg[];
};

@Injectable()
export class AiMetricsService {
  private static readonly DEFAULT_WINDOW: AiMetricsWindow = '24h';
  private static readonly TOP_TAGS_LIMIT = 5;
  private static readonly WINDOW_MS_MAP: Record<AiMetricsWindow, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<Feedback>,
    private readonly aiFeedbackMetricsAggregator: AiFeedbackMetricsAggregator,
  ) {}

  async getAiMetrics(
    classroomId: string,
    classroomTaskId: string,
    window: AiMetricsWindow | undefined,
    includeTagsQuery: string | undefined,
    teacherId: string,
  ) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const classroomTaskObjectId = this.parseObjectId(
      classroomTaskId,
      'classroomTaskId',
    );
    const includeTags = this.parseIncludeTags(includeTagsQuery);
    const { window: resolvedWindow, lowerBound } = this.resolveWindow(window);

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomObjectId,
        teacherId: new Types.ObjectId(teacherId),
      })
      .select('_id')
      .lean()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const classroomTask = await this.classroomTaskModel
      .findOne({ _id: classroomTaskObjectId, classroomId: classroomObjectId })
      .select('_id')
      .lean()
      .exec();
    if (!classroomTask) {
      throw new NotFoundException('Classroom task not found');
    }

    const [{ jobs, avgAttempts, errors }, feedbackAggregate, topTags] =
      await Promise.all([
        this.aiFeedbackMetricsAggregator.aggregateJobsByClassroomTaskIds(
          [classroomTaskObjectId],
          lowerBound,
          'updatedAt',
        ),
        this.feedbackModel
          .aggregate<FeedbackAggregationResult>(
            this.buildFeedbackSummaryPipeline(
              classroomTaskObjectId,
              lowerBound,
            ),
          )
          .exec(),
        includeTags
          ? this.aiFeedbackMetricsAggregator.aggregateTopTagsByClassroomTaskIds(
              [classroomTaskObjectId],
              lowerBound,
              AiMetricsService.TOP_TAGS_LIMIT,
            )
          : Promise.resolve([]),
      ]);

    const feedbackSummary = feedbackAggregate[0]?.summary[0];
    const totalItems = feedbackSummary?.totalItems ?? 0;
    const submissionsCount = feedbackSummary?.submissionsCount ?? 0;
    const avgItemsPerSubmission =
      submissionsCount > 0 ? totalItems / submissionsCount : 0;

    return {
      classroomId: classroomObjectId.toString(),
      classroomTaskId: classroomTaskObjectId.toString(),
      generatedAt: new Date().toISOString(),
      window: resolvedWindow,
      summary: {
        jobs,
        successRate: jobs.total > 0 ? jobs.succeeded / jobs.total : 0,
        avgAttempts,
        avgLatencyMs: null,
      },
      errors,
      feedback: {
        avgItemsPerSubmission,
        totalItems,
        topTags: includeTags ? topTags : [],
      },
    };
  }

  private buildFeedbackSummaryPipeline(
    classroomTaskId: Types.ObjectId,
    lowerBound: Date,
  ) {
    return [
      {
        $match: {
          source: FeedbackSource.AI,
          createdAt: { $gte: lowerBound },
        },
      },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          pipeline: [{ $match: { classroomTaskId } }, { $project: { _id: 1 } }],
          as: 'submission',
        },
      },
      { $match: { submission: { $ne: [] } } },
      {
        $facet: {
          summary: [
            { $group: { _id: '$submissionId', items: { $sum: 1 } } },
            {
              $group: {
                _id: null,
                totalItems: { $sum: '$items' },
                submissionsCount: { $sum: 1 },
              },
            },
          ],
        },
      },
    ] as PipelineStage[];
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private parseIncludeTags(includeTagsQuery: string | undefined) {
    if (includeTagsQuery === undefined) {
      return true;
    }
    return includeTagsQuery.toLowerCase() === 'true';
  }

  private resolveWindow(window: AiMetricsWindow | undefined) {
    const resolved = AI_METRICS_WINDOWS.includes(window as AiMetricsWindow)
      ? (window as AiMetricsWindow)
      : AiMetricsService.DEFAULT_WINDOW;
    const lowerBound = new Date(
      Date.now() - AiMetricsService.WINDOW_MS_MAP[resolved],
    );
    return { window: resolved, lowerBound };
  }
}
