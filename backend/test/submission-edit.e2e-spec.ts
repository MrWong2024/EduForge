import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
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
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { User } from '../src/modules/users/schemas/user.schema';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

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
  contentRevision: number | null;
  lastEditedAt: string | null;
  lastEditIsLate: boolean | null;
  reviewStartedAt: string | null;
  editing: { canEdit: boolean; reason: string | null; message: string | null };
  content: { language: string; codeText: string; submissionNote: string };
  meta?: { aiUsageDeclaration?: string };
};
type Published = Resource & { taskId: string };
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

describe('B1-2 submission content edits and review admission (HTTP)', () => {
  let app: INestApplication<App>;
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
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
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
    expect(users.db.name).toBe('eduforge_test');
    expect(users.db.host).toBe('127.0.0.1');
    expect(users.db.port).toBe(27017);
    users.db.set('maxTimeMS', 10000);
    const database = users.db.db;
    if (!database) throw new Error('Missing connected test database');
    const build = (await database.command(
      { buildInfo: 1 },
      { timeoutMS: 5000 },
    )) as { version: string };
    expect(build.version).toBe('9.0.4');
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: config.get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: users.db.host,
      authInfo: auth.authInfo,
    });
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
      'B1-2 database gate: standard_test / eduforge_test / 127.0.0.1:27017 / MongoDB 9.0.4 / root@admin verified; namespace=' +
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
        expect(await feedback.countDocuments(related)).toBe(0);
        expect(await jobs.countDocuments(related)).toBe(0);
        expect(await submissions.countDocuments({ _id: { $in: ids } })).toBe(0);
        expect(
          await instances.countDocuments({
            _id: { $in: instanceIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await tasks.countDocuments({
            _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await enrollments.countDocuments({
            classroomId: {
              $in: classroomIds.map((id) => new Types.ObjectId(id)),
            },
          }),
        ).toBe(0);
        expect(
          await classrooms.countDocuments({
            _id: { $in: classroomIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await courses.countDocuments({
            _id: { $in: courseIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await sessions.countDocuments({ userId: { $in: userIds } }),
        ).toBe(0);
        expect(await users.countDocuments({ _id: { $in: userIds } })).toBe(0);
        console.info(
          'B1-2 exact cleanup verified: submissions/feedback/jobs/classes/enrollment/session/users residual=0; namespace=' +
            namespace,
        );
      }
    } finally {
      if (app) {
        await app.close();
        if (users) expect(users.db.readyState).toBe(0);
        console.info('B1-2 app/DB closed');
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
      {
        mutation: { $unset: { taskSnapshot: '' } },
        status: 403,
        message: '课堂任务内容快照缺失或无效，请联系教师核对。',
      },
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
      const instanceBefore = await instances.collection.findOne({
        _id: new Types.ObjectId(instance.id),
      });
      expect(instanceBefore).not.toBeNull();
      if ('$unset' in scenario.mutation)
        expect(instanceBefore).not.toHaveProperty('taskSnapshot');
      const denied = await edit(saved.id).expect(scenario.status);
      if (scenario.message)
        expect((denied.body as { message: string }).message).toBe(
          scenario.message,
        );
      expect(await raw(saved.id)).toEqual(snapshot);
      expect(
        await instances.collection.findOne({
          _id: new Types.ObjectId(instance.id),
        }),
      ).toEqual(instanceBefore);
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
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body).toMatchObject({
      statusCode: 409,
      path: submissionUrl(created.id),
      message: '作品内容已变化，请查看最新提交并核对草稿后明确继续。',
    });
    expect(conflict?.body).not.toHaveProperty('code');
    expect(conflict?.body).not.toHaveProperty('reason');
    await noReviewRecords(created.id);
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
      path: submissionUrl(created.id),
      message:
        '本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。',
    });
    expect(denied.body).not.toHaveProperty('code');
    expect(denied.body).not.toHaveProperty('reason');
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

  it('keeps missing revisions unknown and readable while rejecting all new writes without backfill', async () => {
    const created = await submit(await publish());
    await submissions.collection.updateOne(
      { _id: new Types.ObjectId(created.id) },
      { $unset: { contentRevision: '' } },
    );
    const before = await raw(created.id);
    expect(before).not.toBeNull();
    expect(before).not.toHaveProperty('contentRevision');
    expect(before).not.toHaveProperty('reviewStartedAt');
    for (const agent of [student, teacher]) {
      const view = await detail(agent, created.id);
      expect(view.contentRevision).toBeNull();
      expect(view.content).toEqual(original);
      expect(view.meta).toEqual({ aiUsageDeclaration: 'Synthetic test only' });
      expect(view.reviewStartedAt).toBeNull();
    }
    expect((await detail(student, created.id)).editing).toMatchObject({
      canEdit: false,
      reason: 'INVALID_STATE',
    });
    expect(await raw(created.id)).toEqual(before);
    await edit(created.id, 0, changed, otherStudent).expect(403);
    for (const [response, path] of [
      [await edit(created.id), submissionUrl(created.id)],
      [await giveFeedback(created.id), submissionUrl(created.id) + '/feedback'],
      [
        await askAi(created.id),
        submissionUrl(created.id) + '/ai-feedback/request',
      ],
    ] as const) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        statusCode: 409,
        path,
        message: '提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。',
      });
      expect(response.body).not.toHaveProperty('code');
      expect(response.body).not.toHaveProperty('reason');
    }
    expect(await raw(created.id)).toEqual(before);
    await noReviewRecords(created.id);
  });

  it.each(['missing', 'array'] as const)(
    'rejects a revision made %s after review validation but before the real Mongo CAS',
    async (revisionState) => {
      const created = await submit(await publish());
      const database = submissions.db.db;
      if (!database) throw new Error('Missing connected test database');
      expect((await raw(created.id))?.contentRevision).toBe(0);
      let beforeWrite: Awaited<ReturnType<typeof raw>> | undefined;
      let restoreExec: (() => void) | undefined;
      const actualFindOneAndUpdate = submissions.findOneAndUpdate.bind(
        submissions,
      ) as Model<Submission>['findOneAndUpdate'];
      const writeSpy = jest
        .spyOn(submissions, 'findOneAndUpdate')
        .mockImplementationOnce((filter, update, options) => {
          const query = actualFindOneAndUpdate<Submission>(
            filter,
            update,
            options,
          );
          const execSpy = jest
            .spyOn(query, 'exec')
            .mockImplementationOnce(async (): Promise<Submission | null> => {
              // The service has read revision 0 and validated review admission.
              // Corrupt only this owned fixture immediately before the real CAS.
              await database
                .collection(submissions.collection.name)
                .updateOne(
                  { _id: new Types.ObjectId(created.id) },
                  revisionState === 'missing'
                    ? { $unset: { contentRevision: '' } }
                    : { $set: { contentRevision: [0] } },
                );
              beforeWrite = await raw(created.id);
              expect(beforeWrite).not.toBeNull();
              if (revisionState === 'missing') {
                expect(beforeWrite).not.toHaveProperty('contentRevision');
              } else {
                expect(beforeWrite?.contentRevision).toEqual([0]);
              }
              expect(beforeWrite).not.toHaveProperty('reviewStartedAt');
              execSpy.mockRestore();
              return query.exec();
            });
          restoreExec = () => execSpy.mockRestore();
          return query;
        });
      try {
        const rejected = await giveFeedback(created.id).expect(409);
        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(beforeWrite).toBeDefined();
        expect(rejected.body).toMatchObject({
          statusCode: 409,
          path: submissionUrl(created.id) + '/feedback',
          message: '提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。',
        });
        expect(rejected.body).not.toHaveProperty('code');
        expect(rejected.body).not.toHaveProperty('reason');
        expect(await raw(created.id)).toEqual(beforeWrite);
        await noReviewRecords(created.id);
      } finally {
        restoreExec?.();
        writeSpy.mockRestore();
      }
    },
  );

  it('keeps existing feedback readable and author-editable when the submission revision is missing', async () => {
    const created = await submit(await publish());
    const accepted = (await giveFeedback(created.id).expect(201))
      .body as Resource;
    await submissions.collection.updateOne(
      { _id: new Types.ObjectId(created.id) },
      { $unset: { contentRevision: '' } },
    );
    const before = await raw(created.id);
    expect(before).not.toHaveProperty('contentRevision');
    for (const agent of [student, teacher]) {
      const response = await agent
        .get(submissionUrl(created.id) + '/feedback')
        .expect(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          id: accepted.id,
          message: reviewPayload.message,
        }),
      ]);
    }
    expect(await raw(created.id)).toEqual(before);
    const edited = await teacher
      .patch(submissionUrl(created.id) + '/feedback/' + accepted.id)
      .send({ message: 'Clarified existing teacher feedback.' })
      .expect(200);
    expect(edited.body).toMatchObject({
      id: accepted.id,
      createdBy: userIds[0].toHexString(),
      message: 'Clarified existing teacher feedback.',
    });
    expect(await raw(created.id)).toEqual(before);
    const associated = { submissionId: new Types.ObjectId(created.id) };
    expect(await feedback.countDocuments(associated)).toBe(1);
    expect(await jobs.countDocuments(associated)).toBe(0);
  });

  it('rejects illegal persisted revisions and review states at every write entry without repairing them', async () => {
    // Raw collection writes are restricted to these intentional corruption-only fixtures.
    const invalidFields: Record<string, unknown>[] = [
      ...[null, '0', -1, 0.5, [0]].map((contentRevision) => ({
        contentRevision,
      })),
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
      expect(before).toMatchObject(fields);
      const view = await detail(student, created.id);
      expect(view.editing.canEdit).toBe(false);
      if ('contentRevision' in fields) expect(view.contentRevision).toBeNull();
      for (const [response, path] of [
        [await edit(created.id), submissionUrl(created.id)],
        [
          await giveFeedback(created.id),
          submissionUrl(created.id) + '/feedback',
        ],
        [
          await askAi(created.id),
          submissionUrl(created.id) + '/ai-feedback/request',
        ],
      ] as const) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({
          statusCode: 409,
          path,
          message: '提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。',
        });
        expect(response.body).not.toHaveProperty('code');
        expect(response.body).not.toHaveProperty('reason');
      }
      expect(await raw(created.id)).toEqual(before);
      await noReviewRecords(created.id);
    }
  });
});
