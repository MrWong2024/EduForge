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
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom review-pack e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string; attemptNo: number };
type ReviewPackResponse = {
  overview: {
    studentsCount: number;
    submissionRate: number;
  };
  commonIssues: {
    topTags: Array<{ tag: string; count: number }>;
  };
  examples: Array<{
    tag: string;
    samples: Array<{
      submissionId: string;
      attemptNo: number;
      severity: string;
      type: string;
      message: string;
      suggestion?: string;
      source: string;
    }>;
  }>;
  studentTiers: {
    notSubmitted: Array<{ studentId: string }>;
  };
  actionItems: Array<{ title: string; why: string; how: string }>;
  teacherScript: Array<{
    minute: string;
    topic: string;
    talkingPoints: string[];
  }>;
};

describe('Classroom Review Pack (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let enrollmentModel: Model<Enrollment>;
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
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  let submissionId = '';

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.review.pack.${Date.now()}@example.com`;
  const studentAEmail = `studentA.review.pack.${Date.now()}@example.com`;
  const studentBEmail = `studentB.review.pack.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

  const waitMs = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

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
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'true';

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
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
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
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
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
      if (submissionId) {
        const submissionObjectId = new Types.ObjectId(submissionId);
        cleanup.push(
          feedbackModel.deleteMany({
            submissionId: submissionObjectId,
          }),
        );
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: submissionObjectId,
          }),
        );
        cleanup.push(
          submissionModel.deleteOne({
            _id: submissionObjectId,
          }),
        );
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
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userObjectIds = [teacherId, studentAId, studentBId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userObjectIds.length > 0) {
        cleanup.push(
          sessionModel.deleteMany({ userId: { $in: userObjectIds } }),
        );
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      await Promise.all(cleanup);
    }

    await app.close();
  });

  it('returns classroom review pack with overview, common issues, examples and tiers', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `RVPK${Date.now()}`,
        name: 'Review Pack Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Review-Pack-Classroom',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Review Pack Task',
        description: 'Generate classroom review pack.',
        knowledgeModule: 'review-pack',
        stage: 2,
        status: 'DRAFT',
      })
      .expect(201);
    taskId = (createdTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId })
      .expect(201);
    classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;

    await Promise.all([
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBody.joinCode })
        .expect(201),
      studentBAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBody.joinCode })
        .expect(201),
    ]);

    const createdSubmission = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function reviewPackSubmission() { return "ok"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    submissionId = submissionBody.id;
    expect(submissionBody.attemptNo).toBe(1);

    for (let index = 0; index < 6; index += 1) {
      await aiFeedbackProcessor.processOnce(10);
      await waitMs(70);
    }

    await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({
        source: 'TEACHER',
        type: 'STYLE',
        severity: 'WARN',
        message: 'Use clearer names for helper functions.',
        suggestion: 'Rename helper to reflect intent.',
        tags: ['readability'],
      })
      .expect(201);

    const reviewPack = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/review-pack`,
      )
      .query({
        window: '7d',
        examplesPerTag: 2,
        topK: 10,
        includeStudentTiers: true,
        includeTeacherScript: true,
      })
      .expect(200);
    const body = reviewPack.body as ReviewPackResponse;

    expect(body.overview.studentsCount).toBeGreaterThanOrEqual(2);
    expect(body.overview.submissionRate).toBeGreaterThanOrEqual(0);
    expect(body.overview.submissionRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(body.commonIssues.topTags)).toBe(true);
    expect(Array.isArray(body.examples)).toBe(true);
    for (const group of body.examples) {
      for (const sample of group.samples) {
        expect((sample as Record<string, unknown>).codeText).toBeUndefined();
      }
    }
    expect(body.studentTiers.notSubmitted.length).toBeGreaterThanOrEqual(1);
    expect(body.actionItems.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(body.teacherScript)).toBe(true);
  });
});
