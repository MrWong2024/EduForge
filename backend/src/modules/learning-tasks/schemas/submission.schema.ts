import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Task } from './task.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { User } from '../../users/schemas/user.schema';

export type SubmissionDocument = HydratedDocument<Submission>;

export enum SubmissionStatus {
  Submitted = 'SUBMITTED',
  Evaluated = 'EVALUATED',
}

@Schema({ _id: false })
export class SubmissionContent {
  @Prop({ required: true })
  codeText!: string;

  @Prop({ required: true })
  language!: string;
}

export const SubmissionContentSchema =
  SchemaFactory.createForClass(SubmissionContent);

@Schema({ _id: false })
export class SubmissionMeta {
  @Prop()
  aiUsageDeclaration?: string;
}

export const SubmissionMetaSchema =
  SchemaFactory.createForClass(SubmissionMeta);

@Schema({ timestamps: true })
export class Submission {
  @Prop({ type: Types.ObjectId, ref: Task.name, required: true })
  taskId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: ClassroomTask.name })
  classroomTaskId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  studentId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  attemptNo!: number;

  @Prop({ required: true, type: SubmissionContentSchema })
  content!: SubmissionContent;

  @Prop({ type: SubmissionMetaSchema })
  meta?: SubmissionMeta;

  @Prop({ required: true, enum: SubmissionStatus })
  status!: SubmissionStatus;
}

export const SubmissionSchema = SchemaFactory.createForClass(Submission);
SubmissionSchema.index(
  { taskId: 1, studentId: 1, attemptNo: 1 },
  { unique: true },
);
SubmissionSchema.index({ taskId: 1, studentId: 1 });
// Supports teacher list/stats queries on taskId with createdAt sort; adds write overhead.
SubmissionSchema.index({ taskId: 1, createdAt: -1 });
// Supports classroom dashboard queries scoped by classroomTaskId and student.
SubmissionSchema.index({ classroomTaskId: 1, studentId: 1, createdAt: -1 });
// Supports classroom dashboard queries scoped by classroomTaskId with time order.
SubmissionSchema.index({ classroomTaskId: 1, createdAt: -1 });
// Supports lookup pipelines constrained by classroomTaskId and _id.
SubmissionSchema.index({ classroomTaskId: 1, _id: 1 });
