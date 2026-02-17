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
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom task deadline e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = {
  id: string;
  isLate: boolean;
  lateBySeconds: number;
};
type WeeklyReportResponse = {
  progress: {
    lateSubmissionsCount: number;
    lateStudentsCount: number;
  };
};

describe('Classroom Task Deadline Rules (e2e)', () => {
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
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentId = '';
  let courseId = '';
  let classroomId = '';

  const createdTaskIds: string[] = [];
  const createdClassroomTaskIds: string[] = [];
  const createdSubmissionIds: string[] = [];

  let previousWorkerEnabled: string | undefined;

  const teacherEmail = `teacher.deadline.${Date.now()}@example.com`;
  const studentEmail = `student.deadline.${Date.now()}@example.com`;
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

  const createPublishedClassroomTask = async (options?: {
    dueAt?: string;
    allowLate?: boolean;
  }) => {
    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: `Deadline Task ${Date.now()}-${Math.random()}`,
        description: 'Deadline rule test task.',
        knowledgeModule: 'deadline',
        stage: 1,
        status: 'DRAFT',
      })
      .expect(201);
    const taskId = (createdTask.body as CreatedTaskResponse).id;
    createdTaskIds.push(taskId);

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const payload: {
      taskId: string;
      dueAt?: string;
      settings?: { allowLate: boolean };
    } = {
      taskId,
    };
    if (options?.dueAt) {
      payload.dueAt = options.dueAt;
    }
    if (options?.allowLate !== undefined) {
      payload.settings = { allowLate: options.allowLate };
    }

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send(payload)
      .expect(201);
    const classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;
    createdClassroomTaskIds.push(classroomTaskId);

    return { taskId, classroomTaskId };
  };

  beforeAll(async () => {
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';

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
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

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

    teacherId = teacher._id.toString();
    studentId = student._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `DL${Date.now()}`,
        name: 'Deadline Rules',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Deadline-1',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
  });

  afterAll(async () => {
    if (previousWorkerEnabled === undefined) {
      delete process.env.AI_FEEDBACK_WORKER_ENABLED;
    } else {
      process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
    }

    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (createdSubmissionIds.length > 0) {
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: {
              $in: createdSubmissionIds.map((id) => new Types.ObjectId(id)),
            },
          }),
        );
        cleanup.push(
          submissionModel.deleteMany({
            _id: {
              $in: createdSubmissionIds.map((id) => new Types.ObjectId(id)),
            },
          }),
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
      if (createdTaskIds.length > 0) {
        cleanup.push(
          taskModel.deleteMany({
            _id: { $in: createdTaskIds.map((id) => new Types.ObjectId(id)) },
          }),
        );
      }
      if (classroomId) {
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: new Types.ObjectId(classroomId),
          }),
        );
        cleanup.push(
          classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
        );
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userIds = [teacherId, studentId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userIds.length > 0) {
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
      }
      await Promise.all(cleanup);
    }

    await app.close();
  });

  it('enforces deadline gate and records late markers', async () => {
    const noDueTask = await createPublishedClassroomTask();
    const noDueSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${noDueTask.classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function onTimeWithoutDue() { return 1; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const noDueBody = noDueSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(noDueBody.id);
    expect(noDueBody.isLate).toBe(false);
    expect(noDueBody.lateBySeconds).toBe(0);

    const allowLateTask = await createPublishedClassroomTask({
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      allowLate: true,
    });
    const allowLateSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${allowLateTask.classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function lateAllowed() { return 2; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const allowLateBody = allowLateSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(allowLateBody.id);
    expect(allowLateBody.isLate).toBe(true);
    expect(allowLateBody.lateBySeconds).toBeGreaterThan(0);

    const weeklyReport = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    const weeklyBody = weeklyReport.body as WeeklyReportResponse;
    expect(weeklyBody.progress.lateSubmissionsCount).toBeGreaterThanOrEqual(1);
    expect(weeklyBody.progress.lateStudentsCount).toBeGreaterThanOrEqual(1);

    const denyLateTask = await createPublishedClassroomTask({
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      allowLate: false,
    });
    const denied = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${denyLateTask.classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function lateDenied() { return 3; }',
          language: 'typescript',
        },
      });

    expect(denied.status).toBe(403);

    const deniedBody = denied.body as { code?: string };
    expect(deniedBody.code).toBe('LATE_SUBMISSION_NOT_ALLOWED');
  });
});
