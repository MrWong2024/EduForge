import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { assertAuthTestWritesConfirmed } from './helpers/auth-test-writes';
import { createFixtureUser } from './helpers/create-fixture-user';
import { deleteFixtureRows } from './helpers/delete-fixture-rows';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type Connection,
  type Model,
  type mongo,
  STATES,
  Types,
} from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { parseCsv } from '../scripts/import-users-csv';
import { hashPassword } from '../src/modules/users/password.utils';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';

jest.setTimeout(60000);

const namespace = `csv-security-${randomUUID()}`;
// Synthetic application account credential; unrelated to infrastructure credentials.
const password = 'CsvSecurity123!';
const HTTP_TIMEOUT = { response: 10000, deadline: 15000 };
const DATABASE_OPERATION_BUDGET_MS = 10000;
const SERVER_MAX_TIME_MS = 5000;
const readOptions = () => ({
  maxTimeMS: SERVER_MAX_TIME_MS,
  signal: AbortSignal.timeout(DATABASE_OPERATION_BUDGET_MS),
});
type Agent = ReturnType<typeof request.agent>;
type Profile = { id: string; name?: string; studentNo?: string };
type AssessmentItem = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
  score: number;
  riskLevel: string;
  submittedTasksRate: number;
  submissionsCount: number;
  iteratedTasksCount: number;
  lateSubmissionsCount: number;
  lateTasksCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  aiRequestedTasksCount: number;
  aiSucceededTasksCount: number;
  avgWarnItems: number;
  avgErrorItems: number;
  topTags: { tag: string; count: number }[];
};
type UserOwnership = {
  _id: Types.ObjectId;
  email: string;
  roles: string[];
};
type CourseOwnership = {
  _id: Types.ObjectId;
  code: string;
  createdBy: Types.ObjectId;
};
type ClassroomOwnership = {
  _id: Types.ObjectId;
  name: string;
  courseId: Types.ObjectId;
  teacherId: Types.ObjectId;
};
type EnrollmentOwnership = {
  _id: Types.ObjectId;
  classroomId: Types.ObjectId;
  userId: Types.ObjectId;
};

