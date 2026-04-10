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

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for course lifecycle e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string };

describe('Course Lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;

  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  const createdCourseIds: string[] = [];
  const createdClassroomIds: string[] = [];
  const createdUserIds: string[] = [];

  const teacherEmail = `teacher.course.lifecycle.${Date.now()}@example.com`;
  const studentEmail = `student.course.lifecycle.${Date.now()}@example.com`;
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

  const createCourse = async (suffix: string) => {
    const created = await teacherAgent
      .post('/api/courses')
      .send({
        code: `COURSE${suffix}${Date.now()}`,
        name: `Course-${suffix}`,
        term: '2026-Spring',
      })
      .expect(201);

    const courseId = (created.body as CreatedCourseResponse).id;
    createdCourseIds.push(courseId);
    return courseId;
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
    studentAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [teacher, student] = await Promise.all([
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
    ]);

    createdUserIds.push(teacher._id.toString(), student._id.toString());

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
  });

  afterAll(async () => {
    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (createdClassroomIds.length > 0) {
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
        const userObjectIds = createdUserIds.map((id) => new Types.ObjectId(id));
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userObjectIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      await Promise.all(cleanup);
    }

    await app.close();
  });

  it('allows deleting an empty course', async () => {
    const courseId = await createCourse('DEL-EMPTY');

    const deleted = await teacherAgent.delete(`/api/courses/${courseId}`).expect(200);
    expect((deleted.body as { ok?: boolean }).ok).toBe(true);

    await teacherAgent.get(`/api/courses/${courseId}`).expect(404);
  });

  it('rejects deleting non-empty course when classroom exists', async () => {
    const courseId = await createCourse('DEL-NONEMPTY');

    const classroomRes = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Course-Lifecycle-Classroom' })
      .expect(201);
    const classroomId = (classroomRes.body as CreatedClassroomResponse).id;
    createdClassroomIds.push(classroomId);

    const deleted = await teacherAgent.delete(`/api/courses/${courseId}`).expect(409);
    const body = deleted.body as { code?: string; message?: string };
    expect(body.code).toBe('COURSE_NOT_EMPTY');
    expect(body.message).toBe('该课程下已有班级记录，不能删除，只能归档');
  });

  it('archives course via PATCH status', async () => {
    const courseId = await createCourse('ARCHIVE');

    const archived = await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    expect((archived.body as { status?: string }).status).toBe('ARCHIVED');
  });

  it('restores course via PATCH status', async () => {
    const courseId = await createCourse('RESTORE');

    await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const restored = await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect((restored.body as { status?: string }).status).toBe('ACTIVE');
  });

  it('keeps authorization unchanged for delete', async () => {
    const courseId = await createCourse('AUTHZ');
    await studentAgent.delete(`/api/courses/${courseId}`).expect(403);
  });
});
