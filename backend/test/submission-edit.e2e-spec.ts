import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { type Connection, Model, mongo, STATES, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { LearningTasksModule } from '../src/modules/learning-tasks/learning-tasks.module';
import type { FeedbackResponseDto } from '../src/modules/learning-tasks/dto/feedback-response.dto';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { User } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(90000);
type Agent = ReturnType<typeof request.agent>;
type Resource = { id: string; joinCode?: string };
type Detail = Resource & {
  taskId: string;
  classroomTaskId: string;
  attemptNo: number;
  submittedAt: string;
  isLate: boolean;
  lateBySeconds: number;
  language: string;
  contentRevision: number | null;
  lastEditedAt: string | null;
  lastEditIsLate: boolean | null;
  reviewStartedAt: string | null;
  editing: { canEdit: boolean; reason: string | null; message: string | null };
  content: { language: string; codeText: string; submissionNote: string };
};
type Published = Resource & { taskId: string };
type FeedbackReceipt = Omit<FeedbackResponseDto, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};
type StoredFeedback = Feedback & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
const original = {
  language: 'javascript',
  codeText: '  const A = "😀";\n\tA;\n',
  submissionNote: '  初次说明\n\t保留空白\n',
};
const changed = {
  language: 'typescript',
  codeText: '  const B: string = "😀";\n\tB;\n',
  submissionNote: '  修改说明\n\t保留原文\n',
};
const reviewPayload = {
  source: FeedbackSource.Teacher,
  type: FeedbackType.Style,
  severity: FeedbackSeverity.Warn,
  message: 'Use clearer naming.',
  suggestion: 'Consider names.',
  tags: ['naming'],
  scoreHint: 75,
};

