import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
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

import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedCourseResponse = {
  id: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

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

describe('Enrollments Authority And Legacy Compatibility (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let enrollmentModel: Model<Enrollment>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;
  let legacyStudentAgent: ReturnType<typeof request.agent>;

  const createdCourseIds: string[] = [];
  const createdClassroomIds: string[] = [];

  let teacherId = '';
  let studentId = '';
  let legacyStudentId = '';

  const teacherEmail = `teacher.enrollment.af.${Date.now()}@example.com`;
  const studentEmail = `student.enrollment.af.${Date.now()}@example.com`;
  const legacyStudentEmail = `student.legacy.af.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';
  const legacyStudentPassword = 'StudentPass123!';

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

  const createCourseAndClassroom = async (suffix: string) => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `ENR${suffix}${Date.now()}`,
        name: `Enrollments ${suffix}`,
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
    expect(classroomBody).not.toHaveProperty('studentIds');
    expect(classroomBody).toMatchObject({
      courseId,
      course: {
        id: courseId,
        name: `Enrollments ${suffix}`,
        term: '2026-Spring',
      },
    });

    return {
      courseId,
      classroomId: classroomBody.id,
      joinCode: classroomBody.joinCode,
    };
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

  beforeAll(async () => {
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

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

    const connection = app.get<Connection>(getConnectionToken());
    const database = connection.db;
    if (!database) throw new Error('Missing connected test database');
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false, maxTimeMS: 5000 },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
      databaseName: database.databaseName,
      connectedHost: connection.host,
      authInfo: auth.authInfo,
    });

    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());
    legacyStudentAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));

    const [teacherHash, studentHash, legacyStudentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(legacyStudentPassword, 10),
    ]);

    const [teacher, student, legacyStudent] = await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
      userModel.create({
        email: legacyStudentEmail,
        passwordHash: legacyStudentHash,
        roles: ['student'],
      }),
    ]);

    teacherId = teacher._id.toString();
    studentId = student._id.toString();
    legacyStudentId = legacyStudent._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
    await login(legacyStudentAgent, legacyStudentEmail, legacyStudentPassword);
  });

  afterAll(async () => {
    try {
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
      const userObjectIds = [teacherId, studentId, legacyStudentId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userObjectIds.length > 0) {
        cleanup.push(
          sessionModel.deleteMany({ userId: { $in: userObjectIds } }),
        );
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      await Promise.all(cleanup);
    } finally {
      await app?.close();
    }
  });

  it('A/B: enrollment authority for join/remove with weekly-report counts', async () => {
    const { courseId, classroomId, joinCode } =
      await createCourseAndClassroom('AB');
    const classroomObjectId = new Types.ObjectId(classroomId);
    const studentObjectId = new Types.ObjectId(studentId);
    const expectedClassroom = {
      id: classroomId,
      courseId,
      course: {
        id: courseId,
        name: 'Enrollments AB',
        term: '2026-Spring',
      },
    };
    const createdDocument = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(createdDocument).toMatchObject({ _id: classroomObjectId });
    expect(createdDocument).not.toHaveProperty('studentIds');

    const detail = await teacherAgent
      .get(`/api/classrooms/${classroomId}`)
      .expect(200);
    expect(detail.body).toMatchObject(expectedClassroom);
    expect(detail.body).not.toHaveProperty('studentIds');

    const updated = await teacherAgent
      .patch(`/api/classrooms/${classroomId}`)
      .send({ name: 'Classroom-AB-updated' })
      .expect(200);
    expect(updated.body).toMatchObject({
      ...expectedClassroom,
      name: 'Classroom-AB-updated',
    });
    expect(updated.body).not.toHaveProperty('studentIds');

    let enrollmentId: Types.ObjectId | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const joined = await studentAgent
        .post('/api/classrooms/join')
        .send({ joinCode })
        .expect(201);
      expect(joined.body).toMatchObject(expectedClassroom);
      expect(joined.body).not.toHaveProperty('studentIds');

      const enrollments = await enrollmentModel
        .find({ classroomId: classroomObjectId })
        .exec();
      expect(enrollments).toHaveLength(1);
      enrollmentId ??= enrollments[0]._id;
      expect(enrollments[0]).toMatchObject({
        _id: enrollmentId,
        userId: studentObjectId,
        role: 'STUDENT',
        status: 'ACTIVE',
      });
      const joinedDocument = await classroomModel.collection.findOne({
        _id: classroomObjectId,
      });
      expect(joinedDocument).toMatchObject({ _id: classroomObjectId });
      expect(joinedDocument).not.toHaveProperty('studentIds');

      await pollUntil(async () => {
        await studentAgent.get(`/api/classrooms/${classroomId}`).expect(200);
      });
    }

    const weeklyBefore = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    const weeklyBeforeBody = weeklyBefore.body as WeeklyReportResponse;
    expect(weeklyBeforeBody.progress.studentsCount).toBe(1);
    expect(typeof weeklyBeforeBody.progress.submissionRate).toBe('number');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const removed = await teacherAgent
        .post(`/api/classrooms/${classroomId}/students/${studentId}/remove`)
        .send({})
        .expect(201);
      expect(removed.body).toMatchObject(expectedClassroom);
      expect(removed.body).not.toHaveProperty('studentIds');

      const enrollments = await enrollmentModel
        .find({ classroomId: classroomObjectId })
        .exec();
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]).toMatchObject({
        _id: enrollmentId,
        userId: studentObjectId,
        role: 'STUDENT',
        status: 'REMOVED',
      });
      const removedDocument = await classroomModel.collection.findOne({
        _id: classroomObjectId,
      });
      expect(removedDocument).toMatchObject({ _id: classroomObjectId });
      expect(removedDocument).not.toHaveProperty('studentIds');

      await pollUntil(async () => {
        await studentAgent.get(`/api/classrooms/${classroomId}`).expect(403);
      });
    }

    const weeklyAfter = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    const weeklyAfterBody = weeklyAfter.body as WeeklyReportResponse;
    expect(weeklyAfterBody.progress.studentsCount).toBe(0);
    expect(weeklyAfterBody.progress.studentsCount).toBeLessThan(
      weeklyBeforeBody.progress.studentsCount,
    );
  });

  it('C: legacy-only dirty studentIds must not grant membership privilege', async () => {
    const { classroomId } = await createCourseAndClassroom('LEGACY');
    const classroomObjectId = new Types.ObjectId(classroomId);

    await enrollmentModel.deleteMany({ classroomId: classroomObjectId });
    await classroomModel.collection.updateOne(
      { _id: classroomObjectId },
      { $addToSet: { studentIds: new Types.ObjectId(legacyStudentId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(pollutedClassroom).toMatchObject({
      _id: classroomObjectId,
      studentIds: [new Types.ObjectId(legacyStudentId)],
    });

    const classroomAccess = await legacyStudentAgent.get(
      `/api/classrooms/${classroomId}`,
    );
    expect(classroomAccess.status).not.toBe(200);

    const mine = await legacyStudentAgent
      .get('/api/classrooms/mine/dashboard')
      .query({ page: 1, limit: 20 })
      .expect(200);
    const mineBody = mine.body as MineDashboardResponse;
    const hasClassroom = mineBody.items.some(
      (item) => item.classroom.id === classroomId,
    );
    expect(hasClassroom).toBe(false);
  });

  it('D: overview studentsCount differentiates enrolled vs not enrolled classrooms', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `ENROVD${Date.now()}`,
        name: 'Enrollment Overview',
        term: '2026-Spring',
      })
      .expect(201);
    const courseId = (createdCourse.body as CreatedCourseResponse).id;
    createdCourseIds.push(courseId);

    const [createdClassroomA, createdClassroomB] = await Promise.all([
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-A' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-B' })
        .expect(201),
    ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomABody.id, classroomBBody.id);

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);

    const overview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '7d', page: 1, limit: 50 })
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
