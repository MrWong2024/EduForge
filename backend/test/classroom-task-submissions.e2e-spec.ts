import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

const previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'false';

import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for classroom task submissions e2e.',
    );
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string };
type ClassroomTaskSubmissionListResponse = {
  items: Array<{
    id: string;
    taskId: string;
    classroomTaskId: string;
    student: {
      id: string;
      email: string;
      roles: string[];
      status: string;
      name: string | null;
      studentNo: string | null;
      employeeNo: string | null;
    };
    attemptNo: number;
    submittedAt: string;
    isLate: boolean;
    lateBySeconds: number;
    status: string;
    aiFeedbackStatus: string;
  }>;
  total: number;
  page: number;
  limit: number;
};

describe('Classroom Task Submissions List (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let enrollmentModel: Model<Enrollment>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;

  let ownerTeacherAgent: ReturnType<typeof request.agent>;
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  let courseId = '';
  let classroomAId = '';
  let classroomBId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  let taskId = '';
  let submissionAId = '';
  let submissionBId = '';
  let studentAId = '';
  const createdUserIds: string[] = [];

  const ownerTeacherEmail = `teacher.sub.list.owner.${Date.now()}@example.com`;
  const otherTeacherEmail = `teacher.sub.list.other.${Date.now()}@example.com`;
  const studentAEmail = `student.sub.list.a.${Date.now()}@example.com`;
  const studentBEmail = `student.sub.list.b.${Date.now()}@example.com`;
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

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const [ownerTeacherHash, otherTeacherHash, studentAHash, studentBHash] =
      await Promise.all([
        bcrypt.hash(teacherPassword, 10),
        bcrypt.hash(teacherPassword, 10),
        bcrypt.hash(studentPassword, 10),
        bcrypt.hash(studentPassword, 10),
      ]);

    const [ownerTeacher, otherTeacher, studentA, studentB] = await Promise.all([
      userModel.create({
        email: ownerTeacherEmail,
        passwordHash: ownerTeacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: otherTeacherEmail,
        passwordHash: otherTeacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
        name: 'Student Alpha',
        studentNo: 'A0001',
      }),
      userModel.create({
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
        name: 'Student Beta',
        studentNo: 'B0001',
      }),
    ]);

    createdUserIds.push(
      ownerTeacher._id.toString(),
      otherTeacher._id.toString(),
      studentA._id.toString(),
      studentB._id.toString(),
    );
    studentAId = studentA._id.toString();

    await login(ownerTeacherAgent, ownerTeacherEmail, teacherPassword);
    await login(otherTeacherAgent, otherTeacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);

    const createdCourse = await ownerTeacherAgent
      .post('/api/courses')
      .send({
        code: `SUBLIST${Date.now()}`,
        name: 'Submission List Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const [createdClassroomA, createdClassroomB] = await Promise.all([
      ownerTeacherAgent
        .post('/api/classrooms')
        .send({
          courseId,
          name: 'Submission List Classroom A',
        })
        .expect(201),
      ownerTeacherAgent
        .post('/api/classrooms')
        .send({
          courseId,
          name: 'Submission List Classroom B',
        })
        .expect(201),
    ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    classroomAId = classroomABody.id;
    classroomBId = classroomBBody.id;

    const createdTask = await ownerTeacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Shared Submission Task',
        description: 'A shared task for classroomTaskId isolation.',
        knowledgeModule: 'isolation',
        stage: 2,
        status: 'DRAFT',
      })
      .expect(201);
    taskId = (createdTask.body as CreatedTaskResponse).id;

    await ownerTeacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const [createdClassroomTaskA, createdClassroomTaskB] = await Promise.all([
      ownerTeacherAgent
        .post(`/api/classrooms/${classroomAId}/tasks`)
        .send({ taskId })
        .expect(201),
      ownerTeacherAgent
        .post(`/api/classrooms/${classroomBId}/tasks`)
        .send({ taskId })
        .expect(201),
    ]);
    classroomTaskAId = (
      createdClassroomTaskA.body as CreatedClassroomTaskResponse
    ).id;
    classroomTaskBId = (
      createdClassroomTaskB.body as CreatedClassroomTaskResponse
    ).id;

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBBody.joinCode })
      .expect(201);

    const createdSubmissionA = await studentAAgent
      .post(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function classA() { return "A"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionAId = (createdSubmissionA.body as CreatedSubmissionResponse).id;

    const createdSubmissionB = await studentBAgent
      .post(
        `/api/classrooms/${classroomBId}/tasks/${classroomTaskBId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function classB() { return "B"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionBId = (createdSubmissionB.body as CreatedSubmissionResponse).id;
  });

  afterAll(async () => {
    if (previousAutoOnSubmit === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = previousAutoOnSubmit;
    }

    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (submissionAId || submissionBId) {
        const submissionIds = [submissionAId, submissionBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: { $in: submissionIds },
          }),
        );
        cleanup.push(
          submissionModel.deleteMany({ _id: { $in: submissionIds } }),
        );
      }
      if (classroomTaskAId || classroomTaskBId) {
        cleanup.push(
          classroomTaskModel.deleteMany({
            _id: {
              $in: [classroomTaskAId, classroomTaskBId]
                .filter(Boolean)
                .map((id) => new Types.ObjectId(id)),
            },
          }),
        );
      }
      if (classroomAId || classroomBId) {
        const classroomIds = [classroomAId, classroomBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: { $in: classroomIds },
          }),
        );
        cleanup.push(classroomModel.deleteMany({ _id: { $in: classroomIds } }));
      }
      if (taskId) {
        cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
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

  it('owner teacher lists submissions by classroomTaskId only (no cross-class taskId mix)', async () => {
    const response = await ownerTeacherAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .query({ page: 1, limit: 20 })
      .expect(200);
    const body = response.body as ClassroomTaskSubmissionListResponse;

    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.items.length).toBe(1);

    const item = body.items[0];
    expect(item.id).toBe(submissionAId);
    expect(item.taskId).toBe(taskId);
    expect(item.classroomTaskId).toBe(classroomTaskAId);
    expect(item.classroomTaskId).not.toBe(classroomTaskBId);
    expect(item.id).not.toBe(submissionBId);

    expect(item.student.id).toBe(studentAId);
    expect(item.student.email).toBe(studentAEmail);
    expect(item.student.roles).toEqual(expect.arrayContaining(['student']));
    expect(item.student.name).toBe('Student Alpha');
    expect(item.student.studentNo).toBe('A0001');

    expect(typeof item.attemptNo).toBe('number');
    expect(typeof item.submittedAt).toBe('string');
    expect(typeof item.isLate).toBe('boolean');
    expect(typeof item.lateBySeconds).toBe('number');
    expect(item.status).toBe('SUBMITTED');
    expect(item.aiFeedbackStatus).toBe('NOT_REQUESTED');

    expect(item).not.toHaveProperty('passwordHash');
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('content.codeText');
  });

  it('non-owner teacher cannot access and gets 404', async () => {
    await otherTeacherAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .query({ page: 1, limit: 20 })
      .expect(404);
  });

  it('non-teacher cannot access and gets 403', async () => {
    await studentAAgent
      .get(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .query({ page: 1, limit: 20 })
      .expect(403);
  });
});
