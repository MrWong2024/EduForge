import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string; contentRevision: number };
type StudentSnapshotStats = {
  studentId: string;
  submittedTasksCount: number;
  submissionsCount: number;
  lateSubmissionsCount: number;
  aiRequestedCount: number;
  aiSucceededCount: number;
};
type SnapshotResponse = {
  meta: {
    generatedAt: string;
    window: string;
    effectiveWindow: string;
    notes: string[];
  };
  course: { term: string };
  classroom: { id: string; status: string };
  students: {
    total: number;
  };
  classroomTasks: Array<{ classroomTaskId: string }>;
  summary: {
    progress: { publishedClassroomTasks: number };
  };
  statsByClassroomTask: Array<{
    classroomTaskId: string;
    submissions: { total: number; lateTotal: number; distinctStudents: number };
  }>;
  statsByStudent: StudentSnapshotStats[];
  processAssessment: {
    items: Array<StudentSnapshotStats & { publishedTasksCount: number }>;
  };
};

describe('Classroom Export Snapshot (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule | undefined;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let classroomTaskModel: Model<ClassroomTask>;
  let enrollmentModel: Model<Enrollment>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let otherTeacherId = '';
  let studentId = '';
  let courseId = '';
  let classroomId = '';
  const classroomTaskIds: string[] = [];
  const taskIds: string[] = [];
  const submissionIds: string[] = [];
  let fixtureAuthorized = false;

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.snapshot.${Date.now()}@example.com`;
  const otherTeacherEmail = `other.teacher.snapshot.${Date.now()}@example.com`;
  const studentEmail = `student.snapshot.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

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
          throw new Error(`Unexpected login status ${res.status}`);
        }
      });
  };

  const expectEmptyDatabase = async (phase: string) => {
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const cursor = database.listCollections({}, { maxTimeMS: 5000 });
    try {
      const collections = await cursor.toArray();
      const counts: Record<string, number> = {};
      for (const collection of collections) {
        expect(collection.type).toBe('collection');
        counts[collection.name] = await database
          .collection(collection.name)
          .countDocuments({}, { maxTimeMS: 5000 });
      }
      const total = Object.values(counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      console.info('Snapshot database counts: ' + phase, { counts, total });
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
      expect(total).toBe(0);
    } finally {
      await cursor.close();
    }
  };

  const readBusinessDigests = async () => {
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const digests: Record<string, string> = {};
    for (const [collection, ids] of [
      [courseModel.collection.name, [courseId]],
      [classroomModel.collection.name, [classroomId]],
      [taskModel.collection.name, taskIds],
      [classroomTaskModel.collection.name, classroomTaskIds],
      [submissionModel.collection.name, submissionIds],
    ] as Array<[string, string[]]>) {
      const cursor = database
        .collection(collection)
        .find(
          { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
          { sort: { _id: 1 }, maxTimeMS: 5000 },
        );
      try {
        const documents = await cursor.toArray();
        expect(documents).toHaveLength(ids.length);
        digests[collection] = createHash('sha256')
          .update(mongo.BSON.serialize({ documents }))
          .digest('hex');
      } finally {
        await cursor.close();
      }
    }
    const cursor = aiFeedbackJobModel.collection.find(
      {
        submissionId: {
          $in: submissionIds.map((id) => new Types.ObjectId(id)),
        },
      },
      { sort: { _id: 1 }, maxTimeMS: 5000 },
    );
    try {
      const related = await cursor.toArray();
      expect(related).toHaveLength(1);
      digests.jobs = createHash('sha256')
        .update(mongo.BSON.serialize({ related }))
        .digest('hex');
    } finally {
      await cursor.close();
    }
    return digests;
  };

  beforeAll(async () => {
    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    otherTeacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    userModel.db.set('maxTimeMS', 10000);
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const hello = await database.command({ hello: 1 }, { timeoutMS: 5000 });
    expect(hello.setName).toBeUndefined();
    expect(hello.msg).not.toBe('isdbgrid');
    expect(hello.isWritablePrimary).toBe(true);
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    const config = app.get(ConfigService);
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: config.get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: userModel.db.host,
      authInfo: auth.authInfo,
    });
    expect(config.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(process.env.AI_FEEDBACK_REAL_ENABLED).toBe('false');
    expect(config.get('MAIL_PROVIDER')).toBe('log');
    console.info(
      'Snapshot database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
    );
    await expectEmptyDatabase('before fixtures');
    fixtureAuthorized = true;

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const teacher = await userModel.create({
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    teacherId = teacher._id.toString();
    const otherTeacher = await userModel.create({
      email: otherTeacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    otherTeacherId = otherTeacher._id.toString();
    const student = await userModel.create({
      email: studentEmail,
      passwordHash: studentHash,
      roles: ['student'],
    });
    studentId = student._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(otherTeacherAgent, otherTeacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      if (!fixtureAuthorized) return;
      const cleanup: Promise<unknown>[] = [];
      if (submissionIds.length > 0) {
        const submissionObjectIds = submissionIds.map(
          (id) => new Types.ObjectId(id),
        );
        cleanup.push(
          feedbackModel.deleteMany({
            submissionId: { $in: submissionObjectIds },
          }),
        );
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: { $in: submissionObjectIds },
          }),
        );
        cleanup.push(
          submissionModel.deleteMany({ _id: { $in: submissionObjectIds } }),
        );
      }
      if (classroomTaskIds.length > 0) {
        cleanup.push(
          classroomTaskModel.deleteMany({
            _id: { $in: classroomTaskIds.map((id) => new Types.ObjectId(id)) },
          }),
        );
      }
      if (taskIds.length > 0) {
        cleanup.push(
          taskModel.deleteMany({
            _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
          }),
        );
      }
      if (classroomId) {
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: new Types.ObjectId(classroomId),
          }),
        );
        cleanup.push(
          classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
        );
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userIds = [teacherId, otherTeacherId, studentId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userIds.length > 0) {
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
      }
      const results = await Promise.allSettled(cleanup);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Snapshot scoped fixture cleanup failed');
      }
      await expectEmptyDatabase('after scoped cleanup');
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        if (previousWorkerEnabled === undefined) {
          delete process.env.AI_FEEDBACK_WORKER_ENABLED;
        } else {
          process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
        }
        if (previousDebugEnabled === undefined) {
          delete process.env.AI_FEEDBACK_DEBUG_ENABLED;
        } else {
          process.env.AI_FEEDBACK_DEBUG_ENABLED = previousDebugEnabled;
        }
      }
    }
  });

  it('exports sanitized classroom snapshot and supports per-task omission', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `SNAP${Date.now()}`,
        name: 'Snapshot Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Snapshot-Class',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const referenceTime = Date.now();
    for (const daysAgo of [2, 14, 40]) {
      const createdTask = await teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Snapshot Task',
          description: 'Snapshot aggregation task.',
          knowledgeModule: 'snapshot',
          status: 'DRAFT',
        })
        .expect(201);
      const taskId = (createdTask.body as CreatedTaskResponse).id;
      taskIds.push(taskId);

      await teacherAgent
        .post(`/api/learning-tasks/tasks/${taskId}/publish`)
        .send({})
        .expect(201);

      const createdClassroomTask = await teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({
          taskId,
          dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
          settings: {
            allowLate: true,
          },
        })
        .expect(201);
      const classroomTaskId = (
        createdClassroomTask.body as CreatedClassroomTaskResponse
      ).id;
      classroomTaskIds.push(classroomTaskId);

      const createdSubmission = await studentAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
        )
        .send({
          content: {
            codeText: 'function snapshotLateSubmission() { return true; }',
            language: 'typescript',
          },
        })
        .expect(201);
      const submission = createdSubmission.body as CreatedSubmissionResponse;
      const submissionId = submission.id;
      submissionIds.push(submissionId);

      if (daysAgo === 2) {
        await studentAgent
          .post(
            `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
          )
          .send({
            expectedRevision: submission.contentRevision,
            reason: 'snapshot-export-test',
          })
          .expect(200);
      }

      const createdAt = new Date(referenceTime - daysAgo * 24 * 60 * 60 * 1000);
      const dueAt = new Date(createdAt.getTime() - 60 * 1000);
      const taskUpdate = await classroomTaskModel.collection.updateOne(
        { _id: new Types.ObjectId(classroomTaskId) },
        { $set: { createdAt, publishedAt: createdAt, dueAt } },
      );
      expect(taskUpdate.matchedCount).toBe(1);
      const submissionUpdate = await submissionModel.collection.updateOne(
        { _id: new Types.ObjectId(submissionId) },
        { $set: { createdAt } },
      );
      expect(submissionUpdate.matchedCount).toBe(1);
      const rawTask = await classroomTaskModel.collection.findOne(
        { _id: new Types.ObjectId(classroomTaskId) },
        {
          projection: { createdAt: 1, publishedAt: 1, dueAt: 1 },
          maxTimeMS: 5000,
        },
      );
      expect(rawTask).toMatchObject({
        createdAt,
        publishedAt: createdAt,
        dueAt,
      });
      const rawSubmission = await submissionModel.collection.findOne(
        { _id: new Types.ObjectId(submissionId) },
        {
          projection: { createdAt: 1, isLate: 1, contentRevision: 1 },
          maxTimeMS: 5000,
        },
      );
      expect(rawSubmission).toMatchObject({
        createdAt,
        isLate: true,
        contentRevision: submission.contentRevision,
      });
      if (daysAgo === 2) {
        const jobUpdate = await aiFeedbackJobModel.collection.updateMany(
          { submissionId: new Types.ObjectId(submissionId) },
          { $set: { createdAt } },
        );
        expect(jobUpdate.matchedCount).toBe(1);
        const rawJob = await aiFeedbackJobModel.collection.findOne(
          { submissionId: new Types.ObjectId(submissionId) },
          { projection: { createdAt: 1 }, maxTimeMS: 5000 },
        );
        expect(rawJob).toMatchObject({ createdAt });
      }
    }

    const before = await readBusinessDigests();
    const snapshot = await teacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .expect(200);
    const body = snapshot.body as SnapshotResponse;

    expect(typeof body.meta.generatedAt).toBe('string');
    expect(Array.isArray(body.classroomTasks)).toBe(true);
    expect(body.classroomTasks.length).toBeGreaterThanOrEqual(1);
    expect(body.students.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.processAssessment.items)).toBe(true);
    expect(body.meta.window).toBe('30d');
    expect(body.meta.effectiveWindow).toBe('30d');
    expect(body.meta.notes).toEqual([]);
    expect(body.course.term).toBe('2026-Spring');
    expect(
      body.classroomTasks.map((task) => task.classroomTaskId).sort(),
    ).toEqual(classroomTaskIds.slice(0, 2).sort());

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('codeText');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('apiKey');

    const withoutPerTask = await teacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .query({ includePerTask: 'false' })
      .expect(200);
    const withoutPerTaskBody = withoutPerTask.body as SnapshotResponse;

    expect(withoutPerTaskBody.statsByClassroomTask).toEqual([]);
    const hasOmittedNote = (withoutPerTaskBody.meta.notes ?? []).some((note) =>
      note.toLowerCase().includes('pertask omitted'),
    );
    expect(hasOmittedNote).toBe(true);
    expect(withoutPerTaskBody.meta.notes).not.toEqual(
      expect.arrayContaining([expect.stringContaining('term')]),
    );
    expect(await readBusinessDigests()).toEqual(before);
  });

  it.each([
    ['7d', 1],
    ['30d', 2],
    [undefined, 2],
  ] as const)(
    'exports the exact task and submission scope for %s',
    async (window, expectedCount) => {
      const before = await readBusinessDigests();
      const path =
        `/api/classrooms/${classroomId}/export/snapshot` +
        (window === undefined ? '' : `?window=${window}`);
      const response = await teacherAgent.get(path).expect(200);
      const body = response.body as SnapshotResponse;
      expect(body.meta.window).toBe(window ?? '30d');
      expect(body.meta.effectiveWindow).toBe(window ?? '30d');
      expect(body.meta.notes).toEqual([]);
      expect(typeof body.meta.generatedAt).toBe('string');
      expect(body.course.term).toBe('2026-Spring');
      const expectedIds = classroomTaskIds.slice(0, expectedCount).sort();
      expect(
        body.classroomTasks.map((task) => task.classroomTaskId).sort(),
      ).toEqual(expectedIds);
      expect(
        body.statsByClassroomTask.map((task) => task.classroomTaskId).sort(),
      ).toEqual(expectedIds);
      for (const task of body.statsByClassroomTask) {
        expect(task.submissions).toEqual({
          total: 1,
          lateTotal: 1,
          distinctStudents: 1,
        });
      }
      expect(body.statsByStudent).toHaveLength(1);
      expect(body.processAssessment.items).toHaveLength(1);
      for (const item of [
        body.statsByStudent[0],
        body.processAssessment.items[0],
      ]) {
        expect(item).toMatchObject({
          studentId,
          submittedTasksCount: expectedCount,
          submissionsCount: expectedCount,
          lateSubmissionsCount: expectedCount,
          aiRequestedCount: 1,
          aiSucceededCount: 0,
        });
      }
      expect(body.processAssessment.items[0].publishedTasksCount).toBe(
        expectedCount,
      );
      expect(body.summary.progress.publishedClassroomTasks).toBe(expectedCount);
      expect(await readBusinessDigests()).toEqual(before);
      console.info(
        'Snapshot exact scope:',
        window ?? 'default',
        'tasks/submissions=' + expectedCount,
      );
    },
  );

  it('keeps native valid states readable and rejects invalid states without repairs', async () => {
    const database = userModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const classrooms = database.collection<Record<string, unknown>>(
      classroomModel.collection.name,
    );
    const filter = { _id: new Types.ObjectId(classroomId) };
    const original = await classrooms.findOne(filter, { maxTimeMS: 5000 });
    if (!original) throw new Error('Missing snapshot fixture classroom');
    const originalHasStatus = Object.hasOwn(original, 'status');
    const course = await courseModel.collection.findOne(
      { _id: new Types.ObjectId(courseId) },
      { projection: { status: 1 }, maxTimeMS: 5000 },
    );
    expect(course?.status).toBe('ACTIVE');
    const path = `/api/classrooms/${classroomId}/export/snapshot?window=30d&includePerTask=true`;
    const scenarios: Array<{ status?: unknown; expectedStatus: 200 | 409 }> = [
      { status: 'ACTIVE', expectedStatus: 200 },
      { status: 'ARCHIVED', expectedStatus: 200 },
      { expectedStatus: 409 },
      { status: ['ACTIVE'], expectedStatus: 409 },
    ];

    try {
      for (const scenario of scenarios) {
        const hasStatus = Object.hasOwn(scenario, 'status');
        const update = await classrooms.updateOne(
          filter,
          hasStatus
            ? { $set: { status: scenario.status } }
            : { $unset: { status: '' } },
          { maxTimeMS: 5000 },
        );
        expect(update.matchedCount).toBe(1);
        const beforeGet = await classrooms.findOne(filter, { maxTimeMS: 5000 });
        if (!beforeGet) throw new Error('Missing polluted snapshot classroom');
        expect(Object.hasOwn(beforeGet, 'status')).toBe(hasStatus);
        if (hasStatus) expect(beforeGet.status).toStrictEqual(scenario.status);
        if (Array.isArray(scenario.status)) {
          expect(Array.isArray(beforeGet.status)).toBe(true);
        }
        const beforeDigests = await readBusinessDigests();

        const response = await teacherAgent
          .get(path)
          .expect(scenario.expectedStatus);
        if (scenario.expectedStatus === 200) {
          const body = response.body as SnapshotResponse;
          expect(body.classroom).toMatchObject({
            id: classroomId,
            status: scenario.status,
          });
          expect(body.course.term).toBe('2026-Spring');
          expect(body.meta.window).toBe('30d');
          expect(body.meta.effectiveWindow).toBe('30d');
          expect(body.students.total).toBe(1);
          expect(body.summary.progress.publishedClassroomTasks).toBe(2);
          expect(body.statsByClassroomTask).toHaveLength(2);
          for (const task of body.statsByClassroomTask) {
            expect(task.submissions).toEqual({
              total: 1,
              lateTotal: 1,
              distinctStudents: 1,
            });
          }
          expect(body.statsByStudent).toHaveLength(1);
          expect(body.statsByStudent[0]).toMatchObject({
            studentId,
            submittedTasksCount: 2,
            submissionsCount: 2,
            lateSubmissionsCount: 2,
            aiRequestedCount: 1,
            aiSucceededCount: 0,
          });
        } else {
          expect(response.body).toMatchObject({
            statusCode: 409,
            message: 'Classroom has invalid status',
            path,
          });
          if (!hasStatus) {
            const denied = await otherTeacherAgent.get(path).expect(404);
            expect(denied.body).toMatchObject({
              statusCode: 404,
              message: 'Classroom not found',
              path,
            });
          }
        }

        const afterGet = await classrooms.findOne(filter, { maxTimeMS: 5000 });
        expect(afterGet).toStrictEqual(beforeGet);
        expect(afterGet?.createdAt).toEqual(beforeGet.createdAt);
        expect(afterGet?.updatedAt).toEqual(beforeGet.updatedAt);
        expect(await readBusinessDigests()).toEqual(beforeDigests);
      }
    } finally {
      const restored = await classrooms.updateOne(
        filter,
        originalHasStatus
          ? { $set: { status: original.status } }
          : { $unset: { status: '' } },
        { maxTimeMS: 5000 },
      );
      expect(restored.matchedCount).toBe(1);
      expect(
        await classrooms.findOne(filter, { maxTimeMS: 5000 }),
      ).toStrictEqual(original);
    }
  });

  it.each(['term', '24h', 'all'])(
    'rejects explicit window=%s through the public DTO',
    async (window) => {
      const path = `/api/classrooms/${classroomId}/export/snapshot?window=${window}`;
      const response = await teacherAgent.get(path).expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, path });
      expect(response.body).toHaveProperty(
        'message',
        expect.stringContaining(
          'window must be one of the following values: 7d, 30d',
        ),
      );
    },
  );

  it('preserves authentication, role priority and classroom owner isolation', async () => {
    await studentAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot?window=term`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/classrooms/${classroomId}/export/snapshot?window=term`)
      .timeout({ response: 5000, deadline: 10000 })
      .expect(401);
    await otherTeacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot?window=30d`)
      .expect(404);
  });
});
