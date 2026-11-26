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
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type Model, mongo, STATES, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  getClassroomTaskTransactionModel,
  runClassroomTaskTransaction,
} from '../src/lib/classroom-task-transaction';
import type { ClassroomTaskResponseDto } from '../src/modules/classrooms/classroom-tasks/dto/classroom-task-response.dto';
import type { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import type { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import {
  Classroom,
  ClassroomStatus,
} from '../src/modules/classrooms/schemas/classroom.schema';
import { hashPassword } from '../src/modules/users/password.utils';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);

const namespace = `classroom-lifecycle-${randomUUID()}`;
const accounts = [
  { id: new Types.ObjectId(), name: 'owner', role: 'teacher' },
  { id: new Types.ObjectId(), name: 'other', role: 'teacher' },
  { id: new Types.ObjectId(), name: 'student', role: 'student' },
] as const;
const ownerId = accounts[0].id;
const studentId = accounts[2].id;
const courseId = new Types.ObjectId();
const taskId = new Types.ObjectId();
const password = 'ClassroomLifecycle123!';
const fixtureTime = new Date('2026-01-01T00:00:00.000Z');
const dueAt = '2040-01-01T00:00:00.000Z';
const taskContent = {
  title: namespace,
  description: 'Read the problem and explain the complexity of the solution.',
  knowledgeModule: 'Algorithms',
  rubric: { correctness: { maxScore: 10 } },
};
const httpTimeout = { response: 20000, deadline: 25000 };
const classroomNotEmpty = {
  code: 'CLASSROOM_NOT_EMPTY',
  message: '该班级已有成员或任务记录，不能删除，只能归档',
};
const databaseRead = () => ({
  maxTimeMS: 5000,
  signal: AbortSignal.timeout(5000),
  readPreference: 'primary' as const,
});

type Agent = ReturnType<typeof request.agent>;
type ClassroomRow = Classroom & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v?: number;
  studentIds?: Types.ObjectId[];
};
type EnrollmentRow = Enrollment & { _id: Types.ObjectId };
type TaskRow = ClassroomTask & { _id: Types.ObjectId };
type ChildWriter = 'join' | 'publish';
type ParentWriter = 'delete' | ChildWriter;

function checkpoint() {
  let signal!: () => void;
  const reached = new Promise<void>((resolve) => {
    signal = resolve;
  });
  return { reached, signal };
}

