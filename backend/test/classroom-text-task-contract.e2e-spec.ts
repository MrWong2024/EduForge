import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSource,
  FeedbackType,
  FeedbackSeverity,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import { DefaultStubAiFeedbackProvider } from '../src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider';
import { ClassroomTaskResponseDto } from '../src/modules/classrooms/classroom-tasks/dto/classroom-task-response.dto';
import { SubmissionResponseDto } from '../src/modules/learning-tasks/dto/submission-response.dto';
import { SubmissionDetailResponseDto } from '../src/modules/learning-tasks/dto/submission-detail-response.dto';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(90000);
type Agent = ReturnType<typeof request.agent>;
type Resource = { id: string; joinCode?: string };
type List = { total: number; items: Array<{ id: string }> };
const missingSnapshot = '该课堂任务未保存发布内容，请教师重新布置后继续。';
const oldContent = {
  title: 'Frozen A requirements',
  description:
    'A description\nKeep original external link https://example.invalid/a',
  knowledgeModule: 'old-module',
  courseLabel: 'Java 程序设计',
  difficulty: 'easy',
  rubric: { criterion: 'old rubric' },
};
const newContent = {
  title: 'Frozen B requirements',
  description: 'B changed description',
  knowledgeModule: 'new-module',
  courseLabel: 'Java 程序设计',
  difficulty: 'hard',
  rubric: { criterion: 'new rubric' },
};
const code =
  '===== FILE: src/Alpha.ts =====\nexport const alpha = 1;\n===== FILE: src/Beta.ts =====\nexport const beta = 2;';
const note = '  NOTE_ONLY_A1_独立标记\n\t说明保留缩进和换行。\n';

