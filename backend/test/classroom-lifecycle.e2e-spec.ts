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
import type { ClassroomResponseDto } from '../src/modules/classrooms/dto/classroom-response.dto';
import type { UpdateClassroomDto } from '../src/modules/classrooms/dto/update-classroom.dto';
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
const classroomNotFound = { message: 'Classroom not found' };
const archivedUpdate = { message: 'Archived classrooms cannot be updated' };
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
type ClassroomUpdate = 'rename' | 'archive';

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
  let readbackConnection: Connection | undefined;
  let fixtureDb: mongo.Db | undefined;
  let classroomModel: Model<Classroom>;
  let transactionClassroomModel: Model<Classroom>;
  let teacherAgent: Agent;
  let otherTeacherAgent: Agent;
  let studentAgent: Agent;
  const classrooms: ClassroomRow[] = [];
  const renamedClassrooms = new Map<string, string>();
  const emailFor = (account: (typeof accounts)[number]) =>
    `${namespace}.${account.name}@example.invalid`;

  function database() {
    if (!fixtureDb) throw new Error('CLASSROOM_LIFECYCLE_DATABASE_REQUIRED');
    return fixtureDb;
  }

  function readbackDatabase() {
    if (!readbackConnection?.db)
      throw new Error('CLASSROOM_LIFECYCLE_READBACK_REQUIRED');
    return readbackConnection.db;
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
    extra: Partial<Pick<ClassroomRow, 'studentIds' | 'status'>> = {},
    omitStatus = false,
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
    const record: mongo.Document & { _id: Types.ObjectId } = { ...classroom };
    if (omitStatus) delete record.status;
    await insertFixture('classrooms', record);
    return classroom;
  }

  const classroomPath = (classroom: ClassroomRow) =>
    `/api/classrooms/${classroom._id.toHexString()}`;
  const patch = (
    classroom: ClassroomRow,
    dto: UpdateClassroomDto,
    agent = teacherAgent,
  ) => agent.patch(classroomPath(classroom)).timeout(httpTimeout).send(dto);
  const archive = (classroom: ClassroomRow) =>
    teacherAgent
      .post(`${classroomPath(classroom)}/archive`)
      .timeout(httpTimeout);
  const fetch = (classroom: ClassroomRow) =>
    teacherAgent.get(classroomPath(classroom)).timeout(httpTimeout);
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
    return readbackDatabase()
      .collection<ClassroomRow>('classrooms')
      .findOne({ _id: classroomId }, databaseRead());
  }

  function storedEnrollments(classroomId: Types.ObjectId) {
    return readbackDatabase()
      .collection<EnrollmentRow>('enrollments')
      .find({ classroomId }, databaseRead())
      .toArray();
  }

  function storedTasks(classroomId: Types.ObjectId) {
    return readbackDatabase()
      .collection<TaskRow>('classroomtasks')
      .find({ classroomId }, databaseRead())
      .toArray();
  }

  function assignEditedName(classroom: ClassroomRow) {
    const name = `${classroom.name}-edited`;
    renamedClassrooms.set(classroom._id.toHexString(), name);
    return name;
  }

  async function interleaveClassroomUpdate(
    classroom: ClassroomRow,
    intent: ClassroomUpdate,
    name: string,
    ahead: () => request.Test,
  ) {
    const collection: {
      updateOne: mongo.Collection['updateOne'];
      findOneAndUpdate(
        filter: mongo.Filter<mongo.Document>,
        update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
        options?: mongo.FindOneAndUpdateOptions,
      ): Promise<mongo.Document | null>;
    } = classroomModel.collection;
    const updateOne = collection.updateOne.bind(
      collection,
    ) as typeof collection.updateOne;
    const findOneAndUpdate = collection.findOneAndUpdate.bind(
      collection,
    ) as typeof collection.findOneAndUpdate;
    const beforeWrite = checkpoint();
    const releaseWrite = checkpoint();
    let pausedMethod: 'updateOne' | 'findOneAndUpdate' | undefined;

    async function pauseTargetWrite(
      method: NonNullable<typeof pausedMethod>,
      id: unknown,
      update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
    ) {
      if (!(id instanceof Types.ObjectId) || !id.equals(classroom._id)) return;
      if (Array.isArray(update)) return;
      const fields = update.$set as
        Pick<UpdateClassroomDto, 'name' | 'status'> | undefined;
      const matchesIntent =
        intent === 'rename'
          ? fields?.name === name && fields.status === undefined
          : fields?.status === ClassroomStatus.Archived &&
            fields.name === undefined;
      if (!matchesIntent) return;
      pausedMethod = method;
      beforeWrite.signal();
      await releaseWrite.reached;
    }

    // Hook only the default model's writes. The deletion transaction uses a
    // different model even though both connections target the same database.
    const legacySpy = jest
      .spyOn(collection, 'updateOne')
      .mockImplementation(async (filter, update, options) => {
        await pauseTargetWrite('updateOne', filter._id, update);
        return updateOne(filter, update, options);
      });
    const updateSpy = jest
      .spyOn(collection, 'findOneAndUpdate')
      .mockImplementation(async (filter, update, options) => {
        await pauseTargetWrite('findOneAndUpdate', filter._id, update);
        return findOneAndUpdate(filter, update, options);
      });
    const delayed = (
      intent === 'rename' ? patch(classroom, { name }) : archive(classroom)
    ).then((response) => response);
    try {
      await waitForCheckpoint(
        beforeWrite.reached,
        delayed,
        'DEFAULT_CLASSROOM_UPDATE',
      );
      const first = await ahead();
      releaseWrite.signal();
      return { first, second: await delayed, pausedMethod };
    } finally {
      releaseWrite.signal();
      try {
        await Promise.allSettled([delayed]);
      } finally {
        legacySpy.mockRestore();
        updateSpy.mockRestore();
      }
    }
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
    readbackConnection = await openAuthTestConnection();
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    const transactionConnection = moduleFixture.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(connection);
    await assertAuthTestConnection(transactionConnection);
    classroomModel = moduleFixture.get<Model<Classroom>>(
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
        readbackDatabase: readbackDatabase().databaseName,
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
      if (!connection || !readbackConnection || !fixtureDb) return;
      await assertAuthTestConnection(connection);
      await assertAuthTestConnection(readbackConnection);
      const db = fixtureDb;
      const readbackDb = readbackDatabase();
      assertAuthTestWritesConfirmed(db);
      const accountIds = accounts.map(({ id }) => id);
      const classroomIds = classrooms.map(({ _id }) => _id);
      const childScope = { classroomId: { $in: classroomIds } };
      const classroomScope = { _id: { $in: classroomIds } };
      const sessionScope = { userId: { $in: accountIds } };
      const usersScope = { _id: { $in: accountIds } };
      const enrollments = await readbackDb
        .collection<EnrollmentRow>('enrollments')
        .find(childScope, databaseRead())
        .toArray();
      const tasks = await readbackDb
        .collection<TaskRow>('classroomtasks')
        .find(childScope, databaseRead())
        .toArray();
      const parents = await readbackDb
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
              ({ _id, name }) =>
                _id.equals(row._id) &&
                (name === row.name ||
                  renamedClassrooms.get(_id.toHexString()) === row.name),
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
        enrollments: await readbackDb
          .collection('enrollments')
          .countDocuments(childScope, databaseRead()),
        classroomTasks: await readbackDb
          .collection('classroomtasks')
          .countDocuments(childScope, databaseRead()),
        classrooms: await readbackDb
          .collection('classrooms')
          .countDocuments(classroomScope, databaseRead()),
        tasks: await readbackDb
          .collection('tasks')
          .countDocuments({ _id: taskId }, databaseRead()),
        courses: await readbackDb
          .collection('courses')
          .countDocuments({ _id: courseId }, databaseRead()),
        sessions: await readbackDb
          .collection('sessions')
          .countDocuments(sessionScope, databaseRead()),
        users: await readbackDb
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
          try {
            await readbackConnection?.close();
          } finally {
            authTestEnvironment.restore();
          }
        }
      }
    }
  });

  function expectClassroomReceipt(
    response: request.Response,
    classroom: ClassroomRow,
    name: string,
    status: ClassroomStatus,
  ) {
    expect(response.body).toMatchObject({
      id: classroom._id.toHexString(),
      name,
      status,
      course: {
        id: courseId.toHexString(),
        code: namespace,
        name: namespace,
        term: '2026-Autumn',
        status: 'ACTIVE',
      },
    });
  }

  function receiptState(response: request.Response) {
    const body = response.body as Partial<ClassroomResponseDto> & {
      message?: string;
      ok?: boolean;
    };
    return {
      http: response.status,
      status: body.status,
      name: body.name,
      message: body.message,
      ok: body.ok,
    };
  }

  it.each(['archive', 'rename', 'delete'] as const)(
    'classroom update race: %s completes first',
    async (firstWriter) => {
      const classroom = await createClassroom(`metadata-${firstWriter}-first`);
      const name = assignEditedName(classroom);
      const { first, second, pausedMethod } = await interleaveClassroomUpdate(
        classroom,
        firstWriter === 'archive' ? 'rename' : 'archive',
        name,
        () => {
          if (firstWriter === 'archive') return archive(classroom);
          if (firstWriter === 'rename') return patch(classroom, { name });
          return remove(classroom);
        },
      );
      const fetched = await fetch(classroom);
      const stored = await storedClassroom(classroom._id);
      console.info(
        JSON.stringify({
          stage: 'classroom-lifecycle-update-race',
          firstWriter,
          pausedMethod,
          originalName: classroom.name,
          editedName: name,
          first: receiptState(first),
          second: receiptState(second),
          get: receiptState(fetched),
          mongo: stored && { name: stored.name, status: stored.status },
        }),
      );
      if (firstWriter === 'delete') {
        expect(first.status).toBe(200);
        expect(first.body).toEqual({ ok: true });
        expect(second.status).toBe(404);
        expect(second.body).toMatchObject(classroomNotFound);
        expect(fetched.status).toBe(404);
        expect(fetched.body).toMatchObject(classroomNotFound);
        expect(stored).toBeNull();
        return;
      }

      const expectedName = firstWriter === 'archive' ? classroom.name : name;
      if (firstWriter === 'archive') {
        expect(first.status).toBe(201);
        expectClassroomReceipt(
          first,
          classroom,
          expectedName,
          ClassroomStatus.Archived,
        );
        expect(second.status).toBe(400);
        expect(second.body).toMatchObject(archivedUpdate);
      } else {
        expect(first.status).toBe(200);
        expectClassroomReceipt(first, classroom, name, ClassroomStatus.Active);
        expect(second.status).toBe(201);
        expectClassroomReceipt(
          second,
          classroom,
          name,
          ClassroomStatus.Archived,
        );
      }
      expect(fetched.status).toBe(200);
      expectClassroomReceipt(
        fetched,
        classroom,
        expectedName,
        ClassroomStatus.Archived,
      );
      expect(stored).toMatchObject({
        name: expectedName,
        status: ClassroomStatus.Archived,
      });
    },
  );

  it('deletes an empty classroom after its confirmed rename', async () => {
    const classroom = await createClassroom('rename-then-delete');
    const name = assignEditedName(classroom);
    const renamed = await patch(classroom, { name }).expect(200);
    expectClassroomReceipt(renamed, classroom, name, ClassroomStatus.Active);
    expect(await storedClassroom(classroom._id)).toMatchObject({
      name,
      status: ClassroomStatus.Active,
    });
    const deleted = await remove(classroom).expect(200);
    expect(deleted.body).toEqual({ ok: true });
    const fetched = await fetch(classroom).expect(404);
    expect(fetched.body).toMatchObject(classroomNotFound);
    const stored = await storedClassroom(classroom._id);
    expect(stored).toBeNull();
    console.info(
      JSON.stringify({
        stage: 'classroom-lifecycle-rename-then-delete',
        first: receiptState(renamed),
        second: receiptState(deleted),
        get: receiptState(fetched),
        mongo: stored,
      }),
    );
  });

  it('preserves classroom update authorization, no-op timestamps and mixed patch rules', async () => {
    const classroom = await createClassroom('metadata-contract');
    const name = assignEditedName(classroom);
    await patch(classroom, { name }, studentAgent).expect(403);
    const foreign = await patch(classroom, { name }, otherTeacherAgent).expect(
      404,
    );
    expect(foreign.body).toMatchObject(classroomNotFound);
    for (const dto of [{}, { name: classroom.name }]) {
      const result = await patch(classroom, dto).expect(200);
      expect((result.body as ClassroomResponseDto).updatedAt).toBe(
        fixtureTime.toISOString(),
      );
      expect(await storedClassroom(classroom._id)).toEqual(classroom);
    }

    const archived = await patch(classroom, {
      name,
      status: ClassroomStatus.Archived,
    }).expect(200);
    expectClassroomReceipt(archived, classroom, name, ClassroomStatus.Archived);
    const beforeRejection = await storedClassroom(classroom._id);
    expect(beforeRejection).toMatchObject({
      name,
      status: ClassroomStatus.Archived,
    });
    const blocked = await patch(classroom, {
      name,
      status: ClassroomStatus.Active,
    }).expect(400);
    expect(blocked.body).toMatchObject(archivedUpdate);
    expect(await storedClassroom(classroom._id)).toEqual(beforeRejection);
    const restored = await patch(classroom, {
      status: ClassroomStatus.Active,
    }).expect(200);
    expectClassroomReceipt(restored, classroom, name, ClassroomStatus.Active);
    expect(await storedClassroom(classroom._id)).toMatchObject({
      name,
      status: ClassroomStatus.Active,
    });

    const alreadyArchived = await createClassroom('archived-no-op', {
      status: ClassroomStatus.Archived,
    });
    await archive(alreadyArchived).expect(201);
    const repeated = await archive(alreadyArchived).expect(201);
    expect((repeated.body as ClassroomResponseDto).updatedAt).toBe(
      fixtureTime.toISOString(),
    );
    expect(await storedClassroom(alreadyArchived._id)).toEqual(alreadyArchived);
  });

  it('allows a name update with legacy missing classroom status', async () => {
    const classroom = await createClassroom('legacy-update-status', {}, true);
    expect(await storedClassroom(classroom._id)).not.toHaveProperty('status');
    const name = assignEditedName(classroom);
    const result = await patch(classroom, { name }).expect(200);
    expectClassroomReceipt(result, classroom, name, ClassroomStatus.Active);
    expect(await storedClassroom(classroom._id)).toMatchObject({ name });
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
