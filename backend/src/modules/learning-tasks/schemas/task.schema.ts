import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type TaskDocument = HydratedDocument<Task>;

export enum TaskStatus {
  Draft = 'DRAFT',
  Published = 'PUBLISHED',
  Archived = 'ARCHIVED',
}

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true, trim: true })
  knowledgeModule!: string;

  @Prop({ required: true, min: 1, max: 4 })
  stage!: number;

  @Prop()
  difficulty?: string;

  @Prop({ type: Object })
  rubric?: Record<string, unknown>;

  @Prop({ required: true, enum: TaskStatus })
  status!: TaskStatus;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  createdBy!: Types.ObjectId;

  @Prop()
  publishedAt?: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
// Indexes below optimize list filters/sorts; add write overhead on task writes.
TaskSchema.index({ createdBy: 1, createdAt: -1 });
// Supports listTasks composite filters (status/knowledgeModule/stage) with createdAt sort.
TaskSchema.index({ status: 1, knowledgeModule: 1, stage: 1, createdAt: -1 });
