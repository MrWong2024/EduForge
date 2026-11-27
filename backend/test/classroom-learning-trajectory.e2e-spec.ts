import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Aggregate, Connection, Model, Types, type mongo } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { User } from '../src/modules/users/schemas/user.schema';
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

jest.setTimeout(30000);

const httpDeadline = { response: 10000, deadline: 12000 };
const dbOptions = { timeoutMS: 5000 };

async function bounded<T>(work: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  let moduleFixture: TestingModule | undefined;
  let independentConnection: Connection | undefined;
  let fixtureWritesAllowed = false;
  let userModel: Model<User>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let configService: ConfigService;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  const namespace = `trajectory-${randomUUID()}`;
  const teacherObjectId = new Types.ObjectId();
  const studentAObjectId = new Types.ObjectId();
  const studentBObjectId = new Types.ObjectId();
  const studentAId = studentAObjectId.toHexString();
  const studentBId = studentBObjectId.toHexString();

  const teacherEmail = `teacher.${namespace}@example.com`;
  const studentAEmail = `studentA.${namespace}@example.com`;
  const studentBEmail = `studentB.${namespace}@example.com`;
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
      .timeout(httpDeadline)
      .send({ email, password })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected login status ${res.status}`);
        }
      });
  };

  const fetchTrajectory = async (
    classroomId: string,
    classroomTaskId: string,
    window?: '7d' | 'all',
    options?: {
      includeAttempts?: boolean;
      includeTagDetails?: boolean;
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
      .timeout(httpDeadline)
      .query(query)
      .expect(200);
    return response.body as LearningTrajectoryResponse;
  };

  const database = () => {
    const db = independentConnection?.db;
    if (!db) throw new Error('Missing independent trajectory database');
    return db;
  };

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
    moduleFixture = await Test.createTestingModule({
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
    await assertAuthTestConnection(connection);
    const transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(transactionConnection);
    const transactionDb = transactionConnection.db;
    if (!transactionDb)
      throw new Error('Missing trajectory transaction database');
    const session = await transactionConnection.startSession();
    try {
      session.startTransaction({
        readPreference: 'primary',
        maxCommitTimeMS: 5000,
      });
      await transactionDb
        .collection('classrooms')
        .findOne({ _id: new Types.ObjectId() }, { ...dbOptions, session });
      await session.commitTransaction();
    } finally {
      await session.endSession();
    }
    console.info('Trajectory database gates passed', {
      purpose: 'standard_test',
      default: connection.name,
      transaction: transactionConnection.name,
      independent: independentConnection.name,
      committed: true,
    });
    configService = app.get(ConfigService);
    expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    fixtureWritesAllowed = true;
    await userModel.create({
      _id: teacherObjectId,
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    await userModel.create({
      _id: studentAObjectId,
      email: studentAEmail,
      passwordHash: studentAHash,
      roles: ['student'],
      name: studentAName,
      studentNo: studentANo,
    });
    await userModel.create({
      _id: studentBObjectId,
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
      name: studentBName,
      studentNo: studentBNo,
    });

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  async function cleanupFixtures() {
    if (!fixtureWritesAllowed) return;
    const db = database();
    const accountIds = {
      $in: [teacherObjectId, studentAObjectId, studentBObjectId],
    };
    const classFilter = { teacherId: teacherObjectId };
    const ids = async (
      collection: string,
      filter: mongo.Filter<mongo.Document>,
    ) =>
      (
        await db
          .collection(collection)
          .find(filter, {
            ...dbOptions,
            projection: { _id: 1 },
          })
          .toArray()
      ).map(({ _id }) => _id);
    const classroomIds = await ids('classrooms', classFilter);
    const classroomScope = { classroomId: { $in: classroomIds } };
    const submissionScope = {
      classroomTaskId: { $in: await ids('classroomtasks', classroomScope) },
      studentId: accountIds,
    };
    const feedbackScope = {
      submissionId: { $in: await ids('submissions', submissionScope) },
    };
    const owned: [string, mongo.Filter<mongo.Document>][] = [
      ['feedbacks', feedbackScope],
      ['aifeedbackjobs', feedbackScope],
      ['submissions', submissionScope],
      ['enrollments', { ...classroomScope, userId: accountIds }],
      ['classroomtasks', classroomScope],
      ['classrooms', classFilter],
      ['tasks', { createdBy: teacherObjectId }],
      [
        'courses',
        {
          createdBy: teacherObjectId,
          code: { $in: [namespace + '-history', namespace + '-race'] },
        },
      ],
      ['sessions', { userId: accountIds }],
      ['passwordresettokens', { userId: accountIds }],
      ['users', { _id: accountIds }],
    ];
    for (const [collection, filter] of owned) {
      await db.collection(collection).deleteMany(filter, dbOptions);
    }
    const residual: Record<string, number> = {};
    for (const [collection, filter] of owned) {
      residual[collection] = await db
        .collection(collection)
        .countDocuments(filter, dbOptions);
    }
    console.info('Trajectory scoped residual', residual);
    expect(Object.values(residual)).toEqual(
      Array<number>(owned.length).fill(0),
    );
  }

  afterAll(async () => {
    try {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        await cleanupFixtures();
      }
    } finally {
      try {
        await independentConnection?.close();
      } finally {
        authTestEnvironment.restore();
      }
    }
  });

  async function createTrajectoryFixture(
    label: 'history' | 'race',
    students: Array<ReturnType<typeof request.agent>>,
  ) {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .timeout(httpDeadline)
      .send({
        code: namespace + '-' + label,
        name: 'Trajectory Course',
        term: '2026-Spring',
      })
      .expect(201);
    const { id: courseId } = createdCourse.body as CreatedCourseResponse;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .timeout(httpDeadline)
      .send({ courseId, name: 'Trajectory Classroom ' + label })
      .expect(201);
    const { id: classroomId, joinCode } =
      createdClassroom.body as CreatedClassroomResponse;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .timeout(httpDeadline)
      .send({
        title: 'Trajectory Task ' + label,
        description: 'Track attempt evolution.',
        knowledgeModule: 'trajectory',
        status: 'DRAFT',
      })
      .expect(201);
    const { id: taskId } = createdTask.body as CreatedTaskResponse;

    await teacherAgent
      .post('/api/learning-tasks/tasks/' + taskId + '/publish')
      .timeout(httpDeadline)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post('/api/classrooms/' + classroomId + '/tasks')
      .timeout(httpDeadline)
      .send({
        taskId,
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const { id: classroomTaskId } =
      createdClassroomTask.body as CreatedClassroomTaskResponse;

    for (const student of students) {
      await student
        .post('/api/classrooms/join')
        .timeout(httpDeadline)
        .send({ joinCode })
        .expect(201);
    }
    return { classroomId, classroomTaskId };
  }

  it('returns per-student trajectory with attempts, AI statuses and trend summary', async () => {
    const { classroomId, classroomTaskId } = await createTrajectoryFixture(
      'history',
      [studentAAgent, studentBAgent],
    );
    const fetch = (
      window?: '7d' | 'all',
      options?: Parameters<typeof fetchTrajectory>[3],
    ) => fetchTrajectory(classroomId, classroomTaskId, window, options);

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

    const jobWithoutFeedback = (await fetch('7d')).items.find(
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

    const defaultWindowTrajectory = await fetch(undefined);
    expect(defaultWindowTrajectory.window).toBe('all');

    const trajectoryAll = await fetch('all');
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

    const trajectory7d = await fetch('7d');
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
    const studentBSubmissionId = new Types.ObjectId(studentBSubmissionBody.id);
    await feedbackModel.create({
      submissionId: studentBSubmissionId,
      source: FeedbackSource.Teacher,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Error,
      message: 'Only teacher feedback for this attempt',
    });
    const teacherOnly = (await fetch()).items.find(
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
      const sorted = await fetch('all', { sort: 'errorRate', order });
      expect(sorted.items.map((item) => item.studentId)).toEqual([
        studentBId,
        studentAId,
      ]);
      expect(sorted.items[0]?.attemptsCount).toBe(1);
      expect(errorTrend(sorted.items[0])).toEqual([0, 0, null]);
      expect(sorted.items[0]?.attempts[0]).toMatchObject({
        feedbackCount: 2,
        feedbackSummary: {
          totalItems: 1,
          severityBreakdown: { INFO: 1, WARN: 0, ERROR: 0 },
        },
      });
      expect(errorTrend(sorted.items[1])).toEqual([2, null, null]);
    }

    await feedbackModel.create({
      submissionId: new Types.ObjectId(thirdSubmissionBody.id),
      source: FeedbackSource.AI,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Info,
      message: 'Third attempt AI info',
    });
    const withDetails = await fetch('all');
    const withoutDetails = await fetch('all', {
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

    const bothRecent = (await fetch('7d')).items.find(
      (item) => item.studentId === studentAId,
    );
    expect(errorTrend(bothRecent)).toEqual([0, 0, 0]);
  });

  it('33B keeps a first AI feedback and its counts at one read point', async () => {
    const { classroomId, classroomTaskId } = await createTrajectoryFixture(
      'race',
      [studentAAgent],
    );
    const submitted = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .timeout(httpDeadline)
      .send({
        content: { codeText: 'const first = 1;', language: 'typescript' },
      })
      .expect(201);
    const { id } = submitted.body as CreatedSubmissionResponse;
    const submissionId = new Types.ObjectId(id);
    const feedbackId = new Types.ObjectId();
    const tags = ['33b-first-error', '33b-second-tag'];
    const read = (options?: Parameters<typeof fetchTrajectory>[3]) =>
      fetchTrajectory(classroomId, classroomTaskId, 'all', options);
    function target(body: LearningTrajectoryResponse) {
      const student = body.items.find(
        ({ studentId }) => studentId === studentAId,
      );
      expect(student?.attempts).toHaveLength(1);
      const attempt = student?.attempts[0];
      expect(attempt?.submissionId).toBe(id);
      return {
        all: attempt?.feedbackCount,
        ai: attempt?.feedbackSummary.totalItems,
        errors: attempt?.feedbackSummary.severityBreakdown.ERROR,
        tags: attempt?.feedbackSummary.topTags.toSorted((a, b) =>
          a.tag.localeCompare(b.tag),
        ),
        trend: errorTrend(student),
      };
    }
    const empty = {
      all: 0,
      ai: 0,
      errors: 0,
      tags: [],
      trend: [null, null, null],
    };
    expect(target(await read())).toEqual(empty);

    let markRead: (result: unknown) => void = () => undefined;
    let release: () => void = () => undefined;
    const readCompleted = new Promise<unknown>((resolve) => {
      markRead = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const originalExec = Object.getOwnPropertyDescriptor(
      Aggregate.prototype,
      'exec',
    )?.value as (this: Aggregate<unknown>) => Promise<unknown>;
    const spy = jest
      .spyOn(Aggregate.prototype, 'exec')
      .mockImplementation(async function (this: Aggregate<unknown>) {
        const [matchStage, facetOrGroup] = this.pipeline();
        if (
          this.model() !== feedbackModel ||
          !matchStage ||
          !('$match' in matchStage) ||
          !JSON.stringify(matchStage.$match.submissionId)?.includes(id) ||
          !facetOrGroup
        ) {
          return Reflect.apply(originalExec, this, []);
        }

        if (
          '$facet' in facetOrGroup &&
          matchStage.$match.source === FeedbackSource.AI
        ) {
          // Baseline AI-only aggregation must be dispatched after the new feedback commits.
          await bounded(
            released,
            '33B separate AI aggregate missed its release',
          );
          const result: unknown = await Reflect.apply(originalExec, this, []);
          order.push('ai-only-read');
          return result;
        }

        // The all-source count ran before the boundary in the baseline. After
        // the fix the same boundary holds the completed shared facet instead.
        const result: unknown = await Reflect.apply(originalExec, this, []);
        order.push('feedback-read');
        markRead(result);
        await bounded(released, '33B feedback result missed its release');
        return result;
      });
    const inFlight = read();
    void inFlight.catch(() => undefined);
    let completed: LearningTrajectoryResponse;
    let independentFeedbackCount: number;
    try {
      const before = await bounded(readCompleted, '33B feedback was not read');
      expect(before).toEqual(
        Array.isArray(before) && before.length > 0
          ? [expect.objectContaining({ allCounts: [], totals: [] })]
          : [],
      );
      const feedback = database().collection('feedbacks');
      const now = new Date();
      const insert = await feedback.insertOne(
        {
          _id: feedbackId,
          submissionId,
          source: FeedbackSource.AI,
          type: FeedbackType.Style,
          severity: FeedbackSeverity.Error,
          message: 'First AI feedback for trajectory consistency',
          tags,
          createdAt: now,
          updatedAt: now,
        },
        dbOptions,
      );
      expect(insert.acknowledged).toBe(true);
      order.push('feedback-committed');
      const independentRows = await feedback
        .find(
          { submissionId },
          {
            ...dbOptions,
            projection: {
              _id: 1,
              submissionId: 1,
              source: 1,
              severity: 1,
              tags: 1,
            },
          },
        )
        .toArray();
      independentFeedbackCount = independentRows.length;
      expect(independentRows).toEqual([
        {
          _id: feedbackId,
          submissionId,
          source: FeedbackSource.AI,
          severity: FeedbackSeverity.Error,
          tags,
        },
      ]);
      order.push('released');
      release();
      completed = await inFlight;
    } finally {
      release();
      await inFlight.catch(() => undefined);
      spy.mockRestore();
    }

    const during = target(completed);
    const afterResponse = await read();
    const after = target(afterResponse);
    const withFeedback = {
      all: 1,
      ai: 1,
      errors: 1,
      tags: tags.map((tag) => ({ tag, count: 1 })),
      trend: [1, 1, null],
    };
    console.info('33B feedback read boundary and formal HTTP evidence', {
      submissionId: id,
      order,
      during,
      after,
      independentFeedbackCount,
    });
    expect(during).toEqual(empty);
    expect(after).toEqual(withFeedback);
    const afterTrend = afterResponse.items[0]?.trend;
    expect(afterTrend?.topTagsFirst).toEqual(
      expect.arrayContaining(withFeedback.tags),
    );
    expect(afterTrend?.topTagsLatest).toEqual(afterTrend?.topTagsFirst);

    const tagsDisabled = await read({ includeTagDetails: false });
    expect(target(tagsDisabled)).toEqual({ ...withFeedback, tags: [] });
    expect(tagsDisabled.items[0]?.trend).toMatchObject({
      topTagsFirst: [],
      topTagsLatest: [],
    });
    const attemptsDisabled = await read({ includeAttempts: false });
    expect(attemptsDisabled.items[0]?.attempts).toEqual([]);
    expect(errorTrend(attemptsDisabled.items[0])).toEqual(withFeedback.trend);
    const hiddenAttemptTrend = attemptsDisabled.items[0]?.trend;
    expect(hiddenAttemptTrend?.topTagsFirst).toEqual(
      expect.arrayContaining(withFeedback.tags),
    );
    expect(hiddenAttemptTrend?.topTagsLatest).toEqual(
      hiddenAttemptTrend?.topTagsFirst,
    );
  });
});
