import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type mongo, STATES, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { parseCsv } from '../scripts/import-users-csv';
import { hashPassword } from '../src/modules/users/password.utils';
import {
  User,
  UserSchema,
  UserStatus,
} from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);

const namespace = `report-status-${randomUUID()}`;
const teacherId = new Types.ObjectId();
const studentId = new Types.ObjectId();
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
    id: new Types.ObjectId(),
    email: `${namespace}.other-teacher@example.invalid`,
    role: 'teacher',
  },
];
// Dedicated synthetic application credential, unrelated to real accounts.
const password = 'ReportStatus123!';
const timeout = { response: 10000, deadline: 15000 };
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
  publishedAt?: Date;
  dueAt?: Date;
  settings?: { allowLate?: boolean };
  updatedAt?: Date;
};
type ClassroomTaskResponse = {
  id: string;
  status: string;
  dueAt?: string;
  settings: { allowLate?: boolean };
};
type AssessmentItem = {
  studentId: string;
  submittedTasksCount: number;
  publishedTasksCount: number;
  submittedTasksRate: number;
  submissionsCount: number;
  score: number;
  riskLevel: string;
};
type Assessment = { total: number; items: AssessmentItem[] };
type Dashboard = {
  tasks: unknown[];
  summary: {
    studentsCount: number;
    publishedTasksCount: number;
    lateSubmissionsTotal: number;
    lateStudentsTotal: number;
  };
  archiveSuggestion: unknown;
};

