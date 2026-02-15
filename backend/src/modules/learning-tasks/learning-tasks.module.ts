import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LearningTasksController } from './controllers/learning-tasks.controller';
import { LearningTasksService } from './services/learning-tasks.service';
import { LearningTasksReportsService } from './services/learning-tasks-reports.service';
import { Task, TaskSchema } from './schemas/task.schema';
import { Submission, SubmissionSchema } from './schemas/submission.schema';
import { Feedback, FeedbackSchema } from './schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from './ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from './ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackGuardsService } from './ai-feedback/services/ai-feedback-guards.service';
import { AiFeedbackProcessor } from './ai-feedback/services/ai-feedback-processor.service';
import { DefaultStubAiFeedbackProvider } from './ai-feedback/services/default-stub-ai-feedback.provider';
import { AiFeedbackWorker } from './ai-feedback/services/ai-feedback-worker.service';
import { AiFeedbackDebugEnabledGuard } from './ai-feedback/guards/ai-feedback-debug-enabled.guard';
import { AI_FEEDBACK_PROVIDER_TOKEN } from './ai-feedback/interfaces/ai-feedback-provider.interface';
import { OpenRouterFeedbackProvider } from './ai-feedback/providers/real/openrouter-feedback.provider';
import { AuthModule } from '../auth/auth.module';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from '../classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Classroom,
  ClassroomSchema,
} from '../classrooms/schemas/classroom.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Submission.name, schema: SubmissionSchema },
      { name: Feedback.name, schema: FeedbackSchema },
      { name: AiFeedbackJob.name, schema: AiFeedbackJobSchema },
      { name: ClassroomTask.name, schema: ClassroomTaskSchema },
      { name: Classroom.name, schema: ClassroomSchema },
    ]),
  ],
  controllers: [LearningTasksController],
  providers: [
    LearningTasksService,
    LearningTasksReportsService,
    AiFeedbackJobService,
    AiFeedbackGuardsService,
    AiFeedbackProcessor,
    DefaultStubAiFeedbackProvider,
    OpenRouterFeedbackProvider,
    AiFeedbackWorker,
    AiFeedbackDebugEnabledGuard,
    {
      provide: AI_FEEDBACK_PROVIDER_TOKEN,
      inject: [
        ConfigService,
        DefaultStubAiFeedbackProvider,
        OpenRouterFeedbackProvider,
      ],
      useFactory: (
        configService: ConfigService,
        stubProvider: DefaultStubAiFeedbackProvider,
        openRouterProvider: OpenRouterFeedbackProvider,
      ) => {
        const rawProvider = configService.get<string>('AI_FEEDBACK_PROVIDER');
        const provider = (rawProvider ?? 'stub').toLowerCase();
        if (provider === 'stub') {
          return stubProvider;
        }
        if (provider === 'openrouter') {
          return openRouterProvider;
        }
        throw new Error(
          `AI_FEEDBACK_PROVIDER unsupported value "${rawProvider ?? ''}". Supported: stub, openrouter`,
        );
      },
    },
  ],
  exports: [LearningTasksService],
})
export class LearningTasksModule {}
