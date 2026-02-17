import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../schemas/enrollment.schema';

type EnrollmentStudentRow = {
  userId: Types.ObjectId;
};

@Injectable()
export class EnrollmentService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
  ) {}

  // Idempotent semantics:
  // repeated enroll calls always converge to ACTIVE with removedAt cleared.
  async enrollStudent(classroomId: string, userId: string) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const userObjectId = this.parseObjectId(userId, 'userId');
    const now = new Date();

    await this.enrollmentModel
      .updateOne(
        { classroomId: classroomObjectId, userId: userObjectId },
        {
          $setOnInsert: {
            role: EnrollmentRole.Student,
            joinedAt: now,
          },
          $set: {
            status: EnrollmentStatus.Active,
            removedAt: null,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  // Soft-delete and idempotent semantics:
  // removing an already REMOVED enrollment remains REMOVED and does not throw.
  async removeStudent(classroomId: string, userId: string) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const userObjectId = this.parseObjectId(userId, 'userId');

    await this.enrollmentModel
      .updateOne(
        { classroomId: classroomObjectId, userId: userObjectId },
        {
          $set: {
            status: EnrollmentStatus.Removed,
            removedAt: new Date(),
          },
        },
      )
      .exec();
  }

  async listStudents(classroomId: string) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');

    const rows = await this.enrollmentModel
      .find({
        classroomId: classroomObjectId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .select({ _id: 0, userId: 1 })
      .lean<EnrollmentStudentRow[]>()
      .exec();

    return rows.map((row) => row.userId.toString());
  }

  async countStudents(classroomId: string) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');

    return this.enrollmentModel.countDocuments({
      classroomId: classroomObjectId,
      role: EnrollmentRole.Student,
      status: EnrollmentStatus.Active,
    });
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
