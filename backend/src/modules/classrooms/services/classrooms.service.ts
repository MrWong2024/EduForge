import {
  BadRequestException,
  ConflictException,
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
import { QueryProcessAssessmentDto } from '../dto/query-process-assessment.dto';
import { QueryClassroomExportSnapshotDto } from '../dto/query-classroom-export-snapshot.dto';
import { QueryClassroomStudentsDto } from '../dto/query-classroom-students.dto';
import {
  QueryAiLearningAnalyticsDto,
  QueryAiLearningAnalyticsStudentsDto,
} from '../dto/query-ai-learning-analytics.dto';
import {
  ClassroomCourseSummaryDto,
  ClassroomResponseDto,
} from '../dto/classroom-response.dto';
import { Course } from '../../courses/schemas/course.schema';
import { User } from '../../users/schemas/user.schema';
import { TeacherClassroomDashboardService } from './teacher-classroom-dashboard.service';
import { TeacherClassroomWeeklyReportService } from './teacher-classroom-weekly-report.service';
import { StudentLearningDashboardService } from './student-learning-dashboard.service';
import { ProcessAssessmentService } from './process-assessment.service';
import { ClassroomExportSnapshotService } from './classroom-export-snapshot.service';
import {
  ClassroomStudentEnrollmentRow,
  EnrollmentService,
} from '../enrollments/services/enrollment.service';
import { ClassroomTask } from '../classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  hasAnyRole,
} from '../../users/schemas/user-roles.constants';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { AiLearningAnalyticsService } from './ai-learning-analytics.service';

type ClassroomWithMeta = Classroom & WithId & WithTimestamps;
type ClassroomOwnerLean = Pick<Classroom, 'teacherId'> & WithId;
type CourseSummaryLean = Pick<
  Course,
  'code' | 'name' | 'term' | 'courseLabel' | 'status'
> &
  WithId;
type StudentUserLean = Pick<
  User,
  'email' | 'roles' | 'status' | 'name' | 'studentNo' | 'employeeNo'
> &
  WithId;
