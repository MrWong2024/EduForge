import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
import { CreateClassroomDto } from '../dto/create-classroom.dto';
import { UpdateClassroomDto } from '../dto/update-classroom.dto';
import { QueryClassroomDto } from '../dto/query-classroom.dto';
import { JoinClassroomDto } from '../dto/join-classroom.dto';
import { QueryClassroomWeeklyReportDto } from '../dto/query-classroom-weekly-report.dto';
import { ClassroomResponseDto } from '../dto/classroom-response.dto';
import { Course } from '../../courses/schemas/course.schema';
import { User } from '../../users/schemas/user.schema';
import { TeacherClassroomDashboardService } from './teacher-classroom-dashboard.service';
import { TeacherClassroomWeeklyReportService } from './teacher-classroom-weekly-report.service';
import { StudentLearningDashboardService } from './student-learning-dashboard.service';
import { EnrollmentService } from '../enrollments/services/enrollment.service';
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  hasAnyRole,
} from '../../users/schemas/user-roles.constants';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type ClassroomWithMeta = Classroom & WithId & WithTimestamps;

@Injectable()
export class ClassroomsService {
  private static readonly JOIN_CODE_ATTEMPTS = 8;
  private static readonly JOIN_CODE_MIN_LENGTH = 6;
  private static readonly JOIN_CODE_MAX_LENGTH = 8;
  private static readonly JOIN_CODE_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(Course.name) private readonly courseModel: Model<Course>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
    private readonly teacherClassroomDashboardService: TeacherClassroomDashboardService,
    private readonly teacherClassroomWeeklyReportService: TeacherClassroomWeeklyReportService,
    private readonly studentLearningDashboardService: StudentLearningDashboardService,
  ) {}

  async createClassroom(dto: CreateClassroomDto, userId: string) {
    await this.ensureTeacher(userId);
    const course = await this.courseModel
      .findOne({ _id: dto.courseId, createdBy: new Types.ObjectId(userId) })
      .select('_id')
      .lean()
      .exec();
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    for (
      let attempt = 0;
      attempt < ClassroomsService.JOIN_CODE_ATTEMPTS;
      attempt += 1
    ) {
      const joinCode = this.generateJoinCode();
      try {
        const classroom = await this.classroomModel.create({
          courseId: new Types.ObjectId(dto.courseId),
          name: dto.name,
          teacherId: new Types.ObjectId(userId),
          joinCode,
          status: ClassroomStatus.Active,
        });
        return this.toClassroomResponse(classroom as ClassroomWithMeta, true);
      } catch (error) {
        const mongoError = error as { code?: number };
        if (
          mongoError.code !== 11000 ||
          attempt === ClassroomsService.JOIN_CODE_ATTEMPTS - 1
        ) {
          throw error;
        }
      }
    }

    throw new BadRequestException('Unable to allocate join code');
  }

  async updateClassroom(id: string, dto: UpdateClassroomDto, userId: string) {
    await this.ensureTeacher(userId);
    const classroom = await this.classroomModel.findOne({
      _id: id,
      teacherId: new Types.ObjectId(userId),
    });
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (classroom.status === ClassroomStatus.Archived) {
      throw new BadRequestException('Archived classrooms cannot be updated');
    }
    Object.assign(classroom, dto);
    await classroom.save();
    return this.toClassroomResponse(classroom as ClassroomWithMeta, true);
  }

  async listClassrooms(query: QueryClassroomDto, userId: string) {
    await this.ensureTeacher(userId);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const filter: Record<string, unknown> = {
      teacherId: new Types.ObjectId(userId),
    };
    if (query.courseId) {
      filter.courseId = new Types.ObjectId(query.courseId);
    }
    if (query.status) {
      filter.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.classroomModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ClassroomWithMeta[]>()
        .exec(),
      this.classroomModel.countDocuments(filter),
    ]);

    return {
      items: items.map((classroom) => this.toClassroomResponse(classroom)),
      total,
      page,
      limit,
    };
  }

  async getClassroom(id: string, userId: string) {
    const classroom = await this.classroomModel
      .findById(id)
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const roles = await this.getUserRoles(userId);
    const isTeacher = hasAnyRole(roles, TEACHER_ROLES);
    const isStudent = hasAnyRole(roles, STUDENT_ROLES);
    const isOwner = classroom.teacherId.toString() === userId;

    if (isTeacher && isOwner) {
      return this.toClassroomResponse(classroom, true);
    }
    if (isStudent) {
      await this.assertStudentInClassroomActive(classroom, userId);
      return this.toClassroomResponse(classroom);
    }

    throw new ForbiddenException('Not allowed to view classroom');
  }

  async getDashboard(id: string, userId: string) {
    await this.ensureTeacher(userId);
    return this.teacherClassroomDashboardService.getDashboard(id, userId);
  }

  async getWeeklyReport(
    classroomId: string,
    query: QueryClassroomWeeklyReportDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.teacherClassroomWeeklyReportService.getWeeklyReport(
      classroomId,
      query.window,
      query.includeRiskStudentIds,
      userId,
    );
  }

  async getMyLearningDashboard(query: QueryClassroomDto, userId: string) {
    await this.ensureStudent(userId);
    return this.studentLearningDashboardService.getMyLearningDashboard(
      query,
      userId,
    );
  }

  async archiveClassroom(id: string, userId: string) {
    await this.ensureTeacher(userId);
    const classroom = await this.classroomModel.findOne({
      _id: id,
      teacherId: new Types.ObjectId(userId),
    });
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (classroom.status !== ClassroomStatus.Archived) {
      classroom.status = ClassroomStatus.Archived;
      await classroom.save();
    }
    return this.toClassroomResponse(classroom as ClassroomWithMeta, true);
  }

  async joinClassroom(dto: JoinClassroomDto, userId: string) {
    await this.ensureStudent(userId);
    const classroom = await this.classroomModel
      .findOne({ joinCode: dto.joinCode })
      .lean<ClassroomWithMeta>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    if (classroom.status === ClassroomStatus.Archived) {
      throw new BadRequestException('Classroom is archived');
    }

    // Migration strategy (AD): dual-write during transition.
    // Enrollment is source of truth; classroom.studentIds remains legacy mirror
    // until backfill + full reader migration are complete.
    await this.enrollmentService.enrollStudent(
      classroom._id.toString(),
      userId,
    );
    await this.classroomModel
      .updateOne(
        { _id: classroom._id },
        { $addToSet: { studentIds: new Types.ObjectId(userId) } },
      )
      .exec();
    const updated = await this.classroomModel
      .findById(classroom._id)
      .lean<ClassroomWithMeta>()
      .exec();
    return this.toClassroomResponse(updated ?? classroom);
  }

  async removeStudent(id: string, studentId: string, userId: string) {
    await this.ensureTeacher(userId);
    const classroom = await this.classroomModel.findOne({
      _id: id,
      teacherId: new Types.ObjectId(userId),
    });
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    await this.enrollmentService.removeStudent(
      classroom._id.toString(),
      studentId,
    );
    await this.classroomModel
      .updateOne(
        { _id: classroom._id },
        { $pull: { studentIds: new Types.ObjectId(studentId) } },
      )
      .exec();
    const updated = await this.classroomModel
      .findById(classroom._id)
      .lean<ClassroomWithMeta>()
      .exec();
    return this.toClassroomResponse(
      (updated ?? classroom) as ClassroomWithMeta,
      true,
    );
  }

  private async ensureTeacher(userId: string) {
    const roles = await this.getUserRoles(userId);
    if (!hasAnyRole(roles, TEACHER_ROLES)) {
      throw new ForbiddenException('Not allowed to manage classrooms');
    }
  }

  private async ensureStudent(userId: string) {
    const roles = await this.getUserRoles(userId);
    if (!hasAnyRole(roles, STUDENT_ROLES)) {
      throw new ForbiddenException('Not allowed to join classrooms');
    }
  }

  private async getUserRoles(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('roles')
      .lean()
      .exec();
    if (!user) {
      throw new ForbiddenException('Not allowed');
    }
    return user.roles ?? [];
  }

  private generateJoinCode() {
    const length =
      Math.floor(
        Math.random() *
          (ClassroomsService.JOIN_CODE_MAX_LENGTH -
            ClassroomsService.JOIN_CODE_MIN_LENGTH +
            1),
      ) + ClassroomsService.JOIN_CODE_MIN_LENGTH;
    let code = '';
    for (let i = 0; i < length; i += 1) {
      const index = Math.floor(
        Math.random() * ClassroomsService.JOIN_CODE_CHARS.length,
      );
      code += ClassroomsService.JOIN_CODE_CHARS[index];
    }
    return code;
  }

  private toClassroomResponse(
    classroom: ClassroomWithMeta,
    includeStudents = false,
  ) {
    return {
      id: classroom._id.toString(),
      courseId: classroom.courseId.toString(),
      name: classroom.name,
      teacherId: classroom.teacherId.toString(),
      joinCode: classroom.joinCode,
      status: classroom.status,
      studentIds: includeStudents
        ? classroom.studentIds.map((studentId) => studentId.toString())
        : undefined,
      createdAt: classroom.createdAt ?? new Date(0),
      updatedAt: classroom.updatedAt ?? new Date(0),
    } as ClassroomResponseDto;
  }

  private async assertStudentInClassroomActive(
    classroom: ClassroomWithMeta,
    studentId: string,
  ) {
    const isMember =
      await this.enrollmentService.isStudentActiveInClassroomWithLegacyFallback(
        classroom._id,
        studentId,
        classroom.studentIds ?? [],
      );
    if (!isMember) {
      throw new ForbiddenException('Not allowed to view classroom');
    }
  }
}
