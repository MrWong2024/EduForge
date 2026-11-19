import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type mongo, STATES, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SubmissionSchema } from '../src/modules/learning-tasks/schemas/submission.schema';
import { hashPassword } from '../src/modules/users/password.utils';
import {
  User,
  UserSchema,
  UserStatus,
} from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);
const namespace = `submission-cooldown-${randomUUID()}`;
const teacherId = new Types.ObjectId();
const studentId = new Types.ObjectId();
const otherStudentId = new Types.ObjectId();
const studentIds = [studentId, otherStudentId];
const accounts = [
  {
    id: teacherId,
    email: `${namespace}.teacher@example.invalid`,
    role: 'teacher',
  },
  {
    id: studentId,
    email: `${namespace}.student@example.invalid`,
    role: 'student',
  },
  {
    id: otherStudentId,
    email: `${namespace}.other@example.invalid`,
    role: 'student',
  },
];
// Dedicated synthetic application credential, unrelated to real accounts.
const password = 'SubmissionCooldown123!';
const httpTimeout = { response: 10000, deadline: 15000 };
const positiveCooldownMs = 300000;
type Agent = ReturnType<typeof request.agent>;
type Row = {
  _id: Types.ObjectId;
  createdBy?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  courseId?: Types.ObjectId;
  classroomId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  classroomTaskId?: Types.ObjectId;
  submissionId?: Types.ObjectId;
  studentId?: Types.ObjectId;
  userId?: Types.ObjectId;
  email?: string;
  roles?: string[];
  status?: string;
};
type SubmissionRow = Row & {
  classroomTaskId: Types.ObjectId;
  studentId: Types.ObjectId;
  taskId: Types.ObjectId;
  attemptNo: number;
  contentRevision: number;
  content: { codeText: string; language: string };
  submittedAt: Date;
  isLate: boolean;
  lateBySeconds: number;
};
type SubmissionResponse = {
  id: string;
  attemptNo: number;
  contentRevision: number;
  content: { codeText: string };
  submittedAt: string;
  aiFeedbackStatus: string;
};
type CooldownResponse = {
  statusCode: number;
  timestamp: string;
  path: string;
  code: string;
  message: string;
  cooldownMs: number;
  cooldownSeconds: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
};
type Instance = {
  classroomId: string;
  classroomTaskId: string;
  taskId: string;
};
type IndexRow = {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  partialFilterExpression?: unknown;
  [field: string]: unknown;
};