async function waitForCheckpoint(
  reached: Promise<void>,
  http: Promise<request.Response>,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reached,
      http.then(({ status }) => {
        throw new Error(`${label}_MISSING: HTTP ${status}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('Classroom Lifecycle (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let fixtureDb: mongo.Db | undefined;
  let transactionClassroomModel: Model<Classroom>;
  let teacherAgent: Agent;
  let otherTeacherAgent: Agent;
  let studentAgent: Agent;
  const classrooms: ClassroomRow[] = [];
  const emailFor = (account: (typeof accounts)[number]) =>
    `${namespace}.${account.name}@example.invalid`;

  function database() {
    if (!fixtureDb) throw new Error('CLASSROOM_LIFECYCLE_DATABASE_REQUIRED');
    return fixtureDb;
  }

  async function insertFixture(
    collection: string,
    record: mongo.Document & { _id: Types.ObjectId },
  ) {
    await runAuthTestWrite(
      database(),
      { insert: collection, documents: [record] },
      { collection, filter: { _id: record._id } },
    );
  }

  async function createClassroom(
    suffix: string,
    extra: Pick<ClassroomRow, 'studentIds'> = {},
  ) {
    const classroom: ClassroomRow = {
      _id: new Types.ObjectId(),
      courseId,
      name: `${namespace}-${suffix}`,
      teacherId: ownerId,
      joinCode: randomBytes(4).toString('hex').toUpperCase(),
      status: ClassroomStatus.Active,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
      __v: 0,
      ...extra,
    };
    classrooms.push(classroom);
    await insertFixture('classrooms', classroom);
    return classroom;
  }

  const classroomPath = (classroom: ClassroomRow) =>
    `/api/classrooms/${classroom._id.toHexString()}`;
  const remove = (classroom: ClassroomRow) =>
    teacherAgent.delete(classroomPath(classroom)).timeout(httpTimeout);
  const join = (classroom: ClassroomRow) =>
    studentAgent
      .post('/api/classrooms/join')
      .timeout(httpTimeout)
      .send({ joinCode: classroom.joinCode });
  const publish = (classroom: ClassroomRow, agent = teacherAgent) =>
    agent
      .post(`${classroomPath(classroom)}/tasks`)
      .timeout(httpTimeout)
      .send({
        taskId: taskId.toHexString(),
        dueAt,
        settings: { allowLate: false },
      });

  function storedClassroom(classroomId: Types.ObjectId) {
    return database()
      .collection<ClassroomRow>('classrooms')
      .findOne({ _id: classroomId }, databaseRead());
  }

  function storedEnrollments(classroomId: Types.ObjectId) {
    return database()
      .collection<EnrollmentRow>('enrollments')
      .find({ classroomId }, databaseRead())
      .toArray();
  }

  function storedTasks(classroomId: Types.ObjectId) {
    return database()
      .collection<TaskRow>('classroomtasks')
      .find({ classroomId }, databaseRead())
      .toArray();
  }

  async function race(
    classroom: ClassroomRow,
    writer: ChildWriter,
    first: ParentWriter,
  ) {
    const collection: {
      deleteOne: mongo.Collection['deleteOne'];
      findOneAndUpdate(
        filter: mongo.Filter<mongo.Document>,
        update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
        options?: mongo.FindOneAndUpdateOptions,
      ): Promise<mongo.Document | null>;
    } = transactionClassroomModel.collection;
    const deleteOne = collection.deleteOne.bind(
      collection,
    ) as typeof collection.deleteOne;
    const findOneAndUpdate = collection.findOneAndUpdate.bind(
      collection,
    ) as typeof collection.findOneAndUpdate;
    const firstWrite = checkpoint();
    const releaseWrite = checkpoint();
    const writeConflict = checkpoint();
    let winnerSession: mongo.ClientSession | undefined;
    let conflictCode: number | undefined;

    async function observeWrite<Result>(
      kind: ParentWriter,
      id: unknown,
      session: mongo.ClientSession | undefined,
      execute: () => Promise<Result>,
      wrote: (result: Result) => boolean,
    ) {
      if (!(id instanceof Types.ObjectId) || !id.equals(classroom._id))
        return execute();
      if (!session?.inTransaction())
        throw new Error('CLASSROOM_PARENT_WRITE_WITHOUT_TRANSACTION');
      let result: Result;
      try {
        result = await execute();
      } catch (error: unknown) {
        if (
          kind !== first &&
          winnerSession &&
          session !== winnerSession &&
          error instanceof mongo.MongoServerError &&
          error.code === 112
        ) {
          conflictCode = error.code;
          writeConflict.signal();
        }
        throw error;
      }
      if (kind === first && !winnerSession) {
        expect(wrote(result)).toBe(true);
        winnerSession = session;
        firstWrite.signal();
        await releaseWrite.reached;
      }
      return result;
    }

    const deleteSpy = jest
      .spyOn(collection, 'deleteOne')
      .mockImplementation((filter, options) =>
        observeWrite(
          'delete',
          filter?._id,
          options?.session,
          () => deleteOne(filter, options),
          (result) => result.deletedCount === 1,
        ),
      );
    const updateSpy = jest
      .spyOn(collection, 'findOneAndUpdate')
      .mockImplementation((filter, update, options) =>
        observeWrite(
          writer,
          filter._id,
          options?.session,
          () => findOneAndUpdate(filter, update, options),
          (result) => result !== null,
        ),
      );
    const pending: Promise<request.Response>[] = [];
    function send(kind: ParentWriter) {
      const http = (
        kind === 'delete' ? remove : kind === 'join' ? join : publish
      )(classroom).then((response) => response);
      pending.push(http);
      return http;
    }

    try {
      const winner = send(first);
      await waitForCheckpoint(
        firstWrite.reached,
        winner,
        'FIRST_CLASSROOM_WRITE',
      );
      const loser = send(first === 'delete' ? writer : 'delete');
      await waitForCheckpoint(
        writeConflict.reached,
        loser,
        'MONGO_CLASSROOM_WRITE_CONFLICT',
      );
      releaseWrite.signal();
      const [won, lost] = await Promise.all([winner, loser]);
      return first === 'delete'
        ? { deleted: won, posted: lost, conflictCode }
        : { deleted: lost, posted: won, conflictCode };
    } finally {
      releaseWrite.signal();
      try {
        await Promise.allSettled(pending);
      } finally {
        deleteSpy.mockRestore();
        updateSpy.mockRestore();
      }
    }
  }

  beforeAll(async () => {
    connection = await openAuthTestConnection();
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    const transactionConnection = moduleFixture.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(connection);
    await assertAuthTestConnection(transactionConnection);
    const classroomModel = moduleFixture.get<Model<Classroom>>(
      getModelToken(Classroom.name),
    );
    transactionClassroomModel = getClassroomTaskTransactionModel(
      transactionConnection,
      classroomModel,
    );
    await runClassroomTaskTransaction(transactionConnection, (transaction) =>
      transaction
        .model(classroomModel)
        .exists({ _id: new Types.ObjectId() })
        .session(transaction.session)
        .setOptions(transaction.readOptions())
        .exec(),
    );
    const db = connection.db;
    if (!db) throw new Error('CLASSROOM_LIFECYCLE_DATABASE_REQUIRED');
    for (const name of [
      'classrooms',
      'classroomtasks',
      'courses',
      'enrollments',
      'sessions',
      'tasks',
      'users',
    ]) {
      if (
        !(await db
          .listCollections(
            { name },
            {
              nameOnly: true,
              signal: AbortSignal.timeout(5000),
            },
          )
          .hasNext())
      )
        throw new Error(`CLASSROOM_LIFECYCLE_COLLECTION_MISSING: ${name}`);
    }

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    fixtureDb = db;
    console.info(
      JSON.stringify({
        stage: 'classroom-lifecycle-db-gate',
        defaultDatabase: db.databaseName,
        transactionDatabase: transactionConnection.db?.databaseName,
        transactionProbe: 'committed',
        namespace,
      }),
    );
    const users = app.get<Model<User>>(getModelToken(User.name));
    const passwordHash = await hashPassword(password);
    const server = app.getHttpServer() as Server;
    const agents = [
      request.agent(server),
      request.agent(server),
      request.agent(server),
    ];
    [teacherAgent, otherTeacherAgent, studentAgent] = agents;
    for (const [index, account] of accounts.entries()) {
      const email = emailFor(account);
      await createFixtureUser(users, {
        _id: account.id,
        email,
        roles: [account.role],
        status: UserStatus.Active,
        passwordHash,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
      });
      await agents[index]
        .post('/api/auth/login')
        .timeout(httpTimeout)
        .send({ email, password })
        .expect(201);
    }
    await insertFixture('courses', {
      _id: courseId,
      code: namespace,
      name: namespace,
      term: '2026-Autumn',
      status: 'ACTIVE',
      createdBy: ownerId,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    });
    await insertFixture('tasks', {
      _id: taskId,
      ...taskContent,
      status: 'PUBLISHED',
      visibility: 'PRIVATE',
      createdBy: ownerId,
      publishedAt: fixtureTime,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    });
  });

  afterAll(async () => {
    try {
      if (!connection || !fixtureDb) return;
      await assertAuthTestConnection(connection);
      const db = fixtureDb;
      assertAuthTestWritesConfirmed(db);
      const accountIds = accounts.map(({ id }) => id);
      const classroomIds = classrooms.map(({ _id }) => _id);
      const childScope = { classroomId: { $in: classroomIds } };
      const classroomScope = { _id: { $in: classroomIds } };
      const sessionScope = { userId: { $in: accountIds } };
      const usersScope = { _id: { $in: accountIds } };
      const enrollments = await db
        .collection<EnrollmentRow>('enrollments')
        .find(childScope, databaseRead())
        .toArray();
      const tasks = await db
        .collection<TaskRow>('classroomtasks')
        .find(childScope, databaseRead())
        .toArray();
      const parents = await db
        .collection<ClassroomRow>('classrooms')
        .find(classroomScope, databaseRead())
        .toArray();
      if (
        enrollments.some(({ userId }) => !studentId.equals(userId)) ||
        tasks.some(
          (row) =>
            !taskId.equals(row.taskId) ||
            !accounts.some(({ id }) => id.equals(row.createdBy)),
        ) ||
        parents.some(
          (row) =>
            !ownerId.equals(row.teacherId) ||
            !courseId.equals(row.courseId) ||
            !classrooms.some(
              ({ _id, name }) => _id.equals(row._id) && name === row.name,
            ),
        )
      )
        throw new Error('CLASSROOM_LIFECYCLE_FIXTURE_OWNERSHIP_MISMATCH');
      for (const row of enrollments)
        await deleteFixtureRows(db, 'enrollments', {
          _id: row._id,
          classroomId: row.classroomId,
          userId: studentId,
        });
      for (const row of tasks)
        await deleteFixtureRows(db, 'classroomtasks', {
          _id: row._id,
          classroomId: row.classroomId,
          taskId,
          createdBy: row.createdBy,
        });
      for (const row of parents)
        await deleteFixtureRows(db, 'classrooms', {
          _id: row._id,
          name: row.name,
          teacherId: ownerId,
          courseId,
        });
      await deleteFixtureRows(db, 'tasks', {
        _id: taskId,
        title: namespace,
        createdBy: ownerId,
      });
      await deleteFixtureRows(db, 'courses', {
        _id: courseId,
        code: namespace,
        createdBy: ownerId,
      });
      await deleteFixtureRows(db, 'sessions', sessionScope, 0);
      for (const account of accounts)
        await deleteFixtureRows(db, 'users', {
          _id: account.id,
          email: emailFor(account),
        });

      const remaining = {
        enrollments: await db
          .collection('enrollments')
          .countDocuments(childScope, databaseRead()),
        classroomTasks: await db
          .collection('classroomtasks')
          .countDocuments(childScope, databaseRead()),
        classrooms: await db
          .collection('classrooms')
          .countDocuments(classroomScope, databaseRead()),
        tasks: await db
          .collection('tasks')
          .countDocuments({ _id: taskId }, databaseRead()),
        courses: await db
          .collection('courses')
          .countDocuments({ _id: courseId }, databaseRead()),
        sessions: await db
          .collection('sessions')
          .countDocuments(sessionScope, databaseRead()),
        users: await db
          .collection('users')
          .countDocuments(usersScope, databaseRead()),
      };
      const ownResidual = Object.values(remaining).reduce(
        (sum, count) => sum + count,
        0,
      );
      console.info(
        JSON.stringify({
          stage: 'classroom-lifecycle-cleanup',
          namespace,
          remaining,
          ownResidual,
        }),
      );
      expect(ownResidual).toBe(0);
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        try {
          if (connection?.readyState === STATES.connected)
            await connection.close();
        } finally {
          authTestEnvironment.restore();
        }
      }
    }
  });

  it.each([
    ['join', 'delete'],
    ['join', 'join'],
    ['publish', 'delete'],
    ['publish', 'publish'],
  ] as const)('%s vs delete, %s commits first', async (writer, first) => {
    const classroom = await createClassroom(`race-${writer}-${first}`);
    expect(await storedClassroom(classroom._id)).toEqual(classroom);
    expect(await storedEnrollments(classroom._id)).toEqual([]);
    expect(await storedTasks(classroom._id)).toEqual([]);
    const { deleted, posted, conflictCode } = await race(
      classroom,
      writer,
      first,
    );
    const parent = await storedClassroom(classroom._id);
    const enrollments = await storedEnrollments(classroom._id);
    const tasks = await storedTasks(classroom._id);
    expect(conflictCode).toBe(112);

    let receiptMatchesMongo: boolean | null = null;
    let snapshotMatchesMongo: boolean | null = null;
    if (first === 'delete') {
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ ok: true });
      expect(posted.status).toBe(404);
      expect(posted.body).toMatchObject({ message: 'Classroom not found' });
      expect(parent).toBeNull();
      expect(enrollments).toEqual([]);
      expect(tasks).toEqual([]);
    } else {
      expect(deleted.status).toBe(409);
      expect(deleted.body).toMatchObject(classroomNotEmpty);
      expect(posted.status).toBe(201);
      expect(parent).toEqual({ ...classroom, __v: 1 });
      if (writer === 'join') {
        expect(enrollments).toHaveLength(1);
        expect(enrollments[0]).toMatchObject({
          classroomId: classroom._id,
          userId: studentId,
          role: 'STUDENT',
          status: 'ACTIVE',
        });
        expect(enrollments[0].joinedAt).toBeInstanceOf(Date);
        expect(tasks).toEqual([]);
        const receipt = posted.body as { id: string };
        receiptMatchesMongo = receipt.id === parent?._id.toHexString();
      } else {
        expect(enrollments).toEqual([]);
        expect(tasks).toHaveLength(1);
        const receipt = posted.body as ClassroomTaskResponseDto;
        const instance = tasks[0];
        expect(instance).toMatchObject({
          classroomId: classroom._id,
          taskId,
          createdBy: ownerId,
          status: 'ACTIVE',
          dueAt: new Date(dueAt),
          settings: { allowLate: false },
        });
        expect(instance.taskSnapshot).toEqual(taskContent);
        expect(receipt).toMatchObject({
          taskSnapshotAvailable: true,
          task: taskContent,
          dueAt,
          settings: { allowLate: false },
        });
        receiptMatchesMongo =
          receipt.id === instance._id.toHexString() &&
          receipt.classroomId === instance.classroomId.toHexString() &&
          receipt.taskId === instance.taskId.toHexString();
        snapshotMatchesMongo = true;
      }
      expect(receiptMatchesMongo).toBe(true);
    }

    console.info(
      JSON.stringify({
        stage: 'classroom-lifecycle-race',
        writer,
        firstCommit: first,
        mongoWriteConflict: conflictCode,
        deleteStatus: deleted.status,
        deleteCode: (deleted.body as { code?: string }).code ?? null,
        postStatus: posted.status,
        classroomExists: parent !== null,
        enrollments: enrollments.length,
        classroomTasks: tasks.length,
        receiptMatchesMongo,
        classroomUpdatedAtUnchanged: parent
          ? parent.updatedAt.getTime() === classroom.updatedAt.getTime()
          : null,
        snapshotMatchesMongo,
      }),
    );
  });

  it('keeps one enrollment and its joinedAt across repeated join, removal and rejoin', async () => {
    const classroom = await createClassroom('enrollment');
    await join(classroom).expect(201);
    const [initial] = await storedEnrollments(classroom._id);
    expect(initial).toMatchObject({
      classroomId: classroom._id,
      userId: studentId,
      status: 'ACTIVE',
    });
    expect(initial.joinedAt).toBeInstanceOf(Date);
    await join(classroom).expect(201);
    expect(await storedEnrollments(classroom._id)).toMatchObject([
      {
        _id: initial._id,
        joinedAt: initial.joinedAt,
        status: 'ACTIVE',
      },
    ]);
    expect((await remove(classroom).expect(409)).body).toMatchObject(
      classroomNotEmpty,
    );
    await teacherAgent
      .post(
        `${classroomPath(classroom)}/students/${studentId.toHexString()}/remove`,
      )
      .timeout(httpTimeout)
      .send({})
      .expect(201);
    const removed = await storedEnrollments(classroom._id);
    expect(removed).toMatchObject([
      {
        _id: initial._id,
        joinedAt: initial.joinedAt,
        status: 'REMOVED',
      },
    ]);
    expect(removed[0].removedAt).toBeInstanceOf(Date);
    expect((await remove(classroom).expect(409)).body).toMatchObject(
      classroomNotEmpty,
    );
    await join(classroom).expect(201);
    const rejoined = await storedEnrollments(classroom._id);
    expect(rejoined).toMatchObject([
      {
        _id: initial._id,
        joinedAt: initial.joinedAt,
        status: 'ACTIVE',
      },
    ]);
    expect(rejoined[0].removedAt ?? null).toBeNull();
  });

  it('allows deletion with only legacy studentIds', async () => {
    const classroom = await createClassroom('legacy', {
      studentIds: [studentId],
    });
    expect(await storedClassroom(classroom._id)).toEqual(classroom);
    expect(await storedEnrollments(classroom._id)).toEqual([]);
    expect(await storedTasks(classroom._id)).toEqual([]);
    expect((await remove(classroom).expect(200)).body).toEqual({ ok: true });
    expect(await storedClassroom(classroom._id)).toBeNull();
  });

  it('keeps archived and non-owner guards for the parent before any child write', async () => {
    const classroom = await createClassroom('archived');
    expect(
      (await publish(classroom, otherTeacherAgent).expect(404)).body,
    ).toMatchObject({ message: 'Classroom not found' });
    await teacherAgent
      .patch(classroomPath(classroom))
      .timeout(httpTimeout)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    const archived = await storedClassroom(classroom._id);
    expect(archived?.status).toBe('ARCHIVED');
    await join(classroom).expect(400);
    await publish(classroom).expect(400);
    expect(await storedClassroom(classroom._id)).toEqual(archived);
    expect(await storedEnrollments(classroom._id)).toEqual([]);
    expect(await storedTasks(classroom._id)).toEqual([]);
  });

  it('rolls back repeat publication and rejects deleting a classroom with a task in every status', async () => {
    const classroom = await createClassroom('duplicate-task');
    const receipt = (await publish(classroom).expect(201))
      .body as ClassroomTaskResponseDto;
    const published = await storedClassroom(classroom._id);
    expect((await publish(classroom).expect(400)).body).toMatchObject({
      message: 'Task already published to classroom',
    });
    expect(await storedClassroom(classroom._id)).toEqual(published);
    for (const status of ['ACTIVE', 'CLOSED', 'RECALLED']) {
      if (status !== 'ACTIVE') {
        await teacherAgent
          .patch(`${classroomPath(classroom)}/tasks/${receipt.id}/status`)
          .timeout(httpTimeout)
          .send({ status })
          .expect(200);
      }
      expect((await remove(classroom).expect(409)).body).toMatchObject(
        classroomNotEmpty,
      );
      expect(await storedClassroom(classroom._id)).toEqual(published);
      expect(await storedTasks(classroom._id)).toMatchObject([
        {
          _id: new Types.ObjectId(receipt.id),
          status,
          taskSnapshot: taskContent,
        },
      ]);
    }
  });
});
