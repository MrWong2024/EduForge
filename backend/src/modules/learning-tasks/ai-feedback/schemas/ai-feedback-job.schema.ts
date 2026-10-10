import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { AiTokenUsage } from '../interfaces/ai-feedback-provider.interface';
import type { AiReviewFailureCode } from '../lib/ai-review-summary';
import { Submission } from '../../schemas/submission.schema';
import { Task } from '../../schemas/task.schema';
import { User } from '../../../users/schemas/user.schema';
import { ClassroomTask } from '../../../classrooms/classroom-tasks/schemas/classroom-task.schema';

export type AiFeedbackJobDocument = HydratedDocument<AiFeedbackJob>;

export enum AiFeedbackJobStatus {
  Pending = 'PENDING',
  Running = 'RUNNING',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Dead = 'DEAD',
}

@Schema({ _id: false })
export class AiRequestRecord {
  @Prop({ type: Number, required: true, min: 1, max: 3 })
  claimNo!: number;
  @Prop({ type: String, enum: ['bailian'], required: true })
  provider!: 'bailian';
  @Prop({ type: String, required: true })
  model!: string;
  @Prop({ type: Number, required: true })
  inputBytes!: number;
  @Prop({ type: Number, required: true })
  maxOutputTokens!: number;
  @Prop({ type: Date, required: true })
  reservedAt!: Date;
  @Prop({ type: Object, default: null })
  usage!: AiTokenUsage | null;
}
const AiRequestRecordSchema = SchemaFactory.createForClass(AiRequestRecord);

@Schema({ timestamps: true })
export class AiFeedbackJob {
  // No default: old jobs must not hydrate as current budget records.
  @Prop({ type: Number })
  budgetVersion?: number;
  @Prop({ type: String, enum: ['bailian', 'stub'] })
  provider?: 'bailian' | 'stub';
  @Prop({ type: String })
  failureCode?: AiReviewFailureCode;
  @Prop({
    type: [AiRequestRecordSchema],
    default: undefined,
    validate: (records: AiRequestRecord[]) => records.length <= 3,
  })
  requests?: AiRequestRecord[];
  @Prop({ type: Types.ObjectId, ref: Submission.name, required: true })
  submissionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Task.name, required: true })
  taskId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: ClassroomTask.name })
  classroomTaskId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  studentId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: AiFeedbackJobStatus,
    default: AiFeedbackJobStatus.Pending,
  })
  status!: AiFeedbackJobStatus;

  @Prop({ required: true, min: 0, default: 0 })
  attempts!: number;

  @Prop({ required: true, min: 1, default: 3 })
  maxAttempts!: number;

  @Prop()
  notBefore?: Date;

  @Prop()
  lockedAt?: Date;

  @Prop()
  lockOwner?: string;

  @Prop()
  lastError?: string;
}

export const AiFeedbackJobSchema = SchemaFactory.createForClass(AiFeedbackJob);
AiFeedbackJobSchema.index({ submissionId: 1 }, { unique: true });
// Indexes below optimize job polling/listing; add write overhead on job writes.
AiFeedbackJobSchema.index({ createdAt: -1 });
AiFeedbackJobSchema.index({ status: 1, createdAt: -1 });
AiFeedbackJobSchema.index({
  status: 1,
  notBefore: 1,
  lockedAt: 1,
  createdAt: 1,
});
// Supports dashboard aggregation scoped by classroomTaskId with status and scheduling.
AiFeedbackJobSchema.index({ classroomTaskId: 1, status: 1, notBefore: 1 });
// Supports dashboard aggregation scoped by classroomTaskId with time order.
AiFeedbackJobSchema.index({ classroomTaskId: 1, createdAt: -1 });
// Supports dashboard aggregation scoped by classroomTaskId with update-time windows.
AiFeedbackJobSchema.index({ classroomTaskId: 1, updatedAt: -1 });
