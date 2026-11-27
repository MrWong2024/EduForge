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
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomsService } from '../src/modules/classrooms/services/classrooms.service';
import {
  Course,
  CourseStatus,
} from '../src/modules/courses/schemas/course.schema';
import { CoursesService } from '../src/modules/courses/services/courses.service';
import { hashPassword } from '../src/modules/users/password.utils';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);

const namespace = `course-lifecycle-${randomUUID()}`;
const accounts = [
  { id: new Types.ObjectId(), name: 'owner', role: 'teacher' },
  { id: new Types.ObjectId(), name: 'other', role: 'teacher' },
  { id: new Types.ObjectId(), name: 'student', role: 'student' },
] as const;
const ownerId = accounts[0].id;
const password = 'CourseLifecycle123!';
const httpTimeout = { response: 15000, deadline: 20000 };
const courseNotEmpty = {
  code: 'COURSE_NOT_EMPTY',
  message: '该课程下已有班级记录，不能删除，只能归档',
};
const databaseRead = () => ({
  maxTimeMS: 5000,
  signal: AbortSignal.timeout(5000),
  readPreference: 'primary' as const,
});

type Agent = ReturnType<typeof request.agent>;
type CourseRow = Course & {
  _id: Types.ObjectId;
  updatedAt: Date;
  __v?: number;
};
type ClassroomRow = Classroom & { _id: Types.ObjectId };
type CourseSummary = Pick<
  Course,
  'code' | 'name' | 'term' | 'status' | 'courseLabel'
> & {
  id: string;
};
type CreatedClassroomResponse = {
  id: string;
  courseId: string;
  teacherId: string;
  joinCode: string;
  course: CourseSummary;
};
type ParentWriter = 'delete' | 'create';
type CourseWriteIntent =
  | { field: 'name'; value: string }
  | { field: 'status'; value: CourseStatus.Archived };
type CourseWriteMethod = 'updateOne' | 'findOneAndUpdate';

function summarizeCourseResponse(response: request.Response) {
  const body = response.body as Partial<CourseSummary> & {
    message?: string;
    ok?: boolean;
  };
  return {
    http: response.status,
    name: body.name,
    status: body.status,
    message: body.message,
    ok: body.ok,
  };
}

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

