import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, Types, type Connection } from 'mongoose';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  runClassroomReadSnapshot,
  type ClassroomReadSnapshot,
} from '../../../lib/classroom-task-transaction';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  aggregateScopedSubmissionCounts,
  teacherSubmissionScope,
} from './teacher-submission-scope';
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
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectConnection(CLASSROOM_TASK_TRANSACTION_CONNECTION)
    private readonly classroomTaskTransactionConnection: Connection,
  ) {}

  async getCommonIssuesReport(taskId: string, userId: string, limit = 10) {
    return runClassroomReadSnapshot(
      this.classroomTaskTransactionConnection,
      (snapshot) =>
        this.readCommonIssuesReport(taskId, userId, limit, snapshot),
    );
  }

  private async readCommonIssuesReport(
    taskId: string,
    userId: string,
    limit: number,
    snapshot: ClassroomReadSnapshot,
  ) {
    const task = await snapshot
      .model(this.taskModel)
      .findById(taskId)
      .select('createdBy')
      .session(snapshot.session)
      .setOptions(snapshot.readOptions())
      .lean<Pick<Task, 'createdBy'>>()
      .exec();
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
    const filter = await teacherSubmissionScope(
      taskId,
      userId,
      this.classroomModel,
      this.classroomTaskModel,
      snapshot,
    );

    const summary = await aggregateScopedSubmissionCounts(
      this.submissionModel,
      filter,
      snapshot,
    );
    const [report] = await snapshot
      .model(this.feedbackModel)
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
              { $match: filter },
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
      .option({ session: snapshot.session, ...snapshot.readOptions() })
      .exec();

    const reportPayload: CommonIssuesReportAggregation = report ?? {
      topTags: [],
      topTypes: [],
      examples: [],
    };

    return {
      taskId,
      generatedAt: new Date(),
      summary,
      topTags: reportPayload.topTags,
      topTypes: reportPayload.topTypes,
      examples: reportPayload.examples,
    };
  }
}
