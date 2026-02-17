import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for enrollment-only regression e2e.',
    );
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type WeeklyReportResponse = {
  progress: {
    studentsCount: number;
    submissionRate: number;
  };
};
type MineDashboardResponse = {
  items: Array<{
    classroom: {
      id: string;
    };
  }>;
};
type CourseOverviewResponse = {
  total: number;
  items: Array<{
    classroomId: string;
    studentsCount: number;
    submissionRate: number;
  }>;
};

describe('Enrollment Only Regression Lock (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let enrollmentModel: Model<Enrollment>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;
  let studentCAgent: ReturnType<typeof request.agent>;
  let studentDAgent: ReturnType<typeof request.agent>;

  const createdCourseIds: string[] = [];
  const createdClassroomIds: string[] = [];
  const createdUserIds: string[] = [];

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let studentCId = '';
  let studentDId = '';

  const teacherEmail = `teacher.enrollment.ai.${Date.now()}@example.com`;
  const studentAEmail = `studentA.enrollment.ai.${Date.now()}@example.com`;
  const studentBEmail = `studentB.enrollment.ai.${Date.now()}@example.com`;
  const studentCEmail = `studentC.enrollment.ai.${Date.now()}@example.com`;
  const studentDEmail = `studentD.enrollment.ai.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

  const login = async (
    agent: ReturnType<typeof request.agent>,
    email: string,
    password: string,
  ) => {
    await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  };

  const pollUntil = async (
    assertion: () => Promise<void>,
    retries = 15,
    intervalMs = 120,
  ) => {
    let lastError: unknown;
    for (let index = 0; index < retries; index += 1) {
      try {
        await assertion();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    throw lastError;
  };

  const createCourseAndClassroom = async (suffix: string) => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `ENRONLY${suffix}${Date.now()}`,
        name: `EnrollmentOnly-${suffix}`,
        term: '2026-Spring',
      })
      .expect(201);
    const courseId = (createdCourse.body as CreatedCourseResponse).id;
    createdCourseIds.push(courseId);

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: `Classroom-${suffix}`,
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomBody.id);

    return {
      courseId,
      classroomId: classroomBody.id,
      joinCode: classroomBody.joinCode,
    };
  };

  const fetchWeeklyReport = async (classroomId: string) => {
    const weekly = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    return weekly.body as WeeklyReportResponse;
  };

  beforeAll(async () => {
    ensureMongoUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use(cookieParser());
    await app.init();

    teacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());
    studentCAgent = request.agent(app.getHttpServer());
    studentDAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));

    const [
      teacherHash,
      studentAHash,
      studentBHash,
      studentCHash,
      studentDHash,
    ] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [teacher, studentA, studentB, studentC, studentD] = await Promise.all(
      [
        userModel.create({
          email: teacherEmail,
          passwordHash: teacherHash,
          roles: ['teacher'],
        }),
        userModel.create({
          email: studentAEmail,
          passwordHash: studentAHash,
          roles: ['student'],
        }),
        userModel.create({
          email: studentBEmail,
          passwordHash: studentBHash,
          roles: ['student'],
        }),
        userModel.create({
          email: studentCEmail,
          passwordHash: studentCHash,
          roles: ['student'],
        }),
        userModel.create({
          email: studentDEmail,
          passwordHash: studentDHash,
          roles: ['student'],
        }),
      ],
    );

    teacherId = teacher._id.toString();
    studentAId = studentA._id.toString();
    studentBId = studentB._id.toString();
    studentCId = studentC._id.toString();
    studentDId = studentD._id.toString();
    createdUserIds.push(
      teacherId,
      studentAId,
      studentBId,
      studentCId,
      studentDId,
    );

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
    await login(studentCAgent, studentCEmail, studentPassword);
    await login(studentDAgent, studentDEmail, studentPassword);
  });

  afterAll(async () => {
    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (createdClassroomIds.length > 0) {
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: {
              $in: createdClassroomIds.map((id) => new Types.ObjectId(id)),
            },
          }),
        );
        cleanup.push(
          classroomModel.deleteMany({
            _id: {
              $in: createdClassroomIds.map((id) => new Types.ObjectId(id)),
            },
          }),
        );
      }
      if (createdCourseIds.length > 0) {
        cleanup.push(
          courseModel.deleteMany({
            _id: { $in: createdCourseIds.map((id) => new Types.ObjectId(id)) },
          }),
        );
      }
      if (createdUserIds.length > 0) {
        const userObjectIds = createdUserIds.map(
          (id) => new Types.ObjectId(id),
        );
        cleanup.push(
          sessionModel.deleteMany({ userId: { $in: userObjectIds } }),
        );
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      await Promise.all(cleanup);
    }
    await app.close();
  });

  it('1) authorization anti-cheat: dirty studentIds must not grant classroom access', async () => {
    const { classroomId } = await createCourseAndClassroom('AUTH');
    const classroomObjectId = new Types.ObjectId(classroomId);

    await enrollmentModel
      .deleteMany({
        classroomId: classroomObjectId,
        userId: new Types.ObjectId(studentAId),
      })
      .exec();
    await classroomModel
      .updateOne(
        { _id: classroomObjectId },
        { $addToSet: { studentIds: new Types.ObjectId(studentAId) } },
      )
      .exec();

    const classroomAccess = await studentAAgent.get(
      `/api/classrooms/${classroomId}`,
    );
    expect(classroomAccess.status).not.toBe(200);
  });

  it('2) statistics anti-cheat: weekly studentsCount only follows enrollment', async () => {
    const { classroomId, joinCode } = await createCourseAndClassroom('WEEKLY');
    const classroomObjectId = new Types.ObjectId(classroomId);

    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode })
      .expect(201);

    await pollUntil(async () => {
      const report = await fetchWeeklyReport(classroomId);
      expect(report.progress.studentsCount).toBe(1);
      expect(typeof report.progress.submissionRate).toBe('number');
    });

    await teacherAgent
      .post(`/api/classrooms/${classroomId}/students/${studentBId}/remove`)
      .send({})
      .expect(201);

    await pollUntil(async () => {
      const report = await fetchWeeklyReport(classroomId);
      expect(report.progress.studentsCount).toBe(0);
    });

    await classroomModel
      .updateOne(
        { _id: classroomObjectId },
        { $addToSet: { studentIds: new Types.ObjectId(studentBId) } },
      )
      .exec();

    const reportAfterPollution = await fetchWeeklyReport(classroomId);
    expect(reportAfterPollution.progress.studentsCount).toBe(0);
  });

  it('3) mine anti-cheat: mine dashboard is enrollment-driven only', async () => {
    const { classroomId } = await createCourseAndClassroom('MINE');
    const classroomObjectId = new Types.ObjectId(classroomId);

    await enrollmentModel
      .deleteMany({
        classroomId: classroomObjectId,
        userId: new Types.ObjectId(studentCId),
      })
      .exec();
    await classroomModel
      .updateOne(
        { _id: classroomObjectId },
        { $addToSet: { studentIds: new Types.ObjectId(studentCId) } },
      )
      .exec();

    const mine = await studentCAgent
      .get('/api/classrooms/mine/dashboard')
      .query({ page: 1, limit: 20 })
      .expect(200);
    const mineBody = mine.body as MineDashboardResponse;
    const hasClassroom = mineBody.items.some(
      (item) => item.classroom.id === classroomId,
    );
    expect(hasClassroom).toBe(false);
  });

  it('4) overview anti-cheat: batch studentsCount is not affected by dirty studentIds', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `ENROVREG${Date.now()}`,
        name: 'Enrollment Overview Regression',
        term: '2026-Spring',
      })
      .expect(201);
    const courseId = (createdCourse.body as CreatedCourseResponse).id;
    createdCourseIds.push(courseId);

    const [createdClassroomA, createdClassroomB] = await Promise.all([
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Enrolled' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Polluted' })
        .expect(201),
    ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomABody.id, classroomBBody.id);

    await studentDAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);

    await classroomModel
      .updateOne(
        { _id: new Types.ObjectId(classroomBBody.id) },
        { $addToSet: { studentIds: new Types.ObjectId(studentDId) } },
      )
      .exec();

    const overview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        sort: 'studentsCount',
        order: 'desc',
        page: 1,
        limit: 50,
      })
      .expect(200);
    const body = overview.body as CourseOverviewResponse;

    expect(body.total).toBeGreaterThanOrEqual(2);
    const itemA = body.items.find(
      (item) => item.classroomId === classroomABody.id,
    );
    const itemB = body.items.find(
      (item) => item.classroomId === classroomBBody.id,
    );
    expect(itemA).toBeDefined();
    expect(itemB).toBeDefined();
    expect(itemA?.studentsCount).toBe(1);
    expect(itemB?.studentsCount).toBe(0);
    expect(typeof itemA?.submissionRate).toBe('number');
    expect(typeof itemB?.submissionRate).toBe('number');
  });
});
