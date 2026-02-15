import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClassroomsController } from './controllers/classrooms.controller';
import { ClassroomsService } from './services/classrooms.service';
import { Classroom, ClassroomSchema } from './schemas/classroom.schema';
import { Course, CourseSchema } from '../courses/schemas/course.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ClassroomTasksController } from './classroom-tasks/controllers/classroom-tasks.controller';
import { ClassroomTasksService } from './classroom-tasks/services/classroom-tasks.service';
import { AiMetricsService } from './classroom-tasks/services/ai-metrics.service';
import { AiFeedbackMetricsAggregator } from './classroom-tasks/services/ai-feedback-metrics-aggregator.service';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from './classroom-tasks/schemas/classroom-task.schema';
import { Task, TaskSchema } from '../learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionSchema,
} from '../learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSchema,
} from '../learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from '../learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { TeacherClassroomDashboardService } from './services/teacher-classroom-dashboard.service';
import { TeacherClassroomWeeklyReportService } from './services/teacher-classroom-weekly-report.service';
import { StudentLearningDashboardService } from './services/student-learning-dashboard.service';
import { AuthModule } from '../auth/auth.module';
import { LearningTasksModule } from '../learning-tasks/learning-tasks.module';

@Module({
  imports: [
    AuthModule,
    LearningTasksModule,
    MongooseModule.forFeature([
      { name: Classroom.name, schema: ClassroomSchema },
      { name: ClassroomTask.name, schema: ClassroomTaskSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Submission.name, schema: SubmissionSchema },
      { name: Feedback.name, schema: FeedbackSchema },
      { name: AiFeedbackJob.name, schema: AiFeedbackJobSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ClassroomsController, ClassroomTasksController],
  providers: [
    ClassroomsService,
    ClassroomTasksService,
    AiMetricsService,
    AiFeedbackMetricsAggregator,
    AiFeedbackJobService,
    TeacherClassroomDashboardService,
    TeacherClassroomWeeklyReportService,
    StudentLearningDashboardService,
  ],
})
export class ClassroomsModule {}
