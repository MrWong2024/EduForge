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
type EnrollmentClassroomRow = {
  classroomId: Types.ObjectId;
};

type EnrollmentClassroomStatsRow = {
  _id: Types.ObjectId;
  totalRecords: number;
  activeStudentsCount: number;
};
type EnrollmentGroupedCountRow = {
  _id: Types.ObjectId;
  count: number;
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

    try {
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
    } catch (error) {
      const mongoError = error as { code?: number };
      // Concurrent upsert races should converge to the same ACTIVE enrollment.
      if (mongoError.code !== 11000) {
        throw error;
      }
    }
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

  async countStudentsGroupedByClassroomIds(classroomIds: Types.ObjectId[]) {
    const result = new Map<string, number>();
    if (classroomIds.length === 0) {
      return result;
    }

    const rows = await this.enrollmentModel
      .aggregate<EnrollmentGroupedCountRow>([
        {
          $match: {
            classroomId: { $in: classroomIds },
            role: EnrollmentRole.Student,
            status: EnrollmentStatus.Active,
          },
        },
        {
          $group: {
            _id: '$classroomId',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      result.set(row._id.toString(), row.count);
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

  async isStudentActiveInClassroomWithLegacyFallback(
    classroomId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    legacyStudentIds: Types.ObjectId[] = [],
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
    if (activeMembership) {
      return true;
    }

    const legacyHasStudent = legacyStudentIds.some(
      (legacyStudentId) =>
        legacyStudentId.toString() === userObjectId.toString(),
    );
    if (!legacyHasStudent) {
      return false;
    }

    const statsMap = await this.getClassroomEnrollmentStatsByClassroomIds([
      classroomObjectId,
    ]);
    const stats = statsMap.get(classroomObjectId.toString());
    const totalRecords = stats?.totalRecords ?? 0;

    // Migration fallback (temporary):
    // only trust legacy studentIds when enrollment records for the classroom are absent.
    return totalRecords === 0;
  }

  async listStudentIdsWithLegacyFallback(
    classroomId: string | Types.ObjectId,
    legacyStudentIds: Types.ObjectId[] = [],
  ) {
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
    if (rows.length > 0) {
      return rows.map((row) => row.userId.toString());
    }

    const statsMap = await this.getClassroomEnrollmentStatsByClassroomIds([
      classroomObjectId,
    ]);
    const stats = statsMap.get(classroomObjectId.toString());
    const totalRecords = stats?.totalRecords ?? 0;
    if (totalRecords > 0) {
      return [];
    }

    return Array.from(new Set(legacyStudentIds.map((id) => id.toString())));
  }

  async countStudentsWithLegacyFallback(
    classroomId: string | Types.ObjectId,
    legacyStudentIds: Types.ObjectId[] = [],
  ) {
    const classroomObjectId = this.toObjectId(classroomId, 'classroomId');
    const [groupedActiveMap, statsMap] = await Promise.all([
      this.countStudentsGroupedByClassroomIds([classroomObjectId]),
      this.getClassroomEnrollmentStatsByClassroomIds([classroomObjectId]),
    ]);
    const stats = statsMap.get(classroomObjectId.toString());
    if (!stats || stats.totalRecords === 0) {
      return legacyStudentIds.length;
    }
    return groupedActiveMap.get(classroomObjectId.toString()) ?? 0;
  }

  async getClassroomEnrollmentStatsByClassroomIds(
    classroomIds: Types.ObjectId[],
  ) {
    const statsMap = new Map<
      string,
      { totalRecords: number; activeStudentsCount: number }
    >();
    if (classroomIds.length === 0) {
      return statsMap;
    }

    const rows = await this.enrollmentModel
      .aggregate<EnrollmentClassroomStatsRow>([
        {
          $match: {
            classroomId: { $in: classroomIds },
          },
        },
        {
          $group: {
            _id: '$classroomId',
            totalRecords: { $sum: 1 },
            activeStudentsCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$role', EnrollmentRole.Student] },
                      { $eq: ['$status', EnrollmentStatus.Active] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      statsMap.set(row._id.toString(), {
        totalRecords: row.totalRecords,
        activeStudentsCount: row.activeStudentsCount,
      });
    }
    return statsMap;
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
