import {
  assertAuthTestConnection,
  authTestEnvironment,
} from './helpers/auth-test-environment';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

type CreatedCourseResponse = {
  id: string;
  code: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type CreatedTaskResponse = {
  id: string;
  status: string;
};

type CreatedClassroomTaskResponse = {
  id: string;
  taskId: string;
};

type CreatedSubmissionResponse = {
  id: string;
  contentRevision: number | null;
};

type TeacherDashboardTask = {
  classroomTaskId: string;
  submissionsCount: number;
  distinctStudentsSubmitted: number;
  aiFeedback: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    dead: number;
    notRequested: number;
  };
};

type TeacherDashboardResponse = {
  tasks: TeacherDashboardTask[];
};

type StudentDashboardTask = {
  classroomTaskId: string;
  mySubmissionsCount: number;
  myLatestSubmission: {
    submissionId: string;
    attemptNo?: number | null;
    createdAt: string;
    aiFeedbackStatus: string;
  } | null;
};

type StudentDashboardResponse = {
  items: Array<{
    classroom: { id: string };
    tasks: StudentDashboardTask[];
  }>;
};

describe('Classroom Dashboard Isolation (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let student1Agent: ReturnType<typeof request.agent>;
  let student2Agent: ReturnType<typeof request.agent>;
  let databaseVerified = false;

  const teacherId = new Types.ObjectId();
  const student1Id = new Types.ObjectId();
  const student2Id = new Types.ObjectId();
  const createdUserIds = [teacherId, student1Id, student2Id];
  const createdClassroomIds: string[] = [];
  const createdClassroomTaskIds: string[] = [];
  const createdSubmissionIds: string[] = [];
  let courseId = '';
  let taskId = '';

  const teacherEmail = `teacher.iso.${Date.now()}@example.com`;
  const student1Email = `student1.iso.${Date.now()}@example.com`;
  const student2Email = `student2.iso.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const student1Password = 'StudentPass123!';
  const student2Password = 'StudentPass234!';

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
          throw new Error(`Unexpected login status ${res.status}`);
        }
      });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    userModel = app.get(getModelToken(User.name));
    await assertAuthTestConnection(userModel.db);
    await assertAuthTestConnection(
      app.get<Connection>(
        getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
      ),
    );
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
    student1Agent = request.agent(app.getHttpServer());
    student2Agent = request.agent(app.getHttpServer());

    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    databaseVerified = true;

    const [teacherHash, student1Hash, student2Hash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(student1Password, 10),
      bcrypt.hash(student2Password, 10),
    ]);

    await userModel.create({
      _id: teacherId,
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    await userModel.create({
      _id: student1Id,
      email: student1Email,
      passwordHash: student1Hash,
      roles: ['student'],
    });
    await userModel.create({
      _id: student2Id,
      email: student2Email,
      passwordHash: student2Hash,
      roles: ['student'],
    });
  });

  const cleanupOwnedFixtures = async () => {
    await assertAuthTestConnection(userModel.db);
    const cleanup: Promise<unknown>[] = [];
    if (createdSubmissionIds.length > 0) {
      const submissionObjectIds = createdSubmissionIds.map(
        (id) => new Types.ObjectId(id),
      );
      cleanup.push(
        feedbackModel.deleteMany({
          submissionId: { $in: submissionObjectIds },
        }),
      );
      cleanup.push(
        aiFeedbackJobModel.deleteMany({
          submissionId: { $in: submissionObjectIds },
        }),
      );
      cleanup.push(
        submissionModel.deleteMany({ _id: { $in: submissionObjectIds } }),
      );
    }
    if (createdClassroomTaskIds.length > 0) {
      cleanup.push(
        classroomTaskModel.deleteMany({
          _id: {
            $in: createdClassroomTaskIds.map((id) => new Types.ObjectId(id)),
          },
        }),
      );
    }
    if (taskId) {
      cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
    }
    if (createdClassroomIds.length > 0) {
      cleanup.push(
        classroomModel.deleteMany({
          _id: { $in: createdClassroomIds.map((id) => new Types.ObjectId(id)) },
        }),
      );
    }
    if (courseId) {
      cleanup.push(
        courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
      );
    }

    cleanup.push(sessionModel.deleteMany({ userId: { $in: createdUserIds } }));
    cleanup.push(userModel.deleteMany({ _id: { $in: createdUserIds } }));
    if (createdClassroomIds.length > 0) {
      await app
        .get<Model<Enrollment>>(getModelToken(Enrollment.name))
        .deleteMany({
          classroomId: {
            $in: createdClassroomIds.map((id) => new Types.ObjectId(id)),
          },
        });
    }
    await Promise.all(cleanup);
  };

  afterAll(async () => {
    try {
      if (databaseVerified) await cleanupOwnedFixtures();
    } finally {
      try {
        await app?.close();
      } finally {
        authTestEnvironment.restore();
      }
    }
  });

  it('isolates submissions and AI stats per classroomTaskId', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(student1Agent, student1Email, student1Password);
    await login(student2Agent, student2Email, student2Password);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `CS${Date.now()}`,
        name: 'Isolation 101',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const classroomA = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Classroom A' })
      .expect(201);
    const classroomABody = classroomA.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomABody.id);

    const classroomB = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Classroom B' })
      .expect(201);
    const classroomBBody = classroomB.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomBBody.id);

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Shared Task',
        description: 'Shared across classrooms.',
        knowledgeModule: 'isolation',
        status: 'DRAFT',
      })
      .expect(201);
    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const classroomTaskA = await teacherAgent
      .post(`/api/classrooms/${classroomABody.id}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskABody =
      classroomTaskA.body as CreatedClassroomTaskResponse;
    createdClassroomTaskIds.push(classroomTaskABody.id);

    const classroomTaskB = await teacherAgent
      .post(`/api/classrooms/${classroomBBody.id}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskBBody =
      classroomTaskB.body as CreatedClassroomTaskResponse;
    createdClassroomTaskIds.push(classroomTaskBBody.id);

    await student1Agent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    await student2Agent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBBody.joinCode })
      .expect(201);

    const submissionA = await student1Agent
      .post(
        `/api/classrooms/${classroomABody.id}/tasks/${classroomTaskABody.id}/submissions`,
      )
      .send({
        content: {
          codeText: 'function isolatedA() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionABody = submissionA.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(submissionABody.id);

    const submissionB = await student2Agent
      .post(
        `/api/classrooms/${classroomBBody.id}/tasks/${classroomTaskBBody.id}/submissions`,
      )
      .send({
        content: {
          codeText: 'function isolatedB() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBBody = submissionB.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(submissionBBody.id);

    await student1Agent
      .post(
        `/api/learning-tasks/submissions/${submissionABody.id}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionABody.contentRevision })
      .expect(200);

    const jobA = await aiFeedbackJobModel
      .updateOne(
        { submissionId: new Types.ObjectId(submissionABody.id) },
        { $set: { status: AiFeedbackJobStatus.Succeeded, attempts: 1 } },
      )
      .exec();
    expect(jobA.modifiedCount).toBe(1);

    const teacherDashboardA = await teacherAgent
      .get(`/api/classrooms/${classroomABody.id}/dashboard`)
      .expect(200);
    const teacherBodyA = teacherDashboardA.body as TeacherDashboardResponse;
    const taskA = teacherBodyA.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    expect(taskA).toBeDefined();
    expect(taskA?.submissionsCount).toBe(1);
    expect(taskA?.distinctStudentsSubmitted).toBe(1);
    expect(taskA?.aiFeedback).toEqual({
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      dead: 0,
      notRequested: 0,
    });

    const teacherDashboardB = await teacherAgent
      .get(`/api/classrooms/${classroomBBody.id}/dashboard`)
      .expect(200);
    const teacherBodyB = teacherDashboardB.body as TeacherDashboardResponse;
    const taskB = teacherBodyB.tasks.find(
      (task) => task.classroomTaskId === classroomTaskBBody.id,
    );
    expect(taskB).toBeDefined();
    expect(taskB?.submissionsCount).toBe(1);
    expect(taskB?.distinctStudentsSubmitted).toBe(1);
    expect(taskB?.aiFeedback).toEqual({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      notRequested: 1,
    });

    await student2Agent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    const otherStudentSubmission = await student2Agent
      .post(
        `/api/classrooms/${classroomABody.id}/tasks/${classroomTaskABody.id}/submissions`,
      )
      .send({
        content: {
          codeText: 'function otherStudentInA() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const otherStudentSubmissionBody =
      otherStudentSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(otherStudentSubmissionBody.id);

    const db = submissionModel.db.db;
    if (!db)
      throw new Error('Dashboard isolation fixture database is required');
    const submissions = db.collection(submissionModel.collection.name);
    const classroomTaskAId = new Types.ObjectId(classroomTaskABody.id);
    // Use the raw collection for historical BSON shapes the current schema rejects.
    const invalidAssociations = [
      {},
      { classroomTaskId: null },
      { classroomTaskId: classroomTaskABody.id },
      { classroomTaskId: [classroomTaskAId] },
    ].map((association, index) => ({
      _id: new Types.ObjectId(),
      studentId: student1Id,
      taskId: new Types.ObjectId(taskId),
      attemptNo: index + 2,
      createdAt: new Date(),
      ...association,
    }));
    createdSubmissionIds.push(
      ...invalidAssociations.map(({ _id }) => _id.toHexString()),
    );
    await submissions.insertMany(invalidAssociations);

    const missingFields = await submissions.updateOne(
      { _id: new Types.ObjectId(submissionABody.id), studentId: student1Id },
      { $unset: { attemptNo: '', createdAt: '' } },
    );
    const nullFields = await submissions.updateOne(
      { _id: new Types.ObjectId(submissionBBody.id), studentId: student2Id },
      { $set: { attemptNo: null, createdAt: null } },
    );
    expect(missingFields.modifiedCount).toBe(1);
    expect(nullFields.modifiedCount).toBe(1);

    const student1Dashboard = await student1Agent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect(200);
    const student1Body = student1Dashboard.body as StudentDashboardResponse;
    const student1ClassA = student1Body.items.find(
      (item) => item.classroom.id === classroomABody.id,
    );
    const student1ClassB = student1Body.items.find(
      (item) => item.classroom.id === classroomBBody.id,
    );
    const student1TaskA = student1ClassA?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    expect(student1TaskA?.mySubmissionsCount).toBe(1);
    expect(student1TaskA?.myLatestSubmission).toEqual({
      submissionId: submissionABody.id,
      createdAt: '1970-01-01T00:00:00.000Z',
      aiFeedbackStatus: 'SUCCEEDED',
    });
    expect(student1TaskA?.myLatestSubmission).not.toHaveProperty('attemptNo');
    expect(student1ClassB).toBeUndefined();

    const student2Dashboard = await student2Agent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect(200);
    const student2Body = student2Dashboard.body as StudentDashboardResponse;
    const student2ClassA = student2Body.items.find(
      (item) => item.classroom.id === classroomABody.id,
    );
    const student2ClassB = student2Body.items.find(
      (item) => item.classroom.id === classroomBBody.id,
    );
    const student2TaskA = student2ClassA?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    const student2TaskB = student2ClassB?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskBBody.id,
    );
    expect(student2TaskB?.mySubmissionsCount).toBe(1);
    expect(student2TaskB?.myLatestSubmission).toEqual({
      submissionId: submissionBBody.id,
      attemptNo: null,
      createdAt: '1970-01-01T00:00:00.000Z',
      aiFeedbackStatus: 'NOT_REQUESTED',
    });
    expect(student2TaskA?.mySubmissionsCount).toBe(1);
    expect(student2TaskA?.myLatestSubmission).toMatchObject({
      submissionId: otherStudentSubmissionBody.id,
      attemptNo: 1,
      aiFeedbackStatus: 'NOT_REQUESTED',
    });
    console.info('Dashboard isolation readback', {
      invalidAssociationRows: invalidAssociations.length,
      student1TaskA: {
        count: student1TaskA?.mySubmissionsCount,
        latest: student1TaskA?.myLatestSubmission,
      },
      student2TaskA: {
        count: student2TaskA?.mySubmissionsCount,
        latest: student2TaskA?.myLatestSubmission,
      },
      student2TaskB: {
        count: student2TaskB?.mySubmissionsCount,
        latest: student2TaskB?.myLatestSubmission,
      },
    });
  });
});
