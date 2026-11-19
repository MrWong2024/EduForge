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
    await post(teacher, '/api/auth/login', {
      email: accounts[0].email,
      password,
    }).expect(201);
    await post(student, '/api/auth/login', {
      email: accounts[1].email,
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
});
