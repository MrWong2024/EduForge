import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type CourseDocument = HydratedDocument<Course>;

export enum CourseStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
}

@Schema({ timestamps: true })
export class Course {
  @Prop({ required: true, trim: true })
  code!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  term!: string;

  @Prop({ required: true, enum: CourseStatus, default: CourseStatus.Active })
  status!: CourseStatus;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  createdBy!: Types.ObjectId;
}

export const CourseSchema = SchemaFactory.createForClass(Course);
// Unique per teacher to allow the same code across different teachers.
CourseSchema.index({ createdBy: 1, code: 1 }, { unique: true });
