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
    throw new Error('MONGO_URI is required for classroom students e2e.');
  }
};

type CreatedCourseResponse = {
  id: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type ClassroomStudentItem = {
  id: string;
  email: string;
  roles: string[];
  status: string;
  name: string | null;
  studentNo: string | null;
  employeeNo: string | null;
  joinedAt: string;
};

type ListClassroomStudentsResponse = {
  items: ClassroomStudentItem[];
  total: number;
  page: number;
  limit: number;
};

describe('Classroom Students List (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let enrollmentModel: Model<Enrollment>;

  let ownerTeacherAgent: ReturnType<typeof request.agent>;
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;
  let removedStudentAgent: ReturnType<typeof request.agent>;

  let classroomId = '';
  let courseId = '';
  let studentAId = '';
  let studentBId = '';
  let removedStudentId = '';
  let legacyPollutedStudentId = '';
  const createdUserIds: string[] = [];

  const ownerTeacherEmail = `owner.teacher.students.${Date.now()}@example.com`;
  const otherTeacherEmail = `other.teacher.students.${Date.now()}@example.com`;
  const studentAEmail = `studentA.students.${Date.now()}@example.com`;
  const studentBEmail = `studentB.students.${Date.now()}@example.com`;
  const removedStudentEmail = `removed.students.${Date.now()}@example.com`;
  const pollutedStudentEmail = `polluted.students.${Date.now()}@example.com`;
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

  const listStudents = async (
    agent: ReturnType<typeof request.agent>,
    page: number,
    limit: number,
    includeRemoved?: '0' | '1' | 'true' | 'false',
  ) => {
    const query: Record<string, string | number> = { page, limit };
    if (includeRemoved !== undefined) {
      query.includeRemoved = includeRemoved;
    }
    const response = await agent
      .get(`/api/classrooms/${classroomId}/students`)
      .query(query)
      .expect(200);
    return response.body as ListClassroomStudentsResponse;
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

    ownerTeacherAgent = request.agent(app.getHttpServer());
    otherTeacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());
    removedStudentAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));

    const [
      ownerTeacherHash,
      otherTeacherHash,
      studentAHash,
      studentBHash,
      removedStudentHash,
      pollutedStudentHash,
    ] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [
      ownerTeacher,
      otherTeacher,
      studentA,
      studentB,
      removedStudent,
      pollutedStudent,
    ] = await Promise.all([
      userModel.create({
        email: ownerTeacherEmail,
        passwordHash: ownerTeacherHash,
        roles: ['teacher'],
        name: 'Owner Teacher',
      }),
      userModel.create({
        email: otherTeacherEmail,
        passwordHash: otherTeacherHash,
        roles: ['teacher'],
        name: 'Other Teacher',
      }),
      userModel.create({
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
        name: 'Student A',
        studentNo: 'S0001',
        employeeNo: 'NA-A',
      }),
      userModel.create({
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
        name: 'Student B',
        studentNo: 'S0002',
        employeeNo: 'NA-B',
      }),
      userModel.create({
        email: removedStudentEmail,
        passwordHash: removedStudentHash,
        roles: ['student'],
        name: 'Removed Student',
        studentNo: 'S0003',
        employeeNo: 'NA-C',
      }),
      userModel.create({
        email: pollutedStudentEmail,
        passwordHash: pollutedStudentHash,
        roles: ['student'],
        name: 'Legacy Only',
        studentNo: 'S9999',
        employeeNo: 'NA-Z',
      }),
    ]);

    createdUserIds.push(
      ownerTeacher._id.toString(),
      otherTeacher._id.toString(),
      studentA._id.toString(),
      studentB._id.toString(),
      removedStudent._id.toString(),
      pollutedStudent._id.toString(),
    );
    studentAId = studentA._id.toString();
    studentBId = studentB._id.toString();
    removedStudentId = removedStudent._id.toString();
    legacyPollutedStudentId = pollutedStudent._id.toString();

    await login(ownerTeacherAgent, ownerTeacherEmail, teacherPassword);
    await login(otherTeacherAgent, otherTeacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
    await login(removedStudentAgent, removedStudentEmail, studentPassword);

    const createdCourse = await ownerTeacherAgent
      .post('/api/courses')
      .send({
        code: `CLSSTU${Date.now()}`,
        name: 'Classroom Students Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await ownerTeacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Classroom Students',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
    await removedStudentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
  });

  afterAll(async () => {
    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (classroomId) {
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: new Types.ObjectId(classroomId),
          }),
        );
        cleanup.push(
          classroomModel.deleteOne({
            _id: new Types.ObjectId(classroomId),
          }),
        );
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({
            _id: new Types.ObjectId(courseId),
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

  it('owner teacher can list students with page/limit and response has no sensitive fields', async () => {
    const page1 = await listStudents(ownerTeacherAgent, 1, 2);
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.items.length).toBe(2);

    const page2 = await listStudents(ownerTeacherAgent, 2, 2);
    expect(page2.total).toBe(3);
    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);
    expect(page2.items.length).toBe(1);

    const allItems = [...page1.items, ...page2.items];
    const allIds = allItems.map((item) => item.id);
    expect(new Set(allIds)).toEqual(
      new Set([studentAId, studentBId, removedStudentId]),
    );

    for (const item of allItems) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('email');
      expect(item).toHaveProperty('roles');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('studentNo');
      expect(item).toHaveProperty('employeeNo');
      expect(item).toHaveProperty('joinedAt');
      expect(item).not.toHaveProperty('passwordHash');
    }
  });

  it('includeRemoved query contract works and legacy classroom.studentIds pollution does not affect result', async () => {
    await ownerTeacherAgent
      .post(
        `/api/classrooms/${classroomId}/students/${removedStudentId}/remove`,
      )
      .send({})
      .expect(201);

    await classroomModel
      .updateOne(
        { _id: new Types.ObjectId(classroomId) },
        {
          $addToSet: {
            studentIds: {
              $each: [
                new Types.ObjectId(removedStudentId),
                new Types.ObjectId(legacyPollutedStudentId),
              ],
            },
          },
        },
      )
      .exec();

    const defaultList = await listStudents(ownerTeacherAgent, 1, 20);
    const includeRemovedFalseList = await listStudents(
      ownerTeacherAgent,
      1,
      20,
      '0',
    );
    const includeRemovedTrueList = await listStudents(
      ownerTeacherAgent,
      1,
      20,
      '1',
    );
    const includeRemovedLiteralFalseList = await listStudents(
      ownerTeacherAgent,
      1,
      20,
      'false',
    );
    const includeRemovedLiteralTrueList = await listStudents(
      ownerTeacherAgent,
      1,
      20,
      'true',
    );

    const defaultIds = defaultList.items.map((item) => item.id);
    const includeRemovedFalseIds = includeRemovedFalseList.items.map(
      (item) => item.id,
    );
    const includeRemovedTrueIds = includeRemovedTrueList.items.map(
      (item) => item.id,
    );
    const includeRemovedLiteralFalseIds = includeRemovedLiteralFalseList.items.map(
      (item) => item.id,
    );
    const includeRemovedLiteralTrueIds = includeRemovedLiteralTrueList.items.map(
      (item) => item.id,
    );

    expect(defaultList.total).toBe(2);
    expect(defaultIds).toEqual(expect.arrayContaining([studentAId, studentBId]));
    expect(defaultIds).not.toContain(removedStudentId);
    expect(defaultIds).not.toContain(legacyPollutedStudentId);

    expect(includeRemovedFalseList.total).toBe(2);
    expect(includeRemovedFalseIds).toEqual(
      expect.arrayContaining([studentAId, studentBId]),
    );
    expect(includeRemovedFalseIds).not.toContain(removedStudentId);
    expect(includeRemovedFalseIds).not.toContain(legacyPollutedStudentId);

    expect(includeRemovedTrueList.total).toBe(3);
    expect(includeRemovedTrueIds).toEqual(
      expect.arrayContaining([studentAId, studentBId, removedStudentId]),
    );
    expect(includeRemovedTrueIds).not.toContain(legacyPollutedStudentId);
    expect(
      includeRemovedTrueList.items.find((item) => item.id === removedStudentId)
        ?.status,
    ).toBe('REMOVED');

    expect(includeRemovedLiteralFalseList.total).toBe(2);
    expect(includeRemovedLiteralFalseIds).not.toContain(removedStudentId);

    expect(includeRemovedLiteralTrueList.total).toBe(3);
    expect(includeRemovedLiteralTrueIds).toContain(removedStudentId);
  });

  it('non-owner teacher cannot access list and gets 404', async () => {
    await otherTeacherAgent
      .get(`/api/classrooms/${classroomId}/students`)
      .query({ page: 1, limit: 20 })
      .expect(404);
  });

  it('non-teacher cannot access list and gets 403', async () => {
    await studentAAgent
      .get(`/api/classrooms/${classroomId}/students`)
      .query({ page: 1, limit: 20 })
      .expect(403);
  });
});
