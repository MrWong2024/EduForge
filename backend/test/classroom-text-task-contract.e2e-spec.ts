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
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import { DefaultStubAiFeedbackProvider } from '../src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider';
import { ClassroomTaskResponseDto } from '../src/modules/classrooms/classroom-tasks/dto/classroom-task-response.dto';
import { SubmissionResponseDto } from '../src/modules/learning-tasks/dto/submission-response.dto';
import { SubmissionDetailResponseDto } from '../src/modules/learning-tasks/dto/submission-detail-response.dto';

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
  stage: 1,
  difficulty: 'old difficulty',
  rubric: { criterion: 'old rubric' },
};
const newContent = {
  title: 'Frozen B requirements',
  description: 'B changed description',
  knowledgeModule: 'new-module',
  courseLabel: 'Java 程序设计',
  stage: 2,
  difficulty: 'new difficulty',
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
  const publish = async (
    agent: Agent,
    classroom: Resource,
    id: string,
    mode?: string,
  ) => {
    const res = await agent
      .post('/api/classrooms/' + classroom.id + '/tasks')
      .send({
        taskId: id,
        ...(mode ? { settings: { aiFeedbackMode: mode } } : {}),
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
      .send({});
  const getDetail = async (agent: Agent, id: string) =>
    (await agent.get('/api/learning-tasks/submissions/' + id).expect(200))
      .body as SubmissionDetailResponseDto;

  beforeAll(async () => {
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
    expect(
      await jobs.countDocuments({ status: { $in: ['PENDING', 'FAILED'] } }),
    ).toBe(0);
    console.info(
      'A1 database gate: standard_test / eduforge_test; namespace=' + namespace,
    );
    const config = app.get(ConfigService);
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('MAIL_PROVIDER')).toBe('log');
    config.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
    config.set('AI_FEEDBACK_AUTO_ON_SUBMIT', true);
    config.set('AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY', false);
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
        console.info('A1 scoped cleanup verified: ' + namespace);
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('publishes, preserves each source/note, freezes A and B independently across read chains', async () => {
    taskId = await makeTask(teacherA);
    instanceA = await publish(teacherA, classA, taskId);
    expect(instanceA.taskSnapshotAvailable).toBe(true);
    expect(instanceA.task).toMatchObject(oldContent);
    expect(instanceA.settings?.aiFeedbackMode).toBe('TEACHER_ONLY');
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
    instanceB = await publish(teacherB, classB, taskId, 'MANUAL');
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
      expect(mine.participationStatus.canRequestAiFeedback).toBe(
        instance.id === instanceB.id,
      );
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
        source: 'TEACHER',
        type: 'OTHER',
        severity: 'ERROR',
        message: 'foreign',
      })
      .expect(403);
    await teacherB
      .post('/api/learning-tasks/submissions/' + foreign.id + '/feedback')
      .send({
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

  it('rejects forbidden public fields and note values with no writes; accepts code-point limit and preserves empty note', async () => {
    const id = await makeTask(teacherA);
    const before = await instances.countDocuments({
      classroomId: new Types.ObjectId(classA.id),
    });
    for (const payload of [
      { taskId: id, taskSnapshot: oldContent },
      ...['INVALID', null].map((mode) => ({
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
    const instance = await publish(teacherA, classA, id, 'DISABLED');
    for (const payload of [
      { taskSnapshot: newContent },
      { aiFeedbackMode: 'MANUAL' },
      { settings: { aiFeedbackMode: 'MANUAL' } },
    ]) {
      await teacherA
        .patch('/api/classrooms/' + classA.id + '/tasks/' + instance.id)
        .send(payload)
        .expect(400);
    }
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
        .send({ source, type: 'OTHER', severity: 'WARN', message: 'forged' })
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

  it('enforces all four modes, first-attempt-only auto, idempotency, global switch and removed membership', async () => {
    await ask(studentA, first.id).expect(403);
    const accepted = await ask(teacherA, first.id).expect(200);
    const again = await ask(teacherA, first.id).expect(200);
    expect((again.body as { jobId: string }).jobId).toBe(
      (accepted.body as { jobId: string }).jobId,
    );
    expect(
      await jobs.countDocuments({ submissionId: new Types.ObjectId(first.id) }),
    ).toBe(1);
    await ask(studentB, foreign.id).expect(200);
    await ask(teacherB, foreign.id).expect(200);
    expect(
      await jobs.countDocuments({
        submissionId: new Types.ObjectId(foreign.id),
      }),
    ).toBe(1);
    for (const mode of ['DISABLED', 'MANUAL', 'FIRST_SUBMISSION_AUTO']) {
      const id = await makeTask(teacherA);
      const instance = await publish(teacherA, classA, id, mode);
      const a = await submit(studentA, classA, instance),
        b = await submit(studentA, classA, instance);
      expect(a.aiFeedbackStatus).toBe(
        mode === 'FIRST_SUBMISSION_AUTO' ? 'PENDING' : 'NOT_REQUESTED',
      );
      expect(b.aiFeedbackStatus).toBe('NOT_REQUESTED');
      await ask(studentA, b.id).expect(mode === 'DISABLED' ? 403 : 200);
      await ask(teacherA, b.id).expect(mode === 'DISABLED' ? 403 : 200);
      if (mode === 'DISABLED')
        expect(
          await jobs.countDocuments({
            classroomTaskId: new Types.ObjectId(instance.id),
          }),
        ).toBe(0);
    }
    app.get(ConfigService).set('AI_FEEDBACK_AUTO_ON_SUBMIT', false);
    const off = await publish(
      teacherA,
      classA,
      await makeTask(teacherA),
      'FIRST_SUBMISSION_AUTO',
    );
    expect((await submit(studentA, classA, off)).aiFeedbackStatus).toBe(
      'NOT_REQUESTED',
    );
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
    await ask(studentB, foreign.id).expect(403);
    await ask(teacherB, foreign.id).expect(200);
  });

  it('keeps historical reads without backfill, rejects new legacy actions, and kills ineligible jobs without Provider', async () => {
    // Minimal historical shapes are intentional compatibility fixtures, not a new publish path.
    const legacyTask = await makeTask(teacherA);
    const old = await instances.create({
      classroomId: new Types.ObjectId(classA.id),
      taskId: new Types.ObjectId(legacyTask),
      createdBy: userIds[0],
      publishedAt: new Date(),
      status: 'ACTIVE',
    });
    instanceIds.push(old._id.toString());
    const saved = await submissions.create({
      taskId: new Types.ObjectId(legacyTask),
      classroomTaskId: old._id,
      studentId: userIds[2],
      attemptNo: 1,
      content: { codeText: 'old source', language: 'typescript' },
      status: 'SUBMITTED',
    });
    const unbound = await submissions.create({
      taskId: new Types.ObjectId(legacyTask),
      studentId: userIds[2],
      attemptNo: 1,
      content: { codeText: 'unbound source', language: 'typescript' },
      status: 'SUBMITTED',
    });
    await teacherA
      .post(
        '/api/learning-tasks/submissions/' + saved._id.toString() + '/feedback',
      )
      .send({
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
    expect(legacyList.total).toBe(2);
    const disabled = await publish(
      teacherA,
      classA,
      await makeTask(teacherA),
      'DISABLED',
    );
    const disabledSubmission = await submit(studentA, classA, disabled);
    const provider = jest.spyOn(
      app.get(DefaultStubAiFeedbackProvider),
      'analyzeSubmission',
    );
    // Finish this spec's legitimate pending jobs before constructing old-job qualification cases.
    await app.get(AiFeedbackProcessor).processOnce(20);
    provider.mockClear();
    const ownCases = [
      { submissionId: saved._id, classroomTaskId: old._id },
      { submissionId: unbound._id },
      {
        submissionId: new Types.ObjectId(disabledSubmission.id),
        classroomTaskId: new Types.ObjectId(disabled.id),
      },
    ];
    for (const item of ownCases)
      await jobs.create({
        ...item,
        taskId: (await submissions.findById(item.submissionId).lean().exec())
          ?.taskId,
        studentId: userIds[2],
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
      });
    expect(await app.get(AiFeedbackProcessor).processOnce(3)).toEqual({
      processed: 3,
      succeeded: 0,
      failed: 0,
      dead: 3,
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
      expect(job?.lastError).toMatch(/^AI_ELIGIBILITY:/);
    }
    expect(await feedback.countDocuments({ submissionId: saved._id })).toBe(1);
    expect(await submissions.collection.findOne({ _id: saved._id })).toEqual(
      initial,
    );
    provider.mockRestore();
  });
});