describe('Course Lifecycle (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let readbackConnection: Connection | undefined;
  let transactionConnection: Connection;
  let fixtureDb: mongo.Db | undefined;
  let courseModel: Model<Course>;
  let transactionCourseModel: Model<Course>;
  let classroomsService: ClassroomsService;
  let teacherAgent: Agent;
  let otherTeacherAgent: Agent;
  let studentAgent: Agent;

  const courseIds = new Set<string>();
  const courseCodes = new Set<string>();
  const classroomTargets = new Set<string>();
  const emailFor = (account: (typeof accounts)[number]) =>
    `${namespace}.${account.name}@example.invalid`;

  function database(): mongo.Db {
    if (!readbackConnection?.db)
      throw new Error('COURSE_LIFECYCLE_READBACK_DATABASE_REQUIRED');
    return readbackConnection.db;
  }

  function storedCourse(courseId: string) {
    return database()
      .collection<CourseRow>('courses')
      .findOne({ _id: new Types.ObjectId(courseId) }, databaseRead());
  }

  function storedClassrooms(courseId: string) {
    return database()
      .collection<ClassroomRow>('classrooms')
      .find({ courseId: new Types.ObjectId(courseId) }, databaseRead())
      .toArray();
  }

  const remove = (courseId: string, agent = teacherAgent) =>
    agent.delete(`/api/courses/${courseId}`).timeout(httpTimeout);

  const get = (courseId: string) =>
    teacherAgent.get(`/api/courses/${courseId}`).timeout(httpTimeout);

  const patch = (
    courseId: string,
    body: Record<string, unknown>,
    agent = teacherAgent,
  ) => agent.patch(`/api/courses/${courseId}`).timeout(httpTimeout).send(body);

  const archive = (courseId: string, agent = teacherAgent) =>
    agent.post(`/api/courses/${courseId}/archive`).timeout(httpTimeout);

  const buildClassroom = (
    courseId: string,
    suffix: string,
    agent = teacherAgent,
  ) => {
    const name = `${namespace}-${suffix}`;
    classroomTargets.add(`${courseId}/${name}`);
    return agent
      .post('/api/classrooms')
      .timeout(httpTimeout)
      .send({ courseId, name });
  };

  async function createCourse(suffix: string) {
    const code = `${namespace}-${suffix}`;
    courseCodes.add(code);
    const created = await teacherAgent
      .post('/api/courses')
      .timeout(httpTimeout)
      .send({ code, name: code, term: '2026-Spring', courseLabel: '通用编程' })
      .expect(201);
    const { id } = created.body as { id: string };
    expect(Types.ObjectId.isValid(id)).toBe(true);
    courseIds.add(id);
    return id;
  }

  async function raceCourseUpdate(
    courseId: string,
    intent: CourseWriteIntent,
    delayedRequest: () => request.Test,
    firstRequest: () => request.Test,
  ) {
    if (!app) throw new Error('COURSE_LIFECYCLE_APPLICATION_REQUIRED');
    const service = app.get(CoursesService);
    const handlers = [
      jest.spyOn(service, 'updateCourse'),
      jest.spyOn(service, 'deleteCourse'),
    ];
    const collection: {
      updateOne: mongo.Collection['updateOne'];
      findOneAndUpdate(
        filter: mongo.Filter<mongo.Document>,
        update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
        options?: mongo.FindOneAndUpdateOptions,
      ): Promise<mongo.Document | null>;
    } = courseModel.collection;
    const updateOne = collection.updateOne.bind(
      collection,
    ) as typeof collection.updateOne;
    const findOneAndUpdate = collection.findOneAndUpdate.bind(
      collection,
    ) as typeof collection.findOneAndUpdate;
    const reachedWrite = checkpoint();
    const releaseWrite = checkpoint();
    const target = new Types.ObjectId(courseId);
    let delayedMethod: CourseWriteMethod | undefined;

    async function beforeWrite<Result>(
      method: CourseWriteMethod,
      filter: mongo.Filter<mongo.Document>,
      update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
      execute: () => Promise<Result>,
    ): Promise<Result> {
      if (
        filter?._id instanceof Types.ObjectId &&
        filter._id.equals(target) &&
        !Array.isArray(update) &&
        update.$set?.[intent.field] === intent.value
      ) {
        delayedMethod = method;
        reachedWrite.signal();
        await releaseWrite.reached;
      }
      return execute();
    }

    const spies = [
      jest
        .spyOn(collection, 'updateOne')
        .mockImplementation((filter, update, options) =>
          beforeWrite('updateOne', filter, update, () =>
            updateOne(filter, update, options),
          ),
        ),
      jest
        .spyOn(collection, 'findOneAndUpdate')
        .mockImplementation((filter, update, options) =>
          beforeWrite('findOneAndUpdate', filter, update, () =>
            findOneAndUpdate(filter, update, options),
          ),
        ),
    ];
    const requests: Promise<request.Response>[] = [];
    const start = (send: () => request.Test) => {
      const pending = send().then((response) => response);
      requests.push(pending);
      return pending;
    };
    try {
      const delayed = start(delayedRequest);
      await waitForCheckpoint(
        reachedWrite.reached,
        delayed,
        'COURSE_DEFAULT_CONNECTION_WRITE',
      );
      const first = await start(firstRequest);
      releaseWrite.signal();
      return { first, delayed: await delayed, delayedMethod };
    } finally {
      releaseWrite.signal();
      try {
        await Promise.allSettled(requests);
        // HTTP timeout does not imply the server-side write has finished.
        const pendingHandlers = handlers.flatMap(({ mock }) =>
          mock.results.flatMap((result: jest.MockResult<unknown>) =>
            result.type === 'return' ? [Promise.resolve(result.value)] : [],
          ),
        );
        await Promise.allSettled(pendingHandlers);
      } finally {
        for (const spy of [...spies, ...handlers]) spy.mockRestore();
      }
    }
  }

  async function raceDeleteAndCreate(
    courseId: string,
    first: ParentWriter,
  ): Promise<Record<ParentWriter, request.Response>> {
    const courseCollection: {
      deleteOne: mongo.Collection['deleteOne'];
      findOneAndUpdate(
        filter: mongo.Filter<mongo.Document>,
        update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
        options?: mongo.FindOneAndUpdateOptions,
      ): Promise<mongo.Document | null>;
    } = transactionCourseModel.collection;
    const deleteOne = courseCollection.deleteOne.bind(
      courseCollection,
    ) as typeof courseCollection.deleteOne;
    const findOneAndUpdate = courseCollection.findOneAndUpdate.bind(
      courseCollection,
    ) as typeof courseCollection.findOneAndUpdate;
    const target = new Types.ObjectId(courseId);
    const firstWrite = checkpoint();
    const releaseWrite = checkpoint();
    const writeConflict = checkpoint();
    let winnerSession: mongo.ClientSession | undefined;

    async function observeParentWrite<Result>(
      writer: ParentWriter,
      documentId: unknown,
      session: mongo.ClientSession | undefined,
      execute: () => Promise<Result>,
      wrote: (result: Result) => boolean,
    ): Promise<Result> {
      if (!(documentId instanceof Types.ObjectId) || !documentId.equals(target))
        return execute();
      if (!session?.inTransaction())
        throw new Error('COURSE_PARENT_WRITE_WITHOUT_TRANSACTION');
      let result: Result;
      try {
        result = await execute();
      } catch (error: unknown) {
        if (
          writer !== first &&
          winnerSession &&
          session !== winnerSession &&
          error instanceof mongo.MongoServerError &&
          error.code === 112
        ) {
          writeConflict.signal();
        }
        throw error;
      }
      if (writer === first && !winnerSession) {
        // Hold the successful Mongo write before its transaction can commit.
        expect(wrote(result)).toBe(true);
        winnerSession = session;
        firstWrite.signal();
        await releaseWrite.reached;
      }
      return result;
    }

    const deleteSpy = jest
      .spyOn(courseCollection, 'deleteOne')
      .mockImplementation((filter, options) =>
        observeParentWrite(
          'delete',
          filter?._id,
          options?.session,
          () => deleteOne(filter, options),
          (result) => result.deletedCount === 1,
        ),
      );
    const updateSpy = jest
      .spyOn(courseCollection, 'findOneAndUpdate')
      .mockImplementation((filter, update, options) =>
        observeParentWrite(
          'create',
          filter._id,
          options?.session,
          () => findOneAndUpdate(filter, update, options),
          (result) => result !== null,
        ),
      );
    const requests: Promise<request.Response>[] = [];
    const send = (kind: ParentWriter) => {
      const pending = (
        kind === 'delete' ? remove(courseId) : buildClassroom(courseId, first)
      ).then((response) => response);
      requests.push(pending);
      return pending;
    };

    try {
      const winner = send(first);
      await waitForCheckpoint(firstWrite.reached, winner, 'FIRST_COURSE_WRITE');
      const loser = send(first === 'delete' ? 'create' : 'delete');
      await waitForCheckpoint(
        writeConflict.reached,
        loser,
        'MONGO_COURSE_WRITE_CONFLICT',
      );
      releaseWrite.signal();
      const [won, lost] = await Promise.all([winner, loser]);
      return first === 'delete'
        ? { delete: won, create: lost }
        : { delete: lost, create: won };
    } finally {
      releaseWrite.signal();
      try {
        await Promise.allSettled(requests);
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
    transactionConnection = moduleFixture.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(connection);
    await assertAuthTestConnection(transactionConnection);
    await assertAuthTestConnection(readbackConnection);
    courseModel = moduleFixture.get<Model<Course>>(getModelToken(Course.name));
    expect(courseModel.db).toBe(connection);
    transactionCourseModel = getClassroomTaskTransactionModel(
      transactionConnection,
      courseModel,
    );
    await runClassroomTaskTransaction(transactionConnection, (transaction) =>
      transaction
        .model(courseModel)
        .exists({ _id: new Types.ObjectId() })
        .session(transaction.session)
        .setOptions(transaction.readOptions())
        .exec(),
    );

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    classroomsService = app.get(ClassroomsService);
    fixtureDb = connection.db;
    if (!fixtureDb) throw new Error('COURSE_LIFECYCLE_DATABASE_REQUIRED');
    console.info(
      JSON.stringify({
        stage: 'course-lifecycle-db-gate',
        defaultDatabase: fixtureDb.databaseName,
        transactionDatabase: transactionConnection.db?.databaseName,
        readbackDatabase: database().databaseName,
        transactionProbe: 'committed',
        namespace,
      }),
    );
    const users = app.get<Model<User>>(getModelToken(User.name));
    const passwordHash = await hashPassword(password);
    const httpServer = app.getHttpServer() as Server;
    const agents = [
      request.agent(httpServer),
      request.agent(httpServer),
      request.agent(httpServer),
    ];
    [teacherAgent, otherTeacherAgent, studentAgent] = agents;
    for (const [index, account] of accounts.entries()) {
      const email = emailFor(account);
      await createFixtureUser(users, {
        _id: account.id,
        email,
        passwordHash,
        roles: [account.role],
        status: UserStatus.Active,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
      });
      await agents[index]
        .post('/api/auth/login')
        .timeout(httpTimeout)
        .send({ email, password })
        .expect(201);
    }
  });

  afterAll(async () => {
    try {
      if (!connection || !fixtureDb) return;
      await assertAuthTestConnection(connection);
      assertAuthTestWritesConfirmed(fixtureDb);
      const readbackDb = database();
      const db = fixtureDb;
      const courseFilter = {
        createdBy: ownerId,
        code: { $in: [...courseCodes] },
      };
      const courses = await db
        .collection<CourseRow>('courses')
        .find(courseFilter, databaseRead())
        .toArray();
      for (const course of courses) courseIds.add(course._id.toHexString());
      const courseIdFilter = {
        $in: [...courseIds].map((id) => new Types.ObjectId(id)),
      };
      const classroomFilter = { courseId: courseIdFilter };
      const classrooms = await db
        .collection<ClassroomRow>('classrooms')
        .find(classroomFilter, databaseRead())
        .toArray();
      if (
        classrooms.some(
          ({ courseId, name, teacherId }) =>
            !classroomTargets.has(`${courseId.toHexString()}/${name}`) ||
            !accounts.some(({ id }) => id.equals(teacherId)),
        )
      ) {
        throw new Error('COURSE_LIFECYCLE_CLASSROOM_OWNERSHIP_MISMATCH');
      }
      for (const classroom of classrooms) {
        await deleteFixtureRows(db, 'classrooms', {
          _id: classroom._id,
          courseId: classroom.courseId,
          name: classroom.name,
          teacherId: classroom.teacherId,
        });
      }
      for (const course of courses) {
        await deleteFixtureRows(db, 'courses', {
          _id: course._id,
          createdBy: ownerId,
          code: course.code,
        });
      }
      const sessionFilter = { userId: { $in: accounts.map(({ id }) => id) } };
      await deleteFixtureRows(db, 'sessions', sessionFilter, 0);
      for (const account of accounts)
        await deleteFixtureRows(db, 'users', {
          _id: account.id,
          email: emailFor(account),
        });

      const remaining = {
        courses: await readbackDb
          .collection('courses')
          .countDocuments(courseFilter, databaseRead()),
        classrooms: await readbackDb
          .collection('classrooms')
          .countDocuments(classroomFilter, databaseRead()),
        sessions: await readbackDb
          .collection('sessions')
          .countDocuments(sessionFilter, databaseRead()),
        users: await readbackDb
          .collection('users')
          .countDocuments({ _id: sessionFilter.userId }, databaseRead()),
      };
      console.info(
        JSON.stringify({
          stage: 'course-lifecycle-cleanup',
          namespace,
          remaining,
          ownResidual: Object.values(remaining).reduce(
            (sum, count) => sum + count,
            0,
          ),
        }),
      );
      expect(remaining).toEqual({
        courses: 0,
        classrooms: 0,
        sessions: 0,
        users: 0,
      });
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
            if (readbackConnection?.readyState === STATES.connected)
              await readbackConnection.close();
          } finally {
            authTestEnvironment.restore();
          }
        }
      }
    }
  });

  it('allows deleting an empty course', async () => {
    const courseId = await createCourse('delete-empty');
    const deleted = await remove(courseId).expect(200);
    expect(deleted.body).toEqual({ ok: true });
    await teacherAgent
      .get(`/api/courses/${courseId}`)
      .timeout(httpTimeout)
      .expect(404);
  });

  it('rejects deleting a course with an active or archived classroom', async () => {
    const courseId = await createCourse('delete-nonempty');
    const created = await buildClassroom(courseId, 'nonempty').expect(201);
    const { id } = created.body as CreatedClassroomResponse;
    const active = await remove(courseId).expect(409);
    expect(active.body).toMatchObject(courseNotEmpty);

    const archived = await teacherAgent
      .post(`/api/classrooms/${id}/archive`)
      .timeout(httpTimeout)
      .expect(201);
    expect(archived.body).toMatchObject({ status: 'ARCHIVED' });
    const nonempty = await remove(courseId).expect(409);
    expect(nonempty.body).toMatchObject(courseNotEmpty);
    expect(await storedCourse(courseId)).not.toBeNull();
  });

  it('archives course via PATCH status and permits classroom creation on it', async () => {
    const courseId = await createCourse('archive');
    const archived = await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .timeout(httpTimeout)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    expect(archived.body).toMatchObject({ status: 'ARCHIVED' });
    const created = await buildClassroom(courseId, 'archived-course').expect(
      201,
    );
    expect(created.body).toMatchObject({
      course: { id: courseId, status: 'ARCHIVED' },
    });
  });

  it('restores course via PATCH status', async () => {
    const courseId = await createCourse('restore');
    await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .timeout(httpTimeout)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    const restored = await teacherAgent
      .patch(`/api/courses/${courseId}`)
      .timeout(httpTimeout)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(restored.body).toMatchObject({ status: 'ACTIVE' });
  });

  it.each(['archive', 'edit', 'delete'] as const)(
    'keeps course write results consistent when %s finishes first',
    async (first) => {
      const courseId = await createCourse(`update-race-${first}`);
      const before = await storedCourse(courseId);
      if (!before) throw new Error('COURSE_LIFECYCLE_PARENT_MISSING');
      expect(await storedClassrooms(courseId)).toEqual([]);
      const newName = `Course renamed after ${first} race`;
      const changeName = () => patch(courseId, { name: newName });
      const archiveCourse = () => archive(courseId);
      const {
        first: winner,
        delayed,
        delayedMethod,
      } = await raceCourseUpdate(
        courseId,
        first === 'edit'
          ? { field: 'status', value: CourseStatus.Archived }
          : { field: 'name', value: newName },
        first === 'edit' ? archiveCourse : changeName,
        first === 'archive'
          ? archiveCourse
          : first === 'edit'
            ? changeName
            : () => remove(courseId),
      );
      const fetched = await get(courseId);
      const row = await storedCourse(courseId);
      console.info(
        JSON.stringify({
          stage: 'course-update-interleaving',
          first,
          delayedMethod,
          originalName: before.name,
          newName,
          firstReceipt: summarizeCourseResponse(winner),
          delayedReceipt: summarizeCourseResponse(delayed),
          get: summarizeCourseResponse(fetched),
          mongo: row ? { name: row.name, status: row.status } : null,
        }),
      );
      if (first === 'delete') {
        expect(winner.status).toBe(200);
        expect(winner.body).toEqual({ ok: true });
        expect(delayed.status).toBe(404);
        expect(delayed.body).toMatchObject({ message: 'Course not found' });
        expect(fetched.status).toBe(404);
        expect(fetched.body).toMatchObject({ message: 'Course not found' });
        expect(row).toBeNull();
        return;
      }
      const expected = {
        id: courseId,
        code: before.code,
        name: first === 'edit' ? newName : before.name,
        status: CourseStatus.Archived,
      };
      if (first === 'archive') {
        expect(winner.status).toBe(201);
        expect(winner.body).toMatchObject(expected);
        expect(delayed.status).toBe(400);
        expect(delayed.body).toMatchObject({
          message: 'Archived courses cannot be updated',
        });
      } else {
        expect(winner.status).toBe(200);
        expect(winner.body).toMatchObject({
          ...expected,
          status: CourseStatus.Active,
        });
        expect(delayed.status).toBe(201);
        expect(delayed.body).toMatchObject(expected);
      }
      expect(fetched.status).toBe(200);
      expect(fetched.body).toMatchObject(expected);
      expect(row).toMatchObject({
        name: expected.name,
        status: expected.status,
        term: before.term,
        courseLabel: before.courseLabel,
      });
    },
  );

  it('deletes an empty course after a successful edit', async () => {
    const courseId = await createCourse('edit-then-delete');
    const edited = await patch(courseId, { name: 'Course saved first' }).expect(
      200,
    );
    expect(edited.body).toMatchObject({
      id: courseId,
      name: 'Course saved first',
      status: CourseStatus.Active,
    });
    expect(await storedCourse(courseId)).toMatchObject({
      name: 'Course saved first',
      status: CourseStatus.Active,
    });
    const removed = await remove(courseId).expect(200);
    expect(removed.body).toEqual({ ok: true });
    const fetched = await get(courseId).expect(404);
    expect(fetched.body).toMatchObject({ message: 'Course not found' });
    expect(await storedCourse(courseId)).toBeNull();
    console.info(
      JSON.stringify({
        stage: 'course-update-then-delete',
        firstReceipt: summarizeCourseResponse(edited),
        deleteReceipt: summarizeCourseResponse(removed),
        get: summarizeCourseResponse(fetched),
        mongo: null,
      }),
    );
  });

  it('preserves course timestamps for no-op PATCH and repeated archive, and applies mixed requests as a whole', async () => {
    const courseId = await createCourse('no-op-and-mixed');
    const db = fixtureDb;
    if (!db) throw new Error('COURSE_LIFECYCLE_DATABASE_REQUIRED');
    const filter = { _id: new Types.ObjectId(courseId), createdBy: ownerId };
    const referenceTimestamp = new Date('2020-01-01T00:00:00Z');
    const seedTimestamp = async () => {
      const seeded = await runAuthTestWrite(
        db,
        {
          update: 'courses',
          updates: [
            {
              q: filter,
              u: { $set: { updatedAt: referenceTimestamp } },
            },
          ],
        },
        { collection: 'courses', filter },
      );
      expect(seeded.n).toBe(1);
    };
    await seedTimestamp();
    const empty = await patch(courseId, {}).expect(200);
    const { name } = empty.body as CourseSummary;
    const same = await patch(courseId, { name }).expect(200);
    expect(same.body).toEqual(empty.body);
    expect(empty.body).toMatchObject({
      updatedAt: referenceTimestamp.toISOString(),
    });
    expect((await storedCourse(courseId))?.updatedAt).toEqual(
      referenceTimestamp,
    );

    const renamed = 'Renamed while archiving';
    await patch(courseId, { name: renamed, status: CourseStatus.Archived })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ name: renamed, status: 'ARCHIVED' });
      });
    await seedTimestamp();
    const repeated = await archive(courseId).expect(201);
    expect(repeated.body).toMatchObject({
      name: renamed,
      status: 'ARCHIVED',
      updatedAt: referenceTimestamp.toISOString(),
    });
    const rejected = await patch(courseId, {
      name: renamed,
      status: CourseStatus.Active,
    }).expect(400);
    expect(rejected.body).toMatchObject({
      message: 'Archived courses cannot be updated',
    });
    expect(await storedCourse(courseId)).toMatchObject({
      name: renamed,
      status: 'ARCHIVED',
      updatedAt: referenceTimestamp,
    });
    console.info(
      JSON.stringify({
        stage: 'course-no-op-timestamps',
        emptyPatch: 200,
        sameValuePatch: 200,
        repeatArchive: 201,
        updatedAtUnchanged: true,
      }),
    );
  });

  it.each([null, '', '   '])(
    'preserves an omitted course label and removes it for an explicit %p',
    async (value) => {
      const suffix = value === null ? 'null' : `blank-${value.length}`;
      const courseId = await createCourse(`label-clear-${suffix}`);
      const renamed = await patch(courseId, {
        name: 'Keep classification',
      }).expect(200);
      expect(renamed.body).toMatchObject({ courseLabel: '通用编程' });
      expect((await storedCourse(courseId))?.courseLabel).toBe('通用编程');
      const cleared = await patch(courseId, { courseLabel: value }).expect(200);
      expect(cleared.body).not.toHaveProperty('courseLabel');
      const stored = await storedCourse(courseId);
      expect(stored).not.toBeNull();
      expect(stored).not.toHaveProperty('courseLabel');
    },
  );

  it('retains code trimming, duplicate rejection, ownership and role checks', async () => {
    const courseId = await createCourse('patch-permissions');
    const duplicateId = await createCourse('duplicate-code');
    const duplicate = await storedCourse(duplicateId);
    if (!duplicate) throw new Error('COURSE_LIFECYCLE_DUPLICATE_MISSING');
    const rejected = await patch(courseId, {
      code: ` ${duplicate.code} `,
    }).expect(400);
    expect(rejected.body).toMatchObject({
      message: 'Course code already exists',
    });
    await patch(courseId, { name: 'Unauthorized' }, studentAgent).expect(403);
    const forbidden = await patch(
      courseId,
      { name: 'Other teacher' },
      otherTeacherAgent,
    ).expect(404);
    expect(forbidden.body).toMatchObject({ message: 'Course not found' });
    await archive(courseId, studentAgent).expect(403);
    const hidden = await archive(courseId, otherTeacherAgent).expect(404);
    expect(hidden.body).toMatchObject({ message: 'Course not found' });
    const code = `${namespace}-trimmed-code`;
    courseCodes.add(code);
    const updated = await patch(courseId, {
      code: ` ${code} `,
      courseLabel: '  Python 程序设计  ',
    }).expect(200);
    expect(updated.body).toMatchObject({
      code,
      courseLabel: 'Python 程序设计',
    });
    expect(await storedCourse(courseId)).toMatchObject({
      code,
      courseLabel: 'Python 程序设计',
    });
  });

  it('edits a legacy course with no stored status using default ACTIVE semantics', async () => {
    const courseId = await createCourse('legacy-status');
    const db = fixtureDb;
    if (!db) throw new Error('COURSE_LIFECYCLE_DATABASE_REQUIRED');
    const filter = { _id: new Types.ObjectId(courseId), createdBy: ownerId };
    const seeded = await runAuthTestWrite(
      db,
      {
        update: 'courses',
        updates: [{ q: filter, u: { $unset: { status: '' } } }],
      },
      { collection: 'courses', filter },
    );
    expect(seeded.nModified).toBe(1);
    const legacy = await storedCourse(courseId);
    expect(legacy).not.toBeNull();
    expect(legacy).not.toHaveProperty('status');

    const edited = await patch(courseId, {
      name: 'Legacy course edited',
    }).expect(200);
    expect(edited.body).toMatchObject({
      name: 'Legacy course edited',
      status: CourseStatus.Active,
    });
    expect(await storedCourse(courseId)).toMatchObject({
      name: 'Legacy course edited',
    });
  });

  it('keeps role and course ownership checks for deletion and classroom creation', async () => {
    const courseId = await createCourse('authorization');
    await remove(courseId, studentAgent).expect(403);
    await buildClassroom(courseId, 'unauthorized', studentAgent).expect(403);
    await remove(courseId, otherTeacherAgent).expect(404);
    await buildClassroom(courseId, 'unauthorized', otherTeacherAgent).expect(
      404,
    );
    expect(await storedCourse(courseId)).not.toBeNull();
    expect(await storedClassrooms(courseId)).toEqual([]);
  });

  it('retries a real joinCode index collision with a fresh transaction and another code', async () => {
    const courseId = await createCourse('join-code');
    const firstResponse = await buildClassroom(courseId, 'first-code').expect(
      201,
    );
    const first = firstResponse.body as CreatedClassroomResponse;
    const nextCode = randomUUID().slice(0, 8).toUpperCase();
    const collection = database().collection<ClassroomRow>('classrooms');
    expect(
      await collection.findOne({ joinCode: nextCode }, databaseRead()),
    ).toBeNull();
    const before = await storedCourse(courseId);
    if (!before) throw new Error('COURSE_LIFECYCLE_PARENT_MISSING');
    const generator = jest
      .spyOn(
        classroomsService as unknown as { generateJoinCode(): string },
        'generateJoinCode',
      )
      .mockReturnValueOnce(first.joinCode)
      .mockReturnValueOnce(nextCode);
    try {
      const retried = await buildClassroom(courseId, 'next-code').expect(201);
      const second = retried.body as CreatedClassroomResponse;
      const rows = await storedClassrooms(courseId);
      expect(generator).toHaveBeenCalledTimes(2);
      expect(second.joinCode).toBe(nextCode);
      expect(
        rows.map((row) => ({
          id: row._id.toHexString(),
          joinCode: row.joinCode,
        })),
      ).toEqual(
        expect.arrayContaining([
          { id: first.id, joinCode: first.joinCode },
          { id: second.id, joinCode: nextCode },
        ]),
      );
      expect(rows).toHaveLength(2);
      expect(await storedCourse(courseId)).toEqual({
        ...before,
        __v: (before.__v ?? 0) + 1,
      });
    } finally {
      generator.mockRestore();
    }
  });

  it.each(['delete', 'create'] as const)(
    'keeps consistent terminal state after MongoDB write contention when %s commits first',
    async (first) => {
      const courseId = await createCourse(`race-${first}`);
      const before = await storedCourse(courseId);
      if (!before) throw new Error('COURSE_LIFECYCLE_PARENT_MISSING');
      expect(await storedClassrooms(courseId)).toEqual([]);
      const responses = await raceDeleteAndCreate(courseId, first);
      const course = await storedCourse(courseId);
      const classrooms = await storedClassrooms(courseId);
      const created = responses.create.body as CreatedClassroomResponse;
      const deleteBody = responses.delete.body as { code?: string };
      const joined = classrooms[0];

      if (first === 'delete') {
        expect(responses.delete.status).toBe(200);
        expect(responses.delete.body).toEqual({ ok: true });
        expect(responses.create.status).toBe(404);
        expect(course).toBeNull();
        expect(classrooms).toEqual([]);
      } else {
        expect(responses.delete.status).toBe(409);
        expect(deleteBody).toMatchObject(courseNotEmpty);
        expect(responses.create.status).toBe(201);
        expect(course?.updatedAt).toEqual(before.updatedAt);
        expect(classrooms).toHaveLength(1);
        expect(created).toMatchObject({
          id: joined._id.toHexString(),
          courseId,
          teacherId: ownerId.toHexString(),
          course: {
            id: courseId,
            code: before.code,
            name: before.name,
            term: before.term,
            status: 'ACTIVE',
            courseLabel: '通用编程',
          },
          joinCode: joined.joinCode,
        });
        expect(joined.courseId.toHexString()).toBe(courseId);
        expect(joined.joinCode).toMatch(/^[A-HJ-NP-Z0-9]{6,8}$/);
      }
      console.info(
        JSON.stringify({
          stage: 'course-classroom-write-contention',
          firstCommit: first,
          mongoWriteConflict: 112,
          deleteStatus: responses.delete.status,
          deleteCode: deleteBody.code ?? null,
          createStatus: responses.create.status,
          courseExists: course !== null,
          classrooms: classrooms.length,
          receiptMatchesMongo: joined
            ? created.id === joined._id.toHexString()
            : null,
          courseUpdatedAtUnchanged: course
            ? course.updatedAt.getTime() === before.updatedAt.getTime()
            : null,
        }),
      );
    },
  );
});
