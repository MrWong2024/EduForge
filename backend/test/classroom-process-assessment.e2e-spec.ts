import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import {
  assertAuthTestWritesConfirmed,
  runAuthTestWrite,
} from './helpers/auth-test-writes';
import { createFixtureUser } from './helpers/create-fixture-user';
import { deleteFixtureRows } from './helpers/delete-fixture-rows';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  Model,
  STATES,
  Types,
  type AggregateOptions,
  type Connection,
  type PipelineStage,
  type mongo,
} from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { parseCsv } from '../scripts/import-users-csv';
import { AppModule } from '../src/app.module';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  getClassroomTaskTransactionModel,
  runClassroomTaskTransaction,
} from '../src/lib/classroom-task-transaction';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
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

jest.setTimeout(30000);

const readFixtureOptions = () => ({
  maxTimeMS: 5000,
  signal: AbortSignal.timeout(5000),
});

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
type ProcessAssessmentResponse = {
  window: string;
  rubric: {
    submittedTasksRate: number;
    submissionsCount: number;
    aiRequestQualityProxy: number;
    codeQualityProxy: number;
  };
  total: number;
  items: Array<{
    studentId: string;
    studentName: string;
    studentNo: string | null;
    submittedTasksCount: number;
    submissionsCount: number;
    iteratedTasksCount: number;
    aiRequestedCount: number;
    aiSucceededCount: number;
    aiRequestedTasksCount: number;
    aiSucceededTasksCount: number;
    avgWarnItems: number;
    avgErrorItems: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    topTags: Array<{ tag: string; count: number }>;
  }>;
};