describe('Classroom report task status (real HTTP and Mongo)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let db: mongo.Db | undefined;
  let httpServer: Server | undefined;
  let teacher: Agent;
  let student: Agent;
  let otherTeacher: Agent;
  let courseId = '';
  let classroomId = '';
  let recalledId = '';

  function database(): mongo.Db {
    if (!db) throw new Error('REPORT_STATUS_DATABASE_REQUIRED');
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
    agent.post(path).timeout(timeout).send(body);
  const get = (path: string) => teacher.get(path).timeout(timeout);
  const classroomPath = () => `/api/classrooms/${classroomId}`;
  const report = async (excludedTaskIds?: string): Promise<Assessment> => {
    const response = await get(`${classroomPath()}/process-assessment`)
      .query(excludedTaskIds === undefined ? {} : { excludedTaskIds })
      .expect(200);
    return response.body as Assessment;
  };
  const weeklyActivity = async () => {
    const response = await get(`${classroomPath()}/weekly-report`)
      .query({ window: '7d' })
      .expect(200);
    const body = response.body as {
      progress: {
        distinctStudentsSubmitted: number;
        publishedClassroomTasks: number;
      };
      aiHealth: { jobs: { total: number } };
    };
    return { progress: body.progress, jobs: body.aiHealth.jobs };
  };
  function studentItem(body: Assessment): AssessmentItem {
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const item = body.items.find(
      (value) => value.studentId === studentId.toHexString(),
    );
    if (!item) throw new Error('REPORT_STATUS_STUDENT_MISSING');
    return item;
  }
  function logReading(stage: string, item: AssessmentItem): void {
    console.info(
      JSON.stringify({
        stage,
        studentId: item.studentId,
        submittedTasksCount: item.submittedTasksCount,
        publishedTasksCount: item.publishedTasksCount,
        submittedTasksRate: item.submittedTasksRate,
        score: item.score,
        riskLevel: item.riskLevel,
      }),
    );
  }
  function businessSnapshot() {
    return Promise.all([
      rows('tasks', { createdBy: teacherId }),
      rows('classroomtasks', { createdBy: teacherId }),
      rows('enrollments', { userId: studentId }),
      rows('submissions', { studentId }),
    ]);
  }
  async function publish(key: string): Promise<string> {
    const created = await post(teacher, '/api/learning-tasks/tasks', {
      title: `${namespace}-${key}`,
      description: 'Report status fixture.',
      knowledgeModule: 'report-status',
      status: 'DRAFT',
    }).expect(201);
    const taskId = (created.body as { id: string }).id;
    expect(Types.ObjectId.isValid(taskId)).toBe(true);
    await post(
      teacher,
      `/api/learning-tasks/tasks/${taskId}/publish`,
      {},
    ).expect(201);
    const published = await post(teacher, `${classroomPath()}/tasks`, {
      taskId,
    }).expect(201);
    const id = (published.body as { id: string }).id;
    expect(Types.ObjectId.isValid(id)).toBe(true);
    const persisted = await rows('classroomtasks', {
      _id: new Types.ObjectId(id),
      createdBy: teacherId,
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('ACTIVE');
    expect(persisted[0].publishedAt).toBeInstanceOf(Date);
    return id;
  }
  async function setStatus(
    id: string,
    status: 'RECALLED' | 'CLOSED',
  ): Promise<void> {
    await teacher
      .patch(`${classroomPath()}/tasks/${id}/status`)
      .timeout(timeout)
      .send({ status })
      .expect(200);
    const persisted = await rows('classroomtasks', {
      _id: new Types.ObjectId(id),
      createdBy: teacherId,
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe(status);
  }
  const instancePath = (id: string, targetClassroomId = classroomId) =>
    `/api/classrooms/${targetClassroomId}/tasks/${id}`;
  const patchStatus = (
    id: string,
    status: 'ACTIVE' | 'CLOSED' | 'RECALLED',
    targetClassroomId = classroomId,
  ) =>
    teacher
      .patch(`${instancePath(id, targetClassroomId)}/status`)
      .timeout(timeout)
      .send({ status });
  const patchSettings = (
    id: string,
    body: Record<string, unknown>,
    targetClassroomId = classroomId,
  ) =>
    teacher
      .patch(instancePath(id, targetClassroomId))
      .timeout(timeout)
      .send(body);
  async function storedInstance(id: string): Promise<Row> {
    const persisted = await rows('classroomtasks', {
      _id: new Types.ObjectId(id),
      classroomId: new Types.ObjectId(classroomId),
      createdBy: teacherId,
    });
    expect(persisted).toHaveLength(1);
    return persisted[0];
  }
  async function settleRequests(
    requests: request.Test[],
  ): Promise<request.Response[]> {
    const settled = await Promise.allSettled(requests);
    return settled.map((result) => {
      if (result.status !== 'fulfilled')
        throw new Error('REPORT_STATUS_OVERLAPPING_HTTP_FAILED');
      return result.value;
    });
  }
  function expectPublicRejection(
    response: request.Response,
    status: 400 | 404,
    path: string,
    message?: string,
  ): void {
    expect(response.status).toBe(status);
    const body = response.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'message',
      'path',
      'statusCode',
      'timestamp',
    ]);
    expect(body.statusCode).toBe(status);
    expect(body.path).toBe(path);
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toBe('');
    if (message !== undefined) expect(body.message).toBe(message);
  }
  function logMutation(stage: string, response: request.Response): void {
    const body = response.body as Partial<ClassroomTaskResponse>;
    console.info(
      JSON.stringify({
        stage,
        httpStatus: response.status,
        status: body.status,
        dueAt: body.dueAt,
        allowLate: body.settings?.allowLate,
      }),
    );
  }
  async function expectInstanceState(
    id: string,
    status: string,
    allowLate: boolean,
    dueAt?: string,
  ): Promise<Row> {
    const response = await get(instancePath(id)).expect(200);
    const body = response.body as ClassroomTaskResponse;
    const persisted = await storedInstance(id);
    console.info(
      JSON.stringify({
        stage: 'instance-readback',
        classroomTaskId: id,
        response: {
          status: body.status,
          dueAt: body.dueAt,
          allowLate: body.settings.allowLate,
        },
        mongo: {
          status: persisted.status,
          dueAt: persisted.dueAt?.toISOString(),
          allowLate: persisted.settings?.allowLate,
        },
      }),
    );
    expect(body.id).toBe(id);
    expect(body.status).toBe(status);
    expect(body.settings.allowLate).toBe(allowLate);
    expect(persisted.status).toBe(status);
    expect(persisted.settings?.allowLate).toBe(allowLate);
    if (dueAt === undefined) {
      expect(body.dueAt).toBeUndefined();
      expect(persisted.dueAt).toBeUndefined();
    } else {
      expect(body.dueAt).toBe(dueAt);
      expect(persisted.dueAt).toBeInstanceOf(Date);
      expect(persisted.dueAt?.toISOString()).toBe(dueAt);
    }
    return persisted;
  }

  beforeAll(async () => {
    console.info(
      `Classroom report fixture: ${namespace}; user IDs: ${teacherId.toHexString()},${studentId.toHexString()}`,
    );
    await prepareAuthSessionIndexes();
    connection = await openAuthTestConnection();
    db = connection.db;
    if (!db) throw new Error('REPORT_STATUS_DATABASE_REQUIRED');
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
    const users = connection.model(User.name, UserSchema);
    const passwordHash = await hashPassword(password);
    for (const account of accounts)
      await users.create({
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
    otherTeacher = request.agent(httpServer);
    await post(teacher, '/api/auth/login', {
      email: accounts[0].email,
      password,
    }).expect(201);
    await post(student, '/api/auth/login', {
      email: accounts[1].email,
      password,
    }).expect(201);
    await post(otherTeacher, '/api/auth/login', {
      email: accounts[2].email,
      password,
    }).expect(201);
    const createdCourse = await post(teacher, '/api/courses', {
      code: namespace,
      name: namespace,
      term: 'current',
    }).expect(201);
    courseId = (createdCourse.body as { id: string }).id;
    expect(Types.ObjectId.isValid(courseId)).toBe(true);
    const createdClassroom = await post(teacher, '/api/classrooms', {
      courseId,
      name: namespace,
    }).expect(201);
    const classroom = createdClassroom.body as { id: string; joinCode: string };
    classroomId = classroom.id;
    expect(Types.ObjectId.isValid(classroomId)).toBe(true);
    await post(student, '/api/classrooms/join', {
      joinCode: classroom.joinCode,
    }).expect(201);
    const memberships = await rows('enrollments', { userId: studentId });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].classroomId?.toHexString()).toBe(classroomId);
    expect(memberships[0].status).toBe('ACTIVE');
    recalledId = await publish('recalled');
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
          throw new Error('REPORT_STATUS_USER_OWNERSHIP_MISMATCH');
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
          throw new Error('REPORT_STATUS_CLASSROOM_OWNERSHIP_MISMATCH');
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
          throw new Error('REPORT_STATUS_INSTANCE_OWNERSHIP_MISMATCH');
        const instanceIds = instances.map(({ _id }) => _id);
        const submissionFilter = {
          $or: [
            { studentId },
            { classroomTaskId: { $in: instanceIds } },
            { taskId: { $in: taskIds } },
          ],
        };
        const submissions = await rows('submissions', submissionFilter);
        if (
          submissions.some(
            (row) =>
              !row.studentId?.equals(studentId) ||
              !instances.some(
                (instance) =>
                  instance._id.equals(row.classroomTaskId) &&
                  instance.taskId?.equals(row.taskId),
              ),
          )
        )
          throw new Error('REPORT_STATUS_SUBMISSION_OWNERSHIP_MISMATCH');
        const submissionIds = submissions.map(({ _id }) => _id);
        const jobFilter = {
          $or: [
            { studentId },
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
              !row.studentId?.equals(studentId) ||
              !submissions.some(
                (submission) =>
                  submission._id.equals(row.submissionId) &&
                  submission.classroomTaskId?.equals(row.classroomTaskId) &&
                  submission.taskId?.equals(row.taskId),
              ),
          )
        )
          throw new Error('REPORT_STATUS_JOB_OWNERSHIP_MISMATCH');
        const feedbackFilter = { submissionId: { $in: submissionIds } };
        const feedback = await rows('feedbacks', feedbackFilter, {
          _id: 1,
          submissionId: 1,
        });
        const enrollmentFilter = {
          $or: [{ userId: studentId }, { classroomId: { $in: classroomIds } }],
        };
        const memberships = await rows('enrollments', enrollmentFilter);
        if (
          memberships.some(
            (row) =>
              !row.userId?.equals(studentId) ||
              !classroomIds.some((id) => id.equals(row.classroomId)),
          )
        )
          throw new Error('REPORT_STATUS_ENROLLMENT_OWNERSHIP_MISMATCH');
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
          throw new Error('REPORT_STATUS_RESET_OWNERSHIP_MISMATCH');
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
            .deleteOne({ _id: row._id, studentId }, { timeoutMS: 5000 });
        for (const row of submissions)
          await db
            .collection('submissions')
            .deleteOne(
              { _id: row._id, studentId, classroomTaskId: row.classroomTaskId },
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
          await db
            .collection('enrollments')
            .deleteOne(
              { _id: row._id, userId: studentId, classroomId: row.classroomId },
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
          'Classroom report fixture residual: all 11 scoped collections = 0.',
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
            'Classroom report cleanup: Mongo disconnected; HTTP server closed or not started.',
          );
        } finally {
          authTestEnvironment.restore();
        }
      }
    }
  });

  it('removes a formally recalled unsubmitted task from assessment while preserving the active student', async () => {
    const before = studentItem(await report());
    logReading('before-recall', before);
    expect(before).toMatchObject({
      studentId: studentId.toHexString(),
      publishedTasksCount: 1,
      submittedTasksCount: 0,
      riskLevel: 'HIGH',
    });
    await setStatus(recalledId, 'RECALLED');
    const facts = await businessSnapshot();
    const after = studentItem(await report());
    logReading('after-recall', after);
    const excluded = studentItem(await report(recalledId));
    logReading('after-recall-explicit-exclusion', excluded);
    expect(after).toMatchObject({
      studentId: studentId.toHexString(),
      publishedTasksCount: 0,
      submittedTasksCount: 0,
      submittedTasksRate: 0,
      submissionsCount: 0,
      iteratedTasksCount: 0,
      lateSubmissionsCount: 0,
      lateTasksCount: 0,
      aiRequestedCount: 0,
      aiSucceededCount: 0,
      aiRequestedTasksCount: 0,
      aiSucceededTasksCount: 0,
      avgFeedbackItems: 0,
      avgWarnItems: 0,
      avgErrorItems: 0,
      topTags: [],
      score: 0,
      riskLevel: 'LOW',
    });
    expect(excluded).toEqual(after);
    expect(await businessSnapshot()).toEqual(facts);
  });

  it('returns complete numeric empty dashboard summaries for both visibility modes after recall', async () => {
    const facts = await businessSnapshot();
    for (const includeClosedTasks of [false, true]) {
      const response = await get(`${classroomPath()}/dashboard`)
        .query({ includeClosedTasks: String(includeClosedTasks) })
        .expect(200);
      const body = response.body as Dashboard;
      console.info(
        JSON.stringify({
          stage: 'empty-dashboard',
          includeClosedTasks,
          summary: body.summary,
        }),
      );
      expect(body.tasks).toEqual([]);
      expect(body.summary).toEqual({
        studentsCount: 1,
        publishedTasksCount: 0,
        lateSubmissionsTotal: 0,
        lateStudentsTotal: 0,
      });
      expect(typeof body.summary.lateSubmissionsTotal).toBe('number');
      expect(typeof body.summary.lateStudentsTotal).toBe('number');
      expect(body.archiveSuggestion).toBeDefined();
    }
    expect(await businessSnapshot()).toEqual(facts);
  });

  it('exports the explicit no-effective-task score, risk and coverage in the existing CSV columns', async () => {
    const facts = await businessSnapshot();
    const response = await get(
      `${classroomPath()}/process-assessment.csv`,
    ).expect(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.text.startsWith('\uFEFF')).toBe(true);
    const records = parseCsv(response.text);
    expect(records).toHaveLength(2);
    expect(records.map(({ cells }) => cells.length)).toEqual([17, 17]);
    expect(records[0].cells).toEqual([
      'studentName',
      'studentNo',
      'studentId',
      'score',
      'riskLevel',
      'submittedTasksRate',
      'submissionsCount',
      'iteratedTasksCount',
      'lateSubmissionsCount',
      'lateTasksCount',
      'aiRequestedCount',
      'aiSucceededCount',
      'aiRequestedTasksCount',
      'aiSucceededTasksCount',
      'avgWarnItems',
      'avgErrorItems',
      'topTags',
    ]);
    const row = records
      .slice(1)
      .find(({ cells }) => cells[2] === studentId.toHexString());
    if (!row) throw new Error('REPORT_STATUS_CSV_STUDENT_MISSING');
    console.info(
      JSON.stringify({
        stage: 'recalled-csv',
        score: row.cells[3],
        riskLevel: row.cells[4],
        submittedTasksRate: row.cells[5],
      }),
    );
    expect(row.cells[3]).toBe('0');
    expect(row.cells[4]).toBe('LOW');
    expect(row.cells[5]).toBe('0');
    expect(await businessSnapshot()).toEqual(facts);
  });

  it('uses the corrected process assessment in a current seven-day teaching snapshot', async () => {
    const facts = await businessSnapshot();
    const response = await get(`${classroomPath()}/export/snapshot`)
      .query({ window: '7d', includePerTask: 'false' })
      .expect(200);
    const body = response.body as {
      processAssessment: { items: AssessmentItem[] };
    };
    expect(body.processAssessment.items).toHaveLength(1);
    const item = body.processAssessment.items.find(
      (value) => value.studentId === studentId.toHexString(),
    );
    if (!item) throw new Error('REPORT_STATUS_SNAPSHOT_STUDENT_MISSING');
    console.info(
      JSON.stringify({
        stage: 'recalled-snapshot',
        score: item.score,
        riskLevel: item.riskLevel,
      }),
    );
    expect(item.score).toBe(0);
    expect(item.riskLevel).toBe('LOW');
    expect(await businessSnapshot()).toEqual(facts);
  });

  it('counts CLOSED and ACTIVE instances but excludes RECALLED and then an explicitly excluded ACTIVE instance', async () => {
    const closedId = await publish('closed');
    const activeId = await publish('active');
    const submitted = await post(
      student,
      `${classroomPath()}/tasks/${closedId}/submissions`,
      {
        content: { codeText: 'const answer = 42;', language: 'javascript' },
      },
    ).expect(201);
    expect(Types.ObjectId.isValid((submitted.body as { id: string }).id)).toBe(
      true,
    );
    await setStatus(closedId, 'CLOSED');
    const instances = await rows('classroomtasks', { createdBy: teacherId });
    expect(instances.map(({ status }) => status).sort()).toEqual([
      'ACTIVE',
      'CLOSED',
      'RECALLED',
    ]);
    const submissions = await rows('submissions', { studentId });
    expect(submissions).toHaveLength(1);
    expect(submissions[0].classroomTaskId?.toHexString()).toBe(closedId);
    expect(
      await database()
        .collection('aifeedbackjobs')
        .countDocuments({ studentId }, { maxTimeMS: 5000 }),
    ).toBe(0);
    const facts = await businessSnapshot();
    const mixed = studentItem(await report());
    const excluded = studentItem(await report(activeId));
    logReading('mixed-active-closed-recalled', mixed);
    logReading('mixed-exclude-active', excluded);
    expect(mixed).toMatchObject({
      submittedTasksCount: 1,
      publishedTasksCount: 2,
      submittedTasksRate: 0.5,
      submissionsCount: 1,
    });
    expect(excluded).toMatchObject({
      submittedTasksCount: 1,
      publishedTasksCount: 1,
      submittedTasksRate: 1,
      submissionsCount: 1,
    });
    expect(await businessSnapshot()).toEqual(facts);
  });

  it('independently rejects close, reopen and settings changes on an already recalled instance', async () => {
    const terminalId = await publish('independent-recalled-terminal');
    await patchStatus(terminalId, 'RECALLED').expect(200);
    const before = await storedInstance(terminalId);
    expect(before.status).toBe('RECALLED');
    for (const target of ['CLOSED', 'ACTIVE'] as const) {
      const response = await patchStatus(terminalId, target);
      logMutation(`recalled-reject-${target}`, response);
      expectPublicRejection(
        response,
        400,
        `${instancePath(terminalId)}/status`,
        'Recalled classroom tasks cannot be reopened or closed',
      );
      expect(await storedInstance(terminalId)).toEqual(before);
    }
    const response = await patchSettings(terminalId, { allowLate: false });
    logMutation('recalled-reject-settings', response);
    expectPublicRejection(
      response,
      400,
      instancePath(terminalId),
      'Recalled classroom tasks cannot be updated',
    );
    expect(await storedInstance(terminalId)).toEqual(before);
    await expectInstanceState(terminalId, 'RECALLED', true);
  });

  it('keeps a normal settings/recall race consistent and checks the opposite order with a sequential control', async () => {
    const id = await publish('settings-recall-race');
    expect((await storedInstance(id)).settings?.allowLate).toBe(true);
    const [settingsResponse, recallResponse] = await settleRequests([
      patchSettings(id, { allowLate: false }),
      patchStatus(id, 'RECALLED'),
    ]);
    logMutation('settings-recall-settings', settingsResponse);
    logMutation('settings-recall-recall', recallResponse);
    const final = await storedInstance(id);
    console.info(
      JSON.stringify({
        stage: 'settings-recall-final',
        status: final.status,
        allowLate: final.settings?.allowLate,
      }),
    );
    expect(recallResponse.status).toBe(200);
    expect([200, 400]).toContain(settingsResponse.status);
    const recallBody = recallResponse.body as ClassroomTaskResponse;
    expect(recallBody.status).toBe('RECALLED');
    const settingsCommitted = settingsResponse.status === 200;
    if (settingsCommitted) {
      const settingsBody = settingsResponse.body as ClassroomTaskResponse;
      expect(settingsBody.status).toBe('ACTIVE');
      expect(settingsBody.settings.allowLate).toBe(false);
      expect(recallBody.settings.allowLate).toBe(false);
    } else {
      expectPublicRejection(settingsResponse, 400, instancePath(id));
      expect(recallBody.settings.allowLate).toBe(true);
    }
    await expectInstanceState(id, 'RECALLED', !settingsCommitted);

    const controlId = await publish('settings-recall-order-control');
    console.info(
      JSON.stringify({
        stage: 'settings-recall-control',
        order: settingsCommitted
          ? 'recall-then-settings'
          : 'settings-then-recall',
      }),
    );
    if (settingsCommitted) {
      const recalled = await patchStatus(controlId, 'RECALLED').expect(200);
      expect((recalled.body as ClassroomTaskResponse).settings.allowLate).toBe(
        true,
      );
      const beforeRejectedSettings = await storedInstance(controlId);
      const rejected = await patchSettings(controlId, { allowLate: false });
      expectPublicRejection(
        rejected,
        400,
        instancePath(controlId),
        'Recalled classroom tasks cannot be updated',
      );
      expect(await storedInstance(controlId)).toEqual(beforeRejectedSettings);
      await expectInstanceState(controlId, 'RECALLED', true);
    } else {
      const changed = await patchSettings(controlId, {
        allowLate: false,
      }).expect(200);
      expect((changed.body as ClassroomTaskResponse).status).toBe('ACTIVE');
      expect((changed.body as ClassroomTaskResponse).settings.allowLate).toBe(
        false,
      );
      const recalled = await patchStatus(controlId, 'RECALLED').expect(200);
      expect((recalled.body as ClassroomTaskResponse).settings.allowLate).toBe(
        false,
      );
      await expectInstanceState(controlId, 'RECALLED', false);
    }
  });

  it('preserves independent precise dueAt and false allowLate patches while ACTIVE or CLOSED and clears dueAt without changing false', async () => {
    const editableId = await publish('independent-settings');
    const firstDate = new Date(Date.now() + 2 * 86400000);
    firstDate.setUTCSeconds(37, 456);
    const dueAt = firstDate.toISOString();
    const nextDate = new Date(firstDate.getTime() + 86400000);
    nextDate.setUTCSeconds(49, 789);
    const laterDueAt = nextDate.toISOString();
    const [dueResponse, initialAllowLateResponse] = await settleRequests([
      patchSettings(editableId, { dueAt }),
      patchSettings(editableId, { allowLate: false }),
    ]);
    logMutation('overlapping-dueAt-only', dueResponse);
    logMutation('overlapping-allowLate-only', initialAllowLateResponse);
    expect([dueResponse.status, initialAllowLateResponse.status]).toEqual([
      200, 200,
    ]);
    expect((dueResponse.body as ClassroomTaskResponse).status).toBe('ACTIVE');
    expect((dueResponse.body as ClassroomTaskResponse).dueAt).toBe(dueAt);
    expect(
      (initialAllowLateResponse.body as ClassroomTaskResponse).status,
    ).toBe('ACTIVE');
    expect(
      (initialAllowLateResponse.body as ClassroomTaskResponse).settings
        .allowLate,
    ).toBe(false);
    await expectInstanceState(editableId, 'ACTIVE', false, dueAt);
    const allowLateResponse = await patchSettings(editableId, {
      allowLate: false,
    }).expect(200);
    logMutation('active-allowLate-only', allowLateResponse);
    expect((allowLateResponse.body as ClassroomTaskResponse).dueAt).toBe(dueAt);
    expect(
      (allowLateResponse.body as ClassroomTaskResponse).settings.allowLate,
    ).toBe(false);
    await expectInstanceState(editableId, 'ACTIVE', false, dueAt);

    const beforeClose = await storedInstance(editableId);
    const closed = await patchStatus(editableId, 'CLOSED').expect(200);
    expect((closed.body as ClassroomTaskResponse).status).toBe('CLOSED');
    const afterClose = await expectInstanceState(
      editableId,
      'CLOSED',
      false,
      dueAt,
    );
    expect({ ...afterClose, updatedAt: beforeClose.updatedAt }).toEqual({
      ...beforeClose,
      status: 'CLOSED',
    });
    const changedWhileClosed = await patchSettings(editableId, {
      dueAt: laterDueAt,
    }).expect(200);
    logMutation('closed-dueAt-only', changedWhileClosed);
    expect((changedWhileClosed.body as ClassroomTaskResponse).status).toBe(
      'CLOSED',
    );
    await expectInstanceState(editableId, 'CLOSED', false, laterDueAt);
    const clearedNull = await patchSettings(editableId, { dueAt: null }).expect(
      200,
    );
    logMutation('closed-clear-null', clearedNull);
    expect((clearedNull.body as ClassroomTaskResponse).settings.allowLate).toBe(
      false,
    );
    await expectInstanceState(editableId, 'CLOSED', false);
    await patchSettings(editableId, { dueAt }).expect(200);
    await expectInstanceState(editableId, 'CLOSED', false, dueAt);
    const clearedEmpty = await patchSettings(editableId, { dueAt: '' }).expect(
      200,
    );
    logMutation('closed-clear-empty', clearedEmpty);
    expect(
      (clearedEmpty.body as ClassroomTaskResponse).settings.allowLate,
    ).toBe(false);
    await expectInstanceState(editableId, 'CLOSED', false);
    const beforeReopen = await storedInstance(editableId);
    const reopened = await patchStatus(editableId, 'ACTIVE').expect(200);
    logMutation('normal-reopen', reopened);
    expect((reopened.body as ClassroomTaskResponse).status).toBe('ACTIVE');
    const afterReopen = await expectInstanceState(editableId, 'ACTIVE', false);
    expect({ ...afterReopen, updatedAt: beforeReopen.updatedAt }).toEqual({
      ...beforeReopen,
      status: 'ACTIVE',
    });
  });

  it('returns 404 for the same instance ID under another owned classroom on both patch routes without writing', async () => {
    const crossClassInstanceId = await publish('cross-class-scope');
    const created = await post(teacher, '/api/classrooms', {
      courseId,
      name: `${namespace}-scope-check`,
    }).expect(201);
    const otherClassroomId = (created.body as { id: string }).id;
    expect(Types.ObjectId.isValid(otherClassroomId)).toBe(true);
    const before = await storedInstance(crossClassInstanceId);
    expect(before.status).toBe('ACTIVE');
    expect(before.settings?.allowLate).toBe(true);
    const otherBefore = await rows('classrooms', {
      _id: new Types.ObjectId(otherClassroomId),
      teacherId,
    });
    expect(otherBefore).toHaveLength(1);
    const statusResponse = await patchStatus(
      crossClassInstanceId,
      'RECALLED',
      otherClassroomId,
    );
    const settingsResponse = await patchSettings(
      crossClassInstanceId,
      { allowLate: false },
      otherClassroomId,
    );
    logMutation('cross-class-status', statusResponse);
    logMutation('cross-class-settings', settingsResponse);
    expectPublicRejection(
      statusResponse,
      404,
      `${instancePath(crossClassInstanceId, otherClassroomId)}/status`,
      'Classroom task not found',
    );
    expectPublicRejection(
      settingsResponse,
      404,
      instancePath(crossClassInstanceId, otherClassroomId),
      'Classroom task not found',
    );
    expect(await storedInstance(crossClassInstanceId)).toEqual(before);
    expect(
      await rows('classrooms', {
        _id: new Types.ObjectId(otherClassroomId),
        teacherId,
      }),
    ).toEqual(otherBefore);
  });

  it.each(['ACTIVE', 'CLOSED'] as const)(
    'recalls a submitted %s instance and preserves authorized history and weekly activity',
    async (source) => {
      const baseline = studentItem(await report());
      const baselineWeekly = await weeklyActivity();
      const id = await publish(`submitted-recall-${source.toLowerCase()}`);
      const classroomTaskId = new Types.ObjectId(id);
      const submissionsUrl = `${instancePath(id)}/submissions`;
      const content = {
        codeText: 'const answer = 42;',
        language: 'javascript',
      };
      const submitted = await post(student, submissionsUrl, { content }).expect(
        201,
      );
      const work = submitted.body as { id: string; contentRevision: number };
      const submissionId = new Types.ObjectId(work.id);
      const submissionUrl = `/api/learning-tasks/submissions/${work.id}`;
      await post(student, `${submissionUrl}/ai-feedback/request`, {
        expectedRevision: work.contentRevision,
      }).expect(200);
      const feedback = await post(teacher, `${submissionUrl}/feedback`, {
        expectedRevision: work.contentRevision,
        source: 'TEACHER',
        type: 'STYLE',
        severity: 'WARN',
        message: 'Use clearer naming.',
        tags: ['readability'],
      }).expect(201);
      const feedbackId = (feedback.body as { id: string }).id;
      if (source === 'CLOSED') await setStatus(id, 'CLOSED');
      const instanceBefore = await storedInstance(id);
      expect(instanceBefore.status).toBe(source);

      const history = () =>
        Promise.all([
          rows('submissions', { classroomTaskId }),
          rows('feedbacks', { submissionId }),
          rows('aifeedbackjobs', { submissionId }),
        ]);
      const before = await history();
      expect(before.map((records) => records.length)).toEqual([1, 1, 1]);
      expect(before[0][0]).toMatchObject({
        _id: submissionId,
        classroomTaskId,
        studentId,
        taskId: instanceBefore.taskId,
        attemptNo: 1,
        content,
      });
      expect(before[1][0]).toMatchObject({
        _id: new Types.ObjectId(feedbackId),
        submissionId,
      });
      expect(before[2][0]).toMatchObject({
        submissionId,
        classroomTaskId,
        studentId,
        taskId: instanceBefore.taskId,
      });
      const beforeAssessment = studentItem(await report());
      expect(beforeAssessment).toMatchObject({
        submittedTasksCount: baseline.submittedTasksCount + 1,
        publishedTasksCount: baseline.publishedTasksCount + 1,
        submissionsCount: baseline.submissionsCount + 1,
        aiRequestedCount: 1,
      });
      const beforeWeekly = await weeklyActivity();
      expect(beforeWeekly.progress.distinctStudentsSubmitted).toBe(1);
      expect(beforeWeekly.progress.publishedClassroomTasks).toBe(
        baselineWeekly.progress.publishedClassroomTasks + 1,
      );
      expect(beforeWeekly.jobs.total).toBe(baselineWeekly.jobs.total + 1);

      await otherTeacher
        .patch(`${instancePath(id)}/status`)
        .timeout(timeout)
        .send({ status: 'RECALLED' })
        .expect(404);
      await student
        .patch(`${instancePath(id)}/status`)
        .timeout(timeout)
        .send({ status: 'RECALLED' })
        .expect(403);
      expect(await storedInstance(id)).toEqual(instanceBefore);
      await setStatus(id, 'RECALLED');
      const terminal = await expectInstanceState(id, 'RECALLED', true);
      expect({ ...terminal, updatedAt: instanceBefore.updatedAt }).toEqual({
        ...instanceBefore,
        status: 'RECALLED',
      });
      expectPublicRejection(
        await patchStatus(id, 'ACTIVE'),
        400,
        `${instancePath(id)}/status`,
        'Recalled classroom tasks cannot be reopened or closed',
      );
      await post(student, submissionsUrl, { content }).expect(409);
      for (const agent of [teacher, student]) {
        const detail = await agent
          .get(submissionUrl)
          .timeout(timeout)
          .expect(200);
        expect(detail.body).toMatchObject({
          id: work.id,
          attemptNo: 1,
          content,
        });
        const feedbackList = await agent
          .get(`${submissionUrl}/feedback`)
          .timeout(timeout)
          .expect(200);
        expect(feedbackList.body).toEqual([feedback.body]);
      }
      await otherTeacher.get(submissionUrl).timeout(timeout).expect(403);
      await otherTeacher
        .get(`${submissionUrl}/feedback`)
        .timeout(timeout)
        .expect(403);
      expect(await history()).toEqual(before);
      expect(studentItem(await report())).toEqual(baseline);
      expect(await weeklyActivity()).toEqual(beforeWeekly);
    },
  );
});
