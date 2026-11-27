import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { createFixtureUser } from './helpers/create-fixture-user';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  Aggregate,
  Query,
  Types,
  type Connection,
  type Model,
  type mongo,
} from 'mongoose';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);

const namespace = `snapshot-${randomUUID()}`;
const password = 'ExportSnapshot123!';
const timeout = { response: 12000, deadline: 15000 };
const dbOptions = { timeoutMS: 5000, readPreference: 'primary' } as const;

const teacherId = new Types.ObjectId();
const studentId = new Types.ObjectId();
const extraStudentId = new Types.ObjectId();

type Agent = ReturnType<typeof request.agent>;
type CreatedResource = { id: string };
type CreatedClassroom = CreatedResource & { joinCode: string };
type AssessmentRow = {
  studentId: string;
  submittedTasksCount: number;
  submissionsCount: number;
  lateSubmissionsCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
  topTags: { tag: string; count: number }[];
  riskLevel: string;
  score: number;
};
type SnapshotResponse = {
  meta: { generatedAt: string; effectiveWindow: string; notes: string[] };
  students: { total: number; exported: number };
  classroomTasks: { classroomTaskId: string }[];
  summary: {
    late: { lateSubmissionsCount: number };
    progress: { studentsCount: number; publishedClassroomTasks: number };
  };
  statsByClassroomTask: {
    classroomTaskId: string;
    submissions: { total: number; lateTotal: number };
  }[];
  statsByStudent: AssessmentRow[];
  processAssessment: {
    items: (AssessmentRow & { publishedTasksCount: number })[];
  };
};

function deadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 7500);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function readBarrier() {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    release,
    async hold(): Promise<void> {
      enter();
      await deadline(released, 'Snapshot read barrier was not released');
    },
  };
}

