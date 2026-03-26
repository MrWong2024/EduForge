import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { User } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string; attemptNo: number };
type SubmissionCooldownResponse = {
  code: 'SUBMISSION_COOLDOWN_ACTIVE';
  retryAfterMs: number;
  retryAfterSeconds: number;
};

describe('Classroom Task Submission Cooldown (e2e)', () => {
  let app: INestApplication<App>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;
  let configService: ConfigService;

  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let enrollmentModel: Model<Enrollment>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;

  let previousWorkerEnabled: string | undefined;
  let teacherId = '';
  let studentId = '';
  let courseId = '';
  let classroomId = '';
  const createdTaskIds: string[] = [];
  const createdClassroomTaskIds: string[] = [];
  const createdSubmissionIds: string[] = [];

  const ensureMongoUri = () => {
    if (!process.env.MONGO_URI) {
      throw new Error(
        'MONGO_URI is required for submission cooldown e2e tests.',
      );
    }
  };

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

  const createPublishedClassroomTask = async () => {
    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: `Submission Cooldown Task ${Date.now()}-${Math.random()}`,
        description: 'Verify classroom submission cooldown behavior.',
        knowledgeModule: 'submission-cooldown',
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

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;
    createdClassroomTaskIds.push(classroomTaskId);

    return classroomTaskId;
  };

  const submitToClassroomTask = async (
    targetClassroomTaskId: string,
    codeText: string,
  ) => {
    const res = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${targetClassroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText,
          language: 'typescript',
        },
      });
    return res;
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

    configService = app.get(ConfigService);
    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());

    userModel = app.get<Model<User>>(getModelToken(User.name));
    sessionModel = app.get<Model<Session>>(getModelToken(Session.name));
    courseModel = app.get<Model<Course>>(getModelToken(Course.name));
    classroomModel = app.get<Model<Classroom>>(getModelToken(Classroom.name));
    classroomTaskModel = app.get<Model<ClassroomTask>>(
      getModelToken(ClassroomTask.name),
    );
    enrollmentModel = app.get<Model<Enrollment>>(
      getModelToken(Enrollment.name),
    );
    taskModel = app.get<Model<Task>>(getModelToken(Task.name));
    submissionModel = app.get<Model<Submission>>(
      getModelToken(Submission.name),
    );
    aiFeedbackJobModel = app.get<Model<AiFeedbackJob>>(
      getModelToken(AiFeedbackJob.name),
    );

    const teacherEmail = `teacher.cooldown.${Date.now()}.${Math.random()}@example.com`;
    const studentEmail = `student.cooldown.${Date.now()}.${Math.random()}@example.com`;
    const teacherPassword = 'TeacherPass123!';
    const studentPassword = 'StudentPass123!';

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
        code: `CD${Date.now()}${Math.floor(Math.random() * 1000)}`,
        name: 'Submission Cooldown Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Submission-Cooldown-Classroom',
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
        const submissionObjectIds = createdSubmissionIds.map(
          (id) => new Types.ObjectId(id),
        );
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: { $in: submissionObjectIds },
          }),
        );
        cleanup.push(
          submissionModel.deleteMany({
            _id: { $in: submissionObjectIds },
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
        const classroomObjectId = new Types.ObjectId(classroomId);
        cleanup.push(
          enrollmentModel.deleteMany({ classroomId: classroomObjectId }),
        );
        cleanup.push(classroomModel.deleteOne({ _id: classroomObjectId }));
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

  it('rejects immediate second submission by default and allows retry after cooldown window', async () => {
    const classroomTaskId = await createPublishedClassroomTask();

    const firstSubmission = await submitToClassroomTask(
      classroomTaskId,
      'function cooldownDefaultOne() { return 1; }',
    );
    expect(firstSubmission.status).toBe(201);
    const firstBody = firstSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(firstBody.id);
    expect(firstBody.attemptNo).toBe(1);

    const rejected = await submitToClassroomTask(
      classroomTaskId,
      'function cooldownDefaultTwo() { return 2; }',
    );
    const rejectedBody = rejected.body as SubmissionCooldownResponse;

    expect(rejected.status).toBe(429);
    expect(rejectedBody.code).toBe('SUBMISSION_COOLDOWN_ACTIVE');
    expect(typeof rejectedBody.retryAfterMs).toBe('number');
    expect(rejectedBody.retryAfterMs).toBeGreaterThan(0);
    expect(typeof rejectedBody.retryAfterSeconds).toBe('number');
    expect(rejectedBody.retryAfterSeconds).toBeGreaterThan(0);

    await submissionModel
      .findByIdAndUpdate(firstBody.id, {
        submittedAt: new Date(Date.now() - 301000),
      })
      .exec();

    const allowedAfterWindow = await submitToClassroomTask(
      classroomTaskId,
      'function cooldownDefaultThree() { return 3; }',
    );
    expect(allowedAfterWindow.status).toBe(201);
    const allowedBody = allowedAfterWindow.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(allowedBody.id);
    expect(allowedBody.attemptNo).toBe(2);
  });

  it('allows consecutive submissions when LEARNING_TASK_SUBMISSION_COOLDOWN_MS=0', async () => {
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    const classroomTaskId = await createPublishedClassroomTask();

    const firstSubmission = await submitToClassroomTask(
      classroomTaskId,
      'function cooldownDisabledOne() { return 1; }',
    );
    expect(firstSubmission.status).toBe(201);
    const firstBody = firstSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(firstBody.id);
    expect(firstBody.attemptNo).toBe(1);

    const secondSubmission = await submitToClassroomTask(
      classroomTaskId,
      'function cooldownDisabledTwo() { return 2; }',
    );
    expect(secondSubmission.status).toBe(201);
    const secondBody = secondSubmission.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(secondBody.id);
    expect(secondBody.attemptNo).toBe(2);
  });
});
