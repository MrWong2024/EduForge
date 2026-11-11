import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
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
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
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
      feedbackCount: number;
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
  let moduleFixture: TestingModule | undefined;
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
  let fixtureAuthorized = false;
  let environmentOverridden = false;

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
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
          throw new Error(`Unexpected login status ${res.status}`);
        }
      });
  };

  const fetchTrajectory = async (window?: '7d' | 'all') => {
    const query: Record<string, unknown> = {
      page: 1,
      limit: 20,
      includeAttempts: true,
      includeTagDetails: true,
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

  const expectEmptyDatabase = async (phase: string) => {
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const cursor = database.listCollections({}, { maxTimeMS: 5000 });
    try {
      const collections = await cursor.toArray();
      const counts: Record<string, number> = {};
      for (const collection of collections) {
        expect(collection.type).toBe('collection');
        counts[collection.name] = await database
          .collection(collection.name)
          .countDocuments({}, { maxTimeMS: 5000 });
      }
      console.info('Trajectory database counts: ' + phase, counts);
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    } finally {
      await cursor.close();
    }
  };

  beforeAll(async () => {
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    previousSubmissionCooldownMs =
      process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    environmentOverridden = true;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = '0';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    configService = app.get(ConfigService);
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentBAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

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

    userModel.db.set('maxTimeMS', 10000);
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const hello = await database.command({ hello: 1 }, { timeoutMS: 5000 });
    expect(hello.setName).toBeUndefined();
    expect(hello.msg).not.toBe('isdbgrid');
    expect(hello.isWritablePrimary).toBe(true);
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: configService.get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: userModel.db.host,
      authInfo: auth.authInfo,
    });
    expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(configService.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(process.env.AI_FEEDBACK_REAL_ENABLED).toBe('false');
    expect(configService.get('MAIL_PROVIDER')).toBe('log');
    console.info(
      'Trajectory database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
    );
    await expectEmptyDatabase('before fixtures');
    fixtureAuthorized = true;

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const teacher = await userModel.create({
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    teacherId = teacher._id.toString();
    const studentA = await userModel.create({
      email: studentAEmail,
      passwordHash: studentAHash,
      roles: ['student'],
      name: studentAName,
      studentNo: studentANo,
    });
    studentAId = studentA._id.toString();
    const studentB = await userModel.create({
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
      name: studentBName,
      studentNo: studentBNo,
    });
    studentBId = studentB._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      if (!fixtureAuthorized) return;
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
      const results = await Promise.allSettled(cleanup);
      const failedCount = results.filter(
        (result) => result.status === 'rejected',
      ).length;
      await expectEmptyDatabase('after scoped cleanup');
      if (failedCount > 0) {
        throw new Error(
          `Trajectory scoped fixture cleanup failed: ${failedCount}`,
        );
      }
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        if (environmentOverridden) {
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
          if (previousSubmissionCooldownMs === undefined) {
            delete process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
          } else {
            process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS =
              previousSubmissionCooldownMs;
          }
        }
      }
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

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

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
      { maxTimeMS: 5000 },
    );
    expect(createdAtPatchResult.matchedCount).toBe(1);
    expect(createdAtPatchResult.modifiedCount).toBe(1);
    const patchedSubmission = await submissionModel.collection.findOne<{
      createdAt?: Date;
      submittedAt?: Date;
    }>(
      { _id: firstSubmissionObjectId },
      { projection: { createdAt: 1, submittedAt: 1 }, maxTimeMS: 5000 },
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
        expectedRevision: secondSubmissionBody.contentRevision,
        reason: 'Need second attempt feedback for trajectory',
      })
      .expect(200);

    let hasSucceeded = false;
    for (let index = 0; index < 10; index += 1) {
      const foreignJobs = await aiFeedbackJobModel
        .countDocuments({
          status: {
            $in: [
              AiFeedbackJobStatus.Pending,
              AiFeedbackJobStatus.Failed,
              AiFeedbackJobStatus.Running,
            ],
          },
          submissionId: {
            $nin: submissionIds.map((id) => new Types.ObjectId(id)),
          },
        })
        .maxTimeMS(5000);
      expect(foreignJobs).toBe(0);
      await aiFeedbackProcessor.processOnce(10);
      const trajectory = await fetchTrajectory('7d');
      const studentAItem = trajectory.items.find(
        (item) => item.studentId === studentAId,
      );
      const succeeded = !!studentAItem?.attempts.some(
        (attempt) =>
          attempt.submissionId === secondSubmissionBody.id &&
          attempt.aiFeedbackStatus === 'SUCCEEDED',
      );
      if (succeeded) {
        hasSucceeded = true;
        break;
      }
      await waitMs(80);
    }
    expect(hasSucceeded).toBe(true);

    await feedbackModel.insertMany([
      {
        submissionId: new Types.ObjectId(secondSubmissionBody.id),
        source: FeedbackSource.Teacher,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Info,
        message: `Trajectory teacher feedback ${Date.now()}`,
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
    expect(studentAItem).not.toHaveProperty('studentName');
    expect(studentAItem?.student).toEqual({
      id: studentAId,
      name: studentAName,
      studentNo: studentANo,
      email: studentAEmail.toLowerCase(),
    });
    expect(studentBItem).not.toHaveProperty('studentName');
    expect(studentBItem?.student).toEqual({
      id: studentBId,
      name: studentBName,
      studentNo: studentBNo,
      email: studentBEmail.toLowerCase(),
    });
    expect(studentAItem?.attemptsCount).toBe(3);
    expect(studentBItem?.attemptsCount).toBe(0);
    expect(typeof studentAItem?.trend.errorCountFirst).toBe('number');
    expect(typeof studentAItem?.trend.errorCountLatest).toBe('number');
    expect(JSON.stringify(trajectoryAll)).not.toContain('passwordHash');
    const secondAttempt = studentAItem?.attempts.find(
      (attempt) => attempt.submissionId === secondSubmissionBody.id,
    );
    const thirdAttempt = studentAItem?.attempts.find(
      (attempt) => attempt.submissionId === thirdSubmissionBody.id,
    );
    expect(secondAttempt).toBeDefined();
    expect(thirdAttempt).toBeDefined();
    expect(secondAttempt?.feedbackSummary.totalItems).toBeGreaterThan(0);
    expect(secondAttempt?.feedbackCount).toBeGreaterThan(
      secondAttempt?.feedbackSummary.totalItems ?? 0,
    );
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
  });
});
