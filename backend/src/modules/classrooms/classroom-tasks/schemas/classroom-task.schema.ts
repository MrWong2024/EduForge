import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { Task } from '../../../learning-tasks/schemas/task.schema';
import { User } from '../../../users/schemas/user.schema';

export type ClassroomTaskDocument = HydratedDocument<ClassroomTask>;

@Schema({ timestamps: true })
export class ClassroomTask {
  @Prop({ type: Types.ObjectId, ref: Classroom.name, required: true })
  classroomId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Task.name, required: true })
  taskId!: Types.ObjectId;

  @Prop({ required: true })
  publishedAt!: Date;

  @Prop()
  dueAt?: Date;

  @Prop({ type: Object })
  settings?: {
    allowLate?: boolean;
    maxAttempts?: number;
  };

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  createdBy!: Types.ObjectId;
}

export const ClassroomTaskSchema = SchemaFactory.createForClass(ClassroomTask);
// Prevent duplicate publishes of the same task into the same classroom.
ClassroomTaskSchema.index({ classroomId: 1, taskId: 1 }, { unique: true });
// Supports listing by classroom with time order.
ClassroomTaskSchema.index({ classroomId: 1, createdAt: -1 });
