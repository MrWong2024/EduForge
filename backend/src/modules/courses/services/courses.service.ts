import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, Types, type QueryFilter } from 'mongoose';
import type { Connection } from 'mongoose';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  runClassroomTaskTransaction,
} from '../../../lib/classroom-task-transaction';
import { Course, CourseStatus } from '../schemas/course.schema';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { CreateCourseDto } from '../dto/create-course.dto';
import { UpdateCourseDto } from '../dto/update-course.dto';
import { QueryCourseDto } from '../dto/query-course.dto';
import { CourseResponseDto } from '../dto/course-response.dto';
import { User } from '../../users/schemas/user.schema';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import {
  TEACHER_ROLES,
  hasAnyRole,
} from '../../users/schemas/user-roles.constants';

type CourseWithMeta = Course & WithId & WithTimestamps;

@Injectable()
export class CoursesService {
  private static readonly COURSE_NOT_EMPTY_CODE = 'COURSE_NOT_EMPTY';
  private static readonly COURSE_NOT_EMPTY_MESSAGE =
    '该课程下已有班级记录，不能删除，只能归档';

  constructor(
    @InjectModel(Course.name) private readonly courseModel: Model<Course>,
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection(CLASSROOM_TASK_TRANSACTION_CONNECTION)
    private readonly classroomTaskTransactionConnection: Connection,
  ) {}

  async createCourse(dto: CreateCourseDto, userId: string) {
    await this.ensureTeacher(userId);
    const courseLabel = this.toSanitizedCourseLabel(dto.courseLabel);
    try {
      const course = await this.courseModel.create({
        ...dto,
        courseLabel,
        status: CourseStatus.Active,
        createdBy: new Types.ObjectId(userId),
      });
      return this.toCourseResponse(course);
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        throw new BadRequestException('Course code already exists');
      }
      throw error;
    }
  }

  async updateCourse(id: string, dto: UpdateCourseDto, userId: string) {
    await this.ensureTeacher(userId);
    const scope = { _id: id, createdBy: new Types.ObjectId(userId) };
    const { name, term, status } = dto;
    const code = dto.code?.trim();
    const courseLabel = this.toSanitizedCourseLabel(dto.courseLabel);
    const hasCourseLabel = dto.courseLabel !== undefined;
    const hasBaseFieldUpdate =
      code !== undefined ||
      name !== undefined ||
      term !== undefined ||
      hasCourseLabel;
    const clearCourseLabel = hasCourseLabel && courseLabel === undefined;
    const $set = {
      ...(code !== undefined && { code }),
      ...(name !== undefined && { name }),
      ...(term !== undefined && { term }),
      ...(status !== undefined && { status }),
      ...(courseLabel !== undefined && { courseLabel }),
    };
    const differences: QueryFilter<Course>[] = Object.entries($set).map(
      ([field, value]) =>
        field === 'status' && status === CourseStatus.Active
          ? { status: { $exists: true, $ne: CourseStatus.Active } }
          : { [field]: { $ne: value } },
    );
    if (clearCourseLabel) {
      differences.push({ courseLabel: { $exists: true } });
    }

    try {
      let course = await this.courseModel.findOne(scope).exec();
      while (course) {
        if (course.status === CourseStatus.Archived && hasBaseFieldUpdate) {
          throw new BadRequestException('Archived courses cannot be updated');
        }
        if (
          (code === undefined || course.code === code) &&
          (name === undefined || course.name === name) &&
          (term === undefined || course.term === term) &&
          (status === undefined || course.status === status) &&
          (courseLabel === undefined || course.courseLabel === courseLabel) &&
          (!clearCourseLabel || course.courseLabel === undefined)
        ) {
          return this.toCourseResponse(course);
        }

        const updated = await this.courseModel
          .findOneAndUpdate(
            {
              ...scope,
              ...(hasBaseFieldUpdate && {
                status: { $ne: CourseStatus.Archived },
              }),
              $or: differences,
            },
            { $set, ...(clearCourseLabel && { $unset: { courseLabel: 1 } }) },
            { returnDocument: 'after', runValidators: true },
          )
          .exec();
        if (updated) return this.toCourseResponse(updated);
        // A miss can mean the patch is already satisfied or the scope changed.
        course = await this.courseModel.findOne(scope).exec();
      }
      throw new NotFoundException('Course not found');
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        throw new BadRequestException('Course code already exists');
      }
      throw error;
    }
  }

  async listCourses(query: QueryCourseDto, userId: string) {
    await this.ensureTeacher(userId);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const filter: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
    };
    if (query.term) {
      filter.term = query.term;
    }
    if (query.status) {
      filter.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.courseModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CourseWithMeta[]>()
        .exec(),
      this.courseModel.countDocuments(filter),
    ]);

    return {
      items: items.map((course) => this.toCourseResponse(course)),
      total,
      page,
      limit,
    };
  }

  async getCourse(id: string, userId: string) {
    await this.ensureTeacher(userId);
    const course = await this.courseModel
      .findOne({ _id: id, createdBy: new Types.ObjectId(userId) })
      .lean<CourseWithMeta>()
      .exec();
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return this.toCourseResponse(course);
  }

  async archiveCourse(id: string, userId: string) {
    return this.updateCourse(id, { status: CourseStatus.Archived }, userId);
  }

  async deleteCourse(id: string, userId: string) {
    await this.ensureTeacher(userId);
    return runClassroomTaskTransaction(
      this.classroomTaskTransactionConnection,
      async (transaction) => {
        const { session } = transaction;
        // Coordinate with the Course write held by classroom creation.
        const { deletedCount } = await transaction
          .model(this.courseModel)
          .deleteOne(
            { _id: id, createdBy: new Types.ObjectId(userId) },
            { session, maxTimeMS: transaction.remainingMs() },
          )
          .exec();
        if (deletedCount === 0) {
          throw new NotFoundException('Course not found');
        }

        const classroom = await transaction
          .model(this.classroomModel)
          .exists({ courseId: new Types.ObjectId(id) })
          .session(session)
          .setOptions(transaction.readOptions())
          .exec();
        if (classroom) {
          throw new ConflictException({
            statusCode: 409,
            code: CoursesService.COURSE_NOT_EMPTY_CODE,
            message: CoursesService.COURSE_NOT_EMPTY_MESSAGE,
          });
        }
        return { ok: true };
      },
    );
  }

  private async ensureTeacher(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('roles')
      .lean()
      .exec();
    if (!user || !hasAnyRole(user.roles ?? [], TEACHER_ROLES)) {
      throw new ForbiddenException('Not allowed to manage courses');
    }
  }

  private toCourseResponse(course: CourseWithMeta) {
    return {
      id: course._id.toString(),
      code: course.code,
      name: course.name,
      term: course.term,
      courseLabel: this.toSanitizedCourseLabel(course.courseLabel),
      status: course.status,
      createdBy: course.createdBy.toString(),
      createdAt: course.createdAt ?? new Date(0),
      updatedAt: course.updatedAt ?? new Date(0),
    } as CourseResponseDto;
  }

  private toSanitizedCourseLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
}
