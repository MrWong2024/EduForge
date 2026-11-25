import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
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
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = {
  contentRevision: number;
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
};
type LearningTrajectoryResponse = {
  window: string;
  page: number;
  limit: number;
  total: number;
  items: Array<{
    studentId: string;
    studentName: string | null;
    student: {
      id: string;
      name: string | null;
      studentNo: string | null;
      email: string | null;
    };
    attemptsCount: number;
    latestAttemptAt: string | null;
    latestAiFeedbackStatus: string | null;
    trend: {
      errorCountFirst: number | null;
      errorCountLatest: number | null;
      errorDelta: number | null;
      topTagsFirst: Array<{ tag: string; count: number }>;
      topTagsLatest: Array<{ tag: string; count: number }>;
    };
    attempts: Array<{
      submissionId: string;
      attemptNo: number;
      createdAt: string;
      isLate: boolean;
      aiFeedbackStatus: string;
      feedbackCount: number;
      feedbackSummary: {
        totalItems: number;
        severityBreakdown: { INFO: number; WARN: number; ERROR: number };
        topTags: Array<{ tag: string; count: number }>;
      };
    }>;
  }>;
};

function errorTrend(item?: LearningTrajectoryResponse['items'][number]) {
  const trend = item?.trend;
  return (
    trend && [trend.errorCountFirst, trend.errorCountLatest, trend.errorDelta]
  );
}

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
  let configService: ConfigService;
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
  let previousSubmissionCooldownMs: string | undefined;

  const teacherEmail = `teacher.trajectory.${Date.now()}@example.com`;
  const studentAEmail = `studentA.trajectory.${Date.now()}@example.com`;
  const studentBEmail = `studentB.trajectory.${Date.now()}@example.com`;
  const studentAName = 'Trajectory Student A';
  const studentBName = 'Trajectory Student B';
  const studentANo = `S-A-${Date.now()}`;
  const studentBNo = `S-B-${Date.now()}`;
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

  const fetchTrajectory = async (
    window?: '7d' | 'all',
    options?: {
      includeAttempts?: boolean;
      sort?: 'errorRate';
      order?: 'asc' | 'desc';
    },
  ) => {
    const query: Record<string, unknown> = {
      page: 1,
      limit: 20,
      includeAttempts: true,
      includeTagDetails: true,
      ...options,
    };
    if (window !== undefined) {
      query.window = window;
    }
    const response = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/learning-trajectory`,
      )
      .query(query)
      .expect(200);
    return response.body as LearningTrajectoryResponse;
  };

  beforeAll(async () => {
    const environment = {
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    };
    assertLocalStandardTestEnvironment(environment);

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousSubmissionCooldownMs =
      process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = '0';

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
    const connection = app.get<Connection>(getConnectionToken());
    const database = connection.db;
    if (!database) throw new Error('Missing connected test database');
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false, maxTimeMS: 5000 },
      { signal: AbortSignal.timeout(5000), readPreference: 'primary' },
    );
    assertLocalStandardTestAuthentication({
      ...environment,
      databaseName: database.databaseName,
      connectedHost: connection.host,
      authInfo: auth.authInfo,
    });
    configService = app.get(ConfigService);
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

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
        name: studentAName,
        studentNo: studentANo,
      }),
      userModel.create({
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
        name: studentBName,
        studentNo: studentBNo,
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
    if (previousSubmissionCooldownMs === undefined) {
      delete process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    } else {
      process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS =
        previousSubmissionCooldownMs;
    }

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
      cleanup.push(sessionModel.deleteMany({ userId: { $in: userObjectIds } }));
      cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
    }
    try {
      await Promise.all(cleanup);
    } finally {
      await app?.close();
    }
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
    await studentAAgent
      .post(
        '/api/learning-tasks/submissions/' +
          firstSubmissionBody.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: firstSubmissionBody.contentRevision })
      .expect(200);

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

    const thirdSubmission = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function trajectoryAttemptThree() { return "a3"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const thirdSubmissionBody =
      thirdSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(thirdSubmissionBody.id);
    expect(thirdSubmissionBody.attemptNo).toBe(3);
    const oldSubmissionDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const firstSubmissionObjectId = new Types.ObjectId(firstSubmissionBody.id);
    const createdAtPatchResult = await submissionModel.collection.updateOne(
      { _id: firstSubmissionObjectId },
      {
        $set: {
          createdAt: oldSubmissionDate,
          submittedAt: oldSubmissionDate,
        },
      },
    );
    expect(createdAtPatchResult.matchedCount).toBe(1);
    expect(createdAtPatchResult.modifiedCount).toBe(1);
    const patchedSubmission = await submissionModel.collection.findOne<{
      createdAt?: Date;
      submittedAt?: Date;
    }>(
      { _id: firstSubmissionObjectId },
      { projection: { createdAt: 1, submittedAt: 1 } },
    );
    expect(patchedSubmission).toBeDefined();
    expect(patchedSubmission?.createdAt).toBeDefined();
    expect(patchedSubmission?.createdAt?.getTime()).toBe(
      oldSubmissionDate.getTime(),
    );
    const sevenDaysLowerBound = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(patchedSubmission?.createdAt?.getTime() ?? 0).toBeLessThan(
      sevenDaysLowerBound,
    );

    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionBody.id}/ai-feedback/request`,
      )
      .send({
        expectedRevision: 0,
        reason: 'Need second attempt feedback for trajectory',
      })
      .expect(200);

    const secondSubmissionObjectId = new Types.ObjectId(
      secondSubmissionBody.id,
    );
    const succeededJob = await aiFeedbackJobModel.updateOne(
      { submissionId: secondSubmissionObjectId },
      { $set: { status: AiFeedbackJobStatus.Succeeded } },
    );
    expect(succeededJob.modifiedCount).toBe(1);

    const jobWithoutFeedback = (await fetchTrajectory('7d')).items.find(
      (item) => item.studentId === studentAId,
    );
    expect(errorTrend(jobWithoutFeedback)).toEqual([null, null, null]);
    expect(jobWithoutFeedback?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: secondSubmissionBody.id,
          aiFeedbackStatus: 'SUCCEEDED',
          feedbackCount: 0,
          feedbackSummary: {
            totalItems: 0,
            severityBreakdown: { INFO: 0, WARN: 0, ERROR: 0 },
            topTags: [],
          },
        }),
      ]),
    );

    await feedbackModel.insertMany([
      {
        submissionId: firstSubmissionObjectId,
        source: FeedbackSource.AI,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Error,
        message: 'First attempt AI error one',
      },
      {
        submissionId: firstSubmissionObjectId,
        source: FeedbackSource.AI,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Error,
        message: 'First attempt AI error two',
      },
      {
        submissionId: secondSubmissionObjectId,
        source: FeedbackSource.AI,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Warn,
        message: 'Second attempt AI warning',
      },
      {
        submissionId: secondSubmissionObjectId,
        source: FeedbackSource.Teacher,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Error,
        message: 'Second attempt teacher error',
      },
    ]);

    const defaultWindowTrajectory = await fetchTrajectory(undefined);
    expect(defaultWindowTrajectory.window).toBe('all');

    const trajectoryAll = await fetchTrajectory('all');
    expect(trajectoryAll.window).toBe('all');
    expect(trajectoryAll.total).toBeGreaterThanOrEqual(2);

    const studentAItem = trajectoryAll.items.find(
      (item) => item.studentId === studentAId,
    );
    const studentBItem = trajectoryAll.items.find(
      (item) => item.studentId === studentBId,
    );
    expect(studentAItem).toBeDefined();
    expect(studentBItem).toBeDefined();
    expect(studentAItem?.studentName).toBe(studentAName);
    expect(studentAItem?.student).toMatchObject({
      id: studentAId,
      name: studentAName,
      studentNo: studentANo,
      email: studentAEmail.toLowerCase(),
    });
    expect(studentBItem?.studentName).toBe(studentBName);
    expect(studentBItem?.student).toMatchObject({
      id: studentBId,
      name: studentBName,
      studentNo: studentBNo,
      email: studentBEmail.toLowerCase(),
    });
    expect(studentAItem?.attemptsCount).toBe(3);
    expect(studentBItem?.attemptsCount).toBe(0);
    expect(errorTrend(studentAItem)).toEqual([2, null, null]);
    expect(errorTrend(studentBItem)).toEqual([null, null, null]);
    expect(JSON.stringify(trajectoryAll)).not.toContain('passwordHash');
    const secondAttempt = studentAItem?.attempts.find(
      (attempt) => attempt.submissionId === secondSubmissionBody.id,
    );
    const thirdAttempt = studentAItem?.attempts.find(
      (attempt) => attempt.submissionId === thirdSubmissionBody.id,
    );
    expect(secondAttempt).toBeDefined();
    expect(thirdAttempt).toBeDefined();
    expect(secondAttempt?.aiFeedbackStatus).toBe('SUCCEEDED');
    expect(secondAttempt?.feedbackSummary.totalItems).toBe(1);
    expect(secondAttempt?.feedbackSummary.severityBreakdown.ERROR).toBe(0);
    expect(secondAttempt?.feedbackCount).toBe(2);
    expect(thirdAttempt?.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(thirdAttempt?.feedbackSummary.totalItems).toBe(0);
    expect(thirdAttempt?.feedbackCount).toBe(0);
    for (const attempt of studentAItem?.attempts ?? []) {
      expect(typeof attempt.aiFeedbackStatus).toBe('string');
      expect(typeof attempt.feedbackCount).toBe('number');
      expect(typeof attempt.feedbackSummary.totalItems).toBe('number');
    }

    const trajectory7d = await fetchTrajectory('7d');
    expect(trajectory7d.window).toBe('7d');
    const studentAIn7d = trajectory7d.items.find(
      (item) => item.studentId === studentAId,
    );
    expect(studentAIn7d?.attemptsCount).toBe(2);
    expect(errorTrend(studentAIn7d)).toEqual([0, null, null]);

    const trajectoryLimit100 = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/learning-trajectory`,
      )
      .query({
        page: 1,
        limit: 100,
        includeAttempts: true,
        includeTagDetails: true,
      })
      .expect(200);
    expect((trajectoryLimit100.body as LearningTrajectoryResponse).limit).toBe(
      100,
    );

    await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/learning-trajectory`,
      )
      .query({
        page: 1,
        limit: 101,
        includeAttempts: true,
        includeTagDetails: true,
      })
      .expect(400);

    const studentBSubmission = await studentBAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'const trajectoryB = true;',
          language: 'typescript',
        },
      })
      .expect(201);
    const studentBSubmissionBody =
      studentBSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(studentBSubmissionBody.id);
    const studentBSubmissionId = new Types.ObjectId(studentBSubmissionBody.id);
    await feedbackModel.create({
      submissionId: studentBSubmissionId,
      source: FeedbackSource.Teacher,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Error,
      message: 'Only teacher feedback for this attempt',
    });
    const teacherOnly = (await fetchTrajectory()).items.find(
      (item) => item.studentId === studentBId,
    );
    expect(errorTrend(teacherOnly)).toEqual([null, null, null]);
    expect(teacherOnly?.attempts[0]?.feedbackCount).toBe(1);
    expect(teacherOnly?.attempts[0]?.feedbackSummary.totalItems).toBe(0);

    await feedbackModel.create({
      submissionId: studentBSubmissionId,
      source: FeedbackSource.AI,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Info,
      message: 'Student B has AI feedback without errors',
    });
    for (const order of ['asc', 'desc'] as const) {
      const sorted = await fetchTrajectory('all', { sort: 'errorRate', order });
      expect(sorted.items.map((item) => item.studentId)).toEqual([
        studentBId,
        studentAId,
      ]);
      expect(sorted.items[0]?.attemptsCount).toBe(1);
      expect(errorTrend(sorted.items[0])).toEqual([0, 0, null]);
      expect(errorTrend(sorted.items[1])).toEqual([2, null, null]);
    }

    await feedbackModel.create({
      submissionId: new Types.ObjectId(thirdSubmissionBody.id),
      source: FeedbackSource.AI,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Info,
      message: 'Third attempt AI info',
    });
    const withDetails = await fetchTrajectory('all');
    const withoutDetails = await fetchTrajectory('all', {
      includeAttempts: false,
    });
    expect(
      errorTrend(
        withDetails.items.find((item) => item.studentId === studentAId),
      ),
    ).toEqual([2, 0, -2]);
    expect(
      withoutDetails.items.map(({ studentId, trend }) => ({
        studentId,
        trend,
      })),
    ).toEqual(
      withDetails.items.map(({ studentId, trend }) => ({ studentId, trend })),
    );
    expect(withoutDetails.items.map((item) => item.attempts)).toEqual([[], []]);

    const bothRecent = (await fetchTrajectory('7d')).items.find(
      (item) => item.studentId === studentAId,
    );
    expect(errorTrend(bothRecent)).toEqual([0, 0, 0]);
  });
});
