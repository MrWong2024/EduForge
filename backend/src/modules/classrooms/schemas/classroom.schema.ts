import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Course } from '../../courses/schemas/course.schema';
import { User } from '../../users/schemas/user.schema';

export type ClassroomDocument = HydratedDocument<Classroom>;

export enum ClassroomStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
}

@Schema({ timestamps: true })
export class Classroom {
  @Prop({ type: Types.ObjectId, ref: Course.name, required: true })
  courseId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  teacherId!: Types.ObjectId;

  @Prop({ required: true })
  joinCode!: string;

  @Prop({ type: [Types.ObjectId], ref: User.name, default: [] })
  studentIds!: Types.ObjectId[];

  @Prop({
    required: true,
    enum: ClassroomStatus,
    default: ClassroomStatus.Active,
  })
  status!: ClassroomStatus;
}

export const ClassroomSchema = SchemaFactory.createForClass(Classroom);
// Unique joinCode for student self-join.
ClassroomSchema.index({ joinCode: 1 }, { unique: true });
// Supports teacher list filters.
ClassroomSchema.index({ teacherId: 1, courseId: 1, status: 1, createdAt: -1 });
