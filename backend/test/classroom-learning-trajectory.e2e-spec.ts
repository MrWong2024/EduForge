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
    throw new Error(
      'MONGO_URI is required for classroom learning trajectory e2e.',
    );
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
};
type LearningTrajectoryResponse = {
  total: number;
  items: Array<{
    studentId: string;
    attemptsCount: number;
    latestAttemptAt: string | null;
    latestAiFeedbackStatus: string | null;
    trend: {
      errorCountFirst: number;
      errorCountLatest: number;
      errorDelta: number;
      topTagsFirst: Array<{ tag: string; count: number }>;
      topTagsLatest: Array<{ tag: string; count: number }>;
    };
    attempts: Array<{
      submissionId: string;
      attemptNo: number;
      createdAt: string;
      isLate: boolean;
      aiFeedbackStatus: string;
      feedbackSummary: {
        totalItems: number;
        severityBreakdown: { INFO: number; WARN: number; ERROR: number };
        topTags: Array<{ tag: string; count: number }>;
      };
    }>;
  }>;
};

describe('Classroom Learning Trajectory (e2e)', () => {
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

  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  const submissionIds: string[] = [];

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.trajectory.${Date.now()}@example.com`;
  const studentAEmail = `studentA.trajectory.${Date.now()}@example.com`;
  const studentBEmail = `studentB.trajectory.${Date.now()}@example.com`;
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

  const fetchTrajectory = async () => {
    const response = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/learning-trajectory`,
      )
      .query({
        window: '7d',
        page: 1,
        limit: 20,
        includeAttempts: true,
        includeTagDetails: true,
      })
      .expect(200);
    return response.body as LearningTrajectoryResponse;
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
      if (submissionIds.length > 0) {
        const submissionObjectIds = submissionIds.map(
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
          submissionModel.deleteMany({
            _id: { $in: submissionObjectIds },
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
          classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
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

  it('returns per-student trajectory with attempts, AI statuses and trend summary', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `LTR${Date.now()}`,
        name: 'Trajectory Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Trajectory-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Trajectory Task',
        description: 'Track attempt evolution.',
        knowledgeModule: 'trajectory',
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
      .send({
        taskId,
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
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

    const firstSubmission = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function trajectoryAttemptOne() { return "a1"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const firstSubmissionBody =
      firstSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(firstSubmissionBody.id);
    expect(firstSubmissionBody.attemptNo).toBe(1);

    const secondSubmission = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function trajectoryAttemptTwo() { return "a2"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const secondSubmissionBody =
      secondSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(secondSubmissionBody.id);
    expect(secondSubmissionBody.attemptNo).toBe(2);

    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionBody.id}/ai-feedback/request`,
      )
      .send({ reason: 'Need second attempt feedback for trajectory' })
      .expect(200);

    let hasSucceeded = false;
    for (let index = 0; index < 10; index += 1) {
      await aiFeedbackProcessor.processOnce(10);
      const trajectory = await fetchTrajectory();
      const studentAItem = trajectory.items.find(
        (item) => item.studentId === studentAId,
      );
      const succeeded = !!studentAItem?.attempts.some(
        (attempt) => attempt.aiFeedbackStatus === 'SUCCEEDED',
      );
      if (succeeded) {
        hasSucceeded = true;
        break;
      }
      await waitMs(80);
    }
    expect(hasSucceeded).toBe(true);

    const trajectory = await fetchTrajectory();
    expect(trajectory.total).toBeGreaterThanOrEqual(2);

    const studentAItem = trajectory.items.find(
      (item) => item.studentId === studentAId,
    );
    const studentBItem = trajectory.items.find(
      (item) => item.studentId === studentBId,
    );
    expect(studentAItem).toBeDefined();
    expect(studentBItem).toBeDefined();
    expect(studentAItem?.attemptsCount).toBe(2);
    expect(studentBItem?.attemptsCount).toBe(0);
    expect(typeof studentAItem?.trend.errorCountFirst).toBe('number');
    expect(typeof studentAItem?.trend.errorCountLatest).toBe('number');
    for (const attempt of studentAItem?.attempts ?? []) {
      expect(typeof attempt.aiFeedbackStatus).toBe('string');
      expect(typeof attempt.feedbackSummary.totalItems).toBe('number');
    }
  });
});
