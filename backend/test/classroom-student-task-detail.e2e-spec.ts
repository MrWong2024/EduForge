import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { ClassroomTasksService } from '../src/modules/classrooms/classroom-tasks/services/classroom-tasks.service';
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
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  runClassroomTaskTransaction,
} from '../src/lib/classroom-task-transaction';
import type {
  CompletionFeedback,
  TaskCompletionStatus,
} from '../src/modules/classrooms/services/student-task-completion-status';

jest.setTimeout(30000);

afterAll(() => authTestEnvironment.restore());

async function withinDeadline<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 7500);
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
type RequestAiFeedbackResponse = {
  submissionId: string;
  jobId: string;
  status: string;
  aiFeedbackStatus: string;
};
type SubmissionDetailItem = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
  feedbackSummary: {
    totalItems: number;
    topTags: Array<{ tag: string; count: number }>;
    severityBreakdown: { INFO: number; WARN: number; ERROR: number };
  };
  feedbackItems?: Array<{
    source: string;
    type: string;
    severity: string;
    message: string;
  }>;
};
type MyTaskDetailResponse = {
  classroom: { id: string; name: string; courseId: string };
  classroomTask: { id: string; classroomId: string; taskId: string };
  task: { id: string; title: string; status: string };
  me: { studentId: string };
  submissions: SubmissionDetailItem[];
  completionStatus: TaskCompletionStatus;
  latest: {
    submissionId: string;
    attemptNo: number;
    aiFeedbackStatus: string;
    feedbackSummary: {
      totalItems: number;
      topTags: Array<{ tag: string; count: number }>;
      severityBreakdown: { INFO: number; WARN: number; ERROR: number };
    };
    feedbackItems?: Array<{
      source: string;
      type: string;
      severity: string;
      message: string;
    }>;
  } | null;
};

