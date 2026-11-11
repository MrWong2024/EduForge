import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
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

type RawWeeklyReportClassroom = {
  _id: Types.ObjectId;
  status?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

type WeeklyReportJob = Pick<
  AiFeedbackJob,
  'submissionId' | 'taskId' | 'classroomTaskId' | 'studentId' | 'status'
> & { _id: Types.ObjectId };

type WeeklyReportResponse = {
  window: string;
  classroom: { status: 'ACTIVE' | 'ARCHIVED' };
  progress: {
    studentsCount: number;
    publishedClassroomTasks: number;
    dueClassroomTasks: number;
    distinctStudentsSubmitted: number;
    submissionRate: number;
  };
  aiHealth: {
    jobs: {
      total: number;
      succeeded: number;
      failed: number;
      dead: number;
      pending: number;
      running: number;
    };
    successRate: number;
    errors: Array<{ code: string; count: number }>;
  };
  topTags: Array<{ tag: string; count: number }>;
};

describe('Classroom Weekly Report (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule | undefined;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let enrollmentModel: Model<Enrollment>;
  let classroomTaskModel: Model<ClassroomTask>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let teacherAgent: ReturnType<typeof request.agent>;
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  let submissionId = '';
  let teacherId = '';
  let otherTeacherId = '';
  let studentId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let fixtureAuthorized = false;
  let environmentOverridden = false;

  const teacherEmail = `teacher.weekly.${Date.now()}@example.com`;
  const otherTeacherEmail = `other.teacher.weekly.${Date.now()}@example.com`;
  const studentEmail = `student.weekly.${Date.now()}@example.com`;
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
      console.info('Weekly report database counts: ' + phase, counts, {
        total,
      });
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
      expect(total).toBe(0);
    } finally {
      await cursor.close();
    }
  };

  beforeAll(async () => {
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    environmentOverridden = true;
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
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

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
      'Weekly report database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
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
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (fixtureAuthorized) {
        const cleanup: Promise<unknown>[] = [];
        const userIds = [teacherId, otherTeacherId, studentId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (submissionId) {
          const submissionObjectId = new Types.ObjectId(submissionId);
          cleanup.push(
            feedbackModel.deleteMany({ submissionId: submissionObjectId }),
          );
          cleanup.push(
            aiFeedbackJobModel.deleteMany({ submissionId: submissionObjectId }),
          );
          cleanup.push(submissionModel.deleteOne({ _id: submissionObjectId }));
        }
        if (classroomTaskId) {
          cleanup.push(
            classroomTaskModel.deleteOne({
              _id: new Types.ObjectId(classroomTaskId),
            }),
          );
        }
        if (taskId) {
          cleanup.push(
            taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }),
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
        if (userIds.length > 0) {
          cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
          cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
        }
        const results = await Promise.allSettled(cleanup);
        for (const result of results) {
          if (result.status === 'rejected') cleanupErrors.push(result.reason);
        }
        await expectEmptyDatabase('after scoped cleanup');
        if (classroomId) {
          expect(
            await enrollmentModel.countDocuments({
              classroomId: new Types.ObjectId(classroomId),
            }),
          ).toBe(0);
        }
        if (userIds.length > 0) {
          expect(
            await sessionModel.countDocuments({ userId: { $in: userIds } }),
          ).toBe(0);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        if (environmentOverridden) {
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
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Weekly report cleanup failed: ${cleanupErrors.length}`);
    }
  });

  it('returns teacher classroom weekly report with progress, ai health and tags', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(otherTeacherAgent, otherTeacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `WEEKLY${Date.now()}`,
        name: 'Weekly Report Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Weekly-Report-Classroom',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Weekly Report Task',
        description: 'Task for classroom weekly report e2e.',
        knowledgeModule: 'weekly-report',
        status: 'DRAFT',
      })
      .expect(201);
    taskId = (createdTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({
        taskId,
        dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function weeklyReportCheck() { return "ok"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    submissionId = submissionBody.id;

    await teacherAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionBody.contentRevision })
      .expect(200);

    const jobs = await aiFeedbackJobModel
      .find({ submissionId: new Types.ObjectId(submissionId) })
      .select('_id submissionId taskId classroomTaskId studentId status')
      .lean<WeeklyReportJob[]>()
      .exec();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].submissionId.toString()).toBe(submissionId);
    expect(jobs[0].taskId.toString()).toBe(taskId);
    expect(jobs[0].classroomTaskId?.toString()).toBe(classroomTaskId);
    expect(jobs[0].studentId.toString()).toBe(studentId);
    expect(jobs[0].status).toBe(AiFeedbackJobStatus.Pending);

    const foreignJobs = await aiFeedbackJobModel
      .countDocuments({
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
        submissionId: { $ne: new Types.ObjectId(submissionId) },
      })
      .maxTimeMS(5000);
    expect(foreignJobs).toBe(0);
    const processed = await aiFeedbackProcessor.processOnce(5);
    expect(processed.succeeded).toBe(1);
    const completedJob = await aiFeedbackJobModel
      .findById(jobs[0]._id)
      .select('status -_id')
      .lean<Pick<AiFeedbackJob, 'status'>>()
      .exec();
    expect(completedJob?.status).toBe(AiFeedbackJobStatus.Succeeded);

    const reportPath = `/api/classrooms/${classroomId}/weekly-report`;
    for (const window of [undefined, 'all', '7d', '30d']) {
      const report = await teacherAgent
        .get(reportPath)
        .query(window === undefined ? {} : { window })
        .query(window === '7d' ? { includeRiskStudentIds: true } : {})
        .expect(200);
      const body = report.body as WeeklyReportResponse;
      expect(body.window).toBe(window ?? 'all');
      expect(body.progress).toMatchObject({
        studentsCount: 1,
        publishedClassroomTasks: 1,
        dueClassroomTasks: 0,
        distinctStudentsSubmitted: 1,
        submissionRate: 1,
      });
      expect(body.aiHealth.jobs).toEqual({
        total: 1,
        succeeded: 1,
        failed: 0,
        dead: 0,
        pending: 0,
        running: 0,
      });
      expect(body.aiHealth.successRate).toBe(1);
      expect(Array.isArray(body.topTags)).toBe(true);
    }

    for (const window of ['1h', '24h']) {
      const rejected = await teacherAgent
        .get(reportPath)
        .query({ window })
        .expect(400);
      expect(rejected.body).toHaveProperty('statusCode', 400);
      expect(rejected.body).toHaveProperty(
        'message',
        expect.stringContaining('window must be one of the following values:'),
      );
      expect(rejected.body).toHaveProperty(
        'path',
        `${reportPath}?window=${window}`,
      );
    }
    await studentAgent.get(reportPath).query({ window: '1h' }).expect(403);
    await request(app.getHttpServer())
      .get(reportPath)
      .timeout({ response: 5000, deadline: 10000 })
      .query({ window: '24h' })
      .expect(401);

    const database = classroomModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const classrooms = database.collection<RawWeeklyReportClassroom>(
      classroomModel.collection.name,
    );
    const filter = { _id: new Types.ObjectId(classroomId) };
    const original = await classrooms.findOne(filter, { timeoutMS: 5000 });
    if (!original) throw new Error('Missing owned classroom fixture');
    const originalHasStatus = Object.hasOwn(original, 'status');
    const statusReportPath = `${reportPath}?window=all&includeRiskStudentIds=true`;

    try {
      for (const status of ['ACTIVE', 'ARCHIVED'] as const) {
        const saved = await classrooms.updateOne(
          filter,
          { $set: { status } },
          { timeoutMS: 5000 },
        );
        expect(saved.matchedCount).toBe(1);
        const before = await classrooms.findOne(filter, { timeoutMS: 5000 });
        if (!before) throw new Error('Missing saved classroom fixture');
        expect(Object.hasOwn(before, 'status')).toBe(true);
        expect(before.status).toBe(status);
        expect(typeof before.status).toBe('string');

        const report = await teacherAgent.get(statusReportPath).expect(200);
        const body = report.body as WeeklyReportResponse;
        expect(body.classroom.status).toBe(status);
        expect(body.progress).toMatchObject({
          studentsCount: 1,
          publishedClassroomTasks: 1,
          dueClassroomTasks: 0,
          distinctStudentsSubmitted: 1,
          submissionRate: 1,
        });
        expect(body.aiHealth.jobs).toEqual({
          total: 1,
          succeeded: 1,
          failed: 0,
          dead: 0,
          pending: 0,
          running: 0,
        });
        const after = await classrooms.findOne(filter, { timeoutMS: 5000 });
        expect(after).toStrictEqual(before);
        expect(after?.createdAt).toEqual(before.createdAt);
        expect(after?.updatedAt).toEqual(before.updatedAt);
      }

      const invalidStatuses: unknown[] = [
        undefined,
        null,
        'UNKNOWN',
        ['ACTIVE'],
      ];
      for (const status of invalidStatuses) {
        const saved = await classrooms.updateOne(
          filter,
          status === undefined
            ? { $unset: { status: '' } }
            : { $set: { status } },
          { timeoutMS: 5000 },
        );
        expect(saved.matchedCount).toBe(1);
        const before = await classrooms.findOne(filter, { timeoutMS: 5000 });
        if (!before) throw new Error('Missing polluted classroom fixture');
        expect(Object.hasOwn(before, 'status')).toBe(status !== undefined);
        if (status !== undefined) {
          expect(before.status).toStrictEqual(status);
          expect(typeof before.status).toBe(typeof status);
          expect(Array.isArray(before.status)).toBe(Array.isArray(status));
        }

        const rejected = await teacherAgent.get(statusReportPath).expect(409);
        expect(rejected.body).toMatchObject({
          statusCode: 409,
          message: 'Classroom has invalid status',
          path: statusReportPath,
        });

        if (status === undefined) {
          const notOwned = await otherTeacherAgent
            .get(statusReportPath)
            .expect(404);
          expect(notOwned.body).toMatchObject({
            statusCode: 404,
            message: 'Classroom not found',
            path: statusReportPath,
          });
          await studentAgent.get(statusReportPath).expect(403);
          await request(app.getHttpServer())
            .get(statusReportPath)
            .timeout({ response: 5000, deadline: 10000 })
            .expect(401);
        }

        const after = await classrooms.findOne(filter, { timeoutMS: 5000 });
        expect(after).toStrictEqual(before);
        expect(after?.createdAt).toEqual(before.createdAt);
        expect(after?.updatedAt).toEqual(before.updatedAt);
      }
    } finally {
      const restored = await classrooms.updateOne(
        filter,
        originalHasStatus
          ? { $set: { status: original.status } }
          : { $unset: { status: '' } },
        { timeoutMS: 5000 },
      );
      expect(restored.matchedCount).toBe(1);
      expect(
        await classrooms.findOne(filter, { timeoutMS: 5000 }),
      ).toStrictEqual(original);
    }
  });
});