describe('Process assessment CSV security (real HTTP and Mongo)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let independentConnection: Connection | undefined;
  let users: Model<User>;
  let sessions: Model<Session>;
  let resets: Model<PasswordResetToken>;
  let courses: Model<Course>;
  let classrooms: Model<Classroom>;
  let enrollments: Model<Enrollment>;
  let ownerAgent: Agent;
  let otherTeacherAgent: Agent;
  let studentAgent: Agent;
  let courseId = '';
  let classroomId = '';
  let enrollmentId = '';

  // Register exact IDs before any insert, including one whose response may be lost.
  const fixtures = [
    {
      id: new Types.ObjectId(),
      email: `${namespace}.owner@example.invalid`,
      role: 'teacher',
    },
    {
      id: new Types.ObjectId(),
      email: `${namespace}.other@example.invalid`,
      role: 'teacher',
    },
    {
      id: new Types.ObjectId(),
      email: `${namespace}.student@example.invalid`,
      role: 'student',
    },
  ];
  const [owner, , student] = fixtures;
  const userIds = fixtures.map(({ id }) => id);
  const userFilter = {
    $or: [
      { _id: { $in: userIds } },
      { email: { $in: fixtures.map(({ email }) => email) } },
    ],
  };
  const server = () => {
    if (!app) throw new Error('CSV_SECURITY_APP_REQUIRED');
    return app.getHttpServer();
  };
  const get = (agent: Agent, path: string) =>
    agent.get(path).timeout(HTTP_TIMEOUT);
  const post = (agent: Agent, path: string) =>
    agent.post(path).timeout(HTTP_TIMEOUT);

  beforeAll(async () => {
    console.info(
      `CSV security fixture: ${namespace}; user IDs: ${userIds.join(',')}`,
    );
    await prepareAuthSessionIndexes();
    connection = await openAuthTestConnection({ budgetModelReads: true });
    independentConnection = await openAuthTestConnection();
    // Inject the already gated real connection with autoIndex/autoCreate disabled.
    // HTTP, Guards, models and persistence remain real; only the explicit Session
    // preparation above may perform DDL in this narrow security test.
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    const defaultConnection = app.get<Connection>(getConnectionToken());
    const transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(defaultConnection);
    await assertAuthTestConnection(transactionConnection);
    const transactionDb = transactionConnection.db;
    if (!transactionDb) throw new Error('CSV_SECURITY_SNAPSHOT_DB_REQUIRED');
    const snapshotSession = await transactionConnection.startSession();
    try {
      snapshotSession.startTransaction({
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: SERVER_MAX_TIME_MS,
      });
      await transactionDb
        .collection('classrooms')
        .findOne(
          { _id: new Types.ObjectId() },
          { session: snapshotSession, ...readOptions() },
        );
      await snapshotSession.commitTransaction();
    } finally {
      await snapshotSession.endSession();
    }
    console.info('CSV security database gates passed', {
      default: defaultConnection.name,
      transaction: transactionConnection.name,
      independent: independentConnection.name,
      snapshot: 'committed',
    });
    sessions = app.get<Model<Session>>(getModelToken(Session.name));
    resets = app.get<Model<PasswordResetToken>>(
      getModelToken(PasswordResetToken.name),
    );
    courses = app.get<Model<Course>>(getModelToken(Course.name));
    classrooms = app.get<Model<Classroom>>(getModelToken(Classroom.name));
    enrollments = app.get<Model<Enrollment>>(getModelToken(Enrollment.name));
    users = app.get<Model<User>>(getModelToken(User.name));

    ownerAgent = request.agent(server());
    otherTeacherAgent = request.agent(server());
    studentAgent = request.agent(server());
    const passwordHash = await hashPassword(password);
    for (const fixture of fixtures) {
      await createFixtureUser(users, {
        _id: fixture.id,
        email: fixture.email,
        roles: [fixture.role],
        status: UserStatus.Active,
        passwordHash,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
      });
    }
    const storedStudent = await users
      .findById(student.id)
      .select({
        email: 1,
        roles: 1,
        credentialVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        __v: 1,
      })
      .setOptions(readOptions())
      .lean<{ createdAt: Date; updatedAt: Date }>()
      .exec();
    expect(storedStudent).toMatchObject({
      email: student.email,
      roles: ['student'],
      credentialVersion: 0,
      __v: 0,
    });
    expect(storedStudent?.createdAt).toBeInstanceOf(Date);
    expect(storedStudent?.updatedAt).toEqual(storedStudent?.createdAt);
    for (const [index, agent] of [
      ownerAgent,
      otherTeacherAgent,
      studentAgent,
    ].entries()) {
      await post(agent, '/api/auth/login')
        .send({ email: fixtures[index].email, password })
        .expect(201);
    }

    // These HTTP writes are never retried. Cleanup reconciles unique identifiers
    // even when a response or a later setup assertion fails.
    const courseResponse = await post(ownerAgent, '/api/courses')
      .send({ code: namespace, name: namespace, term: '2026-Fall' })
      .expect(201);
    const courseBody = courseResponse.body as { id: string };
    expect(Types.ObjectId.isValid(courseBody.id)).toBe(true);
    courseId = courseBody.id;
    const classroomResponse = await post(ownerAgent, '/api/classrooms')
      .send({ courseId, name: namespace })
      .expect(201);
    const classroom = classroomResponse.body as {
      id: string;
      joinCode: string;
    };
    expect(Types.ObjectId.isValid(classroom.id)).toBe(true);
    classroomId = classroom.id;
    await post(studentAgent, '/api/classrooms/join')
      .send({ joinCode: classroom.joinCode })
      .expect(201);
    const membership = await enrollments
      .findOne({
        classroomId: new Types.ObjectId(classroomId),
        userId: student.id,
      })
      .select({ _id: 1, role: 1, status: 1 })
      .lean<{
        _id: Types.ObjectId;
        role: EnrollmentRole;
        status: EnrollmentStatus;
      }>()
      .setOptions(readOptions())
      .exec();
    if (!membership) throw new Error('CSV_SECURITY_MEMBERSHIP_REQUIRED');
    enrollmentId = membership._id.toHexString();
    expect(membership.role).toBe(EnrollmentRole.Student);
    expect(membership.status).toBe(EnrollmentStatus.Active);
  });

  afterAll(async () => {
    try {
      if (connection && users) {
        await assertAuthTestConnection(connection);
        const db = connection.db;
        if (!db) throw new Error('CSV_SECURITY_DATABASE_REQUIRED');
        assertAuthTestWritesConfirmed(db);
        const deleteOwnedRows = (
          collection: string,
          filter: mongo.Document,
          limit: 0 | 1 = 1,
        ) =>
          deleteFixtureRows(
            db,
            collection,
            filter,
            limit,
            DATABASE_OPERATION_BUDGET_MS,
            SERVER_MAX_TIME_MS,
          );
        const accountRows = await users
          .find(userFilter)
          .select({ _id: 1, email: 1, roles: 1 })
          .lean<UserOwnership[]>()
          .setOptions(readOptions())
          .exec();
        for (const row of accountRows) {
          const fixture = fixtures.find(({ id }) => id.equals(row._id));
          if (
            !fixture ||
            row.email !== fixture.email ||
            row.roles.length !== 1 ||
            row.roles[0] !== fixture.role
          )
            throw new Error('CSV_SECURITY_USER_OWNERSHIP_MISMATCH');
        }
        const courseFilter = {
          $or: [
            { _id: { $in: courseId ? [new Types.ObjectId(courseId)] : [] } },
            { createdBy: owner.id, code: namespace },
          ],
        };
        const courseRows = await courses
          .find(courseFilter)
          .select({ _id: 1, code: 1, createdBy: 1 })
          .lean<CourseOwnership[]>()
          .setOptions(readOptions())
          .exec();
        if (
          courseRows.some(
            (row) => row.code !== namespace || !row.createdBy.equals(owner.id),
          )
        )
          throw new Error('CSV_SECURITY_COURSE_OWNERSHIP_MISMATCH');
        const courseIds = courseRows.map(({ _id }) => _id);
        const classroomFilter = {
          $or: [
            {
              _id: {
                $in: classroomId ? [new Types.ObjectId(classroomId)] : [],
              },
            },
            { teacherId: owner.id, name: namespace },
          ],
        };
        const classroomRows = await classrooms
          .find(classroomFilter)
          .select({ _id: 1, name: 1, courseId: 1, teacherId: 1 })
          .lean<ClassroomOwnership[]>()
          .setOptions(readOptions())
          .exec();
        if (
          classroomRows.some(
            (row) =>
              row.name !== namespace ||
              !row.teacherId.equals(owner.id) ||
              !courseIds.some((id) => id.equals(row.courseId)),
          )
        )
          throw new Error('CSV_SECURITY_CLASSROOM_OWNERSHIP_MISMATCH');
        const classroomIds = classroomRows.map(({ _id }) => _id);
        const enrollmentFilter = {
          $or: [
            { classroomId: { $in: classroomIds } },
            { userId: { $in: userIds } },
          ],
        };
        const membershipRows = await enrollments
          .find(enrollmentFilter)
          .select({ _id: 1, classroomId: 1, userId: 1 })
          .lean<EnrollmentOwnership[]>()
          .setOptions(readOptions())
          .exec();
        if (
          membershipRows.some(
            (row) =>
              !row.userId.equals(student.id) ||
              !classroomIds.some((id) => id.equals(row.classroomId)) ||
              (enrollmentId && row._id.toHexString() !== enrollmentId),
          )
        )
          throw new Error('CSV_SECURITY_ENROLLMENT_OWNERSHIP_MISMATCH');
        const resetRows = await resets
          .find({ userId: { $in: userIds } })
          .select({ _id: 0, userId: 1, email: 1 })
          .lean<{ userId: Types.ObjectId; email: string }[]>()
          .setOptions(readOptions())
          .exec();
        if (
          resetRows.some(
            (row) =>
              !fixtures.some(
                (fixture) =>
                  fixture.id.equals(row.userId) && fixture.email === row.email,
              ),
          )
        )
          throw new Error('CSV_SECURITY_RESET_OWNERSHIP_MISMATCH');

        for (const membership of membershipRows)
          await deleteOwnedRows(enrollments.collection.name, {
            _id: membership._id,
            classroomId: membership.classroomId,
            userId: membership.userId,
          });
        for (const classroom of classroomRows)
          await deleteOwnedRows(classrooms.collection.name, {
            _id: classroom._id,
            teacherId: owner.id,
            courseId: classroom.courseId,
            name: namespace,
          });
        for (const course of courseRows)
          await deleteOwnedRows(courses.collection.name, {
            _id: course._id,
            createdBy: owner.id,
            code: namespace,
          });
        await deleteOwnedRows(
          sessions.collection.name,
          { userId: { $in: userIds } },
          0,
        );
        for (const { id, email } of fixtures) {
          await deleteOwnedRows(
            resets.collection.name,
            { userId: id, email },
            0,
          );
        }
        for (const fixture of fixtures)
          await deleteOwnedRows(users.collection.name, {
            _id: fixture.id,
            email: fixture.email,
            roles: [fixture.role],
          });
        const readback = independentConnection?.db;
        if (!readback) throw new Error('CSV_SECURITY_READBACK_DB_REQUIRED');
        const count = (collection: string, filter: mongo.Document) =>
          readback.collection(collection).countDocuments(filter, readOptions());
        const residual = await Promise.all([
          count(enrollments.collection.name, enrollmentFilter),
          count(classrooms.collection.name, classroomFilter),
          count(courses.collection.name, courseFilter),
          count(sessions.collection.name, { userId: { $in: userIds } }),
          count(resets.collection.name, { userId: { $in: userIds } }),
          count(users.collection.name, userFilter),
        ]);
        expect(residual).toEqual([0, 0, 0, 0, 0, 0]);
        console.info(
          'CSV security residual: Enrollment/Classroom/Course/Session/ResetToken/User = 0/0/0/0/0/0.',
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

  it('neutralizes formally writable profile text only in CSV, preserving database and JSON facts', async () => {
    const patch = await studentAgent
      .patch('/api/users/me')
      .timeout(HTTP_TIMEOUT)
      .send({ name: '  =1+1,"学生"\r\n下一行  ', studentNo: '  -1  ' })
      .expect(200);
    const expectedName = '=1+1,"学生"\r\n下一行';
    expect((patch.body as Profile).name).toBe(expectedName);
    expect((patch.body as Profile).studentNo).toBe('-1');
    const storedProfile = await users
      .findOne({ _id: student.id, email: student.email })
      .select({ _id: 0, name: 1, studentNo: 1 })
      .lean<{ name: string; studentNo: string }>()
      .setOptions(readOptions())
      .exec();
    expect(storedProfile).toEqual({ name: expectedName, studentNo: '-1' });
    const sessionRead = jest.spyOn(sessions.collection, 'findOne');
    try {
      const me = await get(studentAgent, '/api/users/me').expect(200);
      expect((me.body as Profile).name).toBe(expectedName);
      expect((me.body as Profile).studentNo).toBe('-1');
      expect(
        sessionRead.mock.calls.some(
          ([, options]) =>
            options?.signal instanceof AbortSignal &&
            typeof options.maxTimeMS === 'number' &&
            options.maxTimeMS > 0 &&
            options.maxTimeMS <= DATABASE_OPERATION_BUDGET_MS,
        ),
      ).toBe(true);
      console.info(
        'GET /api/users/me session model read supplied a signal and positive maxTimeMS within 10s.',
      );
    } finally {
      sessionRead.mockRestore();
    }

    const jsonResponse = await get(
      ownerAgent,
      `/api/classrooms/${classroomId}/process-assessment`,
    ).expect(200);
    const report = jsonResponse.body as {
      total: number;
      items: AssessmentItem[];
    };
    expect(report.total).toBe(1);
    expect(report.items).toHaveLength(1);
    const item = report.items[0];
    expect(item.studentId).toBe(student.id.toHexString());
    expect(item.studentName).toBe(expectedName);
    expect(item.studentNo).toBe('-1');
    expect(item.topTags).toEqual([]);

    const csvResponse = await get(
      ownerAgent,
      `/api/classrooms/${classroomId}/process-assessment.csv`,
    )
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', (error: Error) => done(error, undefined));
      })
      .expect(200);
    expect(csvResponse.headers['content-type']).toBe('text/csv; charset=utf-8');
    const bytes: unknown = csvResponse.body;
    if (!Buffer.isBuffer(bytes)) throw new Error('CSV_SECURITY_BYTES_REQUIRED');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.toString('utf8');
    const header =
      'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,aiRequestedTasksCount,aiSucceededTasksCount,avgWarnItems,avgErrorItems,topTags';
    expect(
      csv.startsWith(
        `\uFEFF${header}\n"\t=1+1,""学生""\r\n下一行","\t-1",${student.id.toHexString()},`,
      ),
    ).toBe(true);
    const records = parseCsv(csv);
    expect(records).toHaveLength(2);
    expect(records.map(({ cells }) => cells.length)).toEqual([17, 17]);
    expect(records[0].cells).toEqual(header.split(','));
    expect(records[1].cells).toEqual([
      '\t=1+1,"学生"\r\n下一行',
      '\t-1',
      student.id.toHexString(),
      String(item.score),
      item.riskLevel,
      String(item.submittedTasksRate),
      String(item.submissionsCount),
      String(item.iteratedTasksCount),
      String(item.lateSubmissionsCount),
      String(item.lateTasksCount),
      String(item.aiRequestedCount),
      String(item.aiSucceededCount),
      String(item.aiRequestedTasksCount),
      String(item.aiSucceededTasksCount),
      String(item.avgWarnItems),
      String(item.avgErrorItems),
      '',
    ]);
    // Export must not persist its TAB marker or change JSON projection afterwards.
    expect(
      await users
        .findOne({ _id: student.id, email: student.email })
        .select({ _id: 0, name: 1, studentNo: 1 })
        .lean<{ name: string; studentNo: string }>()
        .setOptions(readOptions())
        .exec(),
    ).toEqual(storedProfile);
    const after = await get(
      ownerAgent,
      `/api/classrooms/${classroomId}/process-assessment`,
    ).expect(200);
    expect((after.body as { items: AssessmentItem[] }).items).toEqual(
      report.items,
    );
  });

  it('retains anonymous, student and non-owner teacher CSV denial semantics', async () => {
    const path = `/api/classrooms/${classroomId}/process-assessment.csv`;
    await request(server()).get(path).timeout(HTTP_TIMEOUT).expect(401);
    await get(studentAgent, path).expect(403);
    await get(otherTeacherAgent, path).expect(404);
  });
});
