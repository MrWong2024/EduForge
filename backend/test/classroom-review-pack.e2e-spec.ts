import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import {
  assertAuthTestWritesConfirmed,
  runAuthTestWrite,
} from './helpers/auth-test-writes';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
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
import { AiFeedbackJobService } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service';

jest.setTimeout(30000);

async function waitForBarrier<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 5000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  let independentConnection: Connection;
  let databaseVerified = false;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let resetTokenModel: Model<PasswordResetToken>;
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

  const teacherId = new Types.ObjectId().toString();
  const studentAId = new Types.ObjectId().toString();
  const studentBId = new Types.ObjectId().toString();
  const extraStudentIds = Array.from({ length: 3 }, () => new Types.ObjectId());
  const scope = new Types.ObjectId().toHexString();
  const courseCode = `RP${scope}`;
  const classroomName = `Review Pack Classroom ${scope}`;
  const taskTitle = `Review Pack Task ${scope}`;
  const raceTaskTitle = `Review Pack Race ${scope}`;
  const teacherEmail = `teacher.review.pack.${scope}@example.com`;
  const studentAEmail = `studentA.review.pack.${scope}@example.com`;
  const studentBEmail = `studentB.review.pack.${scope}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';
  let classroomId: string;

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
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  };

  beforeAll(async () => {
    independentConnection = await openAuthTestConnection();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use(cookieParser());
    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    resetTokenModel = app.get(getModelToken(PasswordResetToken.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const appConnection = app.get<Connection>(getConnectionToken());
    const transactionConnection = app.get<Connection>(
      getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
    );
    const models = [
      userModel,
      sessionModel,
      resetTokenModel,
      courseModel,
      classroomModel,
      classroomTaskModel,
      enrollmentModel,
      taskModel,
      submissionModel,
      feedbackModel,
      aiFeedbackJobModel,
    ];
    const connections = new Set([
      appConnection,
      transactionConnection,
      ...models.map(({ db }) => db),
    ]);
    for (const connection of connections) {
      await assertAuthTestConnection(connection);
      expect(connection.getClient().options.readPreference.mode).toBe(
        'primary',
      );
    }
    databaseVerified = true;
    console.info('Review pack DB gates passed.', {
      app: appConnection.db?.databaseName,
      transaction: transactionConnection.db?.databaseName,
      independent: independentConnection.db?.databaseName,
      worker: 'disabled',
    });
    await app.init();
    teacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await userModel.create([
      {
        _id: teacherId,
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      },
      {
        _id: studentAId,
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
        name: 'Student Alpha',
        studentNo: 'S-A-0001',
      },
      {
        _id: studentBId,
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
        name: 'Student Beta',
        studentNo: 'S-B-0001',
      },
    ]);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: courseCode,
        name: 'Review Pack Course',
        term: '2026-Spring',
      })
      .expect(201);
    const { id: courseId } = createdCourse.body as CreatedCourseResponse;
    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: classroomName })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;
    await Promise.all([
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBody.joinCode })
        .expect(201),
      studentBAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBody.joinCode })
        .expect(201),
    ]);
  });

  afterAll(async () => {
    try {
      const db = independentConnection?.db;
      if (!databaseVerified || !db) return;
      assertAuthTestWritesConfirmed(db);
      const teacherObjectId = new Types.ObjectId(teacherId);
      const userIds = [
        teacherObjectId,
        new Types.ObjectId(studentAId),
        new Types.ObjectId(studentBId),
        ...extraStudentIds,
      ];
      const courseFilter = { code: courseCode, createdBy: teacherObjectId };
      const classroomFilter = {
        name: classroomName,
        teacherId: teacherObjectId,
      };
      const taskFilter = {
        title: { $in: [taskTitle, raceTaskTitle] },
        createdBy: teacherObjectId,
      };
      const ownedClassrooms = await classroomModel
        .find(classroomFilter)
        .select('_id')
        .maxTimeMS(5000)
        .lean()
        .exec();
      const classroomScope = {
        classroomId: { $in: ownedClassrooms.map(({ _id }) => _id) },
      };
      const ownedClassroomTasks = await classroomTaskModel
        .find(classroomScope)
        .select('_id')
        .maxTimeMS(5000)
        .lean()
        .exec();
      const classroomTaskScope = {
        classroomTaskId: { $in: ownedClassroomTasks.map(({ _id }) => _id) },
      };
      const ownedSubmissions = await submissionModel
        .find(classroomTaskScope)
        .select('_id')
        .maxTimeMS(5000)
        .lean()
        .exec();
      const submissionScope = {
        submissionId: { $in: ownedSubmissions.map(({ _id }) => _id) },
      };
      const userScope = { userId: { $in: userIds } };
      const ownedRows = [
        [feedbackModel.collection.name, submissionScope],
        [aiFeedbackJobModel.collection.name, classroomTaskScope],
        [submissionModel.collection.name, classroomTaskScope],
        [enrollmentModel.collection.name, classroomScope],
        [classroomTaskModel.collection.name, classroomScope],
        [taskModel.collection.name, taskFilter],
        [classroomModel.collection.name, classroomFilter],
        [courseModel.collection.name, courseFilter],
        [sessionModel.collection.name, userScope],
        [resetTokenModel.collection.name, userScope],
        [userModel.collection.name, { _id: { $in: userIds } }],
      ] as const;
      for (const [collection, filter] of ownedRows) {
        await db.collection(collection).deleteMany(filter, { timeoutMS: 5000 });
      }
      const residual = await Promise.all(
        ownedRows.map(async ([collection, filter]) => [
          collection,
          await db.collection(collection).countDocuments(filter, {
            timeoutMS: 5000,
            readPreference: 'primary',
          }),
        ]),
      );
      console.info(
        'Review pack scoped residual:',
        Object.fromEntries(residual),
      );
      expect(residual.map(([, count]) => count)).toEqual(
        Array<number>(ownedRows.length).fill(0),
      );
    } finally {
      try {
        await Promise.all([app?.close(), independentConnection?.close()]);
      } finally {
        authTestEnvironment.restore();
      }
    }
  });

  const publishClassroomTask = async (title: string) => {
    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title,
        description: 'Generate classroom review pack.',
        knowledgeModule: 'review-pack',
        status: 'DRAFT',
      })
      .expect(201);
    const { id: taskId } = createdTask.body as CreatedTaskResponse;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId })
      .expect(201);
    return {
      taskId: new Types.ObjectId(taskId),
      classroomTaskId: new Types.ObjectId(
        (createdClassroomTask.body as CreatedClassroomTaskResponse).id,
      ),
    };
  };

  it('builds stable student tiers by latest submission with AI status and AI error count', async () => {
    const { taskId: taskObjectId, classroomTaskId: classroomTaskObjectId } =
      await publishClassroomTask(taskTitle);
    const classroomTaskId = classroomTaskObjectId.toHexString();
    const [studentC, studentD, studentE] = await userModel.create([
      {
        _id: extraStudentIds[0],
        email: `studentC.review.pack.${scope}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
        name: 'Student Gamma',
        studentNo: 'S-C-0001',
      },
      {
        _id: extraStudentIds[1],
        email: `studentD.review.pack.${scope}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
        name: 'Student Delta',
        studentNo: 'S-D-0001',
      },
      {
        _id: extraStudentIds[2],
        email: `studentE.review.pack.${scope}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
      },
    ]);

    await enrollmentModel.create([
      {
        classroomId: new Types.ObjectId(classroomId),
        userId: studentC._id,
      },
      {
        classroomId: new Types.ObjectId(classroomId),
        userId: studentD._id,
      },
      {
        classroomId: new Types.ObjectId(classroomId),
        userId: studentE._id,
      },
    ]);

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
    );
    expect(backdateResult.matchedCount).toBe(1);
    expect(backdateResult.modifiedCount).toBe(1);
    const backdatedStudentESubmission =
      await submissionModel.collection.findOne<{
        createdAt?: Date;
        submittedAt?: Date;
      }>(
        { _id: studentELatest._id },
        { projection: { createdAt: 1, submittedAt: 1 } },
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

    await aiFeedbackJobModel.create([
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
    ]);

    await feedbackModel.create([
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
    ]);

    const reviewPack = await teacherAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/review-pack`,
      )
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
  });

  it('keeps a student in watch when their first AI review completes during the feedback read', async () => {
    const db = independentConnection.db;
    if (!db) throw new Error('Review pack fixture connection is unavailable.');
    const { classroomTaskId, taskId } =
      await publishClassroomTask(raceTaskTitle);
    const studentId = new Types.ObjectId(studentAId);
    const submission = await submissionModel.create({
      classroomTaskId,
      taskId,
      studentId,
      attemptNo: 1,
      submittedAt: new Date(),
      content: { codeText: 'return 1;', language: 'typescript' },
      status: SubmissionStatus.Submitted,
    });
    const job = await aiFeedbackJobModel.create({
      submissionId: submission._id,
      classroomTaskId,
      taskId,
      studentId,
      status: AiFeedbackJobStatus.Running,
    });
    const feedbackCollection = feedbackModel.collection.name;
    const jobCollection = aiFeedbackJobModel.collection.name;
    const errorFilter = {
      submissionId: submission._id,
      source: FeedbackSource.AI,
      severity: FeedbackSeverity.Error,
    };
    const readDatabase = async () => {
      const options = { timeoutMS: 5000, readPreference: 'primary' } as const;
      const [jobRow, errors] = await Promise.all([
        db
          .collection<AiFeedbackJob>(jobCollection)
          .findOne({ _id: job._id, submissionId: submission._id }, options),
        db.collection(feedbackCollection).countDocuments(errorFilter, options),
      ]);
      return { jobStatus: jobRow?.status, errors };
    };
    const getReviewPack = () =>
      teacherAgent
        .get(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId.toHexString()}/review-pack`,
        )
        .query({ window: 'all' })
        .timeout({ deadline: 18000 })
        .expect(200);
    const readStudentTiers = ({ studentTiers }: ReviewPackResponse) =>
      (
        [
          ['good', studentTiers.good],
          ['watch', studentTiers.watch],
          ['notSubmitted', studentTiers.notSubmitted],
        ] as const
      ).flatMap(([tier, students]) =>
        students
          .filter((student) => student.studentId === studentAId)
          .map((student) => ({
            studentId: student.studentId,
            tier,
            latestErrorCount:
              'latestErrorCount' in student ? student.latestErrorCount : null,
          })),
      );
    const expectedWatch = (latestErrorCount: number) => [
      { studentId: studentAId, tier: 'watch', latestErrorCount },
    ];

    const jobService = app.get<AiFeedbackJobService>(AiFeedbackJobService);
    const readJobStatus = jobService.getStatusMapBySubmissionIds.bind(
      jobService,
    ) as typeof jobService.getStatusMapBySubmissionIds;
    const requestJobStatuses: Array<string | undefined> = [];
    const jobStatusSpy = jest
      .spyOn(jobService, 'getStatusMapBySubmissionIds')
      .mockImplementation(async (...args) => {
        const states = await readJobStatus(...args);
        requestJobStatuses.push(states.get(submission._id.toHexString()));
        return states;
      });
    try {
      const beforeDb = await readDatabase();
      expect(beforeDb).toEqual({ jobStatus: 'RUNNING', errors: 0 });
      const before = await getReviewPack();
      expect(readStudentTiers(before.body as ReviewPackResponse)).toEqual(
        expectedWatch(0),
      );

      type ErrorFacet = {
        latestErrorCountsBySubmission: Array<{
          _id: Types.ObjectId;
          count: number;
        }>;
      };
      let reportFacet!: (rows: ErrorFacet[]) => void;
      const facetRead = new Promise<ErrorFacet[]>((resolve) => {
        reportFacet = resolve;
      });
      let releaseFacet!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseFacet = resolve;
      });

      const aggregate = feedbackModel.aggregate.bind(
        feedbackModel,
      ) as typeof feedbackModel.aggregate;
      const aggregateSpy = jest
        .spyOn(feedbackModel, 'aggregate')
        .mockImplementationOnce((pipeline) => {
          const query = aggregate<ErrorFacet>(pipeline);
          expect(query.pipeline()[0]).toEqual({
            $match: { submissionId: { $in: [submission._id] } },
          });
          const execute = query.exec.bind(query) as typeof query.exec;
          jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
            const rows = await execute();
            reportFacet(rows);
            await waitForBarrier(
              released,
              'release feedback aggregation',
              12000,
            );
            return rows;
          });
          return query;
        });
      const pending = getReviewPack().then((response) => response);
      try {
        const rows = await Promise.race([
          waitForBarrier(facetRead, 'read actual feedback aggregation'),
          pending.then(() => {
            throw new Error('Review pack responded before feedback was held.');
          }),
        ]);
        expect(rows).toHaveLength(1);
        const readErrorCount =
          rows[0].latestErrorCountsBySubmission.find(({ _id }) =>
            _id.equals(submission._id),
          )?.count ?? 0;
        expect(readErrorCount).toBe(0);

        // Simulate the Worker's existing write order while the HTTP read is paused.
        const _id = new Types.ObjectId();
        const now = new Date();
        const insert = await runAuthTestWrite(
          db,
          {
            insert: feedbackCollection,
            documents: [
              {
                _id,
                ...errorFilter,
                type: FeedbackType.Bug,
                message: 'AI review completes during the review-pack read',
                tags: ['logic', 'correctness'],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          { collection: feedbackCollection, filter: { _id } },
          5000,
        );
        expect(insert.n).toBe(1);
        const complete = await runAuthTestWrite(
          db,
          {
            update: jobCollection,
            updates: [
              {
                q: { _id: job._id, status: AiFeedbackJobStatus.Running },
                u: {
                  $set: {
                    status: AiFeedbackJobStatus.Succeeded,
                    updatedAt: new Date(),
                  },
                },
              },
            ],
          },
          { collection: jobCollection, filter: { _id: job._id } },
          5000,
        );
        expect(complete.n).toBe(1);
        expect(complete.nModified).toBe(1);
      } finally {
        releaseFacet();
        await Promise.allSettled([pending]);
        aggregateSpy.mockRestore();
      }

      const during = await pending;
      const after = await getReviewPack();
      const afterDb = await readDatabase();
      const duringTiers = readStudentTiers(during.body as ReviewPackResponse);
      const afterTiers = readStudentTiers(after.body as ReviewPackResponse);
      const observed = {
        studentId: studentAId,
        submissionId: submission._id.toHexString(),
        jobId: job._id.toHexString(),
        before: {
          status: before.status,
          tiers: readStudentTiers(before.body as ReviewPackResponse),
          requestJob: requestJobStatuses[0],
          database: beforeDb,
        },
        during: {
          status: during.status,
          tiers: duringTiers,
          requestJob: requestJobStatuses[1],
        },
        after: {
          status: after.status,
          tiers: afterTiers,
          requestJob: requestJobStatuses[2],
          database: afterDb,
        },
      };
      console.info('Review pack AI completion race:', JSON.stringify(observed));
      expect(afterDb).toEqual({ jobStatus: 'SUCCEEDED', errors: 1 });
      expect(afterTiers).toEqual(expectedWatch(1));
      expect(duringTiers).toEqual(expectedWatch(0));
      expect(requestJobStatuses).toEqual(['RUNNING', 'RUNNING', 'SUCCEEDED']);
    } finally {
      jobStatusSpy.mockRestore();
    }
  });
});
