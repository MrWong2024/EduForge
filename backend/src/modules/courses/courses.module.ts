import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoursesController } from './controllers/courses.controller';
import { CoursesService } from './services/courses.service';
import { CourseOverviewService } from './services/course-overview.service';
import { Course, CourseSchema } from './schemas/course.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Classroom,
  ClassroomSchema,
} from '../classrooms/schemas/classroom.schema';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from '../classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Submission,
  SubmissionSchema,
} from '../learning-tasks/schemas/submission.schema';
import {
  Enrollment,
  EnrollmentSchema,
} from '../classrooms/enrollments/schemas/enrollment.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Feedback,
  FeedbackSchema,
} from '../learning-tasks/schemas/feedback.schema';
import { AiFeedbackMetricsAggregator } from '../classrooms/classroom-tasks/services/ai-feedback-metrics-aggregator.service';
import { EnrollmentService } from '../classrooms/enrollments/services/enrollment.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Course.name, schema: CourseSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: ClassroomTask.name, schema: ClassroomTaskSchema },
      { name: Submission.name, schema: SubmissionSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Feedback.name, schema: FeedbackSchema },
      { name: AiFeedbackJob.name, schema: AiFeedbackJobSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CoursesController],
  providers: [
    CoursesService,
    CourseOverviewService,
    AiFeedbackMetricsAggregator,
    EnrollmentService,
  ],
})
export class CoursesModule {}
