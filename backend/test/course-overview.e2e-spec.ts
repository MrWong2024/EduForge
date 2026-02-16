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
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for course overview e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string };

type CourseOverviewResponse = {
  total: number;
  items: Array<{
    classroomId: string;
    name: string;
    studentsCount: number;
    submissionRate: number;
    ai: {
      jobsTotal: number;
      pendingJobs: number;
      failedJobs: number;
      aiSuccessRate: number;
      topErrors: Array<{ code: string; count: number }>;
    };
  }>;
};

describe('Course Overview (e2e)', () => {
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
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let courseId = '';
  let taskId = '';
  let classroomAId = '';
  let classroomBId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  const submissionIds: string[] = [];

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.course.overview.${Date.now()}@example.com`;
  const studentAEmail = `studentA.course.overview.${Date.now()}@example.com`;
  const studentBEmail = `studentB.course.overview.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentAPassword = 'StudentPass123!';
  const studentBPassword = 'StudentPass123!';

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
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstAttemptOnly =
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'false';

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

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentAPassword, 10),
      bcrypt.hash(studentBPassword, 10),
    ]);

    const [teacher, studentA, studentB] = await Promise.all([
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
    ]);

    teacherId = teacher._id.toString();
    studentAId = studentA._id.toString();
    studentBId = studentB._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentAPassword);
    await login(studentBAgent, studentBEmail, studentBPassword);
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
    if (previousAutoOnSubmit === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = previousAutoOnSubmit;
    }
    if (previousFirstAttemptOnly === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY =
        previousFirstAttemptOnly;
    }

    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      const submissionObjectIds = submissionIds.map(
        (id) => new Types.ObjectId(id),
      );
      if (submissionObjectIds.length > 0) {
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
      if (classroomTaskAId || classroomTaskBId) {
        const classroomTaskIds = [classroomTaskAId, classroomTaskBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (classroomTaskIds.length > 0) {
          cleanup.push(
            classroomTaskModel.deleteMany({ _id: { $in: classroomTaskIds } }),
          );
        }
      }
      if (taskId) {
        cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
      }
      if (classroomAId || classroomBId) {
        const classroomIds = [classroomAId, classroomBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (classroomIds.length > 0) {
          cleanup.push(
            classroomModel.deleteMany({ _id: { $in: classroomIds } }),
          );
        }
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userIds = [teacherId, studentAId, studentBId]
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

  it('returns course overview with multi-classroom metrics, sorting and pagination', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `OVERVIEW${Date.now()}`,
        name: 'Course Overview',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const [createdClassroomA, createdClassroomB] = await Promise.all([
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Classroom-A' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Classroom-B' })
        .expect(201),
    ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    classroomAId = classroomABody.id;
    classroomBId = classroomBBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Course Overview Task',
        description: 'Task for cross-classroom overview aggregation.',
        knowledgeModule: 'course-overview',
        stage: 2,
        status: 'DRAFT',
      })
      .expect(201);
    taskId = (createdTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const [classroomTaskA, classroomTaskB] = await Promise.all([
      teacherAgent
        .post(`/api/classrooms/${classroomAId}/tasks`)
        .send({ taskId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomBId}/tasks`)
        .send({ taskId })
        .expect(201),
    ]);
    classroomTaskAId = (classroomTaskA.body as CreatedClassroomTaskResponse).id;
    classroomTaskBId = (classroomTaskB.body as CreatedClassroomTaskResponse).id;

    await Promise.all([
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomABody.joinCode })
        .expect(201),
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBBody.joinCode })
        .expect(201),
      studentBAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomABody.joinCode })
        .expect(201),
    ]);

    const createdSubmissionA1 = await studentAAgent
      .post(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewAStudentOne() { return "A1"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionIds.push(
      (createdSubmissionA1.body as CreatedSubmissionResponse).id,
    );

    const createdSubmissionB1 = await studentAAgent
      .post(
        `/api/classrooms/${classroomBId}/tasks/${classroomTaskBId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewBStudentOne() { return "B1"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionIds.push(
      (createdSubmissionB1.body as CreatedSubmissionResponse).id,
    );

    const createdSubmissionA2 = await studentBAgent
      .post(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewAStudentTwo() { return "A2"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionIds.push(
      (createdSubmissionA2.body as CreatedSubmissionResponse).id,
    );

    await aiFeedbackProcessor.processOnce(20);

    const overview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '7d' })
      .expect(200);
    const overviewBody = overview.body as CourseOverviewResponse;

    expect(overviewBody.total).toBeGreaterThanOrEqual(2);
    expect(overviewBody.items.length).toBeGreaterThanOrEqual(2);
    for (const item of overviewBody.items) {
      expect(typeof item.submissionRate).toBe('number');
      expect(typeof item.ai.aiSuccessRate).toBe('number');
    }

    const sortedByStudents = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        sort: 'studentsCount',
        order: 'desc',
      })
      .expect(200);
    const sortedBody = sortedByStudents.body as CourseOverviewResponse;
    expect(sortedBody.items.length).toBeGreaterThanOrEqual(2);
    expect(typeof sortedBody.items[0]?.studentsCount).toBe('number');

    const pageLimited = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        page: 1,
        limit: 1,
      })
      .expect(200);
    const pageLimitedBody = pageLimited.body as CourseOverviewResponse;
    expect(pageLimitedBody.total).toBe(2);
    expect(pageLimitedBody.items.length).toBe(1);
  });
});
