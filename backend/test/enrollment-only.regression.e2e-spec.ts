import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';

import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

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
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let previousWorkerEnabled: string | undefined;
  let previousProvider: string | undefined;
  let previousMailProvider: string | undefined;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
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
    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousProvider = process.env.AI_FEEDBACK_PROVIDER;
    previousMailProvider = process.env.MAIL_PROVIDER;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    process.env.AI_FEEDBACK_PROVIDER = 'stub';
    process.env.MAIL_PROVIDER = 'log';
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    moduleFixture = await Test.createTestingModule({
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

    connection = app.get<Connection>(getConnectionToken());
    connection.set('maxTimeMS', 10000);
    const database = connection.db;
    if (!database) throw new Error('Missing connected test database');
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false, maxTimeMS: 5000 },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: app.get(ConfigService).get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: connection.host,
      authInfo: auth.authInfo,
    });

    const config = app.get(ConfigService);
    expect(config.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('MAIL_PROVIDER')).toBe('log');

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentBAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentCAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentDAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
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

    const userFixtures = [
      {
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      },
      {
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
      },
      {
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
      },
      {
        email: studentCEmail,
        passwordHash: studentCHash,
        roles: ['student'],
      },
      {
        email: studentDEmail,
        passwordHash: studentDHash,
        roles: ['student'],
      },
    ];
    for (const fixture of userFixtures) {
      const _id = new Types.ObjectId();
      createdUserIds.push(_id.toString());
      await userModel.create({ _id, ...fixture });
    }
    [teacherId, studentAId, studentBId, studentCId, studentDId] =
      createdUserIds;

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
    await login(studentCAgent, studentCEmail, studentPassword);
    await login(studentDAgent, studentDEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      const cleanup: Promise<unknown>[] = [];
      if (createdClassroomIds.length > 0) {
        cleanup.push(
          classroomTaskModel.deleteMany({
            classroomId: {
              $in: createdClassroomIds.map((id) => new Types.ObjectId(id)),
            },
          }),
        );
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
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
        if (connection) expect(connection.readyState).toBe(0);
      } finally {
        if (previousWorkerEnabled === undefined)
          delete process.env.AI_FEEDBACK_WORKER_ENABLED;
        else process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
        if (previousProvider === undefined)
          delete process.env.AI_FEEDBACK_PROVIDER;
        else process.env.AI_FEEDBACK_PROVIDER = previousProvider;
        if (previousMailProvider === undefined)
          delete process.env.MAIL_PROVIDER;
        else process.env.MAIL_PROVIDER = previousMailProvider;
      }
    }
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
    await classroomModel.collection.updateOne(
      { _id: classroomObjectId },
      { $addToSet: { studentIds: new Types.ObjectId(studentAId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(pollutedClassroom).toMatchObject({
      _id: classroomObjectId,
      studentIds: [new Types.ObjectId(studentAId)],
    });

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

    await classroomModel.collection.updateOne(
      { _id: classroomObjectId },
      { $addToSet: { studentIds: new Types.ObjectId(studentBId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(pollutedClassroom).toMatchObject({
      _id: classroomObjectId,
      studentIds: [new Types.ObjectId(studentBId)],
    });

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
    await classroomModel.collection.updateOne(
      { _id: classroomObjectId },
      { $addToSet: { studentIds: new Types.ObjectId(studentCId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(pollutedClassroom).toMatchObject({
      _id: classroomObjectId,
      studentIds: [new Types.ObjectId(studentCId)],
    });

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

    await classroomModel.collection.updateOne(
      { _id: new Types.ObjectId(classroomBBody.id) },
      { $addToSet: { studentIds: new Types.ObjectId(studentDId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: new Types.ObjectId(classroomBBody.id),
    });
    expect(pollutedClassroom).toMatchObject({
      _id: new Types.ObjectId(classroomBBody.id),
      studentIds: [new Types.ObjectId(studentDId)],
    });

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

  it('5) allows deleting an empty classroom', async () => {
    const { classroomId } = await createCourseAndClassroom('DEL-EMPTY');

    const deleted = await teacherAgent
      .delete(`/api/classrooms/${classroomId}`)
      .expect(200);
    expect((deleted.body as { ok?: boolean }).ok).toBe(true);

    await teacherAgent.get(`/api/classrooms/${classroomId}`).expect(404);
  });

  it('6) rejects deleting classroom with enrollment history (including REMOVED)', async () => {
    const { classroomId, joinCode } =
      await createCourseAndClassroom('DEL-ENROLL');
    const enrollmentFilter = {
      classroomId: new Types.ObjectId(classroomId),
      userId: new Types.ObjectId(studentAId),
    };

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode })
      .expect(201);
    expect(
      await enrollmentModel.findOne(enrollmentFilter).exec(),
    ).toMatchObject({
      role: 'STUDENT',
      status: 'ACTIVE',
    });
    const activeResponse = await teacherAgent
      .delete(`/api/classrooms/${classroomId}`)
      .expect(409);
    expect(activeResponse.body).toMatchObject({
      code: 'CLASSROOM_NOT_EMPTY',
      message: '该班级已有成员或任务记录，不能删除，只能归档',
    });

    await teacherAgent
      .post(`/api/classrooms/${classroomId}/students/${studentAId}/remove`)
      .send({})
      .expect(201);
    expect(
      await enrollmentModel.findOne(enrollmentFilter).exec(),
    ).toMatchObject({
      role: 'STUDENT',
      status: 'REMOVED',
    });

    const response = await teacherAgent
      .delete(`/api/classrooms/${classroomId}`)
      .expect(409);
    const body = response.body as { code?: string; message?: string };
    expect(body.code).toBe('CLASSROOM_NOT_EMPTY');
    expect(body.message).toBe('该班级已有成员或任务记录，不能删除，只能归档');
  });

  it('7) rejects deleting classroom when classroomTask exists', async () => {
    const { classroomId } = await createCourseAndClassroom('DEL-TASK');
    await classroomTaskModel.create({
      classroomId: new Types.ObjectId(classroomId),
      taskId: new Types.ObjectId(),
      taskSnapshot: {
        title: 'Existing classroom task',
        description: 'Preserves the classroom deletion boundary',
        knowledgeModule: 'enrollment-only',
      },
      createdBy: new Types.ObjectId(teacherId),
      publishedAt: new Date(),
    });

    const response = await teacherAgent
      .delete(`/api/classrooms/${classroomId}`)
      .expect(409);
    const body = response.body as { code?: string };
    expect(body.code).toBe('CLASSROOM_NOT_EMPTY');
  });

  it('8) archives classroom via PATCH status', async () => {
    const { classroomId } = await createCourseAndClassroom('ARCHIVE');

    const patched = await teacherAgent
      .patch(`/api/classrooms/${classroomId}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    expect((patched.body as { status?: string }).status).toBe('ARCHIVED');
  });

  it('9) restores archived classroom via PATCH status', async () => {
    const { classroomId } = await createCourseAndClassroom('RESTORE');
    await teacherAgent
      .patch(`/api/classrooms/${classroomId}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const restored = await teacherAgent
      .patch(`/api/classrooms/${classroomId}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect((restored.body as { status?: string }).status).toBe('ACTIVE');
  });

  it('10) keeps classroom management authorization unchanged', async () => {
    const { classroomId } = await createCourseAndClassroom('AUTHZ');
    await studentBAgent.delete(`/api/classrooms/${classroomId}`).expect(403);
  });

  it('11) allows deleting a classroom with only legacy studentIds and no enrollment or task', async () => {
    const { classroomId } = await createCourseAndClassroom('DEL-LEGACY');
    const classroomObjectId = new Types.ObjectId(classroomId);
    await classroomModel.collection.updateOne(
      { _id: classroomObjectId },
      { $addToSet: { studentIds: new Types.ObjectId(studentAId) } },
    );
    const pollutedClassroom = await classroomModel.collection.findOne({
      _id: classroomObjectId,
    });
    expect(pollutedClassroom).toMatchObject({
      _id: classroomObjectId,
      studentIds: [new Types.ObjectId(studentAId)],
    });
    expect(
      await enrollmentModel.countDocuments({ classroomId: classroomObjectId }),
    ).toBe(0);
    expect(
      await classroomTaskModel.countDocuments({
        classroomId: classroomObjectId,
      }),
    ).toBe(0);

    const deleted = await teacherAgent
      .delete(`/api/classrooms/${classroomId}`)
      .expect(200);
    expect(deleted.body).toEqual({ ok: true });
    expect(
      await classroomModel.collection.findOne({ _id: classroomObjectId }),
    ).toBeNull();
  });
});