describe('Classroom Export Snapshot (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let independentConnection: Connection | undefined;
  let fixtureWritesAllowed = false;
  let teacher: Agent;
  let student: Agent;
  let extraStudent: Agent;
  let courseId: string;

  function database(): mongo.Db {
    if (!independentConnection?.db) {
      throw new Error('Snapshot test database is unavailable');
    }
    return independentConnection.db;
  }

  const post = (agent: Agent, path: string, body: Record<string, unknown>) =>
    agent.post(path).timeout(timeout).send(body);

  const getSnapshot = (classroomId: string) =>
    teacher
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .timeout(timeout);

  async function readSnapshot(classroomId: string): Promise<SnapshotResponse> {
    const response = await getSnapshot(classroomId).expect(200);
    return response.body as SnapshotResponse;
  }

  async function createTemplate(scenario: string): Promise<string> {
    const result = await post(teacher, '/api/learning-tasks/tasks', {
      title: `${namespace} ${scenario}`,
      description: 'Snapshot aggregation task.',
      knowledgeModule: 'snapshot',
      status: 'DRAFT',
    }).expect(201);
    const taskId = (result.body as CreatedResource).id;
    await post(
      teacher,
      `/api/learning-tasks/tasks/${taskId}/publish`,
      {},
    ).expect(201);
    return taskId;
  }

  async function publish(
    classroomId: string,
    taskId: string,
    dueAt?: string,
  ): Promise<string> {
    const result = await post(teacher, `/api/classrooms/${classroomId}/tasks`, {
      taskId,
      ...(dueAt ? { dueAt, settings: { allowLate: true } } : {}),
    }).expect(201);
    return (result.body as CreatedResource).id;
  }

  async function createClassroom(scenario: string) {
    const result = await post(teacher, '/api/classrooms', {
      courseId,
      name: `${namespace} ${scenario}`,
    }).expect(201);
    const classroom = result.body as CreatedClassroom;
    await post(student, '/api/classrooms/join', {
      joinCode: classroom.joinCode,
    }).expect(201);
    return classroom;
  }

  async function submitLate(classroomId: string, classroomTaskId: string) {
    const result = await post(
      student,
      `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      {
        content: {
          codeText: 'function snapshotLateSubmission() { return true; }',
          language: 'typescript',
        },
      },
    ).expect(201);
    return (result.body as CreatedResource).id;
  }

  function readLateCounts(snapshot: SnapshotResponse, classroomTaskId: string) {
    const perTask = snapshot.statsByClassroomTask.find(
      (task) => task.classroomTaskId === classroomTaskId,
    );
    const studentIsoId = studentId.toHexString();
    expect(snapshot.students.total).toBe(1);
    expect(snapshot.statsByStudent.map((item) => item.studentId)).toEqual([
      studentIsoId,
    ]);
    expect(
      snapshot.processAssessment.items.map((item) => item.studentId),
    ).toEqual([studentIsoId]);
    const summary = snapshot.statsByStudent[0];
    const { publishedTasksCount, ...assessment } =
      snapshot.processAssessment.items[0];
    expect(publishedTasksCount).toBe(1);
    const sharedAssessment = {
      studentId: assessment.studentId,
      submittedTasksCount: assessment.submittedTasksCount,
      submissionsCount: assessment.submissionsCount,
      lateSubmissionsCount: assessment.lateSubmissionsCount,
      aiRequestedCount: assessment.aiRequestedCount,
      aiSucceededCount: assessment.aiSucceededCount,
      topTags: assessment.topTags,
      riskLevel: assessment.riskLevel,
      score: assessment.score,
    };
    expect(summary).toEqual(sharedAssessment);
    return {
      summary: snapshot.summary.late.lateSubmissionsCount,
      perTask: perTask?.submissions.lateTotal,
      assessment: assessment.submissionsCount,
    };
  }

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    const defaultConnection = app.get<Connection>(getConnectionToken());
    const transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    for (const connection of [
      defaultConnection,
      transactionConnection,
      independentConnection,
    ]) {
      await assertAuthTestConnection(connection);
    }
    expect(app.get(ConfigService).get('AI_FEEDBACK_WORKER_ENABLED')).toBe(
      false,
    );
    const transactionDb = transactionConnection.db;
    if (!transactionDb)
      throw new Error('Snapshot transaction database missing');
    const session = await transactionConnection.startSession();
    try {
      session.startTransaction({
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: 5000,
      });
      await transactionDb
        .collection('classrooms')
        .findOne(
          { _id: new Types.ObjectId() },
          { session, maxTimeMS: 5000, signal: AbortSignal.timeout(5000) },
        );
      await session.commitTransaction();
    } finally {
      await session.endSession();
    }
    console.info('Export snapshot database gates passed', {
      purpose: 'standard_test',
      default: defaultConnection.db?.databaseName,
      transaction: transactionDb.databaseName,
      independent: database().databaseName,
      snapshot: 'committed',
    });

    await app.init();
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const passwordHash = await bcrypt.hash(password, 10);
    const accounts = [
      { id: teacherId, role: 'teacher', label: 'teacher' },
      { id: studentId, role: 'student', label: 'student' },
      { id: extraStudentId, role: 'student', label: 'extra' },
    ];
    const agents: Agent[] = [];
    fixtureWritesAllowed = true;
    for (const account of accounts) {
      const email = `${namespace}.${account.label}@example.invalid`;
      await createFixtureUser(userModel, {
        _id: account.id,
        email,
        passwordHash,
        roles: [account.role],
        status: UserStatus.Active,
        credentialVersion: 0,
        passwordResetRequestedAt: null,
      });
      const agent = request.agent(app.getHttpServer());
      await post(agent, '/api/auth/login', { email, password }).expect(201);
      agents.push(agent);
    }
    [teacher, student, extraStudent] = agents;

    const result = await post(teacher, '/api/courses', {
      code: namespace,
      name: 'Snapshot Course',
      term: '2026-Spring',
    }).expect(201);
    courseId = (result.body as CreatedResource).id;
  });

  async function cleanupFixtures() {
    if (!fixtureWritesAllowed) return;
    const db = database();
    const ownedAccounts = { $in: [teacherId, studentId, extraStudentId] };
    const classFilter = { teacherId };
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
    const taskScope = { classroomId: { $in: classroomIds } };
    const ownedSubmissionScope = {
      classroomTaskId: { $in: await ids('classroomtasks', taskScope) },
      studentId: ownedAccounts,
    };
    const submissionScope = {
      submissionId: { $in: await ids('submissions', ownedSubmissionScope) },
    };
    const owned: [string, mongo.Filter<mongo.Document>][] = [
      ['feedbacks', submissionScope],
      ['aifeedbackjobs', submissionScope],
      ['submissions', ownedSubmissionScope],
      ['enrollments', { ...taskScope, userId: ownedAccounts }],
      ['classroomtasks', taskScope],
      ['classrooms', classFilter],
      ['tasks', { createdBy: teacherId }],
      ['courses', { createdBy: teacherId, code: namespace }],
      ['sessions', { userId: ownedAccounts }],
      ['passwordresettokens', { userId: ownedAccounts }],
      ['users', { _id: ownedAccounts }],
    ];
    for (const [collection, filter] of owned) {
      await db.collection(collection).deleteMany(filter, { timeoutMS: 5000 });
    }
    const residual: Record<string, number> = {};
    for (const [collection, filter] of owned) {
      residual[collection] = await db
        .collection(collection)
        .countDocuments(filter, dbOptions);
    }
    console.info('Export snapshot scoped residual', residual);
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

  it('exports sanitized classroom snapshot with independent limits and per-task omission', async () => {
    const classroom = await createClassroom('projection');
    await post(extraStudent, '/api/classrooms/join', {
      joinCode: classroom.joinCode,
    }).expect(201);
    const classroomTaskId = await publish(
      classroom.id,
      await createTemplate('projection'),
      new Date(Date.now() - 60_000).toISOString(),
    );
    const submissionId = await submitLate(classroom.id, classroomTaskId);
    await post(
      student,
      `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      { expectedRevision: 0, reason: 'snapshot-export-test' },
    ).expect(200);

    const snapshot = await getSnapshot(classroom.id)
      .query({ window: 'term', limitStudents: 1, limitAssessment: 2 })
      .expect(200);
    const body = snapshot.body as SnapshotResponse;
    expect(typeof body.meta.generatedAt).toBe('string');
    expect(body.meta.effectiveWindow).toBe('30d');
    expect(body.classroomTasks.map((item) => item.classroomTaskId)).toEqual([
      classroomTaskId,
    ]);
    expect(body.students).toEqual({ total: 2, exported: 1 });
    expect(body.summary.progress.studentsCount).toBe(2);
    expect(body.statsByStudent).toHaveLength(1);
    expect(
      body.processAssessment.items.map((item) => item.studentId).sort(),
    ).toEqual([studentId.toHexString(), extraStudentId.toHexString()].sort());
    expect(body.meta.notes).toContain(
      'statsByStudent truncated: original=2, exported=1',
    );
    expect(
      body.meta.notes.some((note) =>
        note.includes('processAssessment.items truncated'),
      ),
    ).toBe(false);

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'codeText',
      'prompt',
      'apiKey',
      'passwordHash',
      '@example.invalid',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const withoutPerTask = await getSnapshot(classroom.id)
      .query({ includePerTask: 'false', limitStudents: 2, limitAssessment: 1 })
      .expect(200);
    const omitted = withoutPerTask.body as SnapshotResponse;
    expect(omitted.statsByClassroomTask).toEqual([]);
    expect(omitted.statsByStudent).toHaveLength(2);
    expect(omitted.processAssessment.items).toHaveLength(1);
    expect(omitted.meta.notes).toContain(
      'perTask omitted by includePerTask=false',
    );
    expect(omitted.meta.notes).toContain(
      'processAssessment.items truncated: original=2, exported=1',
    );
    expect(
      omitted.meta.notes.some((note) =>
        note.includes('statsByStudent truncated'),
      ),
    ).toBe(false);
  });

  it('11 keeps first late submission counts at the same snapshot time', async () => {
    const classroom = await createClassroom('late-read');
    const classroomTaskId = await publish(
      classroom.id,
      await createTemplate('late-read'),
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(
      readLateCounts(await readSnapshot(classroom.id), classroomTaskId),
    ).toEqual({
      summary: 0,
      perTask: 0,
      assessment: 0,
    });
    const barrier = readBarrier();
    let held = false;
    const originalExec = Object.getOwnPropertyDescriptor(
      Aggregate.prototype,
      'exec',
    )?.value as (this: Aggregate<unknown>) => Promise<unknown>;
    const spy = jest
      .spyOn(Aggregate.prototype, 'exec')
      .mockImplementation(async function (this: Aggregate<unknown>) {
        const [matchStage, groupStage] = this.pipeline();
        if (
          !held &&
          this.model().modelName === 'Submission' &&
          matchStage &&
          groupStage &&
          '$match' in matchStage &&
          '$group' in groupStage &&
          'lateTotal' in groupStage.$group &&
          JSON.stringify(matchStage.$match.classroomTaskId).includes(
            classroomTaskId,
          )
        ) {
          held = true;
          await barrier.hold();
        }
        return Reflect.apply(originalExec, this, []);
      });

    const inFlight = readSnapshot(classroom.id);
    // Attach a handler immediately so a failed HTTP request can be joined in finally.
    void inFlight.catch(() => undefined);
    let lateId: string;
    let inFlightBody: SnapshotResponse;
    try {
      await deadline(
        barrier.reached,
        'Per-task submission aggregation was not reached',
      );
      lateId = await submitLate(classroom.id, classroomTaskId);
      const submission = await database()
        .collection<{ _id: Types.ObjectId; isLate: boolean }>('submissions')
        .findOne(
          {
            _id: new Types.ObjectId(lateId),
            studentId,
            classroomTaskId: new Types.ObjectId(classroomTaskId),
          },
          dbOptions,
        );
      expect(submission?.isLate).toBe(true);
      console.info('11 independent late submission', {
        id: lateId,
        isLate: submission?.isLate,
      });
      barrier.release();
      inFlightBody = await inFlight;
    } finally {
      barrier.release();
      await inFlight.catch(() => undefined);
      spy.mockRestore();
    }

    const during = readLateCounts(inFlightBody, classroomTaskId);
    const next = readLateCounts(
      await readSnapshot(classroom.id),
      classroomTaskId,
    );
    console.info('11 formal snapshot HTTP evidence', {
      classroomTaskId,
      during,
      next,
    });
    expect(during).toEqual({ summary: 0, perTask: 0, assessment: 0 });
    expect(next).toEqual({ summary: 1, perTask: 1, assessment: 1 });
  });

  it('11 keeps task scope consistent when a classroom task is published during export', async () => {
    const classroom = await createClassroom('task-scope');
    const firstTaskId = await publish(
      classroom.id,
      await createTemplate('task-scope first'),
    );
    const nextTemplateId = await createTemplate('task-scope second');
    const barrier = readBarrier();
    let held = false;
    const originalExec = Object.getOwnPropertyDescriptor(
      Query.prototype,
      'exec',
    )?.value as (this: Query<unknown, unknown>) => Promise<unknown>;
    const spy = jest
      .spyOn(Query.prototype, 'exec')
      .mockImplementation(async function (this: Query<unknown, unknown>) {
        const filter = this.getFilter() as {
          classroomId?: Types.ObjectId;
          createdAt?: unknown;
        };
        const isSnapshotTaskQuery =
          !held &&
          this.model.modelName === 'ClassroomTask' &&
          filter.classroomId?.equals(classroom.id) &&
          filter.createdAt !== undefined;
        const result = Reflect.apply(originalExec, this, []);
        if (!isSnapshotTaskQuery) return result;

        held = true;
        const rows = await result;
        await barrier.hold();
        return rows;
      });

    const inFlight = readSnapshot(classroom.id);
    void inFlight.catch(() => undefined);
    let nextTaskId: string;
    let inFlightBody: SnapshotResponse;
    try {
      await deadline(
        barrier.reached,
        'Snapshot task list read was not reached',
      );
      nextTaskId = await publish(classroom.id, nextTemplateId);
      const task = await database()
        .collection('classroomtasks')
        .findOne(
          {
            _id: new Types.ObjectId(nextTaskId),
            classroomId: new Types.ObjectId(classroom.id),
          },
          dbOptions,
        );
      expect(task?.status).toBe('ACTIVE');
      barrier.release();
      inFlightBody = await inFlight;
    } finally {
      barrier.release();
      await inFlight.catch(() => undefined);
      spy.mockRestore();
    }

    function readScope(snapshot: SnapshotResponse) {
      return {
        taskIds: snapshot.classroomTasks.map((task) => task.classroomTaskId),
        perTaskIds: snapshot.statsByClassroomTask.map(
          (task) => task.classroomTaskId,
        ),
        progressTasks: snapshot.summary.progress.publishedClassroomTasks,
        assessmentTasks: snapshot.processAssessment.items.map(
          (item) => item.publishedTasksCount,
        ),
      };
    }
    const during = readScope(inFlightBody);
    const next = readScope(await readSnapshot(classroom.id));
    console.info('11 formal task scope HTTP evidence', { during, next });
    expect(during).toEqual({
      taskIds: [firstTaskId],
      perTaskIds: [firstTaskId],
      progressTasks: 1,
      assessmentTasks: [1],
    });
    expect(next).toEqual({
      taskIds: [firstTaskId, nextTaskId],
      perTaskIds: [firstTaskId, nextTaskId],
      progressTasks: 2,
      assessmentTasks: [2],
    });
  });
});