type ClassroomStudentItem = {
  id: string;
  email: string;
  roles: string[];
  status: string;
  name: string | null;
  studentNo: string | null;
  employeeNo: string | null;
  joinedAt: Date;
};
type ListClassroomStudentsResponse = {
  items: ClassroomStudentItem[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class ClassroomsService {
  private static readonly JOIN_CODE_ATTEMPTS = 8;
  private static readonly JOIN_CODE_MIN_LENGTH = 6;
  private static readonly JOIN_CODE_MAX_LENGTH = 8;
  private static readonly JOIN_CODE_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  private static readonly CLASSROOM_NOT_EMPTY_CODE = 'CLASSROOM_NOT_EMPTY';
  private static readonly CLASSROOM_NOT_EMPTY_MESSAGE =
    '该班级已有成员或任务记录，不能删除，只能归档';

  constructor(
    @InjectModel(Classroom.name)
    private readonly classroomModel: Model<Classroom>,
    @InjectModel(ClassroomTask.name)
    private readonly classroomTaskModel: Model<ClassroomTask>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Course.name) private readonly courseModel: Model<Course>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly enrollmentService: EnrollmentService,
    private readonly teacherClassroomDashboardService: TeacherClassroomDashboardService,
    private readonly teacherClassroomWeeklyReportService: TeacherClassroomWeeklyReportService,
    private readonly studentLearningDashboardService: StudentLearningDashboardService,
    private readonly processAssessmentService: ProcessAssessmentService,
    private readonly classroomExportSnapshotService: ClassroomExportSnapshotService,
    private readonly aiLearningAnalyticsService: AiLearningAnalyticsService,
  ) {}

  async createClassroom(dto: CreateClassroomDto, userId: string) {
    await this.ensureTeacher(userId);
    const course = await this.courseModel
      .findOne({ _id: dto.courseId, createdBy: new Types.ObjectId(userId) })
      .select('_id code name term courseLabel status')
      .lean<CourseSummaryLean>()
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
        return this.toClassroomResponse(
          classroom as ClassroomWithMeta,
          true,
          this.toCourseSummary(course),
        );
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
    const classroom = await this.findOwnedClassroomOrThrow(id, userId);
    if (
      classroom.status === ClassroomStatus.Archived &&
      dto.name !== undefined
    ) {
      throw new BadRequestException('Archived classrooms cannot be updated');
    }

    if (dto.name !== undefined) {
      classroom.name = dto.name;
    }
    if (dto.status !== undefined) {
      classroom.status = dto.status;
    }

    if (dto.name !== undefined || dto.status !== undefined) {
      await classroom.save();
    }
    return this.toClassroomResponse(classroom as ClassroomWithMeta, true);
  }

  async deleteClassroom(id: string, userId: string) {
    await this.ensureTeacher(userId);
    const classroom = await this.findOwnedClassroomOrThrow(id, userId);
    await this.assertClassroomCanBeDeleted(classroom._id, classroom.studentIds);
    await this.classroomModel.deleteOne({ _id: classroom._id }).exec();
    return { ok: true };
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

    const courseMap = await this.getCourseSummaryMap(
      items.map((classroom) => classroom.courseId),
    );

    return {
      items: await Promise.all(
        items.map((classroom) =>
          this.toClassroomResponse(
            classroom,
            false,
            courseMap.get(classroom.courseId.toString()) ?? null,
          ),
        ),
      ),
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
      await this.assertStudentInClassroomActive(classroom._id, userId);
      return this.toClassroomResponse(classroom);
    }

    throw new ForbiddenException('Not allowed to view classroom');
  }

  async getDashboard(id: string, userId: string, includeClosedTasks = false) {
    await this.ensureTeacher(userId);
    return this.teacherClassroomDashboardService.getDashboard(
      id,
      userId,
      includeClosedTasks,
    );
  }

  async listStudents(
    classroomId: string,
    query: QueryClassroomStudentsDto,
    userId: string,
  ): Promise<ListClassroomStudentsResponse> {
    await this.ensureTeacher(userId);

    const classroom = await this.classroomModel
      .findOne({
        _id: classroomId,
        teacherId: new Types.ObjectId(userId),
      })
      .select('_id teacherId')
      .lean<ClassroomOwnerLean>()
      .exec();
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const includeRemoved = this.parseBooleanQuery(query.includeRemoved, false);

    const [memberships, total] = await Promise.all([
      this.enrollmentService.listStudentsByClassroomPage(
        classroom._id,
        page,
        limit,
        includeRemoved,
      ),
      this.enrollmentService.countStudents(
        classroom._id.toString(),
        includeRemoved,
      ),
    ]);

    if (memberships.length === 0) {
      return { items: [], total, page, limit };
    }

    const users = await this.userModel
      .find({
        _id: { $in: memberships.map((membership) => membership.userId) },
      })
      .select('email roles status name studentNo employeeNo')
      .lean<StudentUserLean[]>()
      .exec();

    const userMap = new Map<string, StudentUserLean>();
    for (const user of users) {
      userMap.set(user._id.toString(), user);
    }

    const items = this.toClassroomStudentItems(memberships, userMap);
    return { items, total, page, limit };
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

  async getMyLearningDashboard(
    query: QueryClassroomDto,
    userId: string,
    includeHistorical = false,
  ) {
    await this.ensureStudent(userId);
    return this.studentLearningDashboardService.getMyLearningDashboard(
      query,
      userId,
      includeHistorical,
    );
  }

  async getProcessAssessment(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.processAssessmentService.getProcessAssessment(
      classroomId,
      query,
      userId,
    );
  }

  async getAiLearningAnalytics(
    classroomId: string,
    query: QueryAiLearningAnalyticsDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.aiLearningAnalyticsService.getOverview(
      classroomId,
      query,
      userId,
    );
  }

  async getAiLearningAnalyticsStudents(
    classroomId: string,
    query: QueryAiLearningAnalyticsStudentsDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.aiLearningAnalyticsService.getStudents(
      classroomId,
      query,
      userId,
    );
  }

  async getAiLearningAnalyticsStudentDetail(
    classroomId: string,
    studentId: string,
    query: QueryAiLearningAnalyticsDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.aiLearningAnalyticsService.getStudentDetail(
      classroomId,
      studentId,
      query,
      userId,
    );
  }

  async exportProcessAssessmentCsv(
    classroomId: string,
    query: QueryProcessAssessmentDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.processAssessmentService.exportProcessAssessmentCsv(
      classroomId,
      query,
      userId,
    );
  }

  async exportSnapshot(
    classroomId: string,
    query: QueryClassroomExportSnapshotDto,
    userId: string,
  ) {
    await this.ensureTeacher(userId);
    return this.classroomExportSnapshotService.getSnapshot(
      classroomId,
      query,
      userId,
    );
  }

  async archiveClassroom(id: string, userId: string) {
    return this.updateClassroom(
      id,
      { status: ClassroomStatus.Archived },
      userId,
    );
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

  private async toClassroomResponse(
    classroom: ClassroomWithMeta,
    includeStudents = false,
    course: ClassroomCourseSummaryDto | null | undefined = undefined,
  ) {
    // Legacy output compatibility:
    // `studentIds` is a derived response field from Enrollment ACTIVE records.
    // Authorization/statistics must not read classroom.studentIds.
    const studentIds = includeStudents
      ? await this.enrollmentService.listActiveStudentIds(classroom._id)
      : undefined;
    const courseSummary =
      course === undefined
        ? await this.findCourseSummaryById(classroom.courseId)
        : (course ?? undefined);
    return {
      id: classroom._id.toString(),
      courseId: classroom.courseId.toString(),
      course: courseSummary,
      name: classroom.name,
      teacherId: classroom.teacherId.toString(),
      joinCode: classroom.joinCode,
      status: classroom.status,
      studentIds,
      createdAt: classroom.createdAt ?? new Date(0),
      updatedAt: classroom.updatedAt ?? new Date(0),
    } as ClassroomResponseDto;
  }

  private async findCourseSummaryById(
    courseId: Types.ObjectId,
  ): Promise<ClassroomCourseSummaryDto | undefined> {
    const course = await this.courseModel
      .findById(courseId)
      .select('_id code name term courseLabel status')
      .lean<CourseSummaryLean>()
      .exec();
    return this.toCourseSummary(course);
  }

  private async getCourseSummaryMap(
    courseIds: Types.ObjectId[],
  ): Promise<Map<string, ClassroomCourseSummaryDto>> {
    const uniqueCourseMap = new Map(
      courseIds.map((courseId) => [courseId.toString(), courseId]),
    );
    const uniqueCourseIds = Array.from(uniqueCourseMap.values());
    const result = new Map<string, ClassroomCourseSummaryDto>();
    if (uniqueCourseIds.length === 0) {
      return result;
    }

    const courses = await this.courseModel
      .find({ _id: { $in: uniqueCourseIds } })
      .select('_id code name term courseLabel status')
      .lean<CourseSummaryLean[]>()
      .exec();

    for (const course of courses) {
      const summary = this.toCourseSummary(course);
      if (summary) {
        result.set(summary.id, summary);
      }
    }
    return result;
  }

  private toCourseSummary(
    course: CourseSummaryLean | null | undefined,
  ): ClassroomCourseSummaryDto | undefined {
    if (!course) {
      return undefined;
    }
    return {
      id: course._id.toString(),
      code: course.code,
      name: course.name,
      term: course.term,
      courseLabel: course.courseLabel,
      status: course.status,
    };
  }

  private async assertStudentInClassroomActive(
    classroomId: string | Types.ObjectId,
    studentId: string,
  ) {
    const isMember = await this.enrollmentService.isStudentActiveInClassroom(
      classroomId,
      studentId,
    );
    if (!isMember) {
      throw new ForbiddenException('Not allowed to view classroom');
    }
  }

  private toClassroomStudentItems(
    memberships: ClassroomStudentEnrollmentRow[],
    userMap: Map<string, StudentUserLean>,
  ): ClassroomStudentItem[] {
    const items: ClassroomStudentItem[] = [];
    for (const membership of memberships) {
      const user = userMap.get(membership.userId.toString());
      if (!user) {
        continue;
      }
      items.push({
        id: user._id.toString(),
        email: user.email,
        roles: user.roles,
        status: membership.status,
        name: user.name ?? null,
        studentNo: user.studentNo ?? null,
        employeeNo: user.employeeNo ?? null,
        joinedAt: membership.joinedAt,
      });
    }
    return items;
  }

  private parseBooleanQuery(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  private async findOwnedClassroomOrThrow(id: string, userId: string) {
    const classroom = await this.classroomModel.findOne({
      _id: id,
      teacherId: new Types.ObjectId(userId),
    });
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }
    return classroom;
  }

  private async assertClassroomCanBeDeleted(
    classroomId: Types.ObjectId,
    studentIds: Types.ObjectId[] | undefined,
  ) {
    const [classroomTask, enrollment] = await Promise.all([
      this.classroomTaskModel.exists({ classroomId }).exec(),
      this.enrollmentModel.exists({ classroomId }).exec(),
    ]);
    const hasClassroomTask = !!classroomTask;
    const hasEnrollment = !!enrollment;
    const hasLegacyStudentIds = (studentIds?.length ?? 0) > 0;
    if (hasClassroomTask || hasEnrollment || hasLegacyStudentIds) {
      throw new ConflictException({
        statusCode: 409,
        code: ClassroomsService.CLASSROOM_NOT_EMPTY_CODE,
        message: ClassroomsService.CLASSROOM_NOT_EMPTY_MESSAGE,
      });
    }
  }
}
