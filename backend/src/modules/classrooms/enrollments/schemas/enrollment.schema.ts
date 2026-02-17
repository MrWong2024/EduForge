import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Classroom } from '../../schemas/classroom.schema';
import { User } from '../../../users/schemas/user.schema';

export type EnrollmentDocument = HydratedDocument<Enrollment>;

export enum EnrollmentRole {
  Student = 'STUDENT',
}

export enum EnrollmentStatus {
  Active = 'ACTIVE',
  Removed = 'REMOVED',
}

@Schema({ timestamps: true })
export class Enrollment {
  @Prop({ type: Types.ObjectId, ref: Classroom.name, required: true })
  classroomId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: EnrollmentRole,
    default: EnrollmentRole.Student,
  })
  role!: EnrollmentRole;

  @Prop({
    required: true,
    enum: EnrollmentStatus,
    default: EnrollmentStatus.Active,
  })
  status!: EnrollmentStatus;

  @Prop({ required: true, default: () => new Date() })
  joinedAt!: Date;

  @Prop({ type: Date, required: false })
  removedAt?: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
// Enforce one enrollment record per classroom-user pair.
EnrollmentSchema.index({ classroomId: 1, userId: 1 }, { unique: true });
// Supports querying user memberships by status.
EnrollmentSchema.index({ userId: 1, status: 1 });
// Supports querying classroom members by status.
EnrollmentSchema.index({ classroomId: 1, status: 1 });
// Supports ACTIVE STUDENT pagination/count by classroom with stable userId sort.
EnrollmentSchema.index({ classroomId: 1, status: 1, role: 1, userId: 1 });