function requestCheckpoint() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForRequestCheckpoint(
  reached: Promise<void>,
  request: Promise<request.Response>,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reached,
      request.then(({ status }) => {
        throw new Error(
          `${label} request completed before its pause: ${status}`,
        );
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} pause timed out`)),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('B1-2 submission content edits and review admission (HTTP)', () => {
  let app: INestApplication<App>;
  let connection: Connection | undefined;
  let readbackConnection: Connection | undefined;
  let config: ConfigService;
  let jobService: AiFeedbackJobService;
  let users: Model<User>, sessions: Model<Session>, courses: Model<Course>;
  let classrooms: Model<Classroom>,
    enrollments: Model<Enrollment>,
    instances: Model<ClassroomTask>;
  let tasks: Model<Task>,
    submissions: Model<Submission>,
    feedback: Model<Feedback>,
    jobs: Model<AiFeedbackJob>;
  let teacher: Agent, student: Agent, otherStudent: Agent;
  let classroom: Resource;
  const userIds: Types.ObjectId[] = [],
    courseIds: string[] = [],
    classroomIds: string[] = [];
  const taskIds: string[] = [],
    instanceIds: string[] = [];
  const namespace = 'b1-2-edit-' + Date.now() + '-' + process.pid;
  const submissionUrl = (id: string) => '/api/learning-tasks/submissions/' + id;
  const instanceUrl = (id: string) =>
    '/api/classrooms/' + classroom.id + '/tasks/' + id;

  const publish = async () => {
    const task = (
      await teacher
        .post('/api/learning-tasks/tasks')
        .send({
          title: namespace + '-' + taskIds.length,
          description: 'Synthetic submission editing task',
          knowledgeModule: 'text',
          courseLabel: 'Java 程序设计',
          status: 'PUBLISHED',
          visibility: 'PRIVATE',
        })
        .expect(201)
    ).body as Resource;
    taskIds.push(task.id);
    const published = (
      await teacher
        .post('/api/classrooms/' + classroom.id + '/tasks')
        .send({
          taskId: task.id,
        })
        .expect(201)
    ).body as Published;
    instanceIds.push(published.id);
    return published;
  };
  const submit = async (instance: Published, content = original) =>
    (
      await student
        .post(instanceUrl(instance.id) + '/submissions')
        .send({
          content,
          meta: { aiUsageDeclaration: 'Synthetic test only' },
        })
        .expect(201)
    ).body as Detail;
  const detail = async (agent: Agent, id: string) =>
    (await agent.get(submissionUrl(id)).expect(200)).body as Detail;
  const edit = (
    id: string,
    expectedRevision = 0,
    content = changed,
    agent = student,
  ) => agent.patch(submissionUrl(id)).send({ expectedRevision, content });
  const giveFeedback = (
    id: string,
    expectedRevision = 0,
    payload = reviewPayload,
  ) =>
    teacher
      .post(submissionUrl(id) + '/feedback')
      .send({ expectedRevision, ...payload });
  const askAi = (id: string, expectedRevision = 0, agent = teacher) =>
    agent
      .post(submissionUrl(id) + '/ai-feedback/request')
      .send({ expectedRevision });
  const raw = (id: string) =>
    submissions.collection.findOne({ _id: new Types.ObjectId(id) });
  const noReviewRecords = async (id: string) => {
    const filter = { submissionId: new Types.ObjectId(id) };
    expect(await feedback.countDocuments(filter)).toBe(0);
    expect(await jobs.countDocuments(filter)).toBe(0);
  };

  beforeAll(async () => {
    connection = await openAuthTestConnection();
    readbackConnection = await openAuthTestConnection();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = module.createNestApplication();
    const transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    await assertAuthTestConnection(transactionConnection);
    configureApp(app);
    await app.init();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
    courses = app.get(getModelToken(Course.name));
    classrooms = app.get(getModelToken(Classroom.name));
    enrollments = app.get(getModelToken(Enrollment.name));
    instances = app.get(getModelToken(ClassroomTask.name));
    tasks = app.get(getModelToken(Task.name));
    submissions = app.get(getModelToken(Submission.name));
    feedback = app.get(getModelToken(Feedback.name));
    jobs = app.get(getModelToken(AiFeedbackJob.name));
    config = app.get(ConfigService);
    // ClassroomsModule also has its own Job service. Inject faults into the
    // exact instance used by the public learning-tasks review endpoints.
    jobService = app
      .select(LearningTasksModule)
      .get(AiFeedbackJobService, { strict: true });
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.EDUFORGE_DATABASE_PURPOSE).toBe('standard_test');
    users.db.set('maxTimeMS', 10000);
    const database = users.db.db;
    if (!database || users.db !== connection)
      throw new Error('Missing guarded fixture connection');
    for (const model of [
      users,
      sessions,
      courses,
      classrooms,
      enrollments,
      instances,
      tasks,
      submissions,
      feedback,
      jobs,
    ]) {
      const name = model.collection.name;
      const collectionExists = await database
        .listCollections({ name }, { signal: AbortSignal.timeout(5000) })
        .hasNext();
      if (!collectionExists)
        throw new Error('SUBMISSION_EDIT_REQUIRED_COLLECTION_MISSING: ' + name);
    }
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('MAIL_PROVIDER')).toBe('log');
    expect(config.get('AI_FEEDBACK_WORKER_ENABLED')).not.toBe(true);
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    const agents: Agent[] = [];
    for (const role of ['teacher', 'student', 'student']) {
      const email = namespace + '-' + agents.length + '@example.invalid';
      const user = await users.create({
        email,
        passwordHash: await bcrypt.hash('12345678', 10),
        roles: [role],
      });
      userIds.push(user._id);
      const agent = request
        .agent(app.getHttpServer())
        .timeout({ response: 10000, deadline: 15000 });
      await agent
        .post('/api/auth/login')
        .send({ email, password: '12345678' })
        .expect(201);
      agents.push(agent);
    }
    [teacher, student, otherStudent] = agents;
    const course = (
      await teacher
        .post('/api/courses')
        .send({
          code: namespace,
          name: 'Synthetic editing course',
          term: '2026',
        })
        .expect(201)
    ).body as Resource;
    courseIds.push(course.id);
    classroom = (
      await teacher
        .post('/api/classrooms')
        .send({ courseId: course.id, name: 'Synthetic editing classroom' })
        .expect(201)
    ).body as Resource;
    classroomIds.push(classroom.id);
    for (const agent of [student, otherStudent])
      await agent
        .post('/api/classrooms/join')
        .send({ joinCode: classroom.joinCode })
        .expect(201);
    console.info(
      'B1-2 database gate: standard_test / default+transaction+independent readback eduforge_test / loopback rs0 PRIMARY verified; namespace=' +
        namespace,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    try {
      if (users && userIds.length) {
        const owned = await submissions
          .find({ studentId: { $in: userIds } })
          .select('_id')
          .lean()
          .exec();
        const ids = owned.map((item) => item._id);
        const related = { submissionId: { $in: ids } };
        await feedback.deleteMany(related);
        await jobs.deleteMany(related);
        await submissions.deleteMany({ _id: { $in: ids } });
        await instances.deleteMany({
          _id: { $in: instanceIds.map((id) => new Types.ObjectId(id)) },
        });
        await tasks.deleteMany({
          _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
        });
        await enrollments.deleteMany({
          classroomId: {
            $in: classroomIds.map((id) => new Types.ObjectId(id)),
          },
        });
        await classrooms.deleteMany({
          _id: { $in: classroomIds.map((id) => new Types.ObjectId(id)) },
        });
        await courses.deleteMany({
          _id: { $in: courseIds.map((id) => new Types.ObjectId(id)) },
        });
        await sessions.deleteMany({ userId: { $in: userIds } });
        await users.deleteMany({ _id: { $in: userIds } });
        const readback = readbackConnection?.db;
        if (!readback) throw new Error('Missing guarded cleanup readback');
        const idScope = (ownedIds: string[]) => ({
          $in: ownedIds.map((id) => new Types.ObjectId(id)),
        });
        const ownedClassrooms = idScope(classroomIds);
        const ownedUsers = { $in: userIds };
        const cleanupChecks = {
          [feedback.collection.name]: related,
          [jobs.collection.name]: related,
          [submissions.collection.name]: { _id: { $in: ids } },
          [instances.collection.name]: { _id: idScope(instanceIds) },
          [tasks.collection.name]: { _id: idScope(taskIds) },
          [enrollments.collection.name]: { classroomId: ownedClassrooms },
          [classrooms.collection.name]: { _id: ownedClassrooms },
          [courses.collection.name]: { _id: idScope(courseIds) },
          [sessions.collection.name]: { userId: ownedUsers },
          passwordresettokens: { userId: ownedUsers },
          [users.collection.name]: { _id: ownedUsers },
        };
        for (const [name, filter] of Object.entries(cleanupChecks)) {
          expect(
            await readback.collection(name).countDocuments(filter, {
              readPreference: 'primary',
              signal: AbortSignal.timeout(5000),
            }),
          ).toBe(0);
        }
        console.info(
          'B1-2 independent cleanup readback: submissions/feedback/jobs/instances/tasks/courses/classes/enrollment/session/reset tokens/users residual=0; namespace=' +
            namespace,
        );
      }
    } finally {
      try {
        if (app) await app.close();
      } finally {
        try {
          if (connection?.readyState === STATES.connected)
            await connection.close();
          if (users) expect(users.db.readyState).toBe(STATES.disconnected);
          console.info('B1-2 app/default DB closed');
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

  it('replaces original text on the same attempt without changing first-submission facts or creating review records', async () => {
    const published = await publish();
    const created = await submit(published);
    const before = await raw(created.id);
    expect(before?.contentRevision).toBe(0);
    expect(before).not.toHaveProperty('lastEditedAt');
    expect(before).not.toHaveProperty('lastEditIsLate');
    expect(before).not.toHaveProperty('reviewStartedAt');
    expect((await detail(student, created.id)).editing).toEqual({
      canEdit: true,
      reason: null,
      message: null,
    });
    await detail(teacher, created.id);
    await detail(student, created.id);
    expect(await raw(created.id)).toEqual(before);
    const saved = (await edit(created.id).expect(200)).body as Detail;
    expect(saved.id).toBe(created.id);
    expect(saved.attemptNo).toBe(1);
    expect(saved.contentRevision).toBe(1);
    expect(saved.content).toEqual(changed);
    expect(saved.lastEditedAt).toEqual(expect.any(String));
    expect(saved.lastEditIsLate).toBe(false);
    expect(saved.reviewStartedAt).toBeNull();
    const after = await raw(created.id);
    expect(after?.submittedAt).toEqual(before?.submittedAt);
    expect(after?.createdAt).toEqual(before?.createdAt);
    expect(after?.isLate).toBe(before?.isLate);
    expect(after?.lateBySeconds).toBe(before?.lateBySeconds);
    expect(after?.meta).toEqual(before?.meta);
    expect(
      await submissions.countDocuments({
        classroomTaskId: new Types.ObjectId(published.id),
        studentId: userIds[1],
      }),
    ).toBe(1);
    await noReviewRecords(created.id);
    expect((await detail(teacher, created.id)).content).toEqual(changed);
    const omittedNote = (
      await student
        .patch(submissionUrl(created.id))
        .send({
          expectedRevision: 1,
          content: { codeText: original.codeText, language: original.language },
        })
        .expect(200)
    ).body as Detail;
    expect(omittedNote.content.submissionNote).toBe('');
  });

  it('keeps submissions editable until an explicit review request', async () => {
    const created = await submit(await publish());
    await edit(created.id).expect(200);
    await noReviewRecords(created.id);
  });

  it('rejects non-owner and teacher writes and invalid DTOs without changing any content', async () => {
    const created = await submit(await publish());
    const before = await raw(created.id);
    await edit(created.id, 0, changed, teacher).expect(403);
    await edit(created.id, 0, changed, otherStudent).expect(403);
    const invalid = [
      { content: changed },
      ...[null, '0', -1, 0.5].map((expectedRevision) => ({
        expectedRevision,
        content: changed,
      })),
      { expectedRevision: 0 },
      { expectedRevision: 0, content: null },
      { expectedRevision: 0, content: {} },
      { expectedRevision: 0, content: { ...changed, submissionNote: null } },
      {
        expectedRevision: 0,
        content: { ...changed, submissionNote: '😀'.repeat(20001) },
      },
      { expectedRevision: 0, content: { ...changed, language: 1 } },
      { expectedRevision: 0, content: { ...changed, codeText: null } },
      { expectedRevision: 0, content: { ...changed, codeText: '' } },
      { expectedRevision: 0, content: { ...changed, language: '' } },
      ...[
        'studentId',
        'taskId',
        'classroomTaskId',
        'attemptNo',
        'submittedAt',
        'contentRevision',
        'revision',
        'reviewStartedAt',
        'lastEditedAt',
        'lastEditIsLate',
        'status',
        'isLate',
        'lateBySeconds',
        'createdAt',
        'meta',
      ].map((key) => ({
        expectedRevision: 0,
        content: changed,
        [key]: key === 'meta' ? {} : 1,
      })),
      {
        expectedRevision: 0,
        content: { ...changed, studentId: userIds[1].toString() },
      },
    ];
    for (const payload of invalid) {
      await student.patch(submissionUrl(created.id)).send(payload).expect(400);
      expect(await raw(created.id)).toEqual(before);
      await noReviewRecords(created.id);
    }
    const unicode = { ...changed, submissionNote: '😀'.repeat(20000) };
    expect(
      ((await edit(created.id, 0, unicode).expect(200)).body as Detail).content,
    ).toEqual(unicode);
  });

  it('rejects empty code or language before creating a first attempt', async () => {
    const published = await publish();
    const readOwnedCounts = async () => {
      const owned = await submissions
        .find({ studentId: { $in: userIds } })
        .select('_id')
        .lean()
        .exec();
      return {
        submissions: owned.length,
        jobs: await jobs.countDocuments({ studentId: { $in: userIds } }),
        feedback: await feedback.countDocuments({
          submissionId: { $in: owned.map((item) => item._id) },
        }),
      };
    };
    const before = await readOwnedCounts();
    for (const content of [
      { ...original, codeText: '' },
      { ...original, language: '' },
    ]) {
      await student
        .post(instanceUrl(published.id) + '/submissions')
        .send({ content })
        .expect(400);
      expect(await readOwnedCounts()).toEqual(before);
    }
    const content = { ...original, submissionNote: '' };
    const created = await submit(published, content);
    expect(created.attemptNo).toBe(1);
    expect(created.contentRevision).toBe(0);
    expect(created.content).toEqual(content);
    expect((await raw(created.id))?.content).toEqual(content);
    await noReviewRecords(created.id);
  });

  it('validates review DTOs and business tags before fixing the content', async () => {
    const created = await submit(await publish());
    const before = await raw(created.id);
    for (const value of [undefined, null, '0', -1, 0.5]) {
      const expected = value === undefined ? {} : { expectedRevision: value };
      await teacher
        .post(submissionUrl(created.id) + '/feedback')
        .send({ ...reviewPayload, ...expected })
        .expect(400);
      await teacher
        .post(submissionUrl(created.id) + '/ai-feedback/request')
        .send(expected)
        .expect(400);
    }
    await teacher
      .post(submissionUrl(created.id) + '/feedback')
      .send({ ...reviewPayload, expectedRevision: 0, tags: ['invalid-tag'] })
      .expect(400);
    await otherStudent
      .post(submissionUrl(created.id) + '/ai-feedback/request')
      .send({ expectedRevision: 0 })
      .expect(403);
    expect(await raw(created.id)).toEqual(before);
    await noReviewRecords(created.id);
  });

  it('uses current deadlines and preserves first submission lateness when a later edit is allowed', async () => {
    const published = await publish();
    const created = await submit(published);
    const before = await raw(created.id);
    const overdueAt = new Date(Date.now() - 60000).toISOString();
    await teacher
      .patch(instanceUrl(published.id))
      .send({
        dueAt: overdueAt,
        allowLate: false,
      })
      .expect(200);
    await edit(created.id).expect(403);
    expect((await detail(student, created.id)).editing.reason).toBe(
      'DEADLINE_PASSED',
    );
    expect(await raw(created.id)).toEqual(before);
    await teacher
      .patch(instanceUrl(published.id))
      .send({ dueAt: overdueAt, allowLate: true })
      .expect(200);
    const saved = (await edit(created.id).expect(200)).body as Detail;
    expect(saved.lastEditIsLate).toBe(true);
    expect(Date.parse(saved.lastEditedAt!)).toBeGreaterThan(
      Date.parse(created.submittedAt),
    );
    expect(saved.isLate).toBe(false);
    expect(saved.lateBySeconds).toBe(0);
    expect((await raw(created.id))?.submittedAt).toEqual(before?.submittedAt);
  });

  it('rejects removed memberships, closed tasks, archived classrooms and missing publication context without side effects', async () => {
    const published = await publish();
    const created = await submit(published);
    const before = await raw(created.id);
    await teacher
      .post(
        '/api/classrooms/' +
          classroom.id +
          '/students/' +
          userIds[1].toString() +
          '/remove',
      )
      .send({})
      .expect(201);
    await edit(created.id).expect(403);
    expect(await raw(created.id)).toEqual(before);
    expect((await detail(student, created.id)).id).toBe(created.id);
    await student
      .post('/api/classrooms/join')
      .send({ joinCode: classroom.joinCode })
      .expect(201);
    await teacher
      .patch(instanceUrl(published.id) + '/status')
      .send({ status: 'CLOSED' })
      .expect(200);
    await edit(created.id).expect(403);
    expect(await raw(created.id)).toEqual(before);
    const second = await submit(await publish());
    const secondBefore = await raw(second.id);
    await teacher
      .patch('/api/classrooms/' + classroom.id)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await edit(second.id).expect(403);
    expect(await raw(second.id)).toEqual(secondBefore);
    expect((await detail(student, second.id)).id).toBe(second.id);
    await teacher
      .patch('/api/classrooms/' + classroom.id)
      .send({ status: 'ACTIVE' })
      .expect(200);
    // Historical missing/mismatched links are corruption-only compatibility fixtures.
    for (const scenario of [
      { mutation: { $unset: { taskSnapshot: '' } }, status: 403 },
      {
        mutation: { $set: { taskId: new Types.ObjectId() } },
        status: 409,
        message: 'Submission does not match classroom task',
      },
      {
        mutation: { $set: { classroomId: new Types.ObjectId() } },
        status: 404,
        message: 'Classroom not found',
      },
    ]) {
      const instance = await publish();
      const saved = await submit(instance);
      const snapshot = await raw(saved.id);
      await instances.collection.updateOne(
        { _id: new Types.ObjectId(instance.id) },
        scenario.mutation,
      );
      const denied = await edit(saved.id).expect(scenario.status);
      if (scenario.message)
        expect((denied.body as { message: string }).message).toBe(
          scenario.message,
        );
      expect(await raw(saved.id)).toEqual(snapshot);
      await noReviewRecords(saved.id);
    }
    for (const scenario of [
      {
        mutation: { $unset: { classroomTaskId: '' } },
        status: 409,
        message: 'Submission has no valid classroom task',
      },
      {
        mutation: { $set: { classroomTaskId: new Types.ObjectId() } },
        status: 404,
        message: 'Classroom task not found',
      },
    ]) {
      const invalid = await submit(await publish());
      await submissions.collection.updateOne(
        { _id: new Types.ObjectId(invalid.id) },
        scenario.mutation,
      );
      const invalidBefore = await raw(invalid.id);
      const denied = await edit(invalid.id).expect(scenario.status);
      expect((denied.body as { message: string }).message).toBe(
        scenario.message,
      );
      expect(await raw(invalid.id)).toEqual(invalidBefore);
      await noReviewRecords(invalid.id);
    }
  });

  it('permits editing an earlier attempt and leaves new-attempt cooldown and counts intact', async () => {
    const published = await publish();
    const first = await submit(published);
    const second = await submit(published);
    expect(second.attemptNo).toBe(2);
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 300000);
    try {
      await student
        .post(instanceUrl(published.id) + '/submissions')
        .send({ content: original })
        .expect(429);
      await edit(first.id).expect(200);
      await student
        .post(instanceUrl(published.id) + '/submissions')
        .send({ content: original })
        .expect(429);
      expect(
        await submissions.countDocuments({
          classroomTaskId: new Types.ObjectId(published.id),
          studentId: userIds[1],
        }),
      ).toBe(2);
      expect((await detail(student, first.id)).attemptNo).toBe(1);
      expect((await detail(student, second.id)).content).toEqual(original);
    } finally {
      config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    }
  });

  it('allows only one student save for a shared revision and preserves the winning payload', async () => {
    const created = await submit(await publish());
    const alternative = {
      ...changed,
      codeText: 'const winner = 2;',
      submissionNote: 'second contender',
    };
    const responses = await Promise.all([
      edit(created.id),
      edit(created.id, 0, alternative),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? changed : alternative;
    const final = await detail(student, created.id);
    expect(final.contentRevision).toBe(1);
    expect(final.content).toEqual(winner);
    const conflict = responses.find((r) => r.status === 409)!.body as object;
    expect(conflict).toMatchObject({
      statusCode: 409,
      message: '作品内容已变化，请查看最新提交并核对草稿后明确继续。',
    });
    expect(conflict).not.toHaveProperty('code');
    await noReviewRecords(created.id);
  });

  it('returns each student PATCH from its own write when a later revision finishes first', async () => {
    const published = await publish();
    const created = await submit(published);
    const submissionId = new Types.ObjectId(created.id);
    const payloadA = {
      language: 'typescript',
      codeText: '  const first = "A";\n\tfirst;\n',
      submissionNote: '  保存 A\n\t保留原文\n',
    };
    const payloadB = {
      language: 'python',
      codeText: '  second = "B"\n\tprint(second)\n',
      submissionNote: '  保存 B\n\t保留原文\n',
    };
    const readback = readbackConnection?.db;
    if (!readback) throw new Error('Missing guarded submission readback');
    const stored = readback.collection<Submission>(submissions.collection.name);
    const read = () =>
      stored.findOne(
        { _id: submissionId },
        { readPreference: 'primary', signal: AbortSignal.timeout(5000) },
      );
    const reached = requestCheckpoint();
    const released = requestCheckpoint();
    const collection: {
      findOneAndUpdate(
        filter: mongo.Filter<mongo.Document>,
        update: mongo.UpdateFilter<mongo.Document> | mongo.Document[],
        options?: mongo.FindOneAndUpdateOptions,
      ): Promise<mongo.Document | null>;
    } = submissions.collection;
    const write = collection.findOneAndUpdate.bind(
      collection,
    ) as typeof collection.findOneAndUpdate;
    const spy = jest
      .spyOn(collection, 'findOneAndUpdate')
      .mockImplementation(async (filter, update, options) => {
        const result = await write(filter, update, options);
        const fields = Array.isArray(update)
          ? undefined
          : (update.$set as Pick<Submission, 'content'> | undefined);
        if (
          result &&
          filter._id instanceof Types.ObjectId &&
          submissionId.equals(filter._id) &&
          fields?.content?.codeText === payloadA.codeText
        ) {
          reached.resolve();
          await released.promise;
        }
        return result;
      });
    const pending = edit(created.id, 0, payloadA).then((result) => result);
    let responseA: request.Response;
    let responseB: request.Response;
    let firstWritten: mongo.WithId<Submission> | null;
    try {
      await waitForRequestCheckpoint(
        reached.promise,
        pending,
        'Student write A',
      );
      firstWritten = await read();
      expect(firstWritten).toMatchObject({
        content: payloadA,
        contentRevision: 1,
        lastEditIsLate: false,
      });
      const afterA = await detail(student, created.id);
      expect(afterA).toMatchObject({ id: created.id, contentRevision: 1 });
      await teacher
        .patch(instanceUrl(published.id))
        .send({ dueAt: '2000-01-01T00:00:00.000Z', allowLate: true })
        .expect(200);
      responseB = await edit(created.id, afterA.contentRevision!, payloadB);
      expect(responseB.status).toBe(200);
      released.resolve();
      responseA = await pending;
    } finally {
      released.resolve();
      try {
        await Promise.allSettled([pending]);
      } finally {
        spy.mockRestore();
      }
    }
    const final = await detail(student, created.id);
    const terminal = await read();
    expect(terminal).toMatchObject({
      _id: submissionId,
      attemptNo: created.attemptNo,
      content: payloadB,
      contentRevision: 2,
      lastEditIsLate: true,
    });
    expect(
      await stored.countDocuments(
        { classroomTaskId: new Types.ObjectId(published.id) },
        { readPreference: 'primary', signal: AbortSignal.timeout(5000) },
      ),
    ).toBe(1);
    const savedA = {
      id: created.id,
      attemptNo: created.attemptNo,
      language: payloadA.language,
      content: payloadA,
      contentRevision: 1,
      lastEditedAt: firstWritten?.lastEditedAt?.toISOString(),
      lastEditIsLate: false,
    };
    const savedB = {
      id: created.id,
      attemptNo: created.attemptNo,
      language: payloadB.language,
      content: payloadB,
      contentRevision: 2,
      lastEditedAt: terminal?.lastEditedAt?.toISOString(),
      lastEditIsLate: true,
    };
    expect(savedA.lastEditedAt).toEqual(expect.any(String));
    expect(savedB.lastEditedAt).toEqual(expect.any(String));
    expect(responseA.status).toBe(200);
    const receiptA = responseA.body as Detail;
    const receiptB = responseB.body as Detail;
    const savedFields = ({
      id,
      attemptNo,
      language,
      content,
      contentRevision,
      lastEditedAt,
      lastEditIsLate,
    }: Detail) => ({
      id,
      attemptNo,
      language,
      content,
      contentRevision,
      lastEditedAt,
      lastEditIsLate,
    });
    console.info('23 student PATCH receipts', {
      namespace,
      a: { status: responseA.status, ...savedFields(receiptA) },
      b: { status: responseB.status, ...savedFields(receiptB) },
      finalGet: savedFields(final),
      mongo: savedB,
    });
    expect(receiptB).toMatchObject(savedB);
    expect(final).toMatchObject(savedB);
    expect(receiptA).toMatchObject(savedA);
  });

  it('rejects old feedback and AI revisions after a student save without pinning or creating associated records', async () => {
    const created = await submit(await publish());
    await detail(teacher, created.id);
    await edit(created.id).expect(200);
    await giveFeedback(created.id).expect(409);
    await askAi(created.id).expect(409);
    expect((await detail(student, created.id)).reviewStartedAt).toBeNull();
    expect((await detail(student, created.id)).content).toEqual(changed);
    await noReviewRecords(created.id);
  });

  it.each(['feedback', 'ai'])(
    'resolves a real concurrent edit versus %s request by the same submission condition',
    async (kind) => {
      const created = await submit(await publish());
      const [save, review] = await Promise.all([
        edit(created.id),
        kind === 'feedback' ? giveFeedback(created.id) : askAi(created.id),
      ]);
      const final = await detail(student, created.id);
      const filter = { submissionId: new Types.ObjectId(created.id) };
      if (save.status === 200) {
        expect(review.status).toBe(409);
        expect(final.contentRevision).toBe(1);
        expect(final.content).toEqual(changed);
        expect(final.reviewStartedAt).toBeNull();
        await noReviewRecords(created.id);
      } else {
        expect(save.status).toBe(409);
        expect(review.status).toBe(kind === 'feedback' ? 201 : 200);
        expect(final.contentRevision).toBe(0);
        expect(final.content).toEqual(original);
        expect(final.reviewStartedAt).toEqual(expect.any(String));
        expect(final.editing.reason).toBe('REVIEW_STARTED');
        expect(await feedback.countDocuments(filter)).toBe(
          kind === 'feedback' ? 1 : 0,
        );
        expect(await jobs.countDocuments(filter)).toBe(kind === 'ai' ? 1 : 0);
      }
    },
  );

  it('keeps admitted content fixed while allowing additional feedback and same-revision AI with existing-job idempotency', async () => {
    const created = await submit(await publish());
    await giveFeedback(created.id).expect(201);
    const firstPin = (await detail(student, created.id)).reviewStartedAt;
    const denied = await edit(created.id).expect(409);
    expect(denied.body).toMatchObject({
      statusCode: 409,
      message:
        '本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。',
    });
    expect(denied.body).not.toHaveProperty('code');
    await giveFeedback(created.id, 0, {
      ...reviewPayload,
      message: 'Additional feedback.',
    }).expect(201);
    const firstJob = (await askAi(created.id).expect(200)).body as {
      jobId: string;
    };
    const filter = { submissionId: new Types.ObjectId(created.id) };
    for (const status of [
      AiFeedbackJobStatus.Failed,
      AiFeedbackJobStatus.Dead,
      AiFeedbackJobStatus.Succeeded,
    ]) {
      await jobs.updateOne(filter, { $set: { status, attempts: 2 } });
      const existing = await jobs.findOne(filter).lean().exec();
      const repeated = (await askAi(created.id).expect(200)).body as {
        jobId: string;
        status: string;
      };
      expect(repeated).toMatchObject({ jobId: firstJob.jobId, status });
      expect(await jobs.findOne(filter).lean().exec()).toEqual(existing);
      await askAi(created.id, 1).expect(409);
      await askAi(created.id, 0, otherStudent).expect(403);
    }
    expect(await jobs.countDocuments(filter)).toBe(1);
    expect((await detail(student, created.id)).reviewStartedAt).toBe(firstPin);
  });

  it('returns each teacher feedback PATCH from its own write with overlapping disjoint edits', async () => {
    const created = await submit(await publish());
    const url = submissionUrl(created.id) + '/feedback';
    const initial = (
      await giveFeedback(created.id, 0, {
        ...reviewPayload,
        message: '旧正文',
        severity: FeedbackSeverity.Info,
      }).expect(201)
    ).body as FeedbackReceipt;
    const target = `${url}/${initial.id}`;
    const id = new Types.ObjectId(initial.id);
    const payloadA = { message: '新正文' };
    const payloadB = { severity: FeedbackSeverity.Warn };
    const timeout = { response: 15000, deadline: 20000 };

    // Pause both real reads before either request can reach its write.
    const reached = Array.from({ length: 2 }, requestCheckpoint);
    const released = Array.from({ length: 2 }, requestCheckpoint);
    const readSnapshots: Array<Pick<Feedback, 'message' | 'severity'>> = [];
    const collection: {
      findOne(
        filter: mongo.Filter<StoredFeedback>,
        options?: mongo.FindOptions,
      ): Promise<StoredFeedback | null>;
    } = feedback.collection;
    const findOne = collection.findOne.bind(
      collection,
    ) as typeof collection.findOne;
    const spy = jest
      .spyOn(collection, 'findOne')
      .mockImplementation(async (filter, options) => {
        const record = await findOne(filter, options);
        const index = readSnapshots.length;
        if (record && id.equals(record._id) && index < reached.length) {
          readSnapshots.push({
            message: record.message,
            severity: record.severity,
          });
          reached[index].resolve();
          await released[index].promise;
        }
        return record;
      });
    const pending: Promise<request.Response>[] = [];
    let receiptA: FeedbackReceipt;
    let receiptB: FeedbackReceipt;
    try {
      const requestA = teacher
        .patch(target)
        .timeout(timeout)
        .send(payloadA)
        .then((response) => response);
      pending.push(requestA);
      await waitForRequestCheckpoint(
        reached[0].promise,
        requestA,
        'Feedback read A',
      );
      const requestB = teacher
        .patch(target)
        .timeout(timeout)
        .send(payloadB)
        .then((response) => response);
      pending.push(requestB);
      await waitForRequestCheckpoint(
        reached[1].promise,
        requestB,
        'Feedback read B',
      );
      expect(readSnapshots).toEqual([
        { message: '旧正文', severity: FeedbackSeverity.Info },
        { message: '旧正文', severity: FeedbackSeverity.Info },
      ]);

      released[0].resolve();
      const a = await requestA;
      expect(a.status).toBe(200);
      receiptA = a.body as FeedbackReceipt;
      released[1].resolve();
      const b = await requestB;
      expect(b.status).toBe(200);
      receiptB = b.body as FeedbackReceipt;
    } finally {
      for (const pause of released) pause.resolve();
      try {
        await Promise.allSettled(pending);
      } finally {
        spy.mockRestore();
      }
    }
    const { updatedAt: updatedAtA, ...bodyA } = receiptA;
    const { updatedAt: updatedAtB, ...bodyB } = receiptB;
    const { updatedAt: initialUpdatedAt, ...initialBody } = initial;
    expect(initialBody).toEqual({
      ...reviewPayload,
      id: id.toHexString(),
      submissionId: created.id,
      createdBy: userIds[0].toHexString(),
      message: '旧正文',
      severity: FeedbackSeverity.Info,
      createdAt: initial.createdAt,
    });
    expect(bodyA).toEqual({ ...initialBody, ...payloadA });
    expect(bodyB).toEqual({ ...initialBody, ...payloadA, ...payloadB });
    for (const time of [
      initial.createdAt,
      initialUpdatedAt,
      updatedAtA,
      updatedAtB,
    ])
      expect(new Date(time).toISOString()).toBe(time);

    const stored = await feedback.findById(id).lean<StoredFeedback>().exec();
    expect(stored).toMatchObject({
      ...reviewPayload,
      _id: id,
      submissionId: new Types.ObjectId(created.id),
      createdBy: userIds[0],
      ...payloadA,
      ...payloadB,
      createdAt: new Date(initial.createdAt),
      updatedAt: new Date(updatedAtB),
    });
    const list = (await teacher.get(url).expect(200)).body as FeedbackReceipt[];
    expect(list).toEqual([receiptB]);
    console.info('Concurrent teacher feedback PATCH verified', {
      writeOrder: 'A then B; both reads held before A completed',
      a: {
        request: payloadA,
        message: receiptA.message,
        severity: receiptA.severity,
      },
      b: {
        request: payloadB,
        message: receiptB.message,
        severity: receiptB.severity,
      },
      mongo: { message: stored?.message, severity: stored?.severity },
      list: { message: list[0].message, severity: list[0].severity },
    });
  });

  it('keeps teacher feedback PATCH compatible with missing authors, explicit clears and same values', async () => {
    const created = await submit(await publish());
    const url = submissionUrl(created.id) + '/feedback';
    const initial = (await giveFeedback(created.id).expect(201))
      .body as FeedbackReceipt;
    const id = new Types.ObjectId(initial.id);
    const scope = { _id: id, submissionId: new Types.ObjectId(created.id) };
    const target = `${url}/${initial.id}`;
    await student.patch(target).send({ suggestion: 'denied' }).expect(403);
    await teacher.patch(target).send({}).expect(400);
    await teacher.patch(target).send({ severity: 'invalid' }).expect(400);
    expect((await teacher.get(url).expect(200)).body).toEqual([initial]);

    const changedAuthor = await feedback.collection.updateOne(
      { ...scope, createdBy: userIds[0] },
      { $set: { createdBy: userIds[1] } },
    );
    expect(changedAuthor.modifiedCount).toBe(1);
    await teacher.patch(target).send({ suggestion: 'denied' }).expect(403);
    expect((await teacher.get(url).expect(200)).body).toEqual([
      { ...initial, createdBy: userIds[1].toHexString() },
    ]);

    const update = await feedback.collection.updateOne(
      { ...scope, createdBy: userIds[1] },
      { $unset: { createdBy: '' } },
    );
    expect(update.modifiedCount).toBe(1);

    const response = await teacher
      .patch(target)
      .send({ suggestion: '', tags: [], scoreHint: 0 })
      .expect(200);
    const edited = response.body as FeedbackReceipt;
    const { updatedAt: editedAt, ...editedBody } = edited;
    const { updatedAt: originalAt, ...initialBody } = initial;
    expect(editedBody).toEqual({
      ...initialBody,
      suggestion: '',
      tags: ['other'],
      scoreHint: 0,
    });
    expect(new Date(editedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalAt).getTime(),
    );
    const sameValue = (
      await teacher.patch(target).send({ message: edited.message }).expect(200)
    ).body as FeedbackReceipt;
    const { updatedAt, ...sameBody } = sameValue;
    expect(sameBody).toEqual(editedBody);
    expect(
      await feedback.findById(id).lean<StoredFeedback>().exec(),
    ).toMatchObject({
      _id: id,
      createdBy: userIds[0],
      suggestion: '',
      tags: ['other'],
      scoreHint: 0,
      updatedAt: new Date(updatedAt),
    });
  });

  it('rejects duplicate teacher feedback edits without changing either record', async () => {
    const uniqueKey = {
      submissionId: 1,
      source: 1,
      type: 1,
      severity: 1,
      message: 1,
    };
    const indexes = await feedback.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: uniqueKey, unique: true }),
    );

    const created = await submit(await publish());
    const url = submissionUrl(created.id) + '/feedback';
    const payloadA = { ...reviewPayload, message: 'B19 feedback A.' };
    const payloadB = {
      ...reviewPayload,
      message: 'B19 feedback B.',
      suggestion: 'B19 suggestion B.',
      tags: ['readability'],
    };
    const a = (await giveFeedback(created.id, 0, payloadA).expect(201))
      .body as Resource;
    const b = (await giveFeedback(created.id, 0, payloadB).expect(201))
      .body as Resource;
    expect(a.id).not.toBe(b.id);

    type FeedbackSnapshot = Feedback & { _id: Types.ObjectId; updatedAt: Date };
    const readPersisted = async () => {
      const records = await feedback
        .find({ submissionId: new Types.ObjectId(created.id) })
        .lean<FeedbackSnapshot[]>()
        .exec();
      expect(records).toHaveLength(2);
      const recordA = records.find((record) => record._id.toString() === a.id);
      const recordB = records.find((record) => record._id.toString() === b.id);
      if (!recordA || !recordB) throw new Error('Expected feedback A and B');
      return { recordA, recordB };
    };
    const before = await readPersisted();
    expect(before.recordA).toMatchObject(payloadA);
    expect(before.recordB).toMatchObject(payloadB);
    expect(before.recordA.updatedAt).toBeInstanceOf(Date);
    expect(before.recordB.updatedAt).toBeInstanceOf(Date);

    const target = `${url}/${b.id}`;
    const duplicate = await teacher
      .patch(target)
      .send({
        message: payloadA.message,
        suggestion: 'B19 unsaved draft suggestion.',
        tags: ['correctness'],
      })
      .expect(409);
    const duplicateMessage =
      '该作品已有相同类型、严重程度和正文的教师反馈，请核对后修改本条反馈。';
    expect(duplicate.body).toMatchObject({
      statusCode: 409,
      message: duplicateMessage,
    });
    expect(duplicate.body).not.toHaveProperty('code');
    const afterDuplicate = await readPersisted();
    expect(afterDuplicate).toStrictEqual(before);

    const unrelated = new mongo.MongoServerError({
      code: 11000,
      errmsg: 'Synthetic unrelated feedback duplicate key',
      keyPattern: { _id: 1 },
    });
    const failNextWrite = jest
      .spyOn(feedback.collection, 'findOneAndUpdate')
      .mockRejectedValueOnce(unrelated);
    try {
      await teacher
        .patch(target)
        .send({ suggestion: 'Should not be persisted.' })
        .expect(500);
    } finally {
      failNextWrite.mockRestore();
    }
    expect(await readPersisted()).toStrictEqual(before);

    const correctedMessage = 'B19 feedback C.';
    const corrected = await teacher
      .patch(target)
      .send({ message: correctedMessage })
      .expect(200);
    expect(corrected.body).toMatchObject({
      id: b.id,
      message: correctedMessage,
    });
    const afterCorrected = await readPersisted();
    expect(afterCorrected.recordA).toStrictEqual(before.recordA);
    expect(afterCorrected.recordB).toMatchObject({
      ...payloadB,
      message: correctedMessage,
    });

    const suggestion = 'B19 corrected suggestion.';
    const suggestionOnly = await teacher
      .patch(target)
      .send({ suggestion })
      .expect(200);
    expect(suggestionOnly.body).toMatchObject({
      id: b.id,
      message: correctedMessage,
      suggestion,
    });
    const afterSuggestion = await readPersisted();
    expect(afterSuggestion.recordA).toStrictEqual(before.recordA);
    expect(afterSuggestion.recordB).toMatchObject({
      ...payloadB,
      message: correctedMessage,
      suggestion,
    });
    console.info('B19 teacher feedback PATCH verified', {
      submissionId: created.id,
      feedbackA: a.id,
      feedbackB: b.id,
      duplicate: {
        status: duplicate.status,
        message: duplicateMessage,
        beforeAndAfter: {
          aUpdatedAt: afterDuplicate.recordA.updatedAt,
          bUpdatedAt: afterDuplicate.recordB.updatedAt,
        },
      },
      corrected: {
        status: corrected.status,
        id: b.id,
        message: afterCorrected.recordB.message,
      },
      suggestionOnly: {
        status: suggestionOnly.status,
        id: b.id,
        suggestion: afterSuggestion.recordB.suggestion,
      },
    });
  });

  it('fails closed for historical feedback or any historical job state even without reviewStartedAt', async () => {
    // Internal historical fixtures cannot be constructed through the new review endpoints.
    for (const status of Object.values(AiFeedbackJobStatus)) {
      const created = await submit(await publish());
      await jobs.create({
        submissionId: new Types.ObjectId(created.id),
        taskId: new Types.ObjectId(created.taskId),
        classroomTaskId: new Types.ObjectId(created.classroomTaskId),
        studentId: userIds[1],
        status,
      });
      const before = await raw(created.id);
      expect((await detail(student, created.id)).editing.reason).toBe(
        'REVIEW_STARTED',
      );
      await edit(created.id).expect(409);
      expect(await raw(created.id)).toEqual(before);
    }
    for (const source of Object.values(FeedbackSource)) {
      const created = await submit(await publish());
      await feedback.create({
        submissionId: new Types.ObjectId(created.id),
        source,
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: 'Historical review',
      });
      const before = await raw(created.id);
      expect((await detail(student, created.id)).editing.reason).toBe(
        'REVIEW_STARTED',
      );
      await edit(created.id).expect(409);
      expect(await raw(created.id)).toEqual(before);
    }
  });

  it('leaves both first and later submissions without jobs or review locks until manual admission', async () => {
    const published = await publish();
    for (const attemptNo of [1, 2]) {
      const created = await submit(published);
      expect(created.attemptNo).toBe(attemptNo);
      expect((await raw(created.id))?.reviewStartedAt).toBeUndefined();
      expect((await detail(student, created.id)).editing.canEdit).toBe(true);
      await noReviewRecords(created.id);
      await edit(created.id).expect(200);
      expect((await raw(created.id))?.contentRevision).toBe(1);
      expect((await raw(created.id))?.attemptNo).toBe(attemptNo);
      await noReviewRecords(created.id);
    }
  });

  it('retains admission after feedback failure and lets an explicit same-revision retry reconcile an uncertain result', async () => {
    const created = await submit(await publish());
    const spy = jest
      .spyOn(feedback, 'create')
      .mockRejectedValueOnce(
        new Error('Synthetic associated feedback write failure'),
      );
    try {
      await giveFeedback(created.id).expect(500);
    } finally {
      spy.mockRestore();
    }
    const fixed = await detail(student, created.id);
    expect(fixed.editing.reason).toBe('REVIEW_STARTED');
    expect(fixed.reviewStartedAt).toEqual(expect.any(String));
    await noReviewRecords(created.id);
    await edit(created.id).expect(409);
    const accepted = (await giveFeedback(created.id).expect(201))
      .body as Resource;
    const feedbackList = await teacher
      .get(submissionUrl(created.id) + '/feedback')
      .expect(200);
    expect(feedbackList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accepted.id,
          message: reviewPayload.message,
        }),
      ]),
    );
    const retried = (await giveFeedback(created.id).expect(201))
      .body as Resource;
    expect(retried.id).toBe(accepted.id);
    await giveFeedback(created.id, 0, {
      ...reviewPayload,
      suggestion: 'Different suggestion.',
    }).expect(409);
    await giveFeedback(created.id, 0, {
      ...reviewPayload,
      scoreHint: 76,
    }).expect(409);
    await giveFeedback(created.id, 0, {
      ...reviewPayload,
      tags: ['readability'],
    }).expect(409);
    expect(
      await feedback.countDocuments({
        submissionId: new Types.ObjectId(created.id),
      }),
    ).toBe(1);
    expect((await detail(student, created.id)).reviewStartedAt).toBe(
      fixed.reviewStartedAt,
    );
    expect(
      await feedback.collection.findOne({
        _id: new Types.ObjectId(accepted.id),
      }),
    ).not.toHaveProperty('expectedRevision');
  });

  it('retains admission after AI Job failure and permits a deliberate same-revision request to complete it', async () => {
    const created = await submit(await publish());
    const spy = jest
      .spyOn(jobService, 'ensureJobForSubmission')
      .mockRejectedValueOnce(
        new Error('Synthetic associated Job write failure'),
      );
    try {
      await askAi(created.id).expect(500);
    } finally {
      spy.mockRestore();
    }
    const fixed = await detail(student, created.id);
    expect(fixed.editing.reason).toBe('REVIEW_STARTED');
    await noReviewRecords(created.id);
    await edit(created.id).expect(409);
    await askAi(created.id).expect(200);
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(created.id),
      }),
    ).toBe(1);
    expect((await detail(student, created.id)).reviewStartedAt).toBe(
      fixed.reviewStartedAt,
    );
  });

  it('reconciles a write that persisted before an uncertain feedback or AI response without creating duplicates', async () => {
    const created = await submit(await publish());
    const actualCreate = feedback.create.bind(
      feedback,
    ) as Model<Feedback>['create'];
    const feedbackSpy = jest
      .spyOn(feedback, 'create')
      .mockImplementationOnce(async () => {
        await actualCreate({
          submissionId: new Types.ObjectId(created.id),
          createdBy: userIds[0],
          ...reviewPayload,
        });
        throw new Error('Synthetic feedback response lost after persistence');
      });
    try {
      await giveFeedback(created.id).expect(500);
    } finally {
      feedbackSpy.mockRestore();
    }
    const observed = (
      await teacher.get(submissionUrl(created.id) + '/feedback').expect(200)
    ).body as Resource[];
    expect(observed).toHaveLength(1);
    const retry = (await giveFeedback(created.id).expect(201)).body as Resource;
    expect(retry.id).toBe(observed[0].id);
    expect(
      await feedback.countDocuments({
        submissionId: new Types.ObjectId(created.id),
      }),
    ).toBe(1);
    expect((await detail(student, created.id)).editing.reason).toBe(
      'REVIEW_STARTED',
    );

    const aiSubmission = await submit(await publish());
    const actualEnsure = jobService.ensureJobForSubmission.bind(
      jobService,
    ) as AiFeedbackJobService['ensureJobForSubmission'];
    const jobSpy = jest
      .spyOn(jobService, 'ensureJobForSubmission')
      .mockImplementationOnce(async (submission) => {
        await actualEnsure(submission);
        throw new Error('Synthetic AI response lost after persistence');
      });
    try {
      await askAi(aiSubmission.id).expect(500);
    } finally {
      jobSpy.mockRestore();
    }
    const existing = await jobs
      .findOne({ submissionId: new Types.ObjectId(aiSubmission.id) })
      .lean()
      .exec();
    expect(existing).not.toBeNull();
    const aiRetry = (await askAi(aiSubmission.id).expect(200)).body as {
      jobId: string;
    };
    expect(aiRetry.jobId).toBe(existing!._id.toString());
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(aiSubmission.id),
      }),
    ).toBe(1);
  });

  it('asks the teacher to reconcile an exact duplicate POST when a concurrent PATCH changes its key', async () => {
    const created = await submit(await publish());
    const url = submissionUrl(created.id) + '/feedback';
    const submissionId = new Types.ObjectId(created.id);
    const payload = { ...reviewPayload, message: '原教师反馈 A' };
    const updatedMessage = '已修改教师反馈 B';
    const initial = (await giveFeedback(created.id, 0, payload).expect(201))
      .body as FeedbackReceipt;
    const samePayload = (await giveFeedback(created.id, 0, payload).expect(201))
      .body as FeedbackReceipt;
    expect(samePayload).toEqual(initial);
    const otherPayload = await giveFeedback(created.id, 0, {
      ...payload,
      suggestion: '同一复合键，不同建议',
    }).expect(409);
    const publicConflictMessage =
      '已有反馈与本次内容不同，请核对反馈列表后再继续。';
    expect(otherPayload.body).toMatchObject({ message: publicConflictMessage });

    const readback = readbackConnection?.db;
    if (!readback) throw new Error('Missing guarded feedback readback');
    const collection = feedback.collection;
    const insertOne = collection.insertOne.bind(
      collection,
    ) as typeof collection.insertOne;
    const findOne = collection.findOne.bind(
      collection,
    ) as typeof collection.findOne;
    const reached = requestCheckpoint();
    const released = requestCheckpoint();
    const uniqueKey = {
      submissionId: 1,
      source: 1,
      type: 1,
      severity: 1,
      message: 1,
    };
    let duplicate: { code?: number; keyPattern?: unknown } | undefined;
    const insertSpy = jest
      .spyOn(collection, 'insertOne')
      .mockImplementation(async (document, options) => {
        try {
          return await insertOne(document, options);
        } catch (error) {
          if (
            error instanceof mongo.MongoServerError &&
            document.message === payload.message
          ) {
            const { code, keyPattern } = error as {
              code?: number;
              keyPattern?: unknown;
            };
            duplicate = { code, keyPattern };
          }
          throw error;
        }
      });
    const lookupSpy = jest
      .spyOn(collection, 'findOne')
      .mockImplementation(async (filter, options) => {
        if (
          filter.submissionId instanceof Types.ObjectId &&
          submissionId.equals(filter.submissionId) &&
          filter.message === payload.message
        ) {
          reached.resolve();
          await released.promise;
        }
        return findOne(filter, options);
      });

    const post = giveFeedback(created.id, 0, payload).then(
      (response) => response,
    );
    let response: request.Response;
    try {
      await waitForRequestCheckpoint(
        reached.promise,
        post,
        'Feedback duplicate lookup',
      );
      expect(duplicate).toEqual({ code: 11000, keyPattern: uniqueKey });
      const patch = await teacher
        .patch(`${url}/${initial.id}`)
        .send({ message: updatedMessage })
        .expect(200);
      expect(patch.body).toMatchObject({
        id: initial.id,
        message: updatedMessage,
      });
      released.resolve();
      response = await post;
    } finally {
      released.resolve();
      try {
        await Promise.allSettled([post]);
      } finally {
        insertSpy.mockRestore();
        lookupSpy.mockRestore();
      }
    }

    const list = (await teacher.get(url).expect(200)).body as FeedbackReceipt[];
    const documents = await readback
      .collection<StoredFeedback>(collection.name)
      .find(
        { submissionId },
        { readPreference: 'primary', signal: AbortSignal.timeout(5000) },
      )
      .toArray();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: initial.id, message: updatedMessage });
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      _id: new Types.ObjectId(initial.id),
      message: updatedMessage,
    });
    console.info('06 feedback POST/PATCH race', {
      namespace,
      feedbackId: initial.id,
      actualDuplicateCode: duplicate?.code,
      postStatus: response.status,
      listed: { count: list.length, message: list[0].message },
      independentMongo: {
        count: documents.length,
        message: documents[0].message,
      },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: publicConflictMessage });
    expect(response.body).not.toHaveProperty('code');
  });

  it('does not reinterpret an unrelated duplicate-key failure as a successful feedback retry', async () => {
    const created = await submit(await publish());
    await giveFeedback(created.id).expect(201);
    const before = await feedback
      .findOne({ submissionId: new Types.ObjectId(created.id) })
      .lean()
      .exec();
    const unrelated = Object.assign(
      new Error('Synthetic unrelated duplicate key'),
      {
        code: 11000,
        keyPattern: { _id: 1 },
        keyValue: { _id: new Types.ObjectId() },
      },
    );
    const spy = jest.spyOn(feedback, 'create').mockRejectedValueOnce(unrelated);
    try {
      await giveFeedback(created.id).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await feedback
        .findOne({ submissionId: new Types.ObjectId(created.id) })
        .lean()
        .exec(),
    ).toEqual(before);
    expect((await detail(student, created.id)).editing.reason).toBe(
      'REVIEW_STARTED',
    );
  });

  it('allows the owner student to reconcile a failed manual job write without reopening edits', async () => {
    const created = await submit(await publish());
    const spy = jest
      .spyOn(jobs, 'create')
      .mockRejectedValueOnce(new Error('Synthetic manual job write failure'));
    try {
      await askAi(created.id, 0, student).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await detail(student, created.id)).editing.reason).toBe(
      'REVIEW_STARTED',
    );
    await noReviewRecords(created.id);
    await edit(created.id).expect(409);
    await askAi(created.id, 0, student).expect(200);
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(created.id),
      }),
    ).toBe(1);
  });

  it('projects historical missing revisions as zero without read backfill and supports all new write entry points', async () => {
    for (const action of ['edit', 'feedback', 'ai']) {
      const created = await submit(await publish());
      await submissions.collection.updateOne(
        { _id: new Types.ObjectId(created.id) },
        { $unset: { contentRevision: '', reviewStartedAt: '' } },
      );
      const before = await raw(created.id);
      const legacy = await detail(student, created.id);
      expect(legacy.contentRevision).toBe(0);
      expect(legacy.editing.canEdit).toBe(true);
      expect(await raw(created.id)).toEqual(before);
      if (action === 'edit') {
        await edit(created.id).expect(200);
        expect((await raw(created.id))?.contentRevision).toBe(1);
      } else {
        await (
          action === 'feedback' ? giveFeedback(created.id) : askAi(created.id)
        ).expect(action === 'feedback' ? 201 : 200);
        expect((await detail(student, created.id)).contentRevision).toBe(0);
        expect((await detail(student, created.id)).reviewStartedAt).toEqual(
          expect.any(String),
        );
      }
    }
  });

  it('rejects illegal persisted revisions and review states at every write entry without repairing them', async () => {
    // Raw collection writes are restricted to these intentional corruption-only fixtures.
    const invalidFields: Record<string, unknown>[] = [
      ...[null, '0', -1, 0.5].map((contentRevision) => ({ contentRevision })),
      ...[null, '2026-01-01', 0].map((reviewStartedAt) => ({
        reviewStartedAt,
      })),
      { status: 'UNKNOWN' },
      { lastEditIsLate: true },
      { lastEditedAt: '2026-01-01', lastEditIsLate: false },
    ];
    for (const fields of invalidFields) {
      const created = await submit(await publish());
      const database = submissions.db.db;
      if (!database) throw new Error('Missing connected test database');
      await database
        .collection(submissions.collection.name)
        .updateOne({ _id: new Types.ObjectId(created.id) }, { $set: fields });
      const before = await raw(created.id);
      const view = await detail(student, created.id);
      expect(view.editing.canEdit).toBe(false);
      if ('contentRevision' in fields) expect(view.contentRevision).toBeNull();
      for (const response of [
        await edit(created.id),
        await giveFeedback(created.id),
        await askAi(created.id),
      ]) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({
          statusCode: 409,
          message: '提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。',
        });
        expect(response.body).not.toHaveProperty('code');
      }
      expect(await raw(created.id)).toEqual(before);
      await noReviewRecords(created.id);
    }
  });
});
