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
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom learning loop e2e.');
  }
};

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
  attemptNo: number;
  aiFeedbackStatus?: string;
};

type CommonIssuesReport = {
  topTags: Array<{ tag: string; count: number }>;
};

describe('Classroom Learning Loop (e2e)', () => {
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
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentId = '';
  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  let submissionId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.loop.${Date.now()}@example.com`;
  const studentEmail = `student.loop.${Date.now()}@example.com`;
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

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

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
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
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
  });

  afterAll(async () => {
    if (previousWorkerEnabled === undefined) {
      delete process.env.AI_FEEDBACK_WORKER_ENABLED;
    } else {
      process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
    }
    if (previousDebugEnabled === undefined) {
      delete process.env.AI_FEEDBACK_DEBUG_ENABLED;
    } else {
      process.env.AI_FEEDBACK_DEBUG_ENABLED = previousDebugEnabled;
    }

    if (KEEP_DB) {
      await app.close();
      return;
    }

    const cleanup: Promise<unknown>[] = [];
    const userIds = [teacherId, studentId].filter(Boolean);

    if (submissionId) {
      const submissionObjectId = new Types.ObjectId(submissionId);
      cleanup.push(
        feedbackModel.deleteMany({ submissionId: submissionObjectId }),
      );
      cleanup.push(
        aiFeedbackJobModel.deleteMany({ submissionId: submissionObjectId }),
      );
      cleanup.push(submissionModel.deleteOne({ _id: submissionObjectId }));
    }
    if (classroomTaskId) {
      cleanup.push(
        classroomTaskModel.deleteOne({
          _id: new Types.ObjectId(classroomTaskId),
        }),
      );
    }
    if (taskId) {
      cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
    }
    if (classroomId) {
      cleanup.push(
        classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
      );
    }
    if (courseId) {
      cleanup.push(
        courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
      );
    }
    if (userIds.length > 0) {
      cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
      cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
    }

    await Promise.all(cleanup);
    await app.close();
  });

  it('teacher publishes task to classroom, student joins and submits, report includes tags', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `CS${Date.now()}`,
        name: 'Algorithms',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    expect(typeof courseBody.id).toBe('string');
    courseId = courseBody.id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'A1',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    expect(typeof classroomBody.id).toBe('string');
    expect(typeof classroomBody.joinCode).toBe('string');
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Sorting Lab',
        description: 'Implement quicksort.',
        knowledgeModule: 'algorithms',
        stage: 2,
        status: 'DRAFT',
      })
      .expect(201);
    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({
        taskId,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        settings: { allowLate: false, maxAttempts: 2 },
      })
      .expect(201);
    const classroomTaskBody =
      createdClassroomTask.body as CreatedClassroomTaskResponse;
    expect(typeof classroomTaskBody.id).toBe('string');
    expect(classroomTaskBody.taskId).toBe(taskId);
    classroomTaskId = classroomTaskBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const createdSubmission = await studentAgent
      .post(`/api/learning-tasks/tasks/${taskId}/submissions`)
      .send({
        content: {
          codeText: 'function quicksort(arr) { return arr; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    expect(typeof submissionBody.id).toBe('string');
    expect(submissionBody.attemptNo).toBe(1);
    submissionId = submissionBody.id;

    await teacherAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });

    await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({
        source: 'TEACHER',
        type: 'STYLE',
        severity: 'WARN',
        message: 'Use clearer naming.',
        tags: ['clarity'],
      })
      .expect(201);

    const report = await teacherAgent
      .get(`/api/learning-tasks/tasks/${taskId}/reports/common-issues`)
      .query({ limit: 10 })
      .expect(200);
    const reportBody = report.body as CommonIssuesReport;
    const tags = reportBody.topTags.map((item) => item.tag);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(tags).toContain('clarity');
  });
});
