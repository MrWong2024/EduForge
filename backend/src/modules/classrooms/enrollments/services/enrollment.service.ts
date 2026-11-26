import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ClassroomTaskTransaction } from '../../../../lib/classroom-task-transaction';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../schemas/enrollment.schema';

type EnrollmentStudentRow = {
  userId: Types.ObjectId;
};
type EnrollmentClassroomRow = {
  classroomId: Types.ObjectId;
};
type EnrollmentClassroomStudentRow = {
  classroomId: Types.ObjectId;
  userId: Types.ObjectId;
};
export type ActiveStudentEnrollmentRow = {
  userId: Types.ObjectId;
  joinedAt: Date;
};
export type ClassroomStudentEnrollmentRow = {
  userId: Types.ObjectId;
  joinedAt: Date;
  status: EnrollmentStatus;
};

@Injectable()
export class EnrollmentService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
  ) {}

  // Idempotent semantics:
  // repeated enroll calls always converge to ACTIVE with removedAt cleared.
  async enrollStudent(
    classroomId: Types.ObjectId,
    userId: string,
    transaction: ClassroomTaskTransaction,
  ) {
    const userObjectId = this.parseObjectId(userId, 'userId');
    await transaction
      .model(this.enrollmentModel)
      .updateOne(
        { classroomId, userId: userObjectId },
        {
          $setOnInsert: {
            role: EnrollmentRole.Student,
            joinedAt: new Date(),
          },
          $set: {
            status: EnrollmentStatus.Active,
            removedAt: null,
          },
        },
        {
          session: transaction.session,
          maxTimeMS: transaction.remainingMs(),
          upsert: true,
        },
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
    return this.listActiveStudentIds(classroomId);
  }

  async listActiveStudentIdsByClassroomPage(
    classroomId: string | Types.ObjectId,
    page: number,
    limit: number,
  ) {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');
    const safePage = page < 1 ? 1 : page;
    const safeLimit = limit < 1 ? 1 : limit;
    const rows = await this.enrollmentModel
      .find({
        classroomId: classroomObjectId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .sort({ userId: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select({ _id: 0, userId: 1 })
      .lean<EnrollmentStudentRow[]>()
      .exec();
    return rows.map((row) => row.userId.toString());
  }

  async listActiveStudentsByClassroomPage(
    classroomId: string | Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<ActiveStudentEnrollmentRow[]> {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');
    const safePage = page < 1 ? 1 : page;
    const safeLimit = limit < 1 ? 1 : limit;

    return this.enrollmentModel
      .find({
        classroomId: classroomObjectId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .sort({ joinedAt: -1, _id: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select({ _id: 0, userId: 1, joinedAt: 1 })
      .lean<ActiveStudentEnrollmentRow[]>()
      .exec();
  }

  async listStudentsByClassroomPage(
    classroomId: string | Types.ObjectId,
    page: number,
    limit: number,
    includeRemoved = false,
  ): Promise<ClassroomStudentEnrollmentRow[]> {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');
    const safePage = page < 1 ? 1 : page;
    const safeLimit = limit < 1 ? 1 : limit;
    const statuses = includeRemoved
      ? [EnrollmentStatus.Active, EnrollmentStatus.Removed]
      : [EnrollmentStatus.Active];

    return this.enrollmentModel
      .find({
        classroomId: classroomObjectId,
        role: EnrollmentRole.Student,
        status: { $in: statuses },
      })
      .sort({ joinedAt: -1, _id: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select({ _id: 0, userId: 1, joinedAt: 1, status: 1 })
      .lean<ClassroomStudentEnrollmentRow[]>()
      .exec();
  }

  async listActiveStudentIds(classroomId: string | Types.ObjectId) {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');

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

  async countStudents(classroomId: string, includeRemoved = false) {
    const classroomObjectId = this.parseObjectId(classroomId, 'classroomId');
    const statuses = includeRemoved
      ? [EnrollmentStatus.Active, EnrollmentStatus.Removed]
      : [EnrollmentStatus.Active];

    return this.enrollmentModel.countDocuments({
      classroomId: classroomObjectId,
      role: EnrollmentRole.Student,
      status: { $in: statuses },
    });
  }

  async listActiveStudentIdsGroupedByClassroomIds(
    classroomIds: Types.ObjectId[],
  ) {
    const result = new Map<string, Set<string>>();
    if (classroomIds.length === 0) {
      return result;
    }

    const rows = await this.enrollmentModel
      .find({
        classroomId: { $in: classroomIds },
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .select({ _id: 0, classroomId: 1, userId: 1 })
      .lean<EnrollmentClassroomStudentRow[]>()
      .exec();

    for (const row of rows) {
      const classroomId = row.classroomId.toString();
      const students = result.get(classroomId) ?? new Set<string>();
      students.add(row.userId.toString());
      result.set(classroomId, students);
    }
    return result;
  }

  async listActiveClassroomIdsByUser(userId: string | Types.ObjectId) {
    const userObjectId = this.toObjectId(userId, 'userId');
    const rows = await this.enrollmentModel
      .find({
        userId: userObjectId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .select({ _id: 0, classroomId: 1 })
      .lean<EnrollmentClassroomRow[]>()
      .exec();
    return rows.map((row) => row.classroomId);
  }

  async isStudentActiveInClassroom(
    classroomId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');
    const userObjectId = this.toObjectId(userId, 'userId');

    const activeMembership = await this.enrollmentModel
      .findOne({
        classroomId: classroomObjectId,
        userId: userObjectId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      })
      .select('_id')
      .lean()
      .exec();
    return !!activeMembership;
  }

  private parseObjectId(value: string, fieldName: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${fieldName} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private toObjectId(value: string | Types.ObjectId, fieldName: string) {
    if (value instanceof Types.ObjectId) {
      return value;
    }
    return this.parseObjectId(value, fieldName);
  }
}