describe('Classroom Process Assessment (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection | undefined;
  let transactionConnection: Connection;
  let independentConnection: Connection | undefined;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let resetTokenModel: Model<PasswordResetToken>;
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

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let courseId = '';
  let classroomId = '';
  let emptyClassroomId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  let taskAId = '';
  let taskBId = '';
  const submissionIds: string[] = [];
  const addedStudentIds: Types.ObjectId[] = [];
  const overlapFixtures = {
    courses: [] as string[],
    classrooms: [] as string[],
    tasks: [] as string[],
    classroomTasks: [] as string[],
  };

  const namespace = `pa-csv-${randomUUID()}`;
  const teacherEmail = `${namespace}.teacher@example.invalid`;
  const studentAEmail = `${namespace}.student-a@example.invalid`;
  const studentBEmail = `${namespace}.student-b@example.invalid`;
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
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

    connection = await openAuthTestConnection({ budgetModelReads: true });
    independentConnection = await openAuthTestConnection();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();

    app = moduleFixture.createNestApplication();
    transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    const defaultConnection = app.get<Connection>(getConnectionToken());
    const gates = [
      defaultConnection,
      transactionConnection,
      independentConnection,
    ];
    expect(new Set(gates.map((item) => item.getClient())).size).toBe(3);
    for (const gatedConnection of gates) {
      await assertAuthTestConnection(gatedConnection);
      const db = gatedConnection.db;
      if (!db) throw new Error('Process assessment test requires MongoDB.');
      const session = await gatedConnection.startSession();
      try {
        session.startTransaction({
          readPreference: 'primary',
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', wtimeoutMS: 5000 },
          maxCommitTimeMS: 5000,
        });
        await db
          .collection('classrooms')
          .findOne(
            { _id: new Types.ObjectId() },
            { session, ...readFixtureOptions() },
          );
        await session.commitTransaction();
      } finally {
        await session.endSession();
      }
    }
    console.info('Process assessment DB gate', {
      default: defaultConnection.db?.databaseName,
      transaction: transactionConnection.db?.databaseName,
      independent: independentConnection.db?.databaseName,
      snapshot: 'committed on all connections',
    });
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
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

    teacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    resetTokenModel = app.get(getModelToken(PasswordResetToken.name));
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

    teacherId = new Types.ObjectId().toString();
    studentAId = new Types.ObjectId().toString();
    studentBId = new Types.ObjectId().toString();
    const defaults = {
      credentialVersion: 0,
      passwordResetRequestedAt: null,
      status: UserStatus.Active,
    };
    for (const fixture of [
      {
        _id: new Types.ObjectId(teacherId),
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      },
      {
        _id: new Types.ObjectId(studentAId),
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
        name: '学生甲',
        studentNo: 'S-A-001',
      },
      {
        _id: new Types.ObjectId(studentBId),
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
        name: '   ',
      },
    ]) {
      await createFixtureUser(userModel, { ...defaults, ...fixture });
    }

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        if (independentConnection?.db && teacherId) {
          await assertAuthTestConnection(independentConnection);
          const db = independentConnection.db;
          assertAuthTestWritesConfirmed(db);

          const objectIds = (...ids: string[]) =>
            ids.filter(Boolean).map((id) => new Types.ObjectId(id));
          const classroomIds = objectIds(
            classroomId,
            emptyClassroomId,
            ...overlapFixtures.classrooms,
          );
          const userIds = [
            ...objectIds(teacherId, studentAId, studentBId),
            ...addedStudentIds,
          ];
          const submissionObjectIds = objectIds(...submissionIds);
          const targets: Array<[string, mongo.Document]> = [
            [
              feedbackModel.collection.name,
              { submissionId: { $in: submissionObjectIds } },
            ],
            [
              aiFeedbackJobModel.collection.name,
              { submissionId: { $in: submissionObjectIds } },
            ],
            [
              submissionModel.collection.name,
              { _id: { $in: submissionObjectIds } },
            ],
            [
              classroomTaskModel.collection.name,
              {
                _id: {
                  $in: objectIds(
                    classroomTaskAId,
                    classroomTaskBId,
                    ...overlapFixtures.classroomTasks,
                  ),
                },
              },
            ],
            [
              taskModel.collection.name,
              {
                _id: {
                  $in: objectIds(taskAId, taskBId, ...overlapFixtures.tasks),
                },
              },
            ],
            [
              enrollmentModel.collection.name,
              { classroomId: { $in: classroomIds }, userId: { $in: userIds } },
            ],
            [classroomModel.collection.name, { _id: { $in: classroomIds } }],
            [
              courseModel.collection.name,
              { _id: { $in: objectIds(courseId, ...overlapFixtures.courses) } },
            ],
            [sessionModel.collection.name, { userId: { $in: userIds } }],
            [resetTokenModel.collection.name, { userId: { $in: userIds } }],
            [userModel.collection.name, { _id: { $in: userIds } }],
          ];

          for (const [collectionName, filter] of targets) {
            const collection = db.collection(collectionName);
            const rows = await collection
              .find(filter, { projection: { _id: 1 }, ...readFixtureOptions() })
              .toArray();
            if (rows.length) {
              await deleteFixtureRows(
                db,
                collectionName,
                { _id: { $in: rows.map(({ _id }) => _id) } },
                0,
              );
            }
            expect(
              await collection.countDocuments(filter, readFixtureOptions()),
            ).toBe(0);
          }
          console.info(
            'Process assessment fixture cleanup verified zero residual.',
          );
        }
      } finally {
        try {
          if (connection && connection.readyState !== STATES.disconnected)
            await connection.close();
        } finally {
          try {
            await independentConnection?.close();
          } finally {
            authTestEnvironment.restore();
          }
        }
      }
    }
  });

  it('returns process-assessment panel and csv export', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `PACLS${Date.now()}`,
        name: 'Process Assessment Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Process-Assessment-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const [createdTaskA, createdTaskB] = await Promise.all([
      teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Process Task A',
          description: 'Task A for process assessment.',
          knowledgeModule: 'process-assessment',
          status: 'DRAFT',
        })
        .expect(201),
      teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Process Task B',
          description: 'Task B for process assessment.',
          knowledgeModule: 'process-assessment',
          status: 'DRAFT',
        })
        .expect(201),
    ]);
    taskAId = (createdTaskA.body as CreatedTaskResponse).id;
    taskBId = (createdTaskB.body as CreatedTaskResponse).id;

    await Promise.all([
      teacherAgent
        .post(`/api/learning-tasks/tasks/${taskAId}/publish`)
        .send({})
        .expect(201),
      teacherAgent
        .post(`/api/learning-tasks/tasks/${taskBId}/publish`)
        .send({})
        .expect(201),
    ]);

    const [createdClassroomTaskA, createdClassroomTaskB] = await Promise.all([
      teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({
          taskId: taskAId,
        })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({
          taskId: taskBId,
        })
        .expect(201),
    ]);
    classroomTaskAId = (
      createdClassroomTaskA.body as CreatedClassroomTaskResponse
    ).id;
    classroomTaskBId = (
      createdClassroomTaskB.body as CreatedClassroomTaskResponse
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

    const [submissionA1, submissionA2] = await Promise.all([
      studentAAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskAId}/submissions`,
        )
        .send({
          content: {
            codeText: 'function paA1() { return 1; }',
            language: 'typescript',
          },
        })
        .expect(201),
      studentAAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskBId}/submissions`,
        )
        .send({
          content: {
            codeText: 'function paB1() { return 2; }',
            language: 'typescript',
          },
        })
        .expect(201),
    ]);
    const submissionA1Body = submissionA1.body as CreatedSubmissionResponse;
    const submissionA2Body = submissionA2.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA1Body.id, submissionA2Body.id);
    await studentAAgent
      .post(
        '/api/learning-tasks/submissions/' +
          submissionA1Body.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: submissionA1Body.contentRevision })
      .expect(200);
    await studentAAgent
      .post(
        '/api/learning-tasks/submissions/' +
          submissionA2Body.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: submissionA2Body.contentRevision })
      .expect(200);

    const submissionA3 = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function paA2() { return 3; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA3Body = submissionA3.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA3Body.id);
    expect(submissionA3Body.attemptNo).toBe(2);
    expect(submissionA3Body.aiFeedbackStatus).toBe('NOT_REQUESTED');

    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${submissionA3Body.id}/ai-feedback/request`,
      )
      .send({
        expectedRevision: 0,
        reason: 'Need process assessment proxy data on attempt 2',
      })
      .expect(200);

    const foreignJob = await aiFeedbackJobModel
      .exists({
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
      })
      .setOptions(readFixtureOptions());
    if (foreignJob)
      throw new Error('Process assessment requires a fixture-only AI queue.');
    for (let index = 0; index < 8; index += 1) {
      await aiFeedbackProcessor.processOnce(20);
      await waitMs(70);
    }

    const processAssessment = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({
        page: 1,
        limit: 50,
        sort: 'score',
        order: 'desc',
      })
      .expect(200);
    const body = processAssessment.body as ProcessAssessmentResponse;
    expect(body.window).toBe('all');
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.rubric).toEqual({
      submittedTasksRate: 0.45,
      submissionsCount: 0.15,
      aiRequestQualityProxy: 0.2,
      codeQualityProxy: 0.2,
    });
    const studentAItem = body.items.find(
      (item) => item.studentId === studentAId,
    );
    const studentBItem = body.items.find(
      (item) => item.studentId === studentBId,
    );
    expect(studentAItem).toBeDefined();
    expect(studentBItem).toBeDefined();
    expect(studentAItem?.studentName).toBe('学生甲');
    expect(studentAItem?.studentNo).toBe('S-A-001');
    expect(studentBItem?.studentName).toBe('未知学生');
    expect(studentBItem?.studentNo).toBeNull();
    expect(
      (studentAItem?.submittedTasksCount ?? 0) >
        (studentBItem?.submittedTasksCount ?? 0) ||
        (studentAItem?.score ?? 0) >= (studentBItem?.score ?? 0),
    ).toBe(true);

    const explicitAllProcessAssessment = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({
        window: 'all',
        page: 1,
        limit: 50,
        sort: 'score',
        order: 'desc',
      })
      .expect(200);
    const explicitAllBody =
      explicitAllProcessAssessment.body as ProcessAssessmentResponse;
    expect(explicitAllBody.window).toBe('all');
    expect(explicitAllBody.total).toBe(body.total);
    expect(explicitAllBody.items).toEqual(body.items);

    const csvResponse = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment.csv`)
      .query({ window: 'all' })
      .expect(200);
    const contentType = String(csvResponse.headers['content-type'] ?? '');
    expect(contentType).toContain('text/csv');
    const csvText = csvResponse.text ?? '';
    expect(csvText).toContain(
      'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,aiRequestedTasksCount,aiSucceededTasksCount,avgWarnItems,avgErrorItems,topTags',
    );
    expect(csvText).toContain('学生甲');
    expect(csvText).toContain('S-A-001');
    expect(csvText).toContain(studentAId);
    expect(csvText).not.toContain('codeText');
    const [header, ...rows] = parseCsv(csvText);
    expect(rows).toHaveLength(body.items.length);
    const idColumn = header.cells.indexOf('studentId');
    const csvStudentIds = rows.map(({ cells }) => cells[idColumn]);
    expect(csvStudentIds.sort()).toEqual(
      body.items.map((item) => item.studentId).sort(),
    );
  });

  it('rejects invalid process-assessment window', async () => {
    await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({ window: 'not-supported' })
      .expect(400);
  });

  it('exports all 101 active students with scope=all while retaining legacy pagination', async () => {
    const db = connection?.db;
    if (!db) throw new Error('Process assessment test requires MongoDB.');
    const insertOwned = async (
      collection: string,
      documents: Array<mongo.Document & { _id: Types.ObjectId }>,
    ) => {
      const inserted = await runAuthTestWrite(
        db,
        { insert: collection, documents },
        {
          collection,
          filter: { _id: { $in: documents.map(({ _id }) => _id) } },
        },
      );
      expect(inserted.n).toBe(documents.length);
    };

    // The original class has two active members. These IDs sort after both of them.
    const activeIds = Array.from({ length: 99 }, () => new Types.ObjectId());
    const removedId = new Types.ObjectId();
    addedStudentIds.push(...activeIds, removedId);
    const stableIds = [studentAId, studentBId, ...activeIds.map(String)].sort();
    const finalPageStudentId = activeIds[activeIds.length - 1];
    expect(stableIds[100]).toBe(finalPageStudentId.toString());
    const now = new Date();
    const timestamps = { createdAt: now, updatedAt: now };
    const passwordHash = await bcrypt.hash(studentPassword, 10);
    await insertOwned(
      userModel.collection.name,
      addedStudentIds.map((_id, index) => ({
        _id,
        email: `${namespace}.bulk-${index}@example.invalid`,
        roles: ['student'],
        status: UserStatus.Active,
        passwordHash,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
        ...timestamps,
      })),
    );
    await insertOwned(
      enrollmentModel.collection.name,
      addedStudentIds.map((userId) => ({
        _id: new Types.ObjectId(),
        classroomId: new Types.ObjectId(classroomId),
        userId,
        role: EnrollmentRole.Student,
        status: userId.equals(removedId)
          ? EnrollmentStatus.Removed
          : EnrollmentStatus.Active,
        joinedAt: now,
        ...timestamps,
      })),
    );

    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const finalPageSubmissions = [
      {
        classroomTaskId: classroomTaskAId,
        taskId: taskAId,
        attemptNo: 1,
        createdAt: old,
      },
      {
        classroomTaskId: classroomTaskAId,
        taskId: taskAId,
        attemptNo: 2,
        createdAt: old,
      },
      {
        classroomTaskId: classroomTaskAId,
        taskId: taskAId,
        attemptNo: 3,
        createdAt: now,
      },
      {
        classroomTaskId: classroomTaskBId,
        taskId: taskBId,
        attemptNo: 1,
        createdAt: now,
      },
    ].map(({ classroomTaskId, taskId, attemptNo, createdAt }) => ({
      _id: new Types.ObjectId(),
      classroomTaskId: new Types.ObjectId(classroomTaskId),
      taskId: new Types.ObjectId(taskId),
      studentId: finalPageStudentId,
      attemptNo,
      createdAt,
      submittedAt: createdAt,
      updatedAt: createdAt,
      content: { codeText: 'const csvScope = true;', language: 'typescript' },
      contentRevision: 0,
      isLate: false,
      lateBySeconds: 0,
      status: SubmissionStatus.Submitted,
    }));
    submissionIds.push(
      ...finalPageSubmissions.map(({ _id }) => _id.toString()),
    );
    await insertOwned(submissionModel.collection.name, finalPageSubmissions);

    const jsonPath = `/api/classrooms/${classroomId}/process-assessment`;
    const csvPath = `${jsonPath}.csv`;
    const httpTimeout = { response: 10000, deadline: 15000 };
    const getCsv = async (query: Record<string, string | number>) => {
      const response = await teacherAgent
        .get(csvPath)
        .query(query)
        .timeout(httpTimeout)
        .expect(200);
      const [header, ...records] = parseCsv(response.text);
      const column = (name: string) => header.cells.indexOf(name);
      return {
        header: header.cells,
        rows: records.map(({ cells }) => ({
          studentId: cells[column('studentId')],
          submissionsCount: Number(cells[column('submissionsCount')]),
          submittedTasksRate: Number(cells[column('submittedTasksRate')]),
        })),
      };
    };
    const lastId = finalPageStudentId.toString();
    const idsOf = (rows: Array<{ studentId: string }>) =>
      rows.map(({ studentId }) => studentId);
    const all = await getCsv({
      scope: 'all',
      sort: 'submissionsCount',
      order: 'desc',
    });
    const allIds = idsOf(all.rows);
    expect([...allIds].sort()).toEqual(stableIds);
    expect(new Set(allIds).size).toBe(101);
    expect(allIds).not.toContain(removedId.toString());
    expect(allIds).toEqual([
      lastId,
      studentAId,
      ...stableIds.filter((id) => id !== lastId && id !== studentAId),
    ]);
    expect(all.rows[0]).toEqual({
      studentId: lastId,
      submissionsCount: 4,
      submittedTasksRate: 1,
    });
    expect(all.rows.find(({ studentId }) => studentId === studentBId)).toEqual({
      studentId: studentBId,
      submissionsCount: 0,
      submittedTasksRate: 0,
    });

    const defaultPage = await getCsv({ window: 'all' });
    expect(idsOf(defaultPage.rows).sort()).toEqual(stableIds.slice(0, 50));
    const secondPage = await getCsv({ page: 2, limit: 100 });
    expect(idsOf(secondPage.rows)).toEqual([lastId]);

    const filtered = await getCsv({
      scope: 'all',
      window: '7d',
      excludedTaskIds: classroomTaskBId,
      sort: 'submissionsCount',
      order: 'asc',
    });
    // Two old A attempts and the recent B attempt leave one recent A submission.
    expect(filtered.rows.slice(-2)).toEqual([
      { studentId: lastId, submissionsCount: 1, submittedTasksRate: 1 },
      { studentId: studentAId, submissionsCount: 2, submittedTasksRate: 1 },
    ]);
    expect(idsOf(filtered.rows).sort()).toEqual(stableIds);

    for (const query of [
      { scope: 'all', page: 1 },
      { scope: 'all', limit: 50 },
      { scope: 'page' },
      { limit: 101 },
    ]) {
      await teacherAgent
        .get(csvPath)
        .query(query)
        .timeout(httpTimeout)
        .expect(400);
    }
    await teacherAgent
      .get(jsonPath)
      .query({ scope: 'all' })
      .timeout(httpTimeout)
      .expect(400);

    const empty = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Process-Assessment-Empty-CSV-Classroom',
      })
      .timeout(httpTimeout)
      .expect(201);
    emptyClassroomId = (empty.body as CreatedClassroomResponse).id;
    const emptyCsv = await teacherAgent
      .get(`/api/classrooms/${emptyClassroomId}/process-assessment.csv`)
      .query({ scope: 'all' })
      .timeout(httpTimeout)
      .expect(200);
    expect(parseCsv(emptyCsv.text).map(({ cells }) => cells)).toEqual([
      all.header,
    ]);

    console.info('Process assessment CSV scope verified', {
      all: all.rows.length,
      defaultPage: defaultPage.rows.length,
      secondPage: secondPage.rows.length,
      allIdsMatch: true,
    });
  });

  it('33A keeps JSON and CSV on one read point during AI completion', async () => {
    const db = independentConnection?.db;
    if (!independentConnection || !db) {
      throw new Error('Process assessment requires an independent connection.');
    }
    const httpTimeout = { response: 10000, deadline: 15000 };
    const courseResponse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `PASYNC${Date.now()}`,
        name: 'Process assessment concurrency',
        term: '2026-Spring',
      })
      .timeout(httpTimeout)
      .expect(201);
    const course = (courseResponse.body as CreatedCourseResponse).id;
    overlapFixtures.courses.push(course);
    const classroomResponse = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId: course, name: 'Process assessment read point' })
      .timeout(httpTimeout)
      .expect(201);
    const classroom = classroomResponse.body as CreatedClassroomResponse;
    overlapFixtures.classrooms.push(classroom.id);
    const taskResponse = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Process assessment read point',
        description: 'Single timely submission with an in-flight AI job.',
        knowledgeModule: 'process-assessment',
        status: 'DRAFT',
      })
      .timeout(httpTimeout)
      .expect(201);
    const task = (taskResponse.body as CreatedTaskResponse).id;
    overlapFixtures.tasks.push(task);
    await teacherAgent
      .post(`/api/learning-tasks/tasks/${task}/publish`)
      .send({})
      .timeout(httpTimeout)
      .expect(201);
    const classroomTaskResponse = await teacherAgent
      .post(`/api/classrooms/${classroom.id}/tasks`)
      .send({ taskId: task })
      .timeout(httpTimeout)
      .expect(201);
    const classroomTask = (
      classroomTaskResponse.body as CreatedClassroomTaskResponse
    ).id;
    overlapFixtures.classroomTasks.push(classroomTask);
    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroom.joinCode })
      .timeout(httpTimeout)
      .expect(201);
    const submitted = await studentAAgent
      .post(
        `/api/classrooms/${classroom.id}/tasks/${classroomTask}/submissions`,
      )
      .send({ content: { codeText: 'return 1;', language: 'typescript' } })
      .timeout(httpTimeout)
      .expect(201);
    const submission = submitted.body as CreatedSubmissionResponse;
    submissionIds.push(submission.id);
    expect(submission.attemptNo).toBe(1);
    const submissionId = new Types.ObjectId(submission.id);
    const lockOwner = 'process-assessment-read-point';
    const job = await aiFeedbackJobModel.create({
      submissionId,
      taskId: new Types.ObjectId(task),
      classroomTaskId: new Types.ObjectId(classroomTask),
      studentId: new Types.ObjectId(studentAId),
      status: AiFeedbackJobStatus.Running,
      attempts: 1,
      maxAttempts: 3,
      lockOwner,
      lockedAt: new Date(),
      provider: 'bailian',
      budgetVersion: 1,
    });
    const feedbackFilter = { submissionId, source: FeedbackSource.AI };
    const tag = 'process-read-point';
    const readStored = async () => {
      const primary = {
        ...readFixtureOptions(),
        readPreference: 'primary',
      } as const;
      const stored = await db
        .collection<Submission>(submissionModel.collection.name)
        .findOne({ _id: submissionId }, primary);
      const storedJob = await db
        .collection<AiFeedbackJob>(aiFeedbackJobModel.collection.name)
        .findOne({ _id: job._id }, primary);
      const feedback = await db
        .collection<Feedback>(feedbackModel.collection.name)
        .find(feedbackFilter, primary)
        .toArray();
      return {
        studentId: stored?.studentId.toString(),
        isLate: stored?.isLate,
        attempts: storedJob?.attempts,
        status: storedJob?.status,
        feedback: feedback.map(({ severity, tags }) => ({ severity, tags })),
      };
    };
    const beforeStored = await readStored();
    expect(beforeStored).toEqual({
      studentId: studentAId,
      isLate: false,
      attempts: 1,
      status: 'RUNNING',
      feedback: [],
    });

    const jsonPath = `/api/classrooms/${classroom.id}/process-assessment`;
    const getJson = async () => {
      const response = await teacherAgent
        .get(jsonPath)
        .timeout(httpTimeout)
        .expect(200);
      const { items } = response.body as ProcessAssessmentResponse;
      expect(items).toHaveLength(1);
      const {
        studentId,
        aiSucceededTasksCount,
        avgErrorItems,
        score,
        riskLevel,
        topTags,
      } = items[0];
      return {
        studentId,
        aiSucceededTasksCount,
        avgErrorItems,
        score,
        riskLevel,
        topTags,
      };
    };
    const getCsv = async () => {
      const response = await teacherAgent
        .get(`${jsonPath}.csv`)
        .timeout(httpTimeout)
        .expect(200);
      const [header, ...rows] = parseCsv(response.text);
      expect(rows).toHaveLength(1);
      const value = (name: string) => rows[0].cells[header.cells.indexOf(name)];
      return {
        studentId: value('studentId'),
        aiSucceededTasksCount: Number(value('aiSucceededTasksCount')),
        avgErrorItems: Number(value('avgErrorItems')),
        score: Number(value('score')),
        riskLevel: value('riskLevel'),
        topTags: value('topTags'),
      };
    };
    const before = {
      studentId: studentAId,
      aiSucceededTasksCount: 0,
      avgErrorItems: 0,
      score: 94,
      riskLevel: 'LOW',
    };
    expect(await getJson()).toEqual({ ...before, topTags: [] });
    expect(await getCsv()).toEqual({ ...before, topTags: '' });

    let reportJobReads!: () => void;
    const ready = new Promise<void>((resolve) => (reportJobReads = resolve));
    let releaseFeedback!: () => void;
    const released = new Promise<void>(
      (resolve) => (releaseFeedback = resolve),
    );
    const jobReads: number[] = [];
    const feedbackReads: number[] = [];
    const observe = <T>(
      model: Model<T>,
      run: (exec: () => Promise<unknown[]>) => Promise<unknown[]>,
    ) => {
      const aggregate = model.aggregate.bind(model) as typeof model.aggregate;
      return jest
        .spyOn(model, 'aggregate')
        .mockImplementation(
          (pipeline?: PipelineStage[], options?: AggregateOptions) => {
            const query = aggregate<unknown>(pipeline, options);
            const first = pipeline?.[0];
            if (!first || !('$match' in first)) return query;
            const match: unknown = first.$match.submissionId;
            if (
              !match ||
              typeof match !== 'object' ||
              !('$in' in match) ||
              !Array.isArray(match.$in) ||
              !match.$in.some(
                (id: unknown) =>
                  id instanceof Types.ObjectId && id.equals(submissionId),
              )
            )
              return query;
            const exec = query.exec.bind(query) as typeof query.exec;
            jest.spyOn(query, 'exec').mockImplementationOnce(() => run(exec));
            return query;
          },
        );
    };
    const recordJob = async (execute: () => Promise<unknown[]>) => {
      const rows = (await execute()) as Array<{
        aiSucceededTasksCount: number;
      }>;
      expect(rows).toHaveLength(1);
      jobReads.push(rows[0].aiSucceededTasksCount);
      if (jobReads.length === 2) reportJobReads();
      return rows;
    };
    const holdFeedback = async (execute: () => Promise<unknown[]>) => {
      await released;
      const rows = (await execute()) as Array<{
        totals: Array<{ totalErrorItems: number }>;
      }>;
      feedbackReads.push(rows[0]?.totals[0]?.totalErrorItems ?? 0);
      return rows;
    };
    const spies = [
      observe(aiFeedbackJobModel, recordJob),
      observe(feedbackModel, holdFeedback),
      observe(
        getClassroomTaskTransactionModel(
          transactionConnection,
          aiFeedbackJobModel,
        ),
        recordJob,
      ),
      observe(
        getClassroomTaskTransactionModel(transactionConnection, feedbackModel),
        holdFeedback,
      ),
    ];
    const pendingJson = getJson();
    const pendingCsv = getCsv();
    const pending = Promise.all([pendingJson, pendingCsv]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('33A Job reads did not finish')),
        5000,
      );
    });
    const during = await (async () => {
      try {
        await Promise.race([
          ready,
          deadline,
          pending.then(() => {
            throw new Error(
              '33A reported before the feedback read was released',
            );
          }),
        ]);
        expect(jobReads).toEqual([0, 0]);
        expect(feedbackReads).toHaveLength(0);
        await runClassroomTaskTransaction(
          independentConnection,
          async (transaction) => {
            const result = await transaction
              .model(aiFeedbackJobModel)
              .updateOne(
                {
                  _id: job._id,
                  status: AiFeedbackJobStatus.Running,
                  attempts: 1,
                  lockOwner,
                },
                {
                  $set: { status: AiFeedbackJobStatus.Succeeded },
                  $unset: { lockOwner: 1, lockedAt: 1 },
                },
                { session: transaction.session, ...transaction.readOptions() },
              )
              .exec();
            expect(result.modifiedCount).toBe(1);
            const inserted = await transaction.model(feedbackModel).insertMany(
              [
                {
                  ...feedbackFilter,
                  type: FeedbackType.Bug,
                  severity: FeedbackSeverity.Error,
                  message: 'First independently committed AI feedback',
                  tags: [tag],
                },
              ],
              { session: transaction.session, ordered: true },
            );
            expect(inserted).toHaveLength(1);
          },
        );
        releaseFeedback();
        return await pending;
      } finally {
        clearTimeout(timer);
        releaseFeedback();
        await Promise.allSettled([pendingJson, pendingCsv]);
        spies.forEach((spy) => spy.mockRestore());
      }
    })();

    const afterStored = await readStored();
    const next = [await getJson(), await getCsv()];
    console.info('33A process assessment controlled interleave', {
      jobReads,
      feedbackReads,
      during: { json: during[0], csv: during[1] },
      next: { json: next[0], csv: next[1] },
      beforeStored,
      afterStored,
    });
    const after = {
      studentId: studentAId,
      aiSucceededTasksCount: 1,
      avgErrorItems: 1,
      score: 88,
      riskLevel: 'MEDIUM',
    };
    expect(afterStored).toEqual({
      ...beforeStored,
      status: 'SUCCEEDED',
      feedback: [{ severity: 'ERROR', tags: [tag] }],
    });
    expect(next).toEqual([
      { ...after, topTags: [{ tag, count: 1 }] },
      { ...after, topTags: `${tag}:1` },
    ]);
    expect(during).toEqual([
      { ...before, topTags: [] },
      { ...before, topTags: '' },
    ]);
    expect(feedbackReads).toEqual([0, 0]);
  });
});
