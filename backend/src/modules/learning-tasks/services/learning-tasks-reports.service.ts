import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task } from '../schemas/task.schema';
import { Submission } from '../schemas/submission.schema';
import { Feedback } from '../schemas/feedback.schema';

export type CommonIssuesReportAggregation = {
  topTags: Array<{
    tag: string;
    count: number;
    severityBreakdown: { INFO: number; WARN: number; ERROR: number };
  }>;
  topTypes: Array<{ type: string; count: number }>;
  examples: Array<{
    tag: string;
    count: number;
    samples: Array<{
      submissionId: Types.ObjectId;
      message: string;
      suggestion?: string;
      severity: 'INFO' | 'WARN' | 'ERROR';
    }>;
  }>;
};

@Injectable()
export class LearningTasksReportsService {
  private static readonly COMMON_ISSUES_LIMIT = 10;
  private static readonly COMMON_ISSUES_SOURCES = ['AI', 'TEACHER'];

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Submission.name)
    private readonly submissionModel: Model<Submission>,
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<Feedback>,
  ) {}

  async getCommonIssuesReport(taskId: string, userId: string, limit = 10) {
    const task = await this.taskModel.findById(taskId).lean().exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.createdBy.toString() !== userId) {
      throw new ForbiddenException('Not allowed to view reports');
    }

    const safeLimit = Math.min(
      Math.max(limit, 1),
      LearningTasksReportsService.COMMON_ISSUES_LIMIT,
    );
    const taskObjectId = new Types.ObjectId(taskId);

    const [submissionsCount, distinctStudentIds, report] = await Promise.all([
      this.submissionModel.countDocuments({ taskId: taskObjectId }),
      this.submissionModel.distinct('studentId', { taskId: taskObjectId }),
      this.feedbackModel
        .aggregate<CommonIssuesReportAggregation>([
          {
            $match: {
              source: {
                $in: LearningTasksReportsService.COMMON_ISSUES_SOURCES,
              },
            },
          },
          {
            $lookup: {
              from: this.submissionModel.collection.name,
              let: { submissionId: '$submissionId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$_id', '$$submissionId'] },
                        { $eq: ['$taskId', taskObjectId] },
                      ],
                    },
                  },
                },
                { $project: { _id: 1 } },
              ],
              as: 'submission',
            },
          },
          { $unwind: '$submission' },
          {
            $facet: {
              topTags: [
                { $match: { tags: { $exists: true, $ne: [] } } },
                { $unwind: '$tags' },
                {
                  $group: {
                    _id: '$tags',
                    count: { $sum: 1 },
                    infoCount: {
                      $sum: {
                        $cond: [{ $eq: ['$severity', 'INFO'] }, 1, 0],
                      },
                    },
                    warnCount: {
                      $sum: {
                        $cond: [{ $eq: ['$severity', 'WARN'] }, 1, 0],
                      },
                    },
                    errorCount: {
                      $sum: {
                        $cond: [{ $eq: ['$severity', 'ERROR'] }, 1, 0],
                      },
                    },
                  },
                },
                { $sort: { count: -1, _id: 1 } },
                { $limit: safeLimit },
                {
                  $project: {
                    _id: 0,
                    tag: '$_id',
                    count: 1,
                    severityBreakdown: {
                      INFO: '$infoCount',
                      WARN: '$warnCount',
                      ERROR: '$errorCount',
                    },
                  },
                },
              ],
              topTypes: [
                {
                  $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1, _id: 1 } },
                { $limit: safeLimit },
                { $project: { _id: 0, type: '$_id', count: 1 } },
              ],
              examples: [
                { $match: { tags: { $exists: true, $ne: [] } } },
                { $unwind: '$tags' },
                { $match: { severity: { $in: ['INFO', 'WARN', 'ERROR'] } } },
                { $sort: { createdAt: -1 } },
                {
                  $group: {
                    _id: '$tags',
                    count: { $sum: 1 },
                    samples: {
                      $push: {
                        submissionId: '$submissionId',
                        message: '$message',
                        suggestion: '$suggestion',
                        severity: '$severity',
                      },
                    },
                  },
                },
                { $sort: { count: -1, _id: 1 } },
                { $limit: safeLimit },
                {
                  $project: {
                    _id: 0,
                    tag: '$_id',
                    count: 1,
                    samples: { $slice: ['$samples', 3] },
                  },
                },
              ],
            },
          },
        ])
        .exec(),
    ]);

    const reportPayload: CommonIssuesReportAggregation = report[0] ?? {
      topTags: [],
      topTypes: [],
      examples: [],
    };

    return {
      taskId,
      generatedAt: new Date(),
      summary: {
        submissionsCount,
        distinctStudentsCount: distinctStudentIds.length,
      },
      topTags: reportPayload.topTags,
      topTypes: reportPayload.topTypes,
      examples: reportPayload.examples,
    };
  }
}
