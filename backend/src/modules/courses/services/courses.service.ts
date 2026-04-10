import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
      return this.toCourseResponse(course as CourseWithMeta);
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
    const course = await this.findOwnedCourseOrThrow(id, userId);
    const hasCourseLabel = dto.courseLabel !== undefined;
    const hasBaseFieldUpdate =
      dto.code !== undefined ||
      dto.name !== undefined ||
      dto.term !== undefined ||
      hasCourseLabel;
    if (course.status === CourseStatus.Archived && hasBaseFieldUpdate) {
      throw new BadRequestException('Archived courses cannot be updated');
    }
    if (dto.code !== undefined) {
      course.code = dto.code;
    }
    if (dto.name !== undefined) {
      course.name = dto.name;
    }
    if (dto.term !== undefined) {
      course.term = dto.term;
    }
    if (hasCourseLabel) {
      course.courseLabel = this.toSanitizedCourseLabel(dto.courseLabel);
    }
    if (dto.status !== undefined) {
      course.status = dto.status;
    }
    try {
      if (hasBaseFieldUpdate || dto.status !== undefined) {
        await course.save();
      }
      return this.toCourseResponse(course as CourseWithMeta);
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
    const course = await this.findOwnedCourseOrThrow(id, userId);
    await this.assertCourseCanBeDeleted(course._id);
    await this.courseModel.deleteOne({ _id: course._id }).exec();
    return { ok: true };
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

  private async findOwnedCourseOrThrow(id: string, userId: string) {
    const course = await this.courseModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(userId),
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return course;
  }

  private async assertCourseCanBeDeleted(courseId: Types.ObjectId) {
    const classroom = await this.classroomModel.exists({ courseId }).exec();
    if (classroom) {
      throw new ConflictException({
        statusCode: 409,
        code: CoursesService.COURSE_NOT_EMPTY_CODE,
        message: CoursesService.COURSE_NOT_EMPTY_MESSAGE,
      });
    }
  }
}
