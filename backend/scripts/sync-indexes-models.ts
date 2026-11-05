import type { Schema } from 'mongoose';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from '../src/modules/auth/schemas/password-reset-token.schema';
import {
  Session,
  SessionSchema,
} from '../src/modules/auth/schemas/session.schema';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Enrollment,
  EnrollmentSchema,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import {
  Classroom,
  ClassroomSchema,
} from '../src/modules/classrooms/schemas/classroom.schema';
import {
  Course,
  CourseSchema,
} from '../src/modules/courses/schemas/course.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  Feedback,
  FeedbackSchema,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  Submission,
  SubmissionSchema,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Task,
  TaskSchema,
} from '../src/modules/learning-tasks/schemas/task.schema';
import { User, UserSchema } from '../src/modules/users/schemas/user.schema';

// Mirror the distinct top-level registrations in the application's forFeature calls.
// The CLI clones these schemas before setting connection-specific options.
export const SYNC_INDEX_SCHEMAS: ReadonlyArray<{
  name: string;
  schema: Schema;
}> = [
  { name: User.name, schema: UserSchema },
  { name: Session.name, schema: SessionSchema },
  { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
  { name: Course.name, schema: CourseSchema },
  { name: Classroom.name, schema: ClassroomSchema },
  { name: Enrollment.name, schema: EnrollmentSchema },
  { name: ClassroomTask.name, schema: ClassroomTaskSchema },
  { name: Task.name, schema: TaskSchema },
  { name: Submission.name, schema: SubmissionSchema },
  { name: Feedback.name, schema: FeedbackSchema },
  { name: AiFeedbackJob.name, schema: AiFeedbackJobSchema },
];
