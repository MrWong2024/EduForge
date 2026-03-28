import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom review-pack e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type ReviewPackResponse = {
  overview: {
    studentsCount: number;
    submittedStudentsCount: number;
    submissionRate: number;
  };
  commonIssues: {
    topTags: Array<{ tag: string; count: number }>;
  };
  examples: Array<{
    tag: string;
    samples: Array<{
      submissionId: string;
      attemptNo: number;
      severity: string;
      type: string;
      message: string;
      suggestion?: string;
      source: string;
    }>;
  }>;
  studentTiers: {
    good: Array<{
      studentId: string;
      attemptsCount: number;
      latestErrorCount: number;
    }>;
    watch: Array<{
      studentId: string;
      attemptsCount: number;
      latestErrorCount: number;
    }>;
    notSubmitted: Array<{ studentId: string }>;
  };
};

describe('Classroom Review Pack (e2e)', () => {
  let app: INestApplication<App>;
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

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

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
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  };

  beforeAll(async () => {
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstAttemptOnly =
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'true';

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
    await app.init();

    teacherAgent = request.agent(app.getHttpServer());
    studentAAgent = request.agent(app.getHttpServer());
    studentBAgent = request.agent(app.getHttpServer());

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

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [teacher, studentA, studentB] = await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: studentAEmail,
        passwordHash: studentAHash,
        roles: ['student'],
      }),
      userModel.create({
        email: studentBEmail,
        passwordHash: studentBHash,
        roles: ['student'],
      }),
    ]);

    teacherId = teacher._id.toString();
    studentAId = studentA._id.toString();
    studentBId = studentB._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  afterAll(async () => {
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
    if (previousAutoOnSubmit === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = previousAutoOnSubmit;
    }
    if (previousFirstAttemptOnly === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY =
        previousFirstAttemptOnly;
    }

    if (!KEEP_DB) {
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
      await Promise.all(cleanup);
    }

    await app.close();
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
        stage: 2,
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

    const [studentC, studentD, studentE] = await userModel.create([
      {
        email: `studentC.review.pack.${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
      },
      {
        email: `studentD.review.pack.${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
      },
      {
        email: `studentE.review.pack.${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash(studentPassword, 10),
        roles: ['student'],
      },
    ]);
    extraStudentIds.push(
      studentC._id.toString(),
      studentD._id.toString(),
      studentE._id.toString(),
    );

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
        message: 'D latest attempt has an AI error',
        tags: ['logic'],
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
        window: '7d',
        examplesPerTag: 2,
        topK: 10,
        includeStudentTiers: '1',
      })
      .expect(200);
    const body = reviewPack.body as ReviewPackResponse;

    expect(body.overview.studentsCount).toBe(5);
    expect(body.overview.submittedStudentsCount).toBe(5);
    expect(body.overview.submissionRate).toBeGreaterThanOrEqual(0);
    expect(body.overview.submissionRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(body.commonIssues.topTags)).toBe(true);
    expect(Array.isArray(body.examples)).toBe(true);
    for (const group of body.examples) {
      for (const sample of group.samples) {
        expect((sample as Record<string, unknown>).codeText).toBeUndefined();
      }
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
  });
});