describe('Classroom Student Task Detail (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let configService: ConfigService;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;
  let independentConnection: Connection;
  let transactionConnection: Connection;
  let fixtureWritesAllowed = false;
  let teacherId: Types.ObjectId;
  let studentId: Types.ObjectId;

  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  const submissionIds: string[] = [];

  const teacherEmail = `teacher.student.detail.${Date.now()}@example.com`;
  const studentEmail = `student.student.detail.${Date.now()}@example.com`;
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
        expect([200, 201]).toContain(res.status);
      });
  };

  const findAttempt = (items: SubmissionDetailItem[], attemptNo: number) =>
    items.find((item) => item.attemptNo === attemptNo);

  const assertNoForeignJobs = async () => {
    const database = independentConnection.db;
    if (!database) throw new Error('Student task detail test database missing');
    const foreignJobs = await database
      .collection(aiFeedbackJobModel.collection.name)
      .countDocuments(
        {
          submissionId: {
            $nin: submissionIds.map((id) => new Types.ObjectId(id)),
          },
          status: {
            $in: [
              AiFeedbackJobStatus.Pending,
              AiFeedbackJobStatus.Failed,
              AiFeedbackJobStatus.Running,
            ],
          },
        },
        { timeoutMS: 5000, readPreference: 'primary' },
      );
    expect(foreignJobs).toBe(0);
  };
  const processOwned = async () => {
    await assertNoForeignJobs();
    return aiFeedbackProcessor.processOnce(5);
  };

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
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
    userModel = app.get(getModelToken(User.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);
    const defaultConnection = app.get<Connection>(getConnectionToken());
    transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    for (const connection of [
      defaultConnection,
      transactionConnection,
      independentConnection,
    ]) {
      await assertAuthTestConnection(connection);
      expect(connection.getClient().options.readPreference.mode).toBe(
        'primary',
      );
    }
    await runClassroomTaskTransaction(transactionConnection, (transaction) =>
      transaction
        .model(feedbackModel)
        .exists({ _id: new Types.ObjectId() })
        .session(transaction.session)
        .setOptions(transaction.readOptions())
        .exec(),
    );
    await assertNoForeignJobs();
    configService = app.get(ConfigService);
    expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(configService.get<string>('AI_FEEDBACK_PROVIDER')).toBe('stub');
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    console.info('Student task detail DB gates passed', {
      default: defaultConnection.db?.databaseName,
      transaction: transactionConnection.db?.databaseName,
      independent: independentConnection.db?.databaseName,
      readOnlyTransaction: 'committed',
      foreignNonterminalJobs: 0,
    });
    await app.init();

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    teacherId = new Types.ObjectId();
    studentId = new Types.ObjectId();
    fixtureWritesAllowed = true;
    await Promise.all([
      userModel.create({
        _id: teacherId,
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        _id: studentId,
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
    ]);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `STDDETAIL${Date.now()}`,
        name: 'Student Detail Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Student-Detail-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Student Task Detail Task',
        description: 'Verify classroom task detail aggregate.',
        knowledgeModule: 'student-detail',
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

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
  });

  afterAll(async () => {
    const cleanupFixtures = async () => {
      if (!fixtureWritesAllowed) return;
      const database = independentConnection.db;
      if (!database) {
        throw new Error('Student task detail cleanup database missing');
      }
      const ownedIds = (...ids: string[]) => ({
        $in: ids.filter(Boolean).map((id) => new Types.ObjectId(id)),
      });
      const submissions = ownedIds(...submissionIds);
      const accounts = { $in: [teacherId, studentId] };
      const ownedRows = [
        [Feedback.name, { submissionId: submissions }],
        [AiFeedbackJob.name, { submissionId: submissions }],
        [Submission.name, { _id: submissions }],
        [Enrollment.name, { classroomId: ownedIds(classroomId) }],
        [ClassroomTask.name, { _id: ownedIds(classroomTaskId) }],
        [Classroom.name, { _id: ownedIds(classroomId) }],
        [Task.name, { _id: ownedIds(taskId) }],
        [Course.name, { _id: ownedIds(courseId) }],
        [Session.name, { userId: accounts }],
        [PasswordResetToken.name, { userId: accounts }],
        [User.name, { _id: accounts }],
      ] as const;
      const collection = (model: string) =>
        database.collection(
          app.get<Model<unknown>>(getModelToken(model)).collection.name,
        );
      for (const [model, filter] of ownedRows) {
        await collection(model).deleteMany(filter, { timeoutMS: 5000 });
      }
      const residual = await Promise.all(
        ownedRows.map(async ([model, filter]) => [
          model,
          await collection(model).countDocuments(filter, {
            timeoutMS: 5000,
            readPreference: 'primary',
          }),
        ]),
      );
      console.info(
        'Student task detail scoped residual',
        Object.fromEntries(residual),
      );
      expect(residual.map(([, count]) => count)).toEqual(
        Array<number>(ownedRows.length).fill(0),
      );
    };
    try {
      try {
        await app?.close();
      } finally {
        await cleanupFixtures();
      }
    } finally {
      await independentConnection?.close();
    }
  });

  it('aggregates student classroom task detail and reflects Z2 NOT_REQUESTED + manual request lifecycle', async () => {
    const firstSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function firstDetailAttempt() { return "first"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const firstSubmissionBody =
      firstSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(firstSubmissionBody.id);
    expect(firstSubmissionBody.attemptNo).toBe(1);
    expect(firstSubmissionBody.aiFeedbackStatus).toBe('NOT_REQUESTED');
    await studentAgent
      .post(
        '/api/learning-tasks/submissions/' +
          firstSubmissionBody.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: firstSubmissionBody.contentRevision })
      .expect(200);

    await processOwned();

    let firstAttemptStatus = '';
    for (let index = 0; index < 5; index += 1) {
      const detail = await studentAgent
        .get(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
        )
        .query({ includeFeedbackItems: true, feedbackLimit: 5 })
        .expect(200);
      const detailBody = detail.body as MyTaskDetailResponse;
      firstAttemptStatus = detailBody.latest?.aiFeedbackStatus ?? '';
      if (firstAttemptStatus === 'SUCCEEDED') {
        expect(detailBody.submissions.length).toBeGreaterThanOrEqual(1);
        expect(
          detailBody.latest?.feedbackSummary.totalItems ?? 0,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (detailBody.latest?.feedbackSummary.topTags ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        break;
      }
      await processOwned();
      await waitMs(60);
    }
    expect(firstAttemptStatus).toBe('SUCCEEDED');

    const secondSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function secondDetailAttempt() { return "second"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const secondSubmissionBody =
      secondSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(secondSubmissionBody.id);
    expect(secondSubmissionBody.attemptNo).toBe(2);
    expect(secondSubmissionBody.aiFeedbackStatus).toBe('NOT_REQUESTED');

    const detailAfterSecond = await studentAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
      )
      .expect(200);
    const detailAfterSecondBody =
      detailAfterSecond.body as MyTaskDetailResponse;
    const secondAttemptBeforeRequest = findAttempt(
      detailAfterSecondBody.submissions,
      2,
    );
    expect(secondAttemptBeforeRequest).toBeDefined();
    expect(secondAttemptBeforeRequest?.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(secondAttemptBeforeRequest?.feedbackSummary.totalItems).toBe(0);
    expect(secondAttemptBeforeRequest?.feedbackSummary.topTags).toEqual([]);

    const requestResponse = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionBody.id}/ai-feedback/request`,
      )
      .send({
        expectedRevision: 0,
        reason: 'Need ai detail for second attempt',
      })
      .expect(200);
    const requestBody = requestResponse.body as RequestAiFeedbackResponse;
    expect(requestBody.submissionId).toBe(secondSubmissionBody.id);
    expect(requestBody.status).toBe('PENDING');
    expect(requestBody.aiFeedbackStatus).toBe('PENDING');

    const detailAfterRequest = await studentAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
      )
      .expect(200);
    const detailAfterRequestBody =
      detailAfterRequest.body as MyTaskDetailResponse;
    const secondAttemptPending = findAttempt(
      detailAfterRequestBody.submissions,
      2,
    );
    expect(secondAttemptPending?.aiFeedbackStatus).toBe('PENDING');

    await processOwned();

    let secondFinalStatus = '';
    for (let index = 0; index < 5; index += 1) {
      const detail = await studentAgent
        .get(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
        )
        .query({ includeFeedbackItems: true, feedbackLimit: 5 })
        .expect(200);
      const detailBody = detail.body as MyTaskDetailResponse;
      const secondAttempt = findAttempt(detailBody.submissions, 2);
      secondFinalStatus = secondAttempt?.aiFeedbackStatus ?? '';
      if (secondFinalStatus === 'SUCCEEDED') {
        expect(
          secondAttempt?.feedbackSummary.totalItems ?? 0,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (secondAttempt?.feedbackSummary.topTags ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (secondAttempt?.feedbackItems ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        break;
      }
      await processOwned();
      await waitMs(60);
    }
    expect(secondFinalStatus).toBe('SUCCEEDED');
  });

  it('31 keeps latest feedback and completion together across a committed AI result', async () => {
    const created = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'return "latest feedback consistency";',
          language: 'typescript',
        },
      })
      .expect(201);
    const submission = created.body as CreatedSubmissionResponse;
    submissionIds.push(submission.id);
    const requestAi = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submission.id}/ai-feedback/request`,
      )
      .send({ expectedRevision: submission.contentRevision })
      .expect(200);
    const jobId = new Types.ObjectId(
      (requestAi.body as RequestAiFeedbackResponse).jobId,
    );
    const submissionId = new Types.ObjectId(submission.id);
    const claim = {
      _id: jobId,
      submissionId,
      status: AiFeedbackJobStatus.Running,
      attempts: 1,
      lockOwner: 'student-detail-race',
    };
    const initial = await aiFeedbackJobModel
      .updateOne(
        { _id: jobId, submissionId, status: AiFeedbackJobStatus.Pending },
        {
          $set: {
            status: claim.status,
            attempts: claim.attempts,
            lockOwner: claim.lockOwner,
            lockedAt: new Date(),
          },
        },
      )
      .exec();
    expect(initial.matchedCount).toBe(1);
    const feedback = {
      submissionId,
      source: FeedbackSource.AI,
      type: FeedbackType.Design,
      severity: FeedbackSeverity.Error,
      message: 'Handle invalid input before rendering',
      tags: ['correctness'],
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };
    const database = independentConnection.db;
    if (!database) throw new Error('Student task detail verifier missing');
    const jobCollection = database.collection<AiFeedbackJob>(
      aiFeedbackJobModel.collection.name,
    );
    const feedbackCollection = database.collection<Feedback>(
      feedbackModel.collection.name,
    );
    const observe = (detail: MyTaskDetailResponse, phase: string) => {
      const row = detail.submissions.find(({ id }) => id === submission.id);
      const { latest, completionStatus } = detail;
      if (!row || !latest) throw new Error('Latest student submission missing');
      expect(latest.submissionId).toBe(row.id);
      expect(completionStatus.latestSubmissionId).toBe(row.id);
      expect(latest.feedbackSummary).toEqual(row.feedbackSummary);
      expect(latest.feedbackItems).toEqual(row.feedbackItems);
      const sample = {
        submissionId: row.id,
        summary: row.feedbackSummary.totalItems,
        errorCount: row.feedbackSummary.severityBreakdown.ERROR,
        aiFeedbackCount: completionStatus.aiFeedbackCount,
        source: completionStatus.source,
        status: completionStatus.status,
        ...(row.feedbackItems
          ? { previewCount: row.feedbackItems.length }
          : {}),
      };
      console.info('31 student detail evidence', { phase, ...sample });
      return sample;
    };
    const detailUrl = `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`;
    const service = app.get<{
      getFeedbackStatsBySubmissionIds(
        ids: Types.ObjectId[],
        includeTagDetails?: boolean,
        includeAllSourceCounts?: boolean,
      ): Promise<{
        summaryMap: Map<string, SubmissionDetailItem['feedbackSummary']>;
        countMap: Map<string, number>;
      }>;
      getCompletionFeedbacksBySubmissionId(
        id: Types.ObjectId,
      ): Promise<CompletionFeedback[]>;
    }>(ClassroomTasksService);
    const readFeedbackStats = service.getFeedbackStatsBySubmissionIds.bind(
      service,
    ) as typeof service.getFeedbackStatsBySubmissionIds;
    const readCompletion = service.getCompletionFeedbacksBySubmissionId.bind(
      service,
    ) as typeof service.getCompletionFeedbacksBySubmissionId;
    let markRead!: (value: { read: string; aiItems: number }) => void;
    const reached = new Promise<{ read: string; aiItems: number }>(
      (resolve) => {
        markRead = resolve;
      },
    );
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const hold = async (read: string, aiItems: number) => {
      if (held) return;
      held = true;
      markRead({ read, aiItems });
      await withinDeadline(
        released,
        'Student detail feedback release timed out',
      );
    };
    const summarySpy = jest
      .spyOn(service, 'getFeedbackStatsBySubmissionIds')
      .mockImplementation(async (ids, includeTags, includeAllCounts) => {
        const stats = await readFeedbackStats(
          ids,
          includeTags,
          includeAllCounts,
        );
        if (ids.some((id) => id.equals(submissionId))) {
          await hold(
            'summary aggregate',
            stats.summaryMap.get(submission.id)?.totalItems ?? 0,
          );
        }
        return stats;
      });
    const completionSpy = jest
      .spyOn(service, 'getCompletionFeedbacksBySubmissionId')
      .mockImplementation(async (id) => {
        const rows = await readCompletion(id);
        if (id.equals(submissionId)) {
          await hold(
            'latest feedback projection',
            rows.filter(({ source }) => source === FeedbackSource.AI).length,
          );
        }
        return rows;
      });
    const response = studentAgent
      .get(detailUrl)
      .query({ includeFeedbackItems: true, feedbackLimit: 1 })
      .expect(200)
      .then(({ body }) => body as MyTaskDetailResponse);
    void response.catch(() => undefined);
    try {
      const atBarrier = await withinDeadline(
        Promise.race([
          reached,
          response.then(() => {
            throw new Error(
              'Student detail completed before its feedback read barrier',
            );
          }),
        ]),
        'Student detail feedback read did not reach its barrier',
      );
      expect(atBarrier.aiItems).toBe(0);
      expect(
        await feedbackCollection.countDocuments(
          { submissionId },
          { readPreference: 'primary', timeoutMS: 5000 },
        ),
      ).toBe(0);
      expect(
        await jobCollection.findOne(
          { _id: jobId },
          { readPreference: 'primary', timeoutMS: 5000 },
        ),
      ).toMatchObject({ status: AiFeedbackJobStatus.Running, attempts: 1 });
      await runClassroomTaskTransaction(transactionConnection, async (txn) => {
        const result = await txn
          .model(aiFeedbackJobModel)
          .updateOne(
            claim,
            {
              $set: { status: AiFeedbackJobStatus.Succeeded },
              $unset: { lockedAt: '', lockOwner: '' },
            },
            { session: txn.session, ...txn.readOptions() },
          )
          .exec();
        expect(result.matchedCount).toBe(1);
        await txn.model(feedbackModel).insertMany([feedback], {
          session: txn.session,
        });
      });
      const committedJob = await jobCollection.findOne(
        { _id: jobId },
        { readPreference: 'primary', timeoutMS: 5000 },
      );
      const committedFeedback = await feedbackCollection.findOne(
        { submissionId, source: FeedbackSource.AI },
        { readPreference: 'primary', timeoutMS: 5000 },
      );
      expect(committedJob).toMatchObject({
        status: AiFeedbackJobStatus.Succeeded,
        attempts: 1,
      });
      expect(committedFeedback).toMatchObject(feedback);
      console.info('31 feedback read barrier and independent commit', {
        ...atBarrier,
        jobStatus: committedJob?.status,
        feedbackSeverity: committedFeedback?.severity,
      });
    } finally {
      release();
      await response.catch(() => undefined);
      summarySpy.mockRestore();
      completionSpy.mockRestore();
    }

    const during = observe(await response, 'during commit');
    const readDetail = async (feedbackLimit?: number) => {
      const request = studentAgent.get(detailUrl);
      if (feedbackLimit !== undefined) {
        request.query({ includeFeedbackItems: true, feedbackLimit });
      }
      const response = await request.expect(200);
      return response.body as MyTaskDetailResponse;
    };
    const after = observe(await readDetail(1), 'after commit');
    expect(after).toEqual({
      submissionId: submission.id,
      summary: 1,
      errorCount: 1,
      aiFeedbackCount: 1,
      source: FeedbackSource.AI,
      status: 'UNQUALIFIED',
      previewCount: 1,
    });
    expect([
      {
        submissionId: submission.id,
        summary: 0,
        errorCount: 0,
        aiFeedbackCount: 0,
        source: null,
        status: 'NO_FEEDBACK',
        previewCount: 0,
      },
      after,
    ]).toContainEqual(during);

    await feedbackModel.create({
      submissionId,
      source: FeedbackSource.Teacher,
      createdBy: teacherId,
      type: FeedbackType.Other,
      severity: FeedbackSeverity.Info,
      message: 'The submission is sufficient',
    });
    const teacherDetail = await readDetail(1);
    expect(teacherDetail.completionStatus.teacherFeedbackCount).toBe(1);
    expect(observe(teacherDetail, 'teacher INFO and AI ERROR')).toEqual({
      ...after,
      source: FeedbackSource.Teacher,
      status: 'QUALIFIED',
    });
    const newerFeedback = {
      ...feedback,
      severity: FeedbackSeverity.Info,
      message: 'A newer AI observation',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
    };
    await feedbackModel.create(newerFeedback);
    const limited = await readDetail(1);
    const full = await readDetail(5);
    const noPreview = await readDetail();
    expect(
      limited.latest?.feedbackItems?.map(({ severity }) => severity),
    ).toEqual([FeedbackSeverity.Info]);
    expect(full.latest?.feedbackItems?.map(({ severity }) => severity)).toEqual(
      [FeedbackSeverity.Info, FeedbackSeverity.Error],
    );
    const teacherPriority = {
      submissionId: submission.id,
      summary: 2,
      errorCount: 1,
      aiFeedbackCount: 2,
      source: FeedbackSource.Teacher,
      status: 'QUALIFIED',
    };
    expect(observe(limited, 'preview capped at 1')).toEqual({
      ...teacherPriority,
      previewCount: 1,
    });
    expect(observe(full, 'preview capped at 5')).toEqual({
      ...teacherPriority,
      previewCount: 2,
    });
    expect(noPreview.latest?.feedbackItems).toBeUndefined();
    expect(observe(noPreview, 'preview disabled')).toEqual(teacherPriority);
  });
});