describe('Classroom task submission cooldown (real HTTP and Mongo)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let db: mongo.Db | undefined;
  let httpServer: Server | undefined;
  let config: ConfigService;
  let teacher: Agent;
  let student: Agent;
  let otherStudent: Agent;
  let courseId = '';
  let mainClassroomId = '';
  let otherClassroomId = '';
  function database(): mongo.Db {
    if (!db) throw new Error('COOLDOWN_DATABASE_REQUIRED');
    return db;
  }
  const rows = (
    name: string,
    filter: mongo.Filter<Row>,
    projection?: mongo.FindOptions['projection'],
  ) =>
    database()
      .collection<Row>(name)
      .find(filter, { projection, maxTimeMS: 5000 })
      .sort({ _id: 1 })
      .toArray();
  const post = (agent: Agent, path: string, body: Record<string, unknown>) =>
    agent.post(path).timeout(httpTimeout).send(body);
  const submissionPath = (instance: Instance) =>
    `/api/classrooms/${instance.classroomId}/tasks/${instance.classroomTaskId}/submissions`;
  const submit = (instance: Instance, codeText: string, agent = student) =>
    post(agent, submissionPath(instance), {
      content: { codeText, language: 'typescript' },
    });
  const storedSubmissions = (instance: Instance, id = studentId) =>
    database()
      .collection<SubmissionRow>('submissions')
      .find(
        {
          classroomTaskId: new Types.ObjectId(instance.classroomTaskId),
          studentId: id,
        },
        { maxTimeMS: 5000 },
      )
      .sort({ attemptNo: 1 })
      .toArray();
  async function noJobs(): Promise<void> {
    expect(
      await database()
        .collection('aifeedbackjobs')
        .countDocuments(
          { studentId: { $in: studentIds } },
          { maxTimeMS: 5000 },
        ),
    ).toBe(0);
  }
  async function overlap(
    instance: Instance,
    codes: readonly [string, string],
  ): Promise<request.Response[]> {
    // Normal overlapping HTTP; await both terminal results before any assertion/cleanup.
    const results = await Promise.allSettled(
      codes.map((code) => submit(instance, code)),
    );
    return results.map((result) => {
      if (result.status !== 'fulfilled')
        throw new Error('COOLDOWN_OVERLAPPING_HTTP_FAILED');
      return result.value;
    });
  }
  function assertSuccess(
    response: request.Response,
    codeText: string,
    stored: SubmissionRow[],
  ): void {
    expect(response.status).toBe(201);
    const body = response.body as SubmissionResponse;
    const row = stored.find((value) => value._id.toHexString() === body.id);
    if (!row) throw new Error('COOLDOWN_COMMITTED_SUBMISSION_MISSING');
    expect(body.attemptNo).toBe(row.attemptNo);
    expect(body.contentRevision).toBe(0);
    expect(row.contentRevision).toBe(0);
    expect(body.content.codeText).toBe(codeText);
    expect(row.content.codeText).toBe(codeText);
    expect(body.submittedAt).toBe(row.submittedAt.toISOString());
    expect(body.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(row.isLate).toBe(false);
    expect(row.lateBySeconds).toBe(0);
  }
  function assertError(
    response: request.Response,
    status: number,
    code: string,
    path: string,
    extra: string[] = [],
  ): Record<string, unknown> {
    expect(response.status).toBe(status);
    const body = response.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['statusCode', 'timestamp', 'path', 'message', 'code', ...extra].sort(),
    );
    expect(body.statusCode).toBe(status);
    expect(body.code).toBe(code);
    expect(body.path).toBe(path);
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.message).toBe('string');
    return body;
  }
  function assertCooldown(
    response: request.Response,
    instance: Instance,
  ): void {
    const body = assertError(
      response,
      429,
      'SUBMISSION_COOLDOWN_ACTIVE',
      submissionPath(instance),
      ['cooldownMs', 'cooldownSeconds', 'retryAfterMs', 'retryAfterSeconds'],
    ) as CooldownResponse;
    for (const key of [
      'cooldownMs',
      'cooldownSeconds',
      'retryAfterMs',
      'retryAfterSeconds',
    ] as const) {
      expect(Number.isSafeInteger(body[key])).toBe(true);
      expect(body[key]).toBeGreaterThan(0);
    }
    expect(body.cooldownMs).toBe(positiveCooldownMs);
    expect(body.retryAfterMs).toBeLessThanOrEqual(body.cooldownMs);
    expect(body.cooldownSeconds).toBe(Math.ceil(body.cooldownMs / 1000));
    expect(body.retryAfterSeconds).toBe(Math.ceil(body.retryAfterMs / 1000));
    expect(body.message).toBe(
      `提交过于频繁。当前设置的提交冷却时间为 ${body.cooldownSeconds} 秒，请约 ${body.retryAfterSeconds} 秒后再试。`,
    );
  }
  function logReadings(
    stage: string,
    responses: request.Response[],
    stored: SubmissionRow[],
  ): void {
    console.info(
      JSON.stringify({
        stage,
        statuses: responses.map(({ status }) => status),
        documents: stored.length,
        attempts: stored.map(({ attemptNo }) => attemptNo),
        errors: responses
          .filter(({ status }) => status !== 201)
          .map((response) => {
            const body = response.body as Partial<CooldownResponse>;
            return {
              status: response.status,
              code: body.code,
              message: body.message,
              cooldownMs: body.cooldownMs,
              cooldownSeconds: body.cooldownSeconds,
              retryAfterMs: body.retryAfterMs,
              retryAfterSeconds: body.retryAfterSeconds,
            };
          }),
      }),
    );
  }
  async function createTemplate(key: string): Promise<string> {
    const response = await post(teacher, '/api/learning-tasks/tasks', {
      title: `${namespace}-${key}`,
      description: 'Submission cooldown fixture.',
      knowledgeModule: 'submission-cooldown',
      status: 'DRAFT',
    }).expect(201);
    const id = (response.body as { id: string }).id;
    expect(Types.ObjectId.isValid(id)).toBe(true);
    await post(teacher, `/api/learning-tasks/tasks/${id}/publish`, {}).expect(
      201,
    );
    return id;
  }
  async function publish(
    taskId: string,
    classroomId = mainClassroomId,
    extra: Record<string, unknown> = {},
  ): Promise<Instance> {
    const response = await post(
      teacher,
      `/api/classrooms/${classroomId}/tasks`,
      { taskId, ...extra },
    ).expect(201);
    const classroomTaskId = (response.body as { id: string }).id;
    expect(Types.ObjectId.isValid(classroomTaskId)).toBe(true);
    return { taskId, classroomId, classroomTaskId };
  }
  const freshInstance = async (key: string) =>
    publish(await createTemplate(key));
  async function prepareSubmissionIndex(): Promise<void> {
    const key = { classroomTaskId: 1, studentId: 1, attemptNo: 1 } as const;
    const partialFilterExpression = { classroomTaskId: { $type: 'objectId' } };
    const indexName = 'classroomTaskId_1_studentId_1_attemptNo_1';
    const definition = SubmissionSchema.indexes().find(([actual]) =>
      isDeepStrictEqual(Object.entries(actual), Object.entries(key)),
    );
    if (
      !definition ||
      definition[1].unique !== true ||
      !isDeepStrictEqual(
        definition[1].partialFilterExpression,
        partialFilterExpression,
      )
    )
      throw new Error('COOLDOWN_SUBMISSION_SCHEMA_INDEX_MISMATCH');
    async function readIndex(): Promise<IndexRow | undefined> {
      const cursor = database().runCursorCommand(
        { listIndexes: 'submissions', cursor: {}, includeBuildUUIDs: true },
        { timeoutMS: 5000, timeoutMode: 'cursorLifetime' },
      );
      let indexes: IndexRow[];
      try {
        indexes = (await cursor.toArray()) as IndexRow[];
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 26
        )
          return undefined;
        throw new Error('COOLDOWN_SUBMISSION_INDEX_READ_FAILED', {
          cause: error,
        });
      } finally {
        await cursor.close();
      }
      if (
        indexes.some(
          (index) =>
            'buildUUID' in index ||
            'indexBuildInfo' in index ||
            index.ready === false,
        )
      )
        throw new Error('COOLDOWN_INDEX_BUILD_IN_PROGRESS');
      const candidates = indexes.filter(
        (index) =>
          index.name === indexName ||
          isDeepStrictEqual(
            Object.keys(index.key).sort(),
            Object.keys(key).sort(),
          ),
      );
      if (candidates.length === 0) return undefined;
      const index = candidates[0];
      const objectIdPartial =
        isDeepStrictEqual(index.partialFilterExpression, {
          classroomTaskId: { $type: 'objectId' },
        }) ||
        isDeepStrictEqual(index.partialFilterExpression, {
          classroomTaskId: { $type: 7 },
        });
      if (
        candidates.length !== 1 ||
        !isDeepStrictEqual(Object.entries(index.key), Object.entries(key)) ||
        index.unique !== true ||
        !objectIdPartial ||
        index.sparse === true ||
        index.hidden === true ||
        index.expireAfterSeconds !== undefined ||
        index.collation !== undefined
      )
        throw new Error('COOLDOWN_SUBMISSION_INDEX_CONFLICT');
      return index;
    }
    let created = false;
    if (!(await readIndex())) {
      for (const entry of await database()
        .listCollections({}, { nameOnly: true })
        .toArray()) {
        if (
          entry.type === 'collection' &&
          (await database()
            .collection(entry.name)
            .countDocuments({}, { limit: 1, maxTimeMS: 5000 }))
        )
          throw new Error(
            'COOLDOWN_INDEX_PREPARATION_REQUIRES_EMPTY_TEST_COLLECTIONS',
          );
      }
      if (!(await readIndex())) {
        await database().collection('submissions').createIndex(key, {
          name: indexName,
          unique: true,
          partialFilterExpression,
          timeoutMS: 10000,
        });
        created = true;
      }
    }
    const actual = await readIndex();
    if (!actual) throw new Error('COOLDOWN_SUBMISSION_INDEX_MISSING');
    console.info(
      JSON.stringify({
        stage: 'submission-index',
        created,
        name: actual.name,
        key: Object.entries(actual.key),
        unique: actual.unique,
        objectIdPartial: true,
      }),
    );
  }
  beforeAll(async () => {
    console.info(
      `Cooldown fixture: ${namespace}; user IDs: ${accounts.map(({ id }) => id.toHexString()).join(',')}`,
    );
    await prepareAuthSessionIndexes();
    connection = await openAuthTestConnection();
    db = connection.db;
    if (!db) throw new Error('COOLDOWN_DATABASE_REQUIRED');
    await prepareSubmissionIndex();
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
    config = app.get(ConfigService);
    const passwordHash = await hashPassword(password);
    for (const account of accounts)
      await connection.model(User.name, UserSchema).create({
        _id: account.id,
        email: account.email,
        roles: [account.role],
        status: UserStatus.Active,
        passwordHash,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
      });
    httpServer = app.getHttpServer() as Server;
    teacher = request.agent(httpServer);
    student = request.agent(httpServer);
    otherStudent = request.agent(httpServer);
    for (const [index, agent] of [teacher, student, otherStudent].entries())
      await post(agent, '/api/auth/login', {
        email: accounts[index].email,
        password,
      }).expect(201);
    const createdCourse = await post(teacher, '/api/courses', {
      code: namespace,
      name: namespace,
      term: 'current',
    }).expect(201);
    courseId = (createdCourse.body as { id: string }).id;
    expect(Types.ObjectId.isValid(courseId)).toBe(true);
    for (const key of ['main', 'other']) {
      const response = await post(teacher, '/api/classrooms', {
        courseId,
        name: `${namespace}-${key}`,
      }).expect(201);
      const classroom = response.body as { id: string; joinCode: string };
      expect(Types.ObjectId.isValid(classroom.id)).toBe(true);
      if (key === 'main') mainClassroomId = classroom.id;
      else otherClassroomId = classroom.id;
      await post(student, '/api/classrooms/join', {
        joinCode: classroom.joinCode,
      }).expect(201);
      if (key === 'main')
        await post(otherStudent, '/api/classrooms/join', {
          joinCode: classroom.joinCode,
        }).expect(201);
    }
    const memberships = await rows('enrollments', {
      userId: { $in: studentIds },
    });
    expect(memberships).toHaveLength(3);
    expect(memberships.every(({ status }) => status === 'ACTIVE')).toBe(true);
  });

  afterAll(async () => {
    try {
      if (connection && db) {
        await assertAuthTestConnection(connection);
        const userIds = accounts.map(({ id }) => id);
        const userFilter = {
          $or: [
            { _id: { $in: userIds } },
            { email: { $in: accounts.map(({ email }) => email) } },
          ],
        };
        const userRows = await rows('users', userFilter, {
          _id: 1,
          email: 1,
          roles: 1,
        });
        if (
          userRows.some(
            (row) =>
              !accounts.some(
                (account) =>
                  account.id.equals(row._id) &&
                  account.email === row.email &&
                  row.roles?.length === 1 &&
                  row.roles[0] === account.role,
              ),
          )
        )
          throw new Error('COOLDOWN_USER_OWNERSHIP_MISMATCH');
        const courses = await rows('courses', { createdBy: teacherId });
        const classrooms = await rows('classrooms', { teacherId });
        const tasks = await rows('tasks', { createdBy: teacherId });
        const courseIds = courses.map(({ _id }) => _id);
        const classroomIds = classrooms.map(({ _id }) => _id);
        const taskIds = tasks.map(({ _id }) => _id);
        if (
          classrooms.some(
            (row) => !courseIds.some((id) => id.equals(row.courseId)),
          )
        )
          throw new Error('COOLDOWN_CLASSROOM_OWNERSHIP_MISMATCH');
        const taskFilter = {
          $or: [
            { createdBy: teacherId },
            { classroomId: { $in: classroomIds } },
            { taskId: { $in: taskIds } },
          ],
        };
        const instances = await rows('classroomtasks', taskFilter);
        if (
          instances.some(
            (row) =>
              !row.createdBy?.equals(teacherId) ||
              !classroomIds.some((id) => id.equals(row.classroomId)) ||
              !taskIds.some((id) => id.equals(row.taskId)),
          )
        )
          throw new Error('COOLDOWN_INSTANCE_OWNERSHIP_MISMATCH');
        const instanceIds = instances.map(({ _id }) => _id);
        const submissionFilter = {
          $or: [
            { studentId: { $in: studentIds } },
            { classroomTaskId: { $in: instanceIds } },
            { taskId: { $in: taskIds } },
          ],
        };
        const submissions = await rows('submissions', submissionFilter);
        if (
          submissions.some(
            (row) =>
              !studentIds.some((id) => id.equals(row.studentId)) ||
              !instances.some(
                (instance) =>
                  instance._id.equals(row.classroomTaskId) &&
                  instance.taskId?.equals(row.taskId),
              ),
          )
        )
          throw new Error('COOLDOWN_SUBMISSION_OWNERSHIP_MISMATCH');
        const submissionIds = submissions.map(({ _id }) => _id);
        const jobFilter = {
          $or: [
            { studentId: { $in: studentIds } },
            { submissionId: { $in: submissionIds } },
            { classroomTaskId: { $in: instanceIds } },
          ],
        };
        const jobs = await rows('aifeedbackjobs', jobFilter, {
          _id: 1,
          studentId: 1,
          submissionId: 1,
          classroomTaskId: 1,
          taskId: 1,
        });
        if (
          jobs.some(
            (row) =>
              !studentIds.some((id) => id.equals(row.studentId)) ||
              !submissions.some(
                (submission) =>
                  submission._id.equals(row.submissionId) &&
                  submission.classroomTaskId?.equals(row.classroomTaskId) &&
                  submission.taskId?.equals(row.taskId),
              ),
          )
        )
          throw new Error('COOLDOWN_JOB_OWNERSHIP_MISMATCH');
        const feedbackFilter = { submissionId: { $in: submissionIds } };
        const feedback = await rows('feedbacks', feedbackFilter, {
          _id: 1,
          submissionId: 1,
        });
        const enrollmentFilter = {
          $or: [
            { userId: { $in: studentIds } },
            { classroomId: { $in: classroomIds } },
          ],
        };
        const memberships = await rows('enrollments', enrollmentFilter);
        if (
          memberships.some(
            (row) =>
              !studentIds.some((id) => id.equals(row.userId)) ||
              !classroomIds.some((id) => id.equals(row.classroomId)),
          )
        )
          throw new Error('COOLDOWN_ENROLLMENT_OWNERSHIP_MISMATCH');
        const resets = await rows(
          'passwordresettokens',
          { userId: { $in: userIds } },
          { _id: 1, userId: 1, email: 1 },
        );
        if (
          resets.some(
            (row) =>
              !accounts.some(
                (account) =>
                  account.id.equals(row.userId) && account.email === row.email,
              ),
          )
        )
          throw new Error('COOLDOWN_RESET_OWNERSHIP_MISMATCH');
        // All discoveries above are restricted to registered users and verified
        // ownership links, including records whose create response was lost.
        for (const row of feedback)
          await db
            .collection('feedbacks')
            .deleteOne(
              { _id: row._id, submissionId: row.submissionId },
              { timeoutMS: 5000 },
            );
        for (const row of jobs)
          await db
            .collection('aifeedbackjobs')
            .deleteOne(
              { _id: row._id, studentId: row.studentId },
              { timeoutMS: 5000 },
            );
        for (const row of submissions)
          await db.collection('submissions').deleteOne(
            {
              _id: row._id,
              studentId: row.studentId,
              classroomTaskId: row.classroomTaskId,
            },
            { timeoutMS: 5000 },
          );
        for (const row of instances)
          await db.collection('classroomtasks').deleteOne(
            {
              _id: row._id,
              createdBy: teacherId,
              classroomId: row.classroomId,
              taskId: row.taskId,
            },
            { timeoutMS: 5000 },
          );
        for (const row of tasks)
          await db
            .collection('tasks')
            .deleteOne(
              { _id: row._id, createdBy: teacherId },
              { timeoutMS: 5000 },
            );
        for (const row of memberships)
          await db.collection('enrollments').deleteOne(
            {
              _id: row._id,
              userId: row.userId,
              classroomId: row.classroomId,
            },
            { timeoutMS: 5000 },
          );
        for (const row of classrooms)
          await db
            .collection('classrooms')
            .deleteOne(
              { _id: row._id, teacherId, courseId: row.courseId },
              { timeoutMS: 5000 },
            );
        for (const row of courses)
          await db
            .collection('courses')
            .deleteOne(
              { _id: row._id, createdBy: teacherId },
              { timeoutMS: 5000 },
            );
        await db
          .collection('sessions')
          .deleteMany({ userId: { $in: userIds } }, { timeoutMS: 5000 });
        for (const account of accounts) {
          await db
            .collection('passwordresettokens')
            .deleteMany(
              { userId: account.id, email: account.email },
              { timeoutMS: 5000 },
            );
          await db
            .collection('users')
            .deleteOne(
              { _id: account.id, email: account.email, roles: [account.role] },
              { timeoutMS: 5000 },
            );
        }
        const residual = await Promise.all([
          db
            .collection('feedbacks')
            .countDocuments(feedbackFilter, { maxTimeMS: 5000 }),
          db
            .collection('aifeedbackjobs')
            .countDocuments(jobFilter, { maxTimeMS: 5000 }),
          db
            .collection('submissions')
            .countDocuments(submissionFilter, { maxTimeMS: 5000 }),
          db
            .collection('classroomtasks')
            .countDocuments(taskFilter, { maxTimeMS: 5000 }),
          db
            .collection('tasks')
            .countDocuments({ createdBy: teacherId }, { maxTimeMS: 5000 }),
          db
            .collection('enrollments')
            .countDocuments(enrollmentFilter, { maxTimeMS: 5000 }),
          db
            .collection('classrooms')
            .countDocuments({ teacherId }, { maxTimeMS: 5000 }),
          db
            .collection('courses')
            .countDocuments({ createdBy: teacherId }, { maxTimeMS: 5000 }),
          db
            .collection('sessions')
            .countDocuments({ userId: { $in: userIds } }, { maxTimeMS: 5000 }),
          db
            .collection('passwordresettokens')
            .countDocuments({ userId: { $in: userIds } }, { maxTimeMS: 5000 }),
          db
            .collection('users')
            .countDocuments(userFilter, { maxTimeMS: 5000 }),
        ]);
        expect(residual).toEqual(Array<number>(11).fill(0));
        console.info(
          'Cooldown fixture residual: all 11 scoped collections = 0.',
        );
      }
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        try {
          if (connection && connection.readyState !== STATES.disconnected)
            await connection.close();
          if (connection)
            expect(connection.readyState).toBe(STATES.disconnected);
          if (httpServer) expect(httpServer.listening).toBe(false);
          console.info(
            'Cooldown cleanup: Mongo disconnected; HTTP server closed or not started.',
          );
        } finally {
          authTestEnvironment.restore();
        }
      }
    }
  });

  it('allows exactly one normal overlapping submission during a positive cooldown', async () => {
    expect(config.get<number>('LEARNING_TASK_SUBMISSION_COOLDOWN_MS')).toBe(
      positiveCooldownMs,
    );
    const instance = await freshInstance('positive-overlap');
    const codes = ['const positiveA = 1;', 'const positiveB = 2;'] as const;
    const responses = await overlap(instance, codes);
    const stored = await storedSubmissions(instance);
    logReadings('positive-overlap', responses, stored);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 429]);
    expect(stored).toHaveLength(1);
    expect(stored[0].attemptNo).toBe(1);
    responses.forEach((response, index) => {
      if (response.status === 201)
        assertSuccess(response, codes[index], stored);
      else assertCooldown(response, instance);
    });
    await noJobs();
  });
  it('keeps sequential rejection and allocates attempt 2 after the existing fixture is outside the window', async () => {
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', positiveCooldownMs);
    const instance = await freshInstance('sequential');
    const first = await submit(instance, 'const sequentialFirst = 1;');
    const firstRows = await storedSubmissions(instance);
    assertSuccess(first, 'const sequentialFirst = 1;', firstRows);
    expect(firstRows.map(({ attemptNo }) => attemptNo)).toEqual([1]);
    const rejected = await submit(instance, 'const sequentialRejected = 2;');
    const rejectedRows = await storedSubmissions(instance);
    logReadings('sequential-rejection', [rejected], rejectedRows);
    expect(rejectedRows).toEqual(firstRows);
    assertCooldown(rejected, instance);
    // Preserve the prior test's passage-of-window fixture adjustment, limited to
    // this exact committed record, without a five-minute sleep or a global clock.
    const aged = await database()
      .collection('submissions')
      .updateOne(
        {
          _id: firstRows[0]._id,
          classroomTaskId: new Types.ObjectId(instance.classroomTaskId),
          studentId,
        },
        {
          $set: {
            submittedAt: new Date(Date.now() - positiveCooldownMs - 1000),
          },
        },
        { timeoutMS: 5000 },
      );
    expect(aged.matchedCount).toBe(1);
    const next = await submit(instance, 'const sequentialAfterWindow = 3;');
    const stored = await storedSubmissions(instance);
    logReadings('after-window', [next], stored);
    expect(stored.map(({ attemptNo }) => attemptNo)).toEqual([1, 2]);
    assertSuccess(next, 'const sequentialAfterWindow = 3;', stored);
    await noJobs();
  });
  it('allocates distinct attempts to zero-cooldown overlapping submissions and still accepts a consecutive submission', async () => {
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    const instance = await freshInstance('zero-overlap');
    const codes = ['const zeroA = 1;', 'const zeroB = 2;'] as const;
    const responses = await overlap(instance, codes);
    const stored = await storedSubmissions(instance);
    logReadings('zero-overlap', responses, stored);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(stored.map(({ attemptNo }) => attemptNo)).toEqual([1, 2]);
    responses.forEach((response, index) =>
      assertSuccess(response, codes[index], stored),
    );
    const consecutive = await submit(instance, 'const zeroConsecutive = 3;');
    const after = await storedSubmissions(instance);
    expect(after.map(({ attemptNo }) => attemptNo)).toEqual([1, 2, 3]);
    assertSuccess(consecutive, 'const zeroConsecutive = 3;', after);
    await noJobs();
  });
  it('keeps cooldown independent for the same template in another classroom instance and for another student', async () => {
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', positiveCooldownMs);
    const taskId = await createTemplate('scope');
    const main = await publish(taskId),
      other = await publish(taskId, otherClassroomId);
    const first = await submit(main, 'const scopeMain = 1;');
    const elsewhere = await submit(other, 'const scopeOtherClass = 2;');
    const differentStudent = await submit(
      main,
      'const scopeOtherStudent = 3;',
      otherStudent,
    );
    const scopes = [
      await storedSubmissions(main),
      await storedSubmissions(other),
      await storedSubmissions(main, otherStudentId),
    ];
    console.info(
      JSON.stringify({
        stage: 'scope-isolation',
        statuses: [first.status, elsewhere.status, differentStudent.status],
        counts: scopes.map((scope) => scope.length),
        attempts: scopes.map((scope) =>
          scope.map(({ attemptNo }) => attemptNo),
        ),
      }),
    );
    [first, elsewhere, differentStudent].forEach((response, index) =>
      assertSuccess(
        response,
        [
          'const scopeMain = 1;',
          'const scopeOtherClass = 2;',
          'const scopeOtherStudent = 3;',
        ][index],
        scopes[index],
      ),
    );
    expect(
      scopes.map((scope) => scope.map(({ attemptNo }) => attemptNo)),
    ).toEqual([[1], [1], [1]]);
    await noJobs();
  });
  it('returns the formal late-submission 403 and creates no submission for a past-due instance forbidding late work', async () => {
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', positiveCooldownMs);
    const instance = await publish(
      await createTemplate('late'),
      mainClassroomId,
      {
        dueAt: new Date(Date.now() - 60000).toISOString(),
        settings: { allowLate: false },
      },
    );
    const response = await submit(instance, 'const forbiddenLate = 1;');
    const stored = await storedSubmissions(instance);
    logReadings('late-forbidden', [response], stored);
    expect(stored).toEqual([]);
    const body = assertError(
      response,
      403,
      'LATE_SUBMISSION_NOT_ALLOWED',
      submissionPath(instance),
    );
    expect(body.message).toBe(
      'Late submission is not allowed for this classroom task',
    );
  });
  it('projects non-empty course and classroom 409 codes without deleting resources or memberships', async () => {
    const before = await Promise.all([
      rows('courses', { createdBy: teacherId }),
      rows('classrooms', { teacherId }),
      rows('enrollments', { userId: { $in: studentIds } }),
    ]);
    expect(before[1]).toHaveLength(2);
    expect(before[2]).toHaveLength(3);
    const coursePath = `/api/courses/${courseId}`,
      classroomPath = `/api/classrooms/${mainClassroomId}`;
    const courseResponse = await teacher
      .delete(coursePath)
      .timeout(httpTimeout);
    const classroomResponse = await teacher
      .delete(classroomPath)
      .timeout(httpTimeout);
    console.info(
      JSON.stringify({
        stage: 'non-empty-deletions',
        course: {
          status: courseResponse.status,
          code: (courseResponse.body as { code?: string }).code,
        },
        classroom: {
          status: classroomResponse.status,
          code: (classroomResponse.body as { code?: string }).code,
        },
      }),
    );
    const courseBody = assertError(
      courseResponse,
      409,
      'COURSE_NOT_EMPTY',
      coursePath,
    );
    const classroomBody = assertError(
      classroomResponse,
      409,
      'CLASSROOM_NOT_EMPTY',
      classroomPath,
    );
    expect(courseBody.message).toBe('该课程下已有班级记录，不能删除，只能归档');
    expect(classroomBody.message).toBe(
      '该班级已有成员或任务记录，不能删除，只能归档',
    );
    expect(
      await Promise.all([
        rows('courses', { createdBy: teacherId }),
        rows('classrooms', { teacherId }),
        rows('enrollments', { userId: { $in: studentIds } }),
      ]),
    ).toEqual(before);
  });
});
