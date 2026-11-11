import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type ReviewPackResponse = {
  window: string;
  overview: {
    studentsCount: number;
    submittedStudentsCount: number;
    submissionRate: number;
    ai: { jobsTotal: number; successRate: number };
  };
  commonIssues: {
    topTags: Array<{ tag: string; count: number }>;
  };
  examples: Array<{
    feedbackId: string;
    submissionId: string;
    attemptNo: number;
    severity: string;
    type: string;
    message: string;
    suggestion?: string;
    source: string;
    primaryTag: string;
    matchedTags: string[];
    tags: string[];
  }>;
  studentTiers: {
    good: Array<{
      studentId: string;
      studentName: string;
      studentNo: string | null;
      attemptsCount: number;
      latestErrorCount: number;
    }>;
    watch: Array<{
      studentId: string;
      studentName: string;
      studentNo: string | null;
      attemptsCount: number;
      latestErrorCount: number;
    }>;
    notSubmitted: Array<{
      studentId: string;
      studentName: string;
      studentNo: string | null;
    }>;
  };
};

describe('Classroom Review Pack (e2e)', () => {
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
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  const extraStudentIds: string[] = [];
  let fixtureAuthorized = false;
  let environmentOverridden = false;

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.review.pack.${Date.now()}@example.com`;
  const studentAEmail = `studentA.review.pack.${Date.now()}@example.com`;
  const studentBEmail = `studentB.review.pack.${Date.now()}@example.com`;
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
      console.info('Review pack database counts: ' + phase, counts);
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    } finally {
      await cursor.close();
    }
  };

  beforeAll(async () => {
    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    environmentOverridden = true;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

    const appModuleImport =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });
    moduleFixture = await Test.createTestingModule({
      imports: [appModuleImport.AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentBAgent = request
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
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(config.get('AI_FEEDBACK_DEBUG_ENABLED')).toBe('true');
    expect(process.env.AI_FEEDBACK_REAL_ENABLED).toBe('false');
    expect(config.get('MAIL_PROVIDER')).toBe('log');
    console.info(
      'Review pack database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
    );
    await expectEmptyDatabase('before fixtures');
    fixtureAuthorized = true;

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    teacherId = new Types.ObjectId().toString();
    studentAId = new Types.ObjectId().toString();
    studentBId = new Types.ObjectId().toString();
    await userModel.create({
      _id: new Types.ObjectId(teacherId),
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    await userModel.create({
      _id: new Types.ObjectId(studentAId),
      email: studentAEmail,
      passwordHash: studentAHash,
      roles: ['student'],
      name: 'Student Alpha',
      studentNo: 'S-A-0001',
    });
    await userModel.create({
      _id: new Types.ObjectId(studentBId),
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
      name: 'Student Beta',
      studentNo: 'S-B-0001',
    });

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      if (!fixtureAuthorized) return;
      const cleanup: Promise<unknown>[] = [];
      if (classroomTaskId) {
        const classroomTaskObjectId = new Types.ObjectId(classroomTaskId);
        const submissions = await submissionModel
          .find({ classroomTaskId: classroomTaskObjectId })
          .select('_id')
          .lean<Array<{ _id: Types.ObjectId }>>()
          .exec();
        const submissionObjectIds = submissions.map((row) => row._id);

        if (submissionObjectIds.length > 0) {
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
        }

        cleanup.push(
          submissionModel.deleteMany({
            classroomTaskId: classroomTaskObjectId,
          }),
        );
      }
      if (classroomTaskId) {
        cleanup.push(
          classroomTaskModel.deleteOne({
            _id: new Types.ObjectId(classroomTaskId),
          }),
        );
      }
      if (taskId) {
        cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
      }
      if (classroomId) {
        cleanup.push(
          enrollmentModel.deleteMany({
            classroomId: new Types.ObjectId(classroomId),
          }),
        );
        cleanup.push(
          classroomModel.deleteOne({
            _id: new Types.ObjectId(classroomId),
          }),
        );
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userObjectIds = [
        teacherId,
        studentAId,
        studentBId,
        ...extraStudentIds,
      ]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userObjectIds.length > 0) {
        cleanup.push(
          sessionModel.deleteMany({ userId: { $in: userObjectIds } }),
        );
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      const results = await Promise.allSettled(cleanup);
      const failedCount = results.filter(
        (result) => result.status === 'rejected',
      ).length;
      await expectEmptyDatabase('after scoped cleanup');
      if (failedCount > 0) {
        throw new Error(
          `Review pack scoped fixture cleanup failed: ${failedCount}`,
        );
      }
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
        if (userModel) expect(userModel.db.readyState).toBe(0);
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
  });

  it('builds stable student tiers by latest submission with AI status and AI error count', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `RVPK${Date.now()}`,
        name: 'Review Pack Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Review-Pack-Classroom',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Review Pack Task',
        description: 'Generate classroom review pack.',
        knowledgeModule: 'review-pack',
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
      .send({ taskId })
      .expect(201);
    classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const studentCId = new Types.ObjectId();
    const studentDId = new Types.ObjectId();
    const studentEId = new Types.ObjectId();
    extraStudentIds.push(
      studentCId.toString(),
      studentDId.toString(),
      studentEId.toString(),
    );
    const studentC = await userModel.create({
      _id: studentCId,
      email: `studentC.review.pack.${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash(studentPassword, 10),
      roles: ['student'],
      name: 'Student Gamma',
      studentNo: 'S-C-0001',
    });
    const studentD = await userModel.create({
      _id: studentDId,
      email: `studentD.review.pack.${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash(studentPassword, 10),
      roles: ['student'],
      name: 'Student Delta',
      studentNo: 'S-D-0001',
    });
    const studentE = await userModel.create({
      _id: studentEId,
      email: `studentE.review.pack.${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash(studentPassword, 10),
      roles: ['student'],
    });
    for (const student of [studentC, studentD, studentE]) {
      await enrollmentModel.create({
        classroomId: new Types.ObjectId(classroomId),
        userId: student._id,
      });
    }

    const classroomTaskObjectId = new Types.ObjectId(classroomTaskId);
    const taskObjectId = new Types.ObjectId(taskId);

    const createSubmission = async (
      studentId: string,
      attemptNo: number,
      codeText: string,
    ) =>
      submissionModel.create({
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: new Types.ObjectId(studentId),
        attemptNo,
        contentRevision: 0,
        submittedAt: new Date(),
        isLate: false,
        lateBySeconds: 0,
        content: {
          codeText,
          language: 'typescript',
        },
        status: SubmissionStatus.Submitted,
      });

    const studentAAttempt1 = await createSubmission(
      studentAId,
      1,
      'function studentAAttempt1(){return 1;}',
    );
    const studentAAttempt2 = await createSubmission(
      studentAId,
      2,
      'function studentAAttempt2(){return 2;}',
    );
    const studentBLatest = await createSubmission(
      studentBId,
      1,
      'function studentBLatest(){return 1;}',
    );
    const studentCLatest = await createSubmission(
      studentC._id.toString(),
      1,
      'function studentCLatest(){return 1;}',
    );
    const studentDLatest = await createSubmission(
      studentD._id.toString(),
      1,
      'function studentDLatest(){return 1;}',
    );
    const studentELatest = await createSubmission(
      studentE._id.toString(),
      1,
      'function studentELatest(){return 1;}',
    );
    const oldSubmissionDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const backdateResult = await submissionModel.collection.updateOne(
      { _id: studentELatest._id },
      {
        $set: {
          createdAt: oldSubmissionDate,
          submittedAt: oldSubmissionDate,
        },
      },
      { maxTimeMS: 5000 },
    );
    expect(backdateResult.matchedCount).toBe(1);
    expect(backdateResult.modifiedCount).toBe(1);
    const backdatedStudentESubmission =
      await submissionModel.collection.findOne<{
        createdAt?: Date;
        submittedAt?: Date;
      }>(
        { _id: studentELatest._id },
        { projection: { createdAt: 1, submittedAt: 1 }, maxTimeMS: 5000 },
      );
    expect(backdatedStudentESubmission).toBeDefined();
    expect(backdatedStudentESubmission?.createdAt?.getTime()).toBe(
      oldSubmissionDate.getTime(),
    );
    expect(backdatedStudentESubmission?.submittedAt?.getTime()).toBe(
      oldSubmissionDate.getTime(),
    );
    expect(backdatedStudentESubmission?.createdAt?.getTime() ?? 0).toBeLessThan(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    );

    for (const job of [
      {
        submissionId: studentAAttempt2._id,
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: studentAAttempt2.studentId,
        status: AiFeedbackJobStatus.Succeeded,
      },
      {
        submissionId: studentBLatest._id,
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: studentBLatest.studentId,
        status: AiFeedbackJobStatus.Succeeded,
      },
      {
        submissionId: studentCLatest._id,
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: studentCLatest.studentId,
        status: AiFeedbackJobStatus.Succeeded,
      },
      {
        submissionId: studentDLatest._id,
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: studentDLatest.studentId,
        status: AiFeedbackJobStatus.Succeeded,
      },
      {
        submissionId: studentELatest._id,
        taskId: taskObjectId,
        classroomTaskId: classroomTaskObjectId,
        studentId: studentELatest.studentId,
        status: AiFeedbackJobStatus.Failed,
      },
    ]) {
      await aiFeedbackJobModel.create(job);
    }

    for (const feedback of [
      {
        submissionId: studentAAttempt1._id,
        source: FeedbackSource.AI,
        type: FeedbackType.Bug,
        severity: FeedbackSeverity.Error,
        message: 'A old attempt has an AI error',
        tags: ['logic'],
      },
      {
        submissionId: studentDLatest._id,
        source: FeedbackSource.AI,
        type: FeedbackType.Bug,
        severity: FeedbackSeverity.Error,
        message: 'D latest attempt has a multi-tag AI error',
        tags: ['correctness', 'bug-risk'],
      },
      {
        submissionId: studentCLatest._id,
        source: FeedbackSource.Teacher,
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Error,
        message: 'Teacher error feedback should not affect latestErrorCount',
        tags: ['readability'],
      },
    ]) {
      await feedbackModel.create(feedback);
    }

    const reviewPackPath = `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/review-pack`;
    const defaultReviewPack = await teacherAgent
      .get(reviewPackPath)
      .query({ examplesPerTag: 2, topK: 10 })
      .expect(200);
    const defaultBody = defaultReviewPack.body as ReviewPackResponse;

    const reviewPack = await teacherAgent
      .get(reviewPackPath)
      .query({
        window: 'all',
        examplesPerTag: 2,
        topK: 10,
      })
      .expect(200);
    const body = reviewPack.body as ReviewPackResponse;
    expect(body.window).toBe('all');

    expect(body.overview.studentsCount).toBe(5);
    expect(body.overview.submittedStudentsCount).toBe(5);
    expect(body.overview.submissionRate).toBeGreaterThanOrEqual(0);
    expect(body.overview.submissionRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(body.commonIssues.topTags)).toBe(true);
    expect(Array.isArray(body.examples)).toBe(true);
    for (const sample of body.examples) {
      expect((sample as Record<string, unknown>).codeText).toBeUndefined();
    }
    const topTagsCountByTag = new Map(
      body.commonIssues.topTags.map((item) => [item.tag, item.count]),
    );
    expect(topTagsCountByTag.get('correctness')).toBe(1);
    expect(topTagsCountByTag.get('bug-risk')).toBe(1);
    const duplicatedMultiTagExample = body.examples.filter(
      (example) =>
        example.message === 'D latest attempt has a multi-tag AI error',
    );
    expect(duplicatedMultiTagExample).toHaveLength(1);
    expect(duplicatedMultiTagExample[0]?.matchedTags.sort()).toEqual([
      'bug-risk',
      'correctness',
    ]);
    expect(duplicatedMultiTagExample[0]?.tags).toEqual([
      'correctness',
      'bug-risk',
    ]);
    for (const item of body.studentTiers.good) {
      expect(typeof item.studentName).toBe('string');
      expect(item.studentName.length).toBeGreaterThan(0);
      expect(
        item.studentNo === null || typeof item.studentNo === 'string',
      ).toBe(true);
    }
    for (const item of body.studentTiers.watch) {
      expect(typeof item.studentName).toBe('string');
      expect(item.studentName.length).toBeGreaterThan(0);
      expect(
        item.studentNo === null || typeof item.studentNo === 'string',
      ).toBe(true);
    }
    for (const item of body.studentTiers.notSubmitted) {
      expect(typeof item.studentName).toBe('string');
      expect(item.studentName.length).toBeGreaterThan(0);
      expect(
        item.studentNo === null || typeof item.studentNo === 'string',
      ).toBe(true);
    }
    expect(body.studentTiers.notSubmitted).toHaveLength(0);

    const goodByStudentId = new Map(
      body.studentTiers.good.map((item) => [item.studentId, item]),
    );
    const watchByStudentId = new Map(
      body.studentTiers.watch.map((item) => [item.studentId, item]),
    );

    expect(Array.from(goodByStudentId.keys()).sort()).toEqual(
      [studentAId, studentBId, studentC._id.toString()].sort(),
    );
    expect(Array.from(watchByStudentId.keys()).sort()).toEqual(
      [studentD._id.toString(), studentE._id.toString()].sort(),
    );
    expect(goodByStudentId.get(studentAId)?.studentName).toBe('Student Alpha');
    expect(goodByStudentId.get(studentAId)?.studentNo).toBe('S-A-0001');
    expect(goodByStudentId.get(studentBId)?.studentName).toBe('Student Beta');
    expect(goodByStudentId.get(studentBId)?.studentNo).toBe('S-B-0001');
    expect(watchByStudentId.get(studentD._id.toString())?.studentName).toBe(
      'Student Delta',
    );
    expect(watchByStudentId.get(studentD._id.toString())?.studentNo).toBe(
      'S-D-0001',
    );
    expect(watchByStudentId.get(studentE._id.toString())?.studentName).toBe(
      '未知学生',
    );
    expect(watchByStudentId.get(studentE._id.toString())?.studentNo).toBeNull();
    expect(goodByStudentId.get(studentAId)?.latestErrorCount).toBe(0);
    expect(goodByStudentId.get(studentAId)?.attemptsCount).toBe(2);
    expect(
      watchByStudentId.get(studentD._id.toString())?.latestErrorCount,
    ).toBe(1);
    expect(
      watchByStudentId.get(studentE._id.toString())?.latestErrorCount,
    ).toBe(0);

    const totalTierCount =
      body.studentTiers.good.length +
      body.studentTiers.watch.length +
      body.studentTiers.notSubmitted.length;
    expect(totalTierCount).toBe(5);
    expect(body.studentTiers.good.length + body.studentTiers.watch.length).toBe(
      body.overview.submittedStudentsCount,
    );

    expect((body as Record<string, unknown>).actionItems).toBeUndefined();
    expect((body as Record<string, unknown>).teacherScript).toBeUndefined();

    const reviewPack7d = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/review-pack`,
      )
      .query({
        window: '7d',
        examplesPerTag: 2,
        topK: 10,
      })
      .expect(200);
    const body7d = reviewPack7d.body as ReviewPackResponse;
    expect(body7d.window).toBe('7d');
    expect(body7d.overview.submittedStudentsCount).toBe(4);
    expect(
      body7d.studentTiers.notSubmitted.some(
        (item) => item.studentId === studentE._id.toString(),
      ),
    ).toBe(true);

    for (const expected of [
      {
        result: defaultBody,
        window: 'all',
        submittedStudents: 5,
        watchIds: [studentD._id.toString(), studentE._id.toString()],
        notSubmittedIds: [],
      },
      {
        result: body,
        window: 'all',
        submittedStudents: 5,
        watchIds: [studentD._id.toString(), studentE._id.toString()],
        notSubmittedIds: [],
      },
      {
        result: body7d,
        window: '7d',
        submittedStudents: 4,
        watchIds: [studentD._id.toString()],
        notSubmittedIds: [studentE._id.toString()],
      },
    ]) {
      expect(expected.result.window).toBe(expected.window);
      expect(expected.result.overview.studentsCount).toBe(5);
      expect(expected.result.overview.submittedStudentsCount).toBe(
        expected.submittedStudents,
      );
      expect(expected.result.overview.submissionRate).toBe(
        expected.submittedStudents / 5,
      );
      expect(expected.result.overview.ai.jobsTotal).toBe(5);
      expect(expected.result.overview.ai.successRate).toBe(4 / 5);
      expect(
        expected.result.studentTiers.good.map((item) => item.studentId).sort(),
      ).toEqual([studentAId, studentBId, studentC._id.toString()].sort());
      expect(
        expected.result.studentTiers.watch.map((item) => item.studentId).sort(),
      ).toEqual(expected.watchIds.sort());
      expect(
        expected.result.studentTiers.notSubmitted
          .map((item) => item.studentId)
          .sort(),
      ).toEqual(expected.notSubmittedIds.sort());
      expect(
        expected.result.studentTiers.good.find(
          (item) => item.studentId === studentAId,
        )?.attemptsCount,
      ).toBe(2);
    }

    for (const window of ['24h', '30d']) {
      const rejected = await teacherAgent
        .get(reviewPackPath)
        .query({ window })
        .expect(400);
      expect(rejected.body).toHaveProperty('statusCode', 400);
      expect(rejected.body).toHaveProperty(
        'message',
        expect.stringContaining('window must be one of the following values:'),
      );
      expect(rejected.body).toHaveProperty(
        'path',
        `${reviewPackPath}?window=${window}`,
      );
    }
    await studentAAgent
      .get(reviewPackPath)
      .query({ window: '24h' })
      .expect(403);
    await request(app.getHttpServer())
      .get(reviewPackPath)
      .timeout({ response: 5000, deadline: 10000 })
      .query({ window: '30d' })
      .expect(401);
  });
});