describe('A1 classroom text task backend contract (HTTP)', () => {
  let app: INestApplication<App>;
  let users: Model<User>,
    sessions: Model<Session>,
    courses: Model<Course>,
    classrooms: Model<Classroom>;
  let enrollments: Model<Enrollment>,
    instances: Model<ClassroomTask>,
    tasks: Model<Task>;
  let submissions: Model<Submission>,
    feedback: Model<Feedback>,
    jobs: Model<AiFeedbackJob>;
  let teacherA: Agent, teacherB: Agent, studentA: Agent, studentB: Agent;
  let classA: Resource, classB: Resource;
  let taskId: string,
    instanceA: ClassroomTaskResponseDto,
    instanceB: ClassroomTaskResponseDto;
  let first: SubmissionResponseDto,
    second: SubmissionResponseDto,
    foreign: SubmissionResponseDto;
  const userIds: Types.ObjectId[] = [],
    courseIds: string[] = [],
    classIds: string[] = [],
    taskIds: string[] = [],
    instanceIds: string[] = [];
  const namespace = 'a1-text-' + Date.now();

  const makeTask = async (
    agent: Agent,
    content = oldContent,
    visibility = 'SHARED',
  ) => {
    const res = await agent
      .post('/api/learning-tasks/tasks')
      .send({ ...content, visibility, status: 'PUBLISHED' })
      .expect(201);
    const id = (res.body as Resource).id;
    taskIds.push(id);
    return id;
  };
  const publish = async (agent: Agent, classroom: Resource, id: string) => {
    const res = await agent
      .post('/api/classrooms/' + classroom.id + '/tasks')
      .send({
        taskId: id,
        settings: { allowLate: true },
      })
      .expect(201);
    const body = res.body as ClassroomTaskResponseDto;
    instanceIds.push(body.id);
    return body;
  };
  const submit = async (
    agent: Agent,
    classroom: Resource,
    instance: ClassroomTaskResponseDto,
    content: Record<string, unknown> = {
      codeText: code,
      language: 'typescript',
      submissionNote: note,
    },
  ) => {
    const res = await agent
      .post(
        '/api/classrooms/' +
          classroom.id +
          '/tasks/' +
          instance.id +
          '/submissions',
      )
      .send({ content, meta: { aiUsageDeclaration: 'Brainstorming only' } })
      .expect(201);
    return res.body as SubmissionResponseDto;
  };
  const ask = (agent: Agent, id: string) =>
    agent
      .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
      .send({ expectedRevision: 0 });
  const getDetail = async (agent: Agent, id: string) =>
    (await agent.get('/api/learning-tasks/submissions/' + id).expect(200))
      .body as SubmissionDetailResponseDto;

  const processOwned = async (batch: number) => {
    const owned = await submissions
      .find({ studentId: { $in: userIds } })
      .select('_id')
      .lean()
      .exec();
    expect(
      await jobs.countDocuments({
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
        submissionId: { $nin: owned.map((s) => s._id) },
      }),
    ).toBe(0);
    return app.get(AiFeedbackProcessor).processOnce(batch);
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
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
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
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.EDUFORGE_DATABASE_PURPOSE).toBe('standard_test');
    expect(users.db.name).toBe('eduforge_test');
    users.db.set('maxTimeMS', 10000);
    const database = users.db.db;
    if (!database) throw new Error('Missing connected test database');
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: app.get(ConfigService).get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: users.db.host,
      authInfo: auth.authInfo,
    });
    expect(
      await jobs.countDocuments({
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
      }),
    ).toBe(0);
    console.info(
      'A1 database gate: standard_test / eduforge_test / local root@admin verified; namespace=' +
        namespace,
    );
    const config = app.get(ConfigService);
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('MAIL_PROVIDER')).toBe('log');
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    const agents: Agent[] = [];
    for (const role of ['teacher', 'teacher', 'student', 'student']) {
      const email = namespace + '-' + agents.length + '@example.invalid';
      const user = await users.create({
        email,
        passwordHash: await bcrypt.hash('TeacherPass123!', 10),
        roles: [role],
      });
      userIds.push(user._id);
      const agent = request
        .agent(app.getHttpServer())
        .timeout({ response: 5000, deadline: 10000 });
      await agent
        .post('/api/auth/login')
        .send({ email, password: 'TeacherPass123!' })
        .expect(201);
      agents.push(agent);
    }
    [teacherA, teacherB, studentA, studentB] = agents;
    const created: Resource[] = [];
    for (const agent of [teacherA, teacherB]) {
      const course = (
        await agent
          .post('/api/courses')
          .send({
            code: namespace + '-' + created.length,
            name: 'Synthetic A1 Course',
            term: '2026',
          })
          .expect(201)
      ).body as Resource;
      courseIds.push(course.id);
      const classroom = (
        await agent
          .post('/api/classrooms')
          .send({ courseId: course.id, name: 'Synthetic A1 Classroom' })
          .expect(201)
      ).body as Resource;
      classIds.push(classroom.id);
      created.push(classroom);
    }
    [classA, classB] = created;
    await studentA
      .post('/api/classrooms/join')
      .send({ joinCode: classA.joinCode })
      .expect(201);
    await studentB
      .post('/api/classrooms/join')
      .send({ joinCode: classB.joinCode })
      .expect(201);
  });

  afterAll(async () => {
    try {
      if (users) {
        const ownedSubmissions = await submissions
          .find({ studentId: { $in: userIds } })
          .select('_id')
          .lean()
          .exec();
        const ids = ownedSubmissions.map((item) => item._id);
        await feedback.deleteMany({ submissionId: { $in: ids } });
        await jobs.deleteMany({ submissionId: { $in: ids } });
        await submissions.deleteMany({ _id: { $in: ids } });
        await instances.deleteMany({
          _id: { $in: instanceIds.map((id) => new Types.ObjectId(id)) },
        });
        await tasks.deleteMany({
          _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
        });
        await enrollments.deleteMany({
          classroomId: { $in: classIds.map((id) => new Types.ObjectId(id)) },
        });
        await classrooms.deleteMany({
          _id: { $in: classIds.map((id) => new Types.ObjectId(id)) },
        });
        await courses.deleteMany({
          _id: { $in: courseIds.map((id) => new Types.ObjectId(id)) },
        });
        await sessions.deleteMany({ userId: { $in: userIds } });
        await users.deleteMany({ _id: { $in: userIds } });
        expect(
          await feedback.countDocuments({ submissionId: { $in: ids } }),
        ).toBe(0);
        expect(await jobs.countDocuments({ submissionId: { $in: ids } })).toBe(
          0,
        );
        expect(await submissions.countDocuments({ _id: { $in: ids } })).toBe(0);
        expect(
          await instances.countDocuments({
            _id: { $in: instanceIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await enrollments.countDocuments({
            classroomId: { $in: classIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(await users.countDocuments({ _id: { $in: userIds } })).toBe(0);
        expect(
          await sessions.countDocuments({ userId: { $in: userIds } }),
        ).toBe(0);
        expect(
          await tasks.countDocuments({
            _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await classrooms.countDocuments({
            _id: { $in: classIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        expect(
          await courses.countDocuments({
            _id: { $in: courseIds.map((id) => new Types.ObjectId(id)) },
          }),
        ).toBe(0);
        console.info('A1 scoped cleanup verified: ' + namespace);
      }
    } finally {
      if (app) {
        await app.close();
        if (users) expect(users.db.readyState).toBe(0);
        console.info('A1 app/DB closed');
      }
    }
  });

  it('removes task stage across task and classroom contracts', async () => {
    const templatesUrl = '/api/learning-tasks/tasks';
    const candidatesUrl =
      '/api/classrooms/' + classB.id + '/publishable-task-templates';
    const title = namespace + '-stage-retirement';
    const rejectedTitle = title + '-rejected-create';
    await teacherA
      .post(templatesUrl)
      .send({ ...oldContent, title: rejectedTitle, stage: 1 })
      .expect(400);
    expect(
      await tasks.countDocuments({
        createdBy: userIds[0],
        title: rejectedTitle,
      }),
    ).toBe(0);

    const id = await makeTask(teacherA, { ...oldContent, title });
    const objectId = new Types.ObjectId(id);
    const taskUrl = templatesUrl + '/' + id;
    const updatedDescription = 'Stage-free teaching content';
    const updated = await teacherA
      .patch(taskUrl)
      .send({ description: updatedDescription })
      .expect(200);
    expect(updated.body as object).not.toHaveProperty('stage');
    const stored = await tasks.collection.findOne({ _id: objectId });
    expect(stored).not.toBeNull();
    expect(stored).not.toHaveProperty('stage');
    expect(stored?.description).toBe(updatedDescription);

    await teacherA
      .patch(taskUrl)
      .send({ title: title + '-rejected-update', stage: 4 })
      .expect(400);
    expect(await tasks.collection.findOne({ _id: objectId })).toEqual(stored);
    await teacherA.get(templatesUrl).query({ stage: 1 }).expect(400);
    await teacherB.get(candidatesUrl).query({ stage: 1 }).expect(400);

    const verifyTemplates = async () => {
      const detail = await teacherA.get(taskUrl).expect(200);
      expect(detail.body as object).toMatchObject({
        id,
        title,
        description: updatedDescription,
        status: 'PUBLISHED',
      });
      expect(detail.body as object).not.toHaveProperty('stage');
      for (const [agent, url, query] of [
        [teacherA, templatesUrl, { scope: 'mine', limit: 100 }],
        [teacherB, candidatesUrl, { limit: 100 }],
      ] as const) {
        const response = await agent.get(url).query(query).expect(200);
        const item = (response.body as List).items.find(
          (item) => item.id === id,
        );
        expect(item).toBeDefined();
        expect(item).not.toHaveProperty('stage');
      }
    };
    await verifyTemplates();

    const instance = await publish(teacherA, classA, id);
    expect(instance.task).not.toHaveProperty('stage');
    const instanceId = new Types.ObjectId(instance.id);
    const rawInstance = await instances.collection.findOne({ _id: instanceId });
    expect(rawInstance?.taskSnapshot).toMatchObject({
      title,
      description: updatedDescription,
    });
    expect(rawInstance?.taskSnapshot).not.toHaveProperty('stage');
    const classroomUrl = '/api/classrooms/' + classA.id;
    const instanceUrl = classroomUrl + '/tasks/' + instance.id;
    const verifyClassroom = async () => {
      const detail = await teacherA.get(instanceUrl).expect(200);
      const detailBody = detail.body as ClassroomTaskResponseDto;
      expect(detailBody.task).toMatchObject({
        title,
        description: updatedDescription,
      });
      expect(detailBody.task).not.toHaveProperty('stage');
      expect(detailBody.taskSnapshotAvailable).toBe(true);
      const list = await teacherA.get(classroomUrl + '/tasks').expect(200);
      const item = (
        list.body as { items: ClassroomTaskResponseDto[] }
      ).items.find((item) => item.id === instance.id);
      expect(item).toBeDefined();
      expect(item?.task).not.toHaveProperty('stage');
      const mine = await studentA
        .get(instanceUrl + '/my-task-detail')
        .expect(200);
      const mineBody = mine.body as {
        task: object;
        participationStatus: {
          canSubmit: boolean;
          canRequestAiFeedback: boolean;
        };
      };
      expect(mineBody.task).toMatchObject({
        title,
        description: updatedDescription,
      });
      expect(mineBody.task).not.toHaveProperty('stage');
      expect(mineBody.participationStatus).toMatchObject({
        canSubmit: true,
        canRequestAiFeedback: true,
      });
      const dashboard = await teacherA
        .get(classroomUrl + '/dashboard')
        .expect(200);
      const dashboardTask = (
        dashboard.body as {
          tasks: Array<{ classroomTaskId: string; title: string }>;
        }
      ).tasks.find((task) => task.classroomTaskId === instance.id);
      expect(dashboardTask?.title).toBe(title);
      expect(dashboardTask).not.toHaveProperty('stage');
    };
    await verifyClassroom();

    // Native collection writes model legacy fields only on this spec's owned IDs.
    await tasks.collection.updateOne(
      { _id: objectId, createdBy: userIds[0] },
      { $set: { stage: 4 } },
    );
    await instances.collection.updateOne(
      { _id: instanceId, taskId: objectId },
      { $set: { 'taskSnapshot.stage': 2 } },
    );
    await verifyTemplates();
    await verifyClassroom();
    expect((await tasks.collection.findOne({ _id: objectId }))?.stage).toBe(4);
    expect(
      (await instances.collection.findOne({ _id: instanceId }))?.taskSnapshot,
    ).toHaveProperty('stage', 2);
    expect(await submissions.countDocuments({ taskId: objectId })).toBe(0);
    expect(await jobs.countDocuments({ taskId: objectId })).toBe(0);
  });

  it('saves, changes, preserves and clears optional template difficulty without a default', async () => {
    const templatesUrl = '/api/learning-tasks/tasks';
    const created = await teacherA
      .post(templatesUrl)
      .send({
        ...oldContent,
        title: namespace + '-difficulty',
        difficulty: 'easy',
      })
      .expect(201);
    const template = created.body as Resource & { difficulty?: string };
    taskIds.push(template.id);
    const objectId = new Types.ObjectId(template.id);
    const taskUrl = templatesUrl + '/' + template.id;
    expect(template.difficulty).toBe('easy');
    expect(
      (await tasks.collection.findOne({ _id: objectId }))?.difficulty,
    ).toBe('easy');

    for (const [payload, expected] of [
      [{ difficulty: 'hard' }, 'hard'],
      [{ difficulty: 'easy' }, 'easy'],
      [{ difficulty: 'medium' }, 'medium'],
      [{ title: namespace + '-difficulty-title-only' }, 'medium'],
      [{ difficulty: '' }, ''],
    ] as const) {
      const updated = await teacherA.patch(taskUrl).send(payload).expect(200);
      expect((updated.body as { difficulty?: string }).difficulty).toBe(
        expected,
      );
      const detail = await teacherA.get(taskUrl).expect(200);
      expect((detail.body as { difficulty?: string }).difficulty).toBe(
        expected,
      );
      expect(
        (await tasks.collection.findOne({ _id: objectId }))?.difficulty,
      ).toBe(expected);
    }

    const omitted = await teacherA
      .post(templatesUrl)
      .send({
        title: namespace + '-difficulty-omitted',
        description: 'Optional difficulty contract',
        knowledgeModule: 'difficulty-contract',
      })
      .expect(201);
    const omittedTemplate = omitted.body as Resource;
    taskIds.push(omittedTemplate.id);
    expect(omitted.body as object).not.toHaveProperty('difficulty');
    expect(
      await tasks.collection.findOne({
        _id: new Types.ObjectId(omittedTemplate.id),
      }),
    ).not.toHaveProperty('difficulty');

    const beforeInvalid = await tasks.collection.findOne({ _id: objectId });
    const authorCount = await tasks.countDocuments({ createdBy: userIds[0] });
    for (const difficulty of [
      null,
      ' ',
      '综合',
      '基础',
      'Easy',
      ' easy ',
      [],
      ['easy'],
      {},
      1,
    ]) {
      await teacherA
        .post(templatesUrl)
        .send({
          ...oldContent,
          title: namespace + '-invalid-difficulty',
          difficulty,
        })
        .expect(400);
      expect(await tasks.countDocuments({ createdBy: userIds[0] })).toBe(
        authorCount,
      );
      await teacherA
        .patch(taskUrl)
        .send({ title: namespace + '-rejected-difficulty-update', difficulty })
        .expect(400);
      expect(await tasks.collection.findOne({ _id: objectId })).toEqual(
        beforeInvalid,
      );
    }
  });

  it('filters template and publishable lists exactly before pagination without widening visibility', async () => {
    const knowledgeModule = namespace + '-difficulty-filter';
    const templatesUrl = '/api/learning-tasks/tasks';
    const candidatesUrl =
      '/api/classrooms/' + classA.id + '/publishable-task-templates';
    const createSample = async (
      agent: Agent,
      name: string,
      difficulty: string | undefined,
      options: {
        visibility?: string;
        status?: string;
        courseLabel?: string;
      } = {},
    ) => {
      const response = await agent
        .post(templatesUrl)
        .send({
          title: namespace + '-' + name,
          description: 'Difficulty query fixture',
          knowledgeModule,
          courseLabel: options.courseLabel ?? 'Java 程序设计',
          visibility: options.visibility ?? 'PRIVATE',
          status: options.status ?? 'PUBLISHED',
          ...(difficulty === undefined ? {} : { difficulty }),
        })
        .expect(201);
      const id = (response.body as Resource).id;
      taskIds.push(id);
      expect((response.body as { difficulty?: string }).difficulty).toBe(
        difficulty,
      );
      expect(
        (await tasks.collection.findOne({ _id: new Types.ObjectId(id) }))
          ?.difficulty,
      ).toBe(difficulty);
      return id;
    };
    const easyA = await createSample(teacherA, 'easy-a', 'easy');
    const easyB = await createSample(teacherA, 'easy-b', 'easy');
    const medium = await createSample(teacherA, 'medium', 'medium');
    const hard = await createSample(teacherA, 'hard', 'hard');
    const empty = await createSample(teacherA, 'empty', '');
    const missing = await createSample(teacherA, 'missing', undefined);
    const shared = await createSample(teacherB, 'shared', 'medium', {
      visibility: 'SHARED',
      courseLabel: 'Python 程序设计',
    });
    await createSample(teacherB, 'foreign-private', 'medium');
    const draft = await createSample(teacherA, 'draft', 'medium', {
      status: 'DRAFT',
    });
    const published = await createSample(
      teacherA,
      'already-published',
      'medium',
    );
    await publish(teacherA, classA, published);

    const templateQuery = {
      knowledgeModule,
      scope: 'all',
      status: 'PUBLISHED',
      limit: 100,
    };
    const candidateQuery = { knowledgeModule, limit: 100 };
    const assertList = async (
      url: string,
      query: Record<string, unknown>,
      expectedIds: string[],
    ) => {
      const response = await teacherA.get(url).query(query).expect(200);
      const result = response.body as List;
      expect(result.total).toBe(expectedIds.length);
      expect(result.items.map((item) => item.id).sort()).toEqual(
        [...expectedIds].sort(),
      );
    };
    for (const [difficulty, templateIds, candidateIds] of [
      ['easy', [easyA, easyB], [easyA, easyB]],
      ['medium', [medium, shared, published], [medium, shared]],
      ['hard', [hard], [hard]],
    ] as const) {
      await assertList(templatesUrl, { ...templateQuery, difficulty }, [
        ...templateIds,
      ]);
      await assertList(candidatesUrl, { ...candidateQuery, difficulty }, [
        ...candidateIds,
      ]);
    }
    await assertList(templatesUrl, templateQuery, [
      easyA,
      easyB,
      medium,
      hard,
      shared,
      published,
      empty,
      missing,
    ]);
    await assertList(candidatesUrl, candidateQuery, [
      easyA,
      easyB,
      medium,
      hard,
      shared,
      empty,
      missing,
    ]);

    for (const [url, query] of [
      [templatesUrl, templateQuery],
      [candidatesUrl, candidateQuery],
    ] as const) {
      const ids: string[] = [];
      for (const page of [1, 2]) {
        const response = await teacherA
          .get(url)
          .query({ ...query, difficulty: 'easy', page, limit: 1 })
          .expect(200);
        const result = response.body as List & { page: number; limit: number };
        expect(result).toMatchObject({ total: 2, page, limit: 1 });
        expect(result.items).toHaveLength(1);
        ids.push(result.items[0].id);
      }
      expect(ids.sort()).toEqual([easyA, easyB].sort());
      expect(new Set(ids).size).toBe(2);
      for (const difficulty of [
        '',
        ' ',
        'unknown',
        'Easy',
        ' easy ',
        ['easy', 'hard'],
      ]) {
        await teacherA
          .get(url)
          .query({ ...query, difficulty })
          .expect(400);
      }
      await teacherA
        .get(url)
        .query(query)
        .query('difficulty[]=easy')
        .expect(400);
    }

    await assertList(
      templatesUrl,
      { ...templateQuery, difficulty: 'medium', courseLabel: 'Java 程序设计' },
      [medium, published],
    );
    await assertList(
      candidatesUrl,
      { ...candidateQuery, difficulty: 'medium', courseLabel: 'Java 程序设计' },
      [medium],
    );
    await assertList(
      templatesUrl,
      { ...templateQuery, difficulty: 'medium', status: 'DRAFT' },
      [draft],
    );
    await assertList(
      templatesUrl,
      {
        ...templateQuery,
        difficulty: 'medium',
        scope: 'mine',
        createdBy: userIds[1].toString(),
      },
      [medium, published],
    );
    await assertList(
      templatesUrl,
      { ...templateQuery, difficulty: 'medium', scope: 'shared' },
      [shared],
    );
    await assertList(
      candidatesUrl,
      { ...candidateQuery, difficulty: 'medium', onlyMine: true },
      [medium],
    );
    await teacherB.get(candidatesUrl).query({ difficulty: 'easy' }).expect(404);
    await studentA.get(candidatesUrl).query({ difficulty: 'easy' }).expect(403);
  });

  it('rejects invalid template difficulty for new publication while historical snapshots stay readable and unchanged', async () => {
    const id = await makeTask(teacherA);
    const instance = await publish(teacherA, classA, id);
    const templateId = new Types.ObjectId(id);
    const instanceId = new Types.ObjectId(instance.id);
    await instances.collection.updateOne(
      { _id: instanceId, taskId: templateId },
      { $set: { 'taskSnapshot.difficulty': 'historical difficulty' } },
    );
    const instanceBefore = await instances.collection.findOne({
      _id: instanceId,
    });
    for (const difficulty of [null, '综合']) {
      // Native writes construct only this spec's legacy compatibility record.
      await tasks.collection.updateOne(
        { _id: templateId, createdBy: userIds[0] },
        { $set: { difficulty } },
      );
      const templateBefore = await tasks.collection.findOne({
        _id: templateId,
      });
      const denied = await teacherB
        .post('/api/classrooms/' + classB.id + '/tasks')
        .send({ taskId: id })
        .expect(400);
      expect((denied.body as { message: string }).message).toBe(
        '请先修改模板难度，再发布课堂任务。',
      );
      expect(
        await instances.countDocuments({
          classroomId: new Types.ObjectId(classB.id),
          taskId: templateId,
        }),
      ).toBe(0);
      const teacherDetail = await teacherA
        .get('/api/classrooms/' + classA.id + '/tasks/' + instance.id)
        .expect(200);
      const studentDetail = await studentA
        .get(
          '/api/classrooms/' +
            classA.id +
            '/tasks/' +
            instance.id +
            '/my-task-detail',
        )
        .expect(200);
      for (const detail of [teacherDetail, studentDetail]) {
        expect(
          (detail.body as { task: { difficulty: string } }).task.difficulty,
        ).toBe('historical difficulty');
      }
      expect(await tasks.collection.findOne({ _id: templateId })).toEqual(
        templateBefore,
      );
      expect(await instances.collection.findOne({ _id: instanceId })).toEqual(
        instanceBefore,
      );
    }
  });

  it('persists visibility defaults and normalized inputs through the legal template lifecycle', async () => {
    const url = '/api/learning-tasks/tasks';
    const created: string[] = [];
    for (const [label, visibility, expected, status] of [
      ['default', undefined, 'PRIVATE', 'DRAFT'],
      ['explicit-shared', 'SHARED', 'SHARED', 'PUBLISHED'],
      ['normalized-shared', ' shared ', 'SHARED', 'PUBLISHED'],
    ] as const) {
      const response = await teacherA
        .post(url)
        .send({
          ...oldContent,
          title: namespace + '-visibility-' + label,
          status,
          ...(visibility === undefined ? {} : { visibility }),
        })
        .expect(201);
      const id = (response.body as Resource).id;
      taskIds.push(id);
      created.push(id);
      expect(response.body as object).toMatchObject({
        visibility: expected,
        status,
      });
      expect(
        await tasks.collection.findOne({ _id: new Types.ObjectId(id) }),
      ).toHaveProperty('visibility', expected);
    }
    const [privateId, sharedId] = created;
    const privateUrl = url + '/' + privateId;
    const updated = await teacherA
      .patch(privateUrl)
      .send({
        title: namespace + '-visibility-edited',
        visibility: ' private ',
      })
      .expect(200);
    expect(updated.body as object).toMatchObject({
      title: namespace + '-visibility-edited',
      visibility: 'PRIVATE',
      status: 'DRAFT',
    });
    expect(
      await tasks.collection.findOne({ _id: new Types.ObjectId(privateId) }),
    ).toMatchObject({
      title: namespace + '-visibility-edited',
      visibility: 'PRIVATE',
      status: 'DRAFT',
    });
    const published = await teacherA.post(privateUrl + '/publish').expect(201);
    expect(published.body as object).toMatchObject({
      visibility: 'PRIVATE',
      status: 'PUBLISHED',
    });
    const publishedBefore = await tasks.collection.findOne({
      _id: new Types.ObjectId(privateId),
    });
    const publishedAt: unknown = publishedBefore?.publishedAt;
    if (!(publishedAt instanceof Date)) {
      throw new Error('Expected stored publishedAt to be a Date');
    }
    expect(publishedBefore).toMatchObject({
      visibility: 'PRIVATE',
      status: 'PUBLISHED',
      publishedAt,
    });
    const repeated = await teacherA.post(privateUrl + '/publish').expect(201);
    expect(repeated.body).toEqual(published.body);
    expect(
      await tasks.collection.findOne({ _id: new Types.ObjectId(privateId) }),
    ).toEqual(publishedBefore);

    expect((await publish(teacherA, classA, privateId)).taskId).toBe(privateId);
    expect((await publish(teacherB, classB, sharedId)).taskId).toBe(sharedId);
    await teacherB.get(privateUrl).expect(404);
    await teacherB
      .post('/api/classrooms/' + classB.id + '/tasks')
      .send({ taskId: privateId })
      .expect(404);
    expect(
      await instances.countDocuments({
        classroomId: new Types.ObjectId(classB.id),
        taskId: new Types.ObjectId(privateId),
      }),
    ).toBe(0);
    const archived = await teacherA.post(privateUrl + '/archive').expect(201);
    expect(archived.body as object).toMatchObject({
      visibility: 'PRIVATE',
      status: 'ARCHIVED',
    });
    expect(
      await tasks.collection.findOne({ _id: new Types.ObjectId(privateId) }),
    ).toMatchObject({
      visibility: 'PRIVATE',
      status: 'ARCHIVED',
      publishedAt,
    });
  });

  it('filters raw invalid visibility before pagination and rejects repairs or publication without writes', async () => {
    const knowledgeModule = namespace + '-visibility-filter';
    const templatesUrl = '/api/learning-tasks/tasks';
    const candidatesUrl =
      '/api/classrooms/' + classA.id + '/publishable-task-templates';
    const ownPrivate = await makeTask(
      teacherA,
      { ...oldContent, title: namespace + '-own-private', knowledgeModule },
      'PRIVATE',
    );
    const ownShared = await makeTask(teacherA, {
      ...oldContent,
      title: namespace + '-own-shared',
      knowledgeModule,
    });
    const foreignShared = await makeTask(teacherB, {
      ...oldContent,
      title: namespace + '-foreign-shared',
      knowledgeModule,
    });
    const foreignPrivate = await makeTask(
      teacherB,
      { ...oldContent, title: namespace + '-foreign-private', knowledgeModule },
      'PRIVATE',
    );
    const invalid = [
      { label: 'missing', status: 'PUBLISHED' },
      { label: 'null', status: 'PUBLISHED', visibility: null },
      { label: 'empty', status: 'PUBLISHED', visibility: '' },
      { label: 'unknown', status: 'PUBLISHED', visibility: 'UNKNOWN' },
      { label: 'array', status: 'PUBLISHED', visibility: ['SHARED'] },
      { label: 'missing-draft', status: 'DRAFT' },
    ].map((sample) => ({ ...sample, _id: new Types.ObjectId() }));
    for (const sample of invalid) {
      taskIds.push(sample._id.toString());
      const timestamp = new Date('2020-01-01T00:00:00.000Z');
      // Native inserts preserve malformed values and truly absent fields.
      await tasks.collection.insertOne({
        ...oldContent,
        _id: sample._id,
        title: namespace + '-visibility-' + sample.label,
        knowledgeModule,
        createdBy: userIds[0],
        status: sample.status,
        ...('visibility' in sample ? { visibility: sample.visibility } : {}),
        ...(sample.status === 'PUBLISHED' ? { publishedAt: timestamp } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const raw = await tasks.collection.findOne({ _id: sample._id });
      expect(raw).toMatchObject({
        status: sample.status,
        updatedAt: timestamp,
      });
      if ('visibility' in sample) {
        expect(raw).toHaveProperty('visibility', sample.visibility);
      } else {
        expect(raw).not.toHaveProperty('visibility');
      }
    }
    const ownedIds = [ownPrivate, ownShared, foreignShared, foreignPrivate]
      .map((id) => new Types.ObjectId(id))
      .concat(invalid.map((sample) => sample._id));
    const readOwnedFacts = async () => ({
      tasks: await tasks.collection
        .find({ _id: { $in: ownedIds } }, { maxTimeMS: 10000 })
        .sort({ _id: 1 })
        .toArray(),
      instances: await instances.collection
        .find({ taskId: { $in: ownedIds } }, { maxTimeMS: 10000 })
        .sort({ _id: 1 })
        .toArray(),
    });
    const before = await readOwnedFacts();
    expect(before.tasks).toHaveLength(10);
    expect(before.instances).toEqual([]);
    const ownIds = [ownPrivate, ownShared];
    const sharedIds = [ownShared, foreignShared];
    const allIds = [ownPrivate, ownShared, foreignShared];
    for (const [url, query, expectedIds] of [
      [templatesUrl, { scope: 'mine', status: 'PUBLISHED' }, ownIds],
      [templatesUrl, { scope: 'shared', status: 'PUBLISHED' }, sharedIds],
      [templatesUrl, { scope: 'all', status: 'PUBLISHED' }, allIds],
      [candidatesUrl, {}, allIds],
      [candidatesUrl, { onlyMine: false }, allIds],
      [candidatesUrl, { onlyMine: true }, ownIds],
    ] as const) {
      const all = (
        await teacherA
          .get(url)
          .query({ knowledgeModule, ...query, limit: 100 })
          .expect(200)
      ).body as List;
      expect(all.total).toBe(expectedIds.length);
      expect(all.items.map((item) => item.id).sort()).toEqual(
        [...expectedIds].sort(),
      );
      const pageIds: string[] = [];
      for (let page = 1; page <= expectedIds.length + 1; page += 1) {
        const result = (
          await teacherA
            .get(url)
            .query({ knowledgeModule, ...query, page, limit: 1 })
            .expect(200)
        ).body as List;
        expect(result.total).toBe(expectedIds.length);
        expect(result.items).toHaveLength(page <= expectedIds.length ? 1 : 0);
        pageIds.push(...result.items.map((item) => item.id));
      }
      expect(pageIds.sort()).toEqual([...expectedIds].sort());
    }

    const [missing, , , , , missingDraft] = invalid;
    for (const sample of invalid) {
      const response = await teacherA
        .get(templatesUrl + '/' + sample._id.toString())
        .expect(409);
      expect(response.body as object).toMatchObject({
        message: 'Task has invalid visibility',
      });
    }
    for (const sample of [missingDraft, missing]) {
      const url = templatesUrl + '/' + sample._id.toString();
      const updated = await teacherA
        .patch(url)
        .send({
          visibility: 'PRIVATE',
          title: 'Must not repair raw visibility',
        })
        .expect(409);
      expect(updated.body as object).toMatchObject({
        message: 'Task has invalid visibility',
      });
      const published = await teacherA.post(url + '/publish').expect(409);
      expect(published.body as object).toMatchObject({
        message: 'Task has invalid visibility',
      });
    }
    const missingUrl = templatesUrl + '/' + missing._id.toString();
    const archived = await teacherA.post(missingUrl + '/archive').expect(409);
    expect(archived.body as object).toMatchObject({
      message: 'Task has invalid visibility',
    });
    const authorPublication = await teacherA
      .post('/api/classrooms/' + classA.id + '/tasks')
      .send({ taskId: missing._id.toString() })
      .expect(409);
    expect(authorPublication.body as object).toMatchObject({
      message: 'Task has invalid visibility',
    });
    const nonAuthorDetail = await teacherB.get(missingUrl).expect(404);
    expect(nonAuthorDetail.body as object).toMatchObject({
      message: 'Task not found',
    });
    await teacherB
      .patch(missingUrl)
      .send({ visibility: 'PRIVATE' })
      .expect(404);
    await teacherB.post(missingUrl + '/publish').expect(404);
    await teacherB.post(missingUrl + '/archive').expect(403);
    const nonAuthorPublication = await teacherB
      .post('/api/classrooms/' + classB.id + '/tasks')
      .send({ taskId: missing._id.toString() })
      .expect(404);
    expect(nonAuthorPublication.body as object).toMatchObject({
      message: 'Task not found',
    });
    expect(await readOwnedFacts()).toEqual(before);
  });

  it('keeps published classroom and student reads independent of invalid source visibility', async () => {
    const id = await makeTask(teacherA, {
      ...oldContent,
      title: namespace + '-visibility-existing-snapshot',
    });
    const instance = await publish(teacherA, classA, id);
    const templateId = new Types.ObjectId(id);
    const instanceId = new Types.ObjectId(instance.id);
    await tasks.collection.updateOne(
      { _id: templateId, createdBy: userIds[0] },
      { $unset: { visibility: '' } },
    );
    const templateBefore = await tasks.collection.findOne({ _id: templateId });
    const instanceBefore = await instances.collection.findOne({
      _id: instanceId,
    });
    expect(templateBefore).not.toHaveProperty('visibility');
    const url = '/api/classrooms/' + classA.id + '/tasks/' + instance.id;
    for (const agent of [teacherA, studentA]) {
      const detail = await agent.get(url).expect(200);
      expect(detail.body as object).toMatchObject({
        id: instance.id,
        taskSnapshotAvailable: true,
        task: instance.task,
      });
    }
    const mine = await studentA.get(url + '/my-task-detail').expect(200);
    expect(mine.body as object).toMatchObject({
      classroomTask: { id: instance.id, taskSnapshotAvailable: true },
      task: instance.task,
    });
    expect(await tasks.collection.findOne({ _id: templateId })).toEqual(
      templateBefore,
    );
    expect(await instances.collection.findOne({ _id: instanceId })).toEqual(
      instanceBefore,
    );
  });

  it('publishes, preserves each source/note, freezes A and B independently across read chains', async () => {
    taskId = await makeTask(teacherA);
    instanceA = await publish(teacherA, classA, taskId);
    expect(instanceA.taskSnapshotAvailable).toBe(true);
    expect(instanceA.task).toMatchObject(oldContent);
    expect(instanceA.settings).toEqual({ allowLate: true });
    expect(
      await instances.collection.findOne({
        _id: new Types.ObjectId(instanceA.id),
      }),
    ).not.toHaveProperty('settings.maxAttempts');
    expect(
      await instances.collection.findOne({
        _id: new Types.ObjectId(instanceA.id),
      }),
    ).not.toHaveProperty('settings.aiFeedbackMode');
    first = await submit(studentA, classA, instanceA);
    second = await submit(studentA, classA, instanceA, {
      codeText: 'second source',
      language: 'typescript',
      submissionNote: 'second note\n',
    });
    expect(first.content).toEqual({
      codeText: code,
      language: 'typescript',
      submissionNote: note,
    });
    expect([first.attemptNo, second.attemptNo]).toEqual([1, 2]);
    expect(first.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(
      await jobs.countDocuments({
        submissionId: {
          $in: [first.id, second.id].map((id) => new Types.ObjectId(id)),
        },
      }),
    ).toBe(0);
    await teacherA
      .patch('/api/learning-tasks/tasks/' + taskId)
      .send(newContent)
      .expect(200);
    instanceB = await publish(teacherB, classB, taskId);
    foreign = await submit(studentB, classB, instanceB);
    expect(instanceB.task).toMatchObject(newContent);
    await teacherA
      .post('/api/learning-tasks/tasks/' + taskId + '/archive')
      .send({})
      .expect(201);
    for (const [teacher, student, classroom, instance, expected] of [
      [teacherA, studentA, classA, instanceA, oldContent],
      [teacherB, studentB, classB, instanceB, newContent],
    ] as const) {
      const detail = (
        await teacher
          .get('/api/classrooms/' + classroom.id + '/tasks/' + instance.id)
          .expect(200)
      ).body as ClassroomTaskResponseDto;
      expect(detail.task).toMatchObject(expected);
      expect(detail.task.status).toBe('ARCHIVED');
      const list = (
        await teacher
          .get('/api/classrooms/' + classroom.id + '/tasks')
          .expect(200)
      ).body as { items: ClassroomTaskResponseDto[] };
      expect(
        list.items.find((item) => item.id === instance.id)?.task,
      ).toMatchObject(expected);
      const mine = (
        await student
          .get(
            '/api/classrooms/' +
              classroom.id +
              '/tasks/' +
              instance.id +
              '/my-task-detail',
          )
          .expect(200)
      ).body as {
        task: unknown;
        classroomTask: { taskSnapshotAvailable: boolean };
        participationStatus: { canRequestAiFeedback: boolean };
      };
      expect(mine.task).toMatchObject(expected);
      expect(mine.classroomTask.taskSnapshotAvailable).toBe(true);
      expect(mine.participationStatus.canRequestAiFeedback).toBe(true);
      const dashboard = (
        await teacher
          .get('/api/classrooms/' + classroom.id + '/dashboard')
          .expect(200)
      ).body as { tasks: Array<{ title: string }> };
      expect(dashboard.tasks.map((item) => item.title)).toContain(
        expected.title,
      );
      const studentDashboard = (
        await student.get('/api/classrooms/mine/dashboard').expect(200)
      ).body as { items: Array<{ tasks: Array<{ title: string }> }> };
      expect(
        studentDashboard.items
          .flatMap((item) => item.tasks)
          .map((item) => item.title),
      ).toContain(expected.title);
      const analytics = (
        await teacher
          .get('/api/classrooms/' + classroom.id + '/ai-learning-analytics')
          .expect(200)
      ).body as { taskTrends: Array<{ taskTitle: string }> };
      expect(analytics.taskTrends.map((item) => item.taskTitle)).toContain(
        expected.title,
      );
    }
    for (const agent of [teacherA, studentA]) {
      const a = await getDetail(agent, first.id),
        b = await getDetail(agent, second.id);
      expect(a.content).toEqual(first.content);
      expect(b.content).toEqual(second.content);
      expect(a.classroomTaskId).toBe(instanceA.id);
      expect(b.classroomTaskId).toBe(instanceA.id);
      expect(a.taskTitle).toBe(oldContent.title);
      expect(a.taskSnapshotAvailable).toBe(true);
      expect(a.meta).toEqual({ aiUsageDeclaration: 'Brainstorming only' });
    }
    expect(
      (
        await submit(studentA, classA, instanceA, {
          codeText: 'after archive',
          language: 'typescript',
        })
      ).content.submissionNote,
    ).toBe('');
  });

  it('isolates shared-template submissions, counts, distinct students, reports and feedback authorization', async () => {
    await teacherA
      .get('/api/learning-tasks/submissions/' + foreign.id)
      .expect(403);
    await teacherA
      .get('/api/learning-tasks/submissions/' + foreign.id + '/feedback')
      .expect(403);
    await ask(teacherA, foreign.id).expect(403);
    await ask(studentA, foreign.id).expect(403);
    await teacherA
      .post('/api/learning-tasks/submissions/' + foreign.id + '/feedback')
      .send({
        expectedRevision: 0,
        source: 'TEACHER',
        type: 'OTHER',
        severity: 'ERROR',
        message: 'foreign',
      })
      .expect(403);
    await teacherB
      .post('/api/learning-tasks/submissions/' + foreign.id + '/feedback')
      .send({
        expectedRevision: 0,
        source: 'TEACHER',
        type: 'OTHER',
        severity: 'ERROR',
        message: 'foreign issue',
        tags: ['naming'],
      })
      .expect(201);
    const ownList = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + taskId + '/submissions?limit=1')
        .expect(200)
    ).body as List;
    expect(ownList.total).toBe(3);
    expect(ownList.items).toHaveLength(1);
    expect(ownList.items[0].id).not.toBe(foreign.id);
    const stats = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + taskId + '/stats')
        .expect(200)
    ).body as {
      submissionsCount: number;
      distinctStudentsCount: number;
      topTags: string[];
    };
    expect(stats).toMatchObject({
      submissionsCount: 3,
      distinctStudentsCount: 1,
    });
    expect(stats.topTags).not.toContain('naming');
    const report = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + taskId + '/reports/common-issues')
        .expect(200)
    ).body as {
      summary: { submissionsCount: number; distinctStudentsCount: number };
      topTags: unknown[];
    };
    expect(report.summary).toEqual({
      submissionsCount: 3,
      distinctStudentsCount: 1,
    });
    expect(report.topTags).toEqual([]);
    const mine = (
      await studentA
        .get('/api/learning-tasks/tasks/' + taskId + '/submissions/mine')
        .expect(200)
    ).body as Array<{ id: string }>;
    expect(mine.map((item) => item.id)).not.toContain(foreign.id);
    const privateId = await makeTask(teacherA, oldContent, 'PRIVATE');
    await teacherB
      .post('/api/classrooms/' + classB.id + '/tasks')
      .send({ taskId: new Types.ObjectId(privateId) })
      .expect(404);
    expect(
      await instances.countDocuments({ taskId: new Types.ObjectId(privateId) }),
    ).toBe(0);
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(foreign.id),
      }),
    ).toBe(0);
  });

  it('excludes native invalid classroom links from lists and rejects their public operations without writes', async () => {
    const template = await makeTask(teacherA);
    const ownInstance = await publish(teacherA, classA, template);
    const otherInstance = await publish(teacherB, classB, template);
    const own = await submit(studentA, classA, ownInstance);
    const other = await submit(studentB, classB, otherInstance);
    expect(own.classroomTaskId).toBe(ownInstance.id);
    expect(other.classroomTaskId).toBe(otherInstance.id);
    const database = submissions.db.db;
    if (!database) throw new Error('Missing connected test database');
    const nativeSubmissions = database.collection(submissions.collection.name);
    // Native writes preserve invalid BSON shapes instead of Mongoose casting them.
    // Every record belongs to this spec's student IDs and existing exact cleanup.
    const invalid = [
      undefined,
      null,
      ownInstance.id,
      [new Types.ObjectId(ownInstance.id)],
    ].map((classroomTaskId, index) => ({
      _id: new Types.ObjectId(),
      taskId: new Types.ObjectId(template),
      studentId: userIds[index === 1 ? 3 : 2],
      ...(classroomTaskId === undefined ? {} : { classroomTaskId }),
      attemptNo: 100 + index,
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      contentRevision: 0,
      content: {
        codeText: 'invalid association fixture',
        language: 'typescript',
      },
      status: SubmissionStatus.Submitted,
    }));
    await nativeSubmissions.insertMany(invalid);
    const existingFeedback = await feedback.create({
      submissionId: invalid[0]._id,
      createdBy: userIds[0],
      source: FeedbackSource.Teacher,
      type: FeedbackType.Other,
      severity: FeedbackSeverity.Warn,
      message: 'Native unbound feedback fixture',
      tags: ['naming'],
    });
    const filter = { _id: { $in: invalid.map((item) => item._id) } };
    const before = await nativeSubmissions
      .find(filter)
      .sort({ _id: 1 })
      .toArray();
    const feedbackBefore = await feedback.collection.findOne({
      _id: existingFeedback._id,
    });

    const list = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + template + '/submissions')
        .query({ page: 1, limit: 1 })
        .expect(200)
    ).body as List;
    expect(list.total).toBe(1);
    expect(list.items.map((item) => item.id)).toEqual([own.id]);
    const nextPage = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + template + '/submissions')
        .query({ page: 2, limit: 1 })
        .expect(200)
    ).body as List;
    expect(nextPage).toMatchObject({ total: 1, items: [] });
    await teacherB
      .get('/api/learning-tasks/tasks/' + template + '/submissions')
      .expect(403);
    const mine = (
      await studentA
        .get('/api/learning-tasks/tasks/' + template + '/submissions/mine')
        .expect(200)
    ).body as Array<{ id: string; classroomTaskId: string }>;
    expect(mine.map((item) => item.id)).toEqual([own.id]);
    expect(mine[0].classroomTaskId).toBe(ownInstance.id);
    const stats = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + template + '/stats')
        .expect(200)
    ).body as {
      submissionsCount: number;
      distinctStudentsCount: number;
      topTags: string[];
    };
    expect(stats).toMatchObject({
      submissionsCount: 1,
      distinctStudentsCount: 1,
      topTags: [],
    });
    const report = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + template + '/reports/common-issues')
        .expect(200)
    ).body as {
      summary: { submissionsCount: number; distinctStudentsCount: number };
      topTags: unknown[];
    };
    expect(report.summary).toEqual({
      submissionsCount: 1,
      distinctStudentsCount: 1,
    });
    expect(report.topTags).toEqual([]);

    const url = '/api/learning-tasks/submissions/' + invalid[0]._id.toString();
    const invalidMessage = 'Submission has no valid classroom task';
    await studentB.get(url + '/feedback').expect(403);
    for (const agent of [teacherA, studentA]) {
      const detail = await agent.get(url).expect(409);
      expect((detail.body as { message: string }).message).toBe(invalidMessage);
      const listFeedback = await agent.get(url + '/feedback').expect(409);
      expect((listFeedback.body as { message: string }).message).toBe(
        invalidMessage,
      );
      const ai = await ask(agent, invalid[0]._id.toString()).expect(409);
      expect((ai.body as { message: string }).message).toBe(invalidMessage);
    }
    const deniedFeedback = await teacherA
      .post(url + '/feedback')
      .send({
        expectedRevision: 0,
        source: 'TEACHER',
        type: 'OTHER',
        severity: 'INFO',
        message: 'Must not persist',
      })
      .expect(409);
    expect((deniedFeedback.body as { message: string }).message).toBe(
      invalidMessage,
    );
    const deniedPatch = await teacherA
      .patch(url + '/feedback/' + existingFeedback._id.toString())
      .send({ message: 'Must not replace historical feedback' })
      .expect(409);
    expect((deniedPatch.body as { message: string }).message).toBe(
      invalidMessage,
    );
    const arrayDetail = await studentA
      .get('/api/learning-tasks/submissions/' + invalid[3]._id.toString())
      .expect(409);
    expect((arrayDetail.body as { message: string }).message).toBe(
      invalidMessage,
    );
    expect(
      await nativeSubmissions.find(filter).sort({ _id: 1 }).toArray(),
    ).toEqual(before);
    expect(
      await feedback.collection.findOne({ _id: existingFeedback._id }),
    ).toEqual(feedbackBefore);
    const related = { submissionId: { $in: invalid.map((item) => item._id) } };
    expect(await feedback.countDocuments(related)).toBe(1);
    expect(await jobs.countDocuments(related)).toBe(0);
  });

  it('filters invalid persisted statuses before pagination and rejects single-task operations without writes', async () => {
    const classroom = (
      await teacherA
        .post('/api/classrooms')
        .send({ courseId: courseIds[0], name: namespace + '-status-contract' })
        .expect(201)
    ).body as Resource;
    classIds.push(classroom.id);
    await studentA
      .post('/api/classrooms/join')
      .send({ joinCode: classroom.joinCode })
      .expect(201);
    const url = '/api/classrooms/' + classroom.id + '/tasks';
    const created: ClassroomTaskResponseDto[] = [];
    for (const label of [
      'active',
      'closed',
      'recalled',
      'missing',
      'null',
      'unknown',
      'array',
    ]) {
      const id = await makeTask(teacherA, {
        ...oldContent,
        title: namespace + '-status-' + label,
      });
      const instance = await publish(teacherA, classroom, id);
      created.push(instance);
      expect(instance.status).toBe('ACTIVE');
      expect(
        await instances.collection.findOne({
          _id: new Types.ObjectId(instance.id),
        }),
      ).toHaveProperty('status', 'ACTIVE');
    }
    const [active, closed, recalled, missing, nullState, unknown, arrayState] =
      created;
    for (const status of ['CLOSED', 'ACTIVE', 'CLOSED']) {
      const response = await teacherA
        .patch(url + '/' + closed.id + '/status')
        .send({ status })
        .expect(200);
      expect((response.body as ClassroomTaskResponseDto).status).toBe(status);
      expect(
        await instances.collection.findOne({
          _id: new Types.ObjectId(closed.id),
        }),
      ).toHaveProperty('status', status);
    }
    await teacherA
      .patch(url + '/' + recalled.id + '/status')
      .send({ status: 'RECALLED' })
      .expect(200);
    const recalledBefore = await instances.collection.findOne({
      _id: new Types.ObjectId(recalled.id),
    });
    expect(recalledBefore).toHaveProperty('status', 'RECALLED');
    await teacherA
      .patch(url + '/' + recalled.id + '/status')
      .send({ status: 'ACTIVE' })
      .expect(400);
    expect(
      await instances.collection.findOne({
        _id: new Types.ObjectId(recalled.id),
      }),
    ).toEqual(recalledBefore);

    await submit(studentA, classroom, missing);
    await instances.collection.updateOne(
      { _id: new Types.ObjectId(missing.id) },
      { $unset: { status: '' } },
    );
    for (const [instance, status] of [
      [nullState, null],
      [unknown, 'UNKNOWN'],
      [arrayState, ['ACTIVE']],
    ] as const) {
      await instances.collection.updateOne(
        { _id: new Types.ObjectId(instance.id) },
        { $set: { status } },
      );
    }
    // The list query's status still selects Task.status, not ClassroomTask.status.
    await teacherA
      .post('/api/learning-tasks/tasks/' + closed.taskId + '/archive')
      .expect(201);
    const ownedIds = created.map((item) => new Types.ObjectId(item.id));
    const readOwnedFacts = async () => {
      const ownedSubmissions = await submissions.collection
        .find({ classroomTaskId: { $in: ownedIds } }, { maxTimeMS: 10000 })
        .sort({ _id: 1 })
        .toArray();
      return {
        instances: await instances.collection
          .find({ _id: { $in: ownedIds } }, { maxTimeMS: 10000 })
          .sort({ _id: 1 })
          .toArray(),
        tasks: await tasks.collection
          .find(
            {
              _id: {
                $in: created.map((item) => new Types.ObjectId(item.taskId)),
              },
            },
            { maxTimeMS: 10000 },
          )
          .sort({ _id: 1 })
          .toArray(),
        submissions: ownedSubmissions,
        feedback: await feedback.collection
          .find(
            { submissionId: { $in: ownedSubmissions.map((item) => item._id) } },
            { maxTimeMS: 10000 },
          )
          .sort({ _id: 1 })
          .toArray(),
        jobs: await jobs.collection
          .find({ classroomTaskId: { $in: ownedIds } }, { maxTimeMS: 10000 })
          .sort({ _id: 1 })
          .toArray(),
      };
    };
    const before = await readOwnedFacts();
    expect(before.submissions).toHaveLength(1);
    for (const instance of [missing, nullState, unknown, arrayState]) {
      const raw = before.instances.find(
        (item) => item._id.toString() === instance.id,
      );
      expect(raw).toBeDefined();
      if (instance === missing) expect(raw).not.toHaveProperty('status');
      if (instance === nullState) expect(raw).toHaveProperty('status', null);
      if (instance === unknown) expect(raw).toHaveProperty('status', 'UNKNOWN');
      if (instance === arrayState)
        expect(raw).toHaveProperty('status', ['ACTIVE']);
    }

    for (const [instance, status] of [
      [active, 'ACTIVE'],
      [closed, 'CLOSED'],
      [recalled, 'RECALLED'],
    ] as const) {
      const response = await teacherA.get(url + '/' + instance.id).expect(200);
      expect((response.body as ClassroomTaskResponseDto).status).toBe(status);
    }
    const expectedIds = [active.id, closed.id, recalled.id].sort();
    for (const agent of [teacherA, studentA]) {
      const all = (await agent.get(url).query({ limit: 100 }).expect(200))
        .body as List;
      expect(all.total).toBe(3);
      expect(all.items.map((item) => item.id).sort()).toEqual(expectedIds);
      const pageIds: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const result = (
          await agent.get(url).query({ page, limit: 1 }).expect(200)
        ).body as List;
        expect(result.total).toBe(3);
        expect(result.items).toHaveLength(page <= 3 ? 1 : 0);
        pageIds.push(...result.items.map((item) => item.id));
      }
      expect(pageIds.sort()).toEqual(expectedIds);
      for (const [status, ids] of [
        ['ARCHIVED', [closed.id]],
        ['PUBLISHED', [active.id, recalled.id]],
      ] as const) {
        const result = (
          await agent.get(url).query({ status, limit: 100 }).expect(200)
        ).body as List;
        expect(result.total).toBe(ids.length);
        expect(result.items.map((item) => item.id).sort()).toEqual(
          [...ids].sort(),
        );
      }
    }
    const invalidUrl = url + '/' + missing.id;
    const submissionPayload = {
      content: {
        codeText: 'status conflict must not create an attempt',
        language: 'typescript',
      },
    };
    await teacherB.get(invalidUrl).expect(403);
    await studentB.get(invalidUrl + '/my-task-detail').expect(403);
    await studentB
      .post(invalidUrl + '/submissions')
      .send(submissionPayload)
      .expect(403);
    await studentA.patch(invalidUrl).send({ allowLate: false }).expect(403);
    await studentA
      .patch(invalidUrl + '/status')
      .send({ status: 'ACTIVE' })
      .expect(403);
    for (const instance of [missing, nullState, unknown, arrayState]) {
      const response = await teacherA.get(url + '/' + instance.id).expect(409);
      expect(response.body as object).toMatchObject({
        message: 'Classroom task has invalid status',
      });
    }
    const mine = await studentA.get(invalidUrl + '/my-task-detail').expect(409);
    expect(mine.body as object).toMatchObject({
      message: 'Classroom task has invalid status',
    });
    const configuration = await teacherA
      .patch(invalidUrl)
      .send({ dueAt: '2035-01-01T00:00:00.000Z', allowLate: false })
      .expect(409);
    expect(configuration.body as object).toMatchObject({
      message: 'Classroom task has invalid status',
    });
    const lifecycle = await teacherA
      .patch(invalidUrl + '/status')
      .send({ status: 'ACTIVE' })
      .expect(409);
    expect(lifecycle.body as object).toMatchObject({
      message: 'Classroom task has invalid status',
    });
    const rejectedSubmission = await studentA
      .post(invalidUrl + '/submissions')
      .send(submissionPayload)
      .expect(409);
    expect(rejectedSubmission.body as object).toMatchObject({
      message: 'Classroom task has invalid status',
    });
    expect(await readOwnedFacts()).toEqual(before);
  });

  it('keeps allowLate defaults and false, clears dueAt, and rejects empty PATCH or null allowLate', async () => {
    const url = '/api/classrooms/' + classA.id + '/tasks';
    const created: ClassroomTaskResponseDto[] = [];
    for (const example of [
      { settings: undefined, allowLate: true },
      { settings: {}, allowLate: true },
      { settings: { allowLate: false }, allowLate: false },
    ]) {
      const id = await makeTask(teacherA);
      const response = await teacherA
        .post(url)
        .send({
          taskId: id,
          ...(example.settings === undefined
            ? {}
            : { settings: example.settings }),
        })
        .expect(201);
      const instance = response.body as ClassroomTaskResponseDto;
      instanceIds.push(instance.id);
      created.push(instance);
      expect(instance.settings).toEqual({ allowLate: example.allowLate });
      const stored = await instances.collection.findOne({
        _id: new Types.ObjectId(instance.id),
      });
      expect(stored?.settings).toEqual({ allowLate: example.allowLate });
    }

    const instance = created[0];
    if (!instance) throw new Error('Expected a published classroom task');
    const taskUrl = url + '/' + instance.id;
    const dueAt = '2099-01-01T00:00:00.000Z';
    const updated = (
      await teacherA
        .patch(taskUrl)
        .send({ dueAt, allowLate: false })
        .expect(200)
    ).body as ClassroomTaskResponseDto;
    expect(updated.dueAt).toBe(dueAt);
    expect(updated.settings).toEqual({ allowLate: false });

    const allowLateOnly = (
      await teacherA.patch(taskUrl).send({ allowLate: false }).expect(200)
    ).body as ClassroomTaskResponseDto;
    expect(allowLateOnly.dueAt).toBe(dueAt);
    expect(allowLateOnly.settings).toEqual({ allowLate: false });

    const cleared = (
      await teacherA.patch(taskUrl).send({ dueAt: null }).expect(200)
    ).body as ClassroomTaskResponseDto;
    expect(cleared).not.toHaveProperty('dueAt');
    expect(cleared.settings).toEqual({ allowLate: false });
    const objectId = new Types.ObjectId(instance.id);
    const before = await instances.collection.findOne({ _id: objectId });
    expect(before).not.toHaveProperty('dueAt');
    expect(before?.settings).toEqual({ allowLate: false });
    for (const payload of [{}, { allowLate: null }]) {
      await teacherA.patch(taskUrl).send(payload).expect(400);
      expect(await instances.collection.findOne({ _id: objectId })).toEqual(
        before,
      );
    }
  });

  it('rejects forbidden public fields and note values with no writes; accepts code-point limit and preserves empty note', async () => {
    const id = await makeTask(teacherA);
    const taskObjectId = new Types.ObjectId(id);
    const templateBefore = await tasks.collection.findOne({
      _id: taskObjectId,
    });
    const before = await instances.countDocuments({
      classroomId: new Types.ObjectId(classA.id),
    });
    for (const payload of [
      { taskId: id, taskSnapshot: oldContent },
      ...[2, null].map((maxAttempts) => ({
        taskId: id,
        dueAt: '2099-01-01T00:00:00.000Z',
        settings: { allowLate: false, maxAttempts },
      })),
      ...[
        'MANUAL',
        'DISABLED',
        'TEACHER_ONLY',
        'FIRST_SUBMISSION_AUTO',
        'INVALID',
        null,
      ].map((mode) => ({
        taskId: id,
        settings: { aiFeedbackMode: mode },
      })),
    ]) {
      await teacherA
        .post('/api/classrooms/' + classA.id + '/tasks')
        .send(payload)
        .expect(400);
    }
    expect(
      await instances.countDocuments({
        classroomId: new Types.ObjectId(classA.id),
      }),
    ).toBe(before);
    expect(await tasks.collection.findOne({ _id: taskObjectId })).toEqual(
      templateBefore,
    );
    expect(await submissions.countDocuments({ taskId: taskObjectId })).toBe(0);
    expect(await jobs.countDocuments({ taskId: taskObjectId })).toBe(0);
    const instance = await publish(teacherA, classA, id);
    const instanceObjectId = new Types.ObjectId(instance.id);
    const instanceBefore = await instances.collection.findOne({
      _id: instanceObjectId,
    });
    for (const payload of [
      { taskSnapshot: newContent },
      { aiFeedbackMode: 'MANUAL' },
      { settings: { aiFeedbackMode: 'MANUAL' } },
      ...[2, null].map((maxAttempts) => ({
        maxAttempts,
        dueAt: '2099-01-01T00:00:00.000Z',
        allowLate: false,
      })),
    ]) {
      await teacherA
        .patch('/api/classrooms/' + classA.id + '/tasks/' + instance.id)
        .send(payload)
        .expect(400);
      expect(
        await instances.collection.findOne({ _id: instanceObjectId }),
      ).toEqual(instanceBefore);
    }
    expect(await tasks.collection.findOne({ _id: taskObjectId })).toEqual(
      templateBefore,
    );
    expect(await submissions.countDocuments({ taskId: taskObjectId })).toBe(0);
    expect(await jobs.countDocuments({ taskId: taskObjectId })).toBe(0);
    const url =
      '/api/classrooms/' + classA.id + '/tasks/' + instance.id + '/submissions';
    for (const invalid of [
      null,
      123,
      {},
      '😀'.repeat(20001),
      '✈️'.repeat(10001),
    ])
      await studentA
        .post(url)
        .send({
          content: {
            codeText: code,
            language: 'typescript',
            submissionNote: invalid,
          },
        })
        .expect(400);
    expect(
      await submissions.countDocuments({
        classroomTaskId: new Types.ObjectId(instance.id),
      }),
    ).toBe(0);
    const unicode = await submit(studentA, classA, instance, {
      codeText: code,
      language: 'typescript',
      submissionNote: '😀'.repeat(20000),
    });
    expect(unicode.content.submissionNote).toBe('😀'.repeat(20000));
    const empty = await submit(studentA, classA, instance, {
      codeText: code,
      language: 'typescript',
      submissionNote: '',
    });
    expect(empty.content.submissionNote).toBe('');
    for (const source of ['AI', 'SYSTEM', 'INVALID'])
      await teacherA
        .post('/api/learning-tasks/submissions/' + empty.id + '/feedback')
        .send({
          expectedRevision: 0,
          source,
          type: 'OTHER',
          severity: 'WARN',
          message: 'forged',
        })
        .expect(400);
    expect(
      await feedback.countDocuments({
        submissionId: {
          $in: [unicode.id, empty.id].map((id) => new Types.ObjectId(id)),
        },
      }),
    ).toBe(0);
    expect(
      await jobs.countDocuments({
        classroomTaskId: new Types.ObjectId(instance.id),
      }),
    ).toBe(0);
    expect(
      (await instances.findById(instance.id).lean().exec())?.taskSnapshot,
    ).toEqual(oldContent);
  });

  it('allows owner students and classroom teachers to request manually with idempotency and membership protection', async () => {
    expect((await getDetail(studentA, first.id)).aiReview).toMatchObject({
      canRequest: true,
      inputCoverage: 'NOT_SENT',
      usage: { reservedRequests: 0, reportedRequests: 0, totalTokens: 0 },
    });
    expect((await getDetail(teacherA, first.id)).aiReview.canRequest).toBe(
      true,
    );
    const accepted = await ask(studentA, first.id).expect(200);
    const again = await ask(teacherA, first.id).expect(200);
    expect((again.body as { jobId: string }).jobId).toBe(
      (accepted.body as { jobId: string }).jobId,
    );
    expect(
      await jobs.countDocuments({ submissionId: new Types.ObjectId(first.id) }),
    ).toBe(1);
    await ask(teacherB, foreign.id).expect(200);
    await ask(studentB, foreign.id).expect(200);
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(foreign.id),
      }),
    ).toBe(1);
    await teacherB
      .post(
        '/api/classrooms/' +
          classB.id +
          '/students/' +
          userIds[3].toString() +
          '/remove',
      )
      .send({})
      .expect(201);
    expect((await getDetail(studentB, foreign.id)).aiReview.canRequest).toBe(
      false,
    );
    await ask(studentB, foreign.id).expect(403);
    await ask(teacherB, foreign.id).expect(200);
  });

  it('ignores residual legacy settings without exposing or rewriting them, and processes existing eligible jobs', async () => {
    const instance = await publish(teacherA, classA, await makeTask(teacherA));
    const objectId = new Types.ObjectId(instance.id);
    // Compatibility fixture only: an old Mixed setting remains in another environment.
    await instances.collection.updateOne(
      { _id: objectId, createdBy: userIds[0] },
      {
        $set: {
          'settings.aiFeedbackMode': 'DISABLED',
          'settings.maxAttempts': 10,
          'settings.legacyPrivate': 'hidden',
        },
      },
    );
    const before = await instances.collection.findOne({ _id: objectId });
    const url = '/api/classrooms/' + classA.id + '/tasks';
    const detail = (await teacherA.get(url + '/' + instance.id).expect(200))
      .body as ClassroomTaskResponseDto;
    const list = (await teacherA.get(url).expect(200)).body as {
      items: ClassroomTaskResponseDto[];
    };
    const mine = (
      await studentA
        .get(url + '/' + instance.id + '/my-task-detail')
        .expect(200)
    ).body as {
      classroomTask: { settings: object };
      participationStatus: { canRequestAiFeedback: boolean };
    };
    for (const settings of [
      detail.settings,
      list.items.find((item) => item.id === instance.id)?.settings,
      mine.classroomTask.settings,
    ]) {
      expect(settings).toEqual({ allowLate: true });
    }
    expect(mine.participationStatus.canRequestAiFeedback).toBe(true);
    expect(await instances.collection.findOne({ _id: objectId })).toEqual(
      before,
    );
    const created = await submit(studentA, classA, instance);
    expect(created.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect((await getDetail(studentA, created.id)).aiReview.canRequest).toBe(
      true,
    );
    const accepted = await ask(studentA, created.id).expect(200);
    const repeated = await ask(teacherA, created.id).expect(200);
    expect((repeated.body as { jobId: string }).jobId).toBe(
      (accepted.body as { jobId: string }).jobId,
    );
    await processOwned(20);
    expect((await getDetail(studentA, created.id)).aiFeedbackStatus).toBe(
      'SUCCEEDED',
    );
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(created.id),
      }),
    ).toBe(1);
    expect(await instances.collection.findOne({ _id: objectId })).toEqual(
      before,
    );
  });

  it('keeps historical reads without backfill, rejects new legacy actions, and kills ineligible jobs without Provider', async () => {
    // Minimal historical shapes are intentional compatibility fixtures, not a new publish path.
    const legacyTask = await makeTask(teacherA);
    const legacyTaskId = new Types.ObjectId(legacyTask);
    await tasks.collection.updateOne(
      { _id: legacyTaskId, createdBy: userIds[0] },
      { $set: { difficulty: '综合' } },
    );
    const legacyTemplateBefore = await tasks.collection.findOne({
      _id: legacyTaskId,
    });
    const old = await instances.create({
      classroomId: new Types.ObjectId(classA.id),
      taskId: new Types.ObjectId(legacyTask),
      createdBy: userIds[0],
      publishedAt: new Date(),
      status: 'ACTIVE',
    });
    instanceIds.push(old._id.toString());
    const legacyInstanceBefore = await instances.collection.findOne({
      _id: old._id,
    });
    const saved = await submissions.create({
      taskId: new Types.ObjectId(legacyTask),
      classroomTaskId: old._id,
      studentId: userIds[2],
      attemptNo: 1,
      content: { codeText: 'old source', language: 'typescript' },
      status: SubmissionStatus.Submitted,
    });
    const unbound = {
      _id: new Types.ObjectId(),
      taskId: new Types.ObjectId(legacyTask),
      studentId: userIds[2],
      attemptNo: 1,
      content: { codeText: 'unbound source', language: 'typescript' },
      status: SubmissionStatus.Submitted,
    };
    const database = submissions.db.db;
    if (!database) throw new Error('Missing connected test database');
    await database.collection(submissions.collection.name).insertOne(unbound);
    await teacherA
      .post(
        '/api/learning-tasks/submissions/' + saved._id.toString() + '/feedback',
      )
      .send({
        expectedRevision: 0,
        source: 'TEACHER',
        type: 'OTHER',
        severity: 'INFO',
        message: 'old feedback',
      })
      .expect(201);
    const initial = await submissions.collection.findOne({ _id: saved._id });
    const detail = await getDetail(studentA, saved._id.toString());
    expect(detail.taskSnapshotAvailable).toBe(false);
    expect(detail.content.submissionNote).toBe('');
    const oldView = (
      await teacherA
        .get('/api/classrooms/' + classA.id + '/tasks/' + old._id.toString())
        .expect(200)
    ).body as ClassroomTaskResponseDto;
    expect(oldView.taskSnapshotAvailable).toBe(false);
    expect(oldView.task.difficulty).toBe('综合');
    const legacyStudentView = await studentA
      .get(
        '/api/classrooms/' +
          classA.id +
          '/tasks/' +
          old._id.toString() +
          '/my-task-detail',
      )
      .expect(200);
    expect(
      (legacyStudentView.body as { task: { difficulty: string } }).task
        .difficulty,
    ).toBe('综合');
    expect(await tasks.collection.findOne({ _id: legacyTaskId })).toEqual(
      legacyTemplateBefore,
    );
    expect(await instances.collection.findOne({ _id: old._id })).toEqual(
      legacyInstanceBefore,
    );
    const denied = await studentA
      .post(
        '/api/classrooms/' +
          classA.id +
          '/tasks/' +
          old._id.toString() +
          '/submissions',
      )
      .send({ content: { codeText: code, language: 'typescript' } })
      .expect(409);
    expect((denied.body as { message: string }).message).toBe(missingSnapshot);
    for (const id of [saved._id.toString(), unbound._id.toString()])
      for (const agent of [teacherA, studentA])
        await ask(agent, id).expect(409);
    await studentA
      .post('/api/learning-tasks/tasks/' + legacyTask + '/submissions')
      .send({ content: { codeText: code, language: 'typescript' } })
      .expect(409);
    expect(await submissions.collection.findOne({ _id: saved._id })).toEqual(
      initial,
    );
    expect(
      (await instances.collection.findOne({ _id: old._id }))?.taskSnapshot,
    ).toBeUndefined();
    const legacyList = (
      await teacherA
        .get('/api/learning-tasks/tasks/' + legacyTask + '/submissions')
        .expect(200)
    ).body as List;
    expect(legacyList.total).toBe(1);
    expect(legacyList.items.map((item) => item.id)).toEqual([
      saved._id.toString(),
    ]);
    const provider = jest.spyOn(
      app.get(DefaultStubAiFeedbackProvider),
      'analyzeSubmission',
    );
    // Finish this spec's legitimate pending jobs before constructing old-job qualification cases.
    await processOwned(20);
    provider.mockClear();
    const ownCases = [
      { submissionId: saved._id, classroomTaskId: old._id },
      { submissionId: unbound._id },
    ];
    for (const item of ownCases)
      await jobs.create({
        ...item,
        budgetVersion: 1,
        requests: [],
        taskId: (await submissions.findById(item.submissionId).lean().exec())
          ?.taskId,
        studentId: userIds[2],
        status: AiFeedbackJobStatus.Pending,
        attempts: 0,
        maxAttempts: 3,
      });
    expect(await processOwned(2)).toEqual({
      processed: 2,
      succeeded: 0,
      failed: 0,
      dead: 2,
    });
    expect(provider).not.toHaveBeenCalled();
    for (const item of ownCases) {
      const job = await jobs
        .findOne({ submissionId: item.submissionId })
        .lean()
        .exec();
      expect(job).toMatchObject({
        status: 'DEAD',
        lockedAt: null,
        lockOwner: null,
        notBefore: null,
      });
      expect(job?.failureCode).toBe('TASK_INELIGIBLE');
    }
    expect(await feedback.countDocuments({ submissionId: saved._id })).toBe(1);
    expect(await submissions.collection.findOne({ _id: saved._id })).toEqual(
      initial,
    );
    provider.mockRestore();
  });
});
