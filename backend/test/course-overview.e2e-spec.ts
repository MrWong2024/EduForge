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
type ValidationErrorResponse = { message?: unknown };

type CourseOverviewResponse = {
  window: string;
  page: number;
  limit: number;
  total: number;
  items: Array<{
    classroomId: string;
    name: string;
    studentsCount: number;
    publishedClassroomTasks: number;
    distinctStudentsSubmitted: number;
    submissionRate: number;
    overallSubmissionCoverage: number;
    lateSubmissionsCount: number;
    lateStudentsCount: number;
    ai: {
      jobsTotal: number;
      pendingJobs: number;
      failedJobs: number;
      aiSuccessRate: number | null;
      topErrors: Array<{ code: string; count: number }>;
    };
  }>;
};

describe('Course Overview (e2e)', () => {
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
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let courseId = '';
  let taskId = '';
  let secondaryTaskId = '';
  let classroomAId = '';
  let classroomBId = '';
  let classroomCId = '';
  let classroomTaskAId = '';
  let classroomTaskASecondId = '';
  let classroomTaskBId = '';
  let classroomTaskCId = '';
  const submissionIds: string[] = [];

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let environmentOverridden = false;
  let fixtureAuthorized = false;

  const teacherEmail = `teacher.course.overview.${Date.now()}@example.com`;
  const studentAEmail = `studentA.course.overview.${Date.now()}@example.com`;
  const studentBEmail = `studentB.course.overview.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentAPassword = 'StudentPass123!';
  const studentBPassword = 'StudentPass123!';

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
      console.info('Course overview database counts: ' + phase, counts);
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
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
    const configService = app.get(ConfigService);
    const hello = await database.command({ hello: 1 }, { timeoutMS: 5000 });
    expect(hello.setName).toBeUndefined();
    expect(hello.msg).not.toBe('isdbgrid');
    expect(hello.isWritablePrimary).toBe(true);
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: configService.get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: userModel.db.host,
      authInfo: auth.authInfo,
    });
    expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(configService.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(process.env.AI_FEEDBACK_REAL_ENABLED).toBe('false');
    expect(configService.get('MAIL_PROVIDER')).toBe('log');
    console.info(
      'Course overview database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
    );
    await expectEmptyDatabase('before fixtures');
    fixtureAuthorized = true;

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentAPassword, 10),
      bcrypt.hash(studentBPassword, 10),
    ]);

    const teacher = await userModel.create({
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    teacherId = teacher._id.toString();
    const studentA = await userModel.create({
      email: studentAEmail,
      passwordHash: studentAHash,
      roles: ['student'],
    });
    studentAId = studentA._id.toString();
    const studentB = await userModel.create({
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
    });
    studentBId = studentB._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentAPassword);
    await login(studentBAgent, studentBEmail, studentBPassword);
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (fixtureAuthorized) {
        const cleanup: Promise<unknown>[] = [];
        const classroomIds = [classroomAId, classroomBId, classroomCId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        const submissionObjectIds = submissionIds.map(
          (id) => new Types.ObjectId(id),
        );
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
          cleanup.push(
            submissionModel.deleteMany({ _id: { $in: submissionObjectIds } }),
          );
        }
        if (
          classroomTaskAId ||
          classroomTaskASecondId ||
          classroomTaskBId ||
          classroomTaskCId
        ) {
          const classroomTaskIds = [
            classroomTaskAId,
            classroomTaskASecondId,
            classroomTaskBId,
            classroomTaskCId,
          ]
            .filter(Boolean)
            .map((id) => new Types.ObjectId(id));
          if (classroomTaskIds.length > 0) {
            cleanup.push(
              classroomTaskModel.deleteMany({ _id: { $in: classroomTaskIds } }),
            );
          }
        }
        if (taskId || secondaryTaskId) {
          const taskIds = [taskId, secondaryTaskId]
            .filter(Boolean)
            .map((id) => new Types.ObjectId(id));
          if (taskIds.length > 0) {
            cleanup.push(taskModel.deleteMany({ _id: { $in: taskIds } }));
          }
        }
        if (classroomIds.length > 0) {
          cleanup.push(
            enrollmentModel.deleteMany({ classroomId: { $in: classroomIds } }),
          );
          cleanup.push(
            classroomModel.deleteMany({ _id: { $in: classroomIds } }),
          );
        }
        if (courseId) {
          cleanup.push(
            courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
          );
        }
        const userIds = [teacherId, studentAId, studentBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (userIds.length > 0) {
          cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
          cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
        }
        const results = await Promise.allSettled(cleanup);
        for (const result of results) {
          if (result.status === 'rejected') cleanupErrors.push(result.reason);
        }
        await expectEmptyDatabase('after scoped cleanup');
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
        if (userModel) expect(userModel.db.readyState).toBe(0);
        console.info(
          'Course overview application and database connection closed',
        );
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
      throw new AggregateError(
        cleanupErrors,
        'Course overview cleanup failed.',
      );
    }
  });

  it('returns course overview with multi-classroom metrics, sorting and pagination', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `OVERVIEW${Date.now()}`,
        name: 'Course Overview',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroomA = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Overview-Classroom-A' })
      .expect(201);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    classroomAId = classroomABody.id;
    const createdClassroomB = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Overview-Classroom-B' })
      .expect(201);
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    classroomBId = classroomBBody.id;
    const createdClassroomC = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Overview-Classroom-C' })
      .expect(201);
    const classroomCBody = createdClassroomC.body as CreatedClassroomResponse;
    classroomCId = classroomCBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Course Overview Task',
        description: 'Task for cross-classroom overview aggregation.',
        knowledgeModule: 'course-overview',
        status: 'DRAFT',
      })
      .expect(201);
    taskId = (createdTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const secondaryTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Course Overview Task Secondary',
        description: 'Secondary task for classroom-level submission coverage.',
        knowledgeModule: 'course-overview-secondary',
        status: 'DRAFT',
      })
      .expect(201);
    secondaryTaskId = (secondaryTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${secondaryTaskId}/publish`)
      .send({})
      .expect(201);

    const classroomTaskA = await teacherAgent
      .post(`/api/classrooms/${classroomAId}/tasks`)
      .send({ taskId })
      .expect(201);
    classroomTaskAId = (classroomTaskA.body as CreatedClassroomTaskResponse).id;
    const classroomTaskB = await teacherAgent
      .post(`/api/classrooms/${classroomBId}/tasks`)
      .send({ taskId })
      .expect(201);
    classroomTaskBId = (classroomTaskB.body as CreatedClassroomTaskResponse).id;
    const classroomTaskASecond = await teacherAgent
      .post(`/api/classrooms/${classroomAId}/tasks`)
      .send({ taskId: secondaryTaskId })
      .expect(201);
    classroomTaskASecondId = (
      classroomTaskASecond.body as CreatedClassroomTaskResponse
    ).id;
    const classroomTaskC = await teacherAgent
      .post(`/api/classrooms/${classroomCId}/tasks`)
      .send({ taskId })
      .expect(201);
    classroomTaskCId = (classroomTaskC.body as CreatedClassroomTaskResponse).id;

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBBody.joinCode })
      .expect(201);
    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomCBody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);

    const createdSubmissionA1 = await studentAAgent
      .post(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewAStudentOne() { return "A1"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA1 = createdSubmissionA1.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA1.id);

    const createdSubmissionB1 = await studentAAgent
      .post(
        `/api/classrooms/${classroomBId}/tasks/${classroomTaskBId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewBStudentOne() { return "B1"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionB1 = createdSubmissionB1.body as CreatedSubmissionResponse;
    submissionIds.push(submissionB1.id);

    const createdSubmissionA2 = await studentBAgent
      .post(
        `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function overviewAStudentTwo() { return "A2"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA2 = createdSubmissionA2.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA2.id);

    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${submissionA1.id}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionA1.contentRevision })
      .expect(200);
    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${submissionB1.id}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionB1.contentRevision })
      .expect(200);
    await studentBAgent
      .post(
        `/api/learning-tasks/submissions/${submissionA2.id}/ai-feedback/request`,
      )
      .send({ expectedRevision: submissionA2.contentRevision })
      .expect(200);

    const foreignJobs = await aiFeedbackJobModel
      .countDocuments({
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
        submissionId: {
          $nin: submissionIds.map((id) => new Types.ObjectId(id)),
        },
      })
      .maxTimeMS(5000);
    expect(foreignJobs).toBe(0);
    expect(await aiFeedbackProcessor.processOnce(20)).toEqual({
      processed: 3,
      succeeded: 3,
      failed: 0,
      dead: 0,
    });

    const overview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '7d' })
      .expect(200);
    const overviewBody = overview.body as CourseOverviewResponse;

    expect(overviewBody.total).toBeGreaterThanOrEqual(3);
    expect(overviewBody.items.length).toBeGreaterThanOrEqual(3);

    const classroomAOverview = overviewBody.items.find(
      (item) => item.classroomId === classroomAId,
    );
    const classroomBOverview = overviewBody.items.find(
      (item) => item.classroomId === classroomBId,
    );
    const classroomCOverview = overviewBody.items.find(
      (item) => item.classroomId === classroomCId,
    );
    expect(classroomAOverview).toBeDefined();
    expect(classroomBOverview).toBeDefined();
    expect(classroomCOverview).toBeDefined();

    // Legacy compatibility: submissionRate still means distinct submitted students coverage.
    expect(classroomAOverview?.submissionRate).toBe(1);
    expect(classroomBOverview?.submissionRate).toBe(1);
    expect(classroomCOverview?.submissionRate).toBe(0);

    // New metric: overall coverage across all published classroom tasks.
    expect(classroomAOverview?.overallSubmissionCoverage).toBe(0.5);
    expect(classroomBOverview?.overallSubmissionCoverage).toBe(1);
    expect(classroomCOverview?.overallSubmissionCoverage).toBe(0);

    // AI success rate nullability and formula:
    // jobsTotal = 0 -> null; jobsTotal > 0 -> succeededJobs/jobsTotal.
    expect(classroomAOverview?.ai.jobsTotal).toBe(2);
    expect(classroomAOverview?.ai.aiSuccessRate).toBe(1);
    expect(classroomBOverview?.ai.jobsTotal).toBe(1);
    expect(classroomBOverview?.ai.aiSuccessRate).toBe(1);
    expect(classroomCOverview?.ai.jobsTotal).toBe(0);
    expect(classroomCOverview?.ai.aiSuccessRate).toBeNull();

    for (const item of overviewBody.items) {
      expect(typeof item.submissionRate).toBe('number');
      expect(typeof item.overallSubmissionCoverage).toBe('number');
      if (item.ai.jobsTotal === 0) {
        expect(item.ai.aiSuccessRate).toBeNull();
      } else {
        expect(typeof item.ai.aiSuccessRate).toBe('number');
      }
    }

    const sortedByStudents = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        sort: 'studentsCount',
        order: 'desc',
      })
      .expect(200);
    const sortedBody = sortedByStudents.body as CourseOverviewResponse;
    expect(sortedBody.items.length).toBeGreaterThanOrEqual(3);
    expect(typeof sortedBody.items[0]?.studentsCount).toBe('number');

    const sortedByOverallSubmissionCoverage = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        sort: 'overallSubmissionCoverage',
        order: 'desc',
      })
      .expect(200);
    const sortedCoverageBody =
      sortedByOverallSubmissionCoverage.body as CourseOverviewResponse;
    const topCoverageClassroom = sortedCoverageBody.items[0];
    const secondCoverageClassroom = sortedCoverageBody.items[1];
    expect(topCoverageClassroom?.classroomId).toBe(classroomBId);
    expect(topCoverageClassroom?.overallSubmissionCoverage).toBe(1);
    expect(secondCoverageClassroom?.classroomId).toBe(classroomAId);
    expect(secondCoverageClassroom?.overallSubmissionCoverage).toBe(0.5);

    const pageLimited = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        page: 1,
        limit: 1,
      })
      .expect(200);
    const pageLimitedBody = pageLimited.body as CourseOverviewResponse;
    expect(pageLimitedBody.total).toBe(3);
    expect(pageLimitedBody.items.length).toBe(1);

    const limit100 = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        page: 1,
        limit: 100,
      })
      .expect(200);
    const limit100Body = limit100.body as CourseOverviewResponse;
    expect(limit100Body.limit).toBe(100);
    expect(limit100Body.items.length).toBe(3);

    await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({
        window: '7d',
        page: 1,
        limit: 101,
      })
      .expect(400);
  });

  it('keeps default/all history and filters seven-day metrics by classroom task creation', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const oldTaskFilter = {
      _id: {
        $in: [
          new Types.ObjectId(classroomTaskAId),
          new Types.ObjectId(classroomTaskASecondId),
        ],
      },
    };
    const updated = await classroomTaskModel.collection.updateMany(
      oldTaskFilter,
      { $set: { createdAt: oldDate } },
      { maxTimeMS: 5000 },
    );
    expect(updated.matchedCount).toBe(2);
    expect(updated.modifiedCount).toBe(2);
    const oldTaskCursor = classroomTaskModel.collection.find<{
      _id: Types.ObjectId;
      createdAt: Date;
    }>(oldTaskFilter, {
      projection: { _id: 1, createdAt: 1 },
      maxTimeMS: 5000,
    });
    try {
      const oldTasks = await oldTaskCursor.toArray();
      expect(oldTasks.map((task) => task._id.toString()).sort()).toEqual(
        [classroomTaskAId, classroomTaskASecondId].sort(),
      );
      for (const task of oldTasks) {
        expect(task.createdAt).toEqual(oldDate);
      }
    } finally {
      await oldTaskCursor.close();
    }

    for (const window of [undefined, 'all', '7d'] as const) {
      const query = window === undefined ? {} : { window };
      const response = await teacherAgent
        .get(`/api/courses/${courseId}/overview`)
        .query(query)
        .expect(200);
      const body = response.body as CourseOverviewResponse;
      expect(body.window).toBe(window ?? 'all');
      expect(body.total).toBe(3);
      expect(body.items.map((item) => item.classroomId).sort()).toEqual(
        [classroomAId, classroomBId, classroomCId].sort(),
      );
      expect(
        body.items.find((item) => item.classroomId === classroomAId),
      ).toMatchObject({
        studentsCount: 2,
        publishedClassroomTasks: window === '7d' ? 0 : 2,
        distinctStudentsSubmitted: window === '7d' ? 0 : 2,
        submissionRate: window === '7d' ? 0 : 1,
        overallSubmissionCoverage: window === '7d' ? 0 : 0.5,
        lateSubmissionsCount: 0,
        lateStudentsCount: 0,
        ai: {
          jobsTotal: window === '7d' ? 0 : 2,
          pendingJobs: 0,
          failedJobs: 0,
          aiSuccessRate: window === '7d' ? null : 1,
        },
      });
      expect(
        body.items.find((item) => item.classroomId === classroomBId),
      ).toMatchObject({
        studentsCount: 1,
        publishedClassroomTasks: 1,
        distinctStudentsSubmitted: 1,
        submissionRate: 1,
        overallSubmissionCoverage: 1,
        lateSubmissionsCount: 0,
        lateStudentsCount: 0,
        ai: {
          jobsTotal: 1,
          pendingJobs: 0,
          failedJobs: 0,
          aiSuccessRate: 1,
        },
      });
      expect(
        body.items.find((item) => item.classroomId === classroomCId),
      ).toMatchObject({
        studentsCount: 1,
        publishedClassroomTasks: 1,
        distinctStudentsSubmitted: 0,
        submissionRate: 0,
        overallSubmissionCoverage: 0,
        lateSubmissionsCount: 0,
        lateStudentsCount: 0,
        ai: {
          jobsTotal: 0,
          pendingJobs: 0,
          failedJobs: 0,
          aiSuccessRate: null,
        },
      });
    }
  });

  it.each(['1h', '24h'])(
    'rejects retired window=%s with the public DTO error',
    async (window) => {
      const path = `/api/courses/${courseId}/overview?window=${window}`;
      const response = await teacherAgent.get(path).expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, path });
      expect(response.body).toHaveProperty(
        'message',
        expect.stringContaining('window must be one of the following values'),
      );
    },
  );

  it('preserves role and authentication rejection for retired windows', async () => {
    await studentAAgent
      .get(`/api/courses/${courseId}/overview?window=24h`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/courses/${courseId}/overview?window=1h`)
      .timeout({ response: 5000, deadline: 10000 })
      .expect(401);
  });

  it('rejects invalid course overview window', async () => {
    const invalidWindowResponse = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: 'not-supported' })
      .expect(400);

    const invalidWindowBody =
      invalidWindowResponse.body as ValidationErrorResponse;
    const message = invalidWindowBody.message;
    if (Array.isArray(message)) {
      const combinedMessage = message.map((item) => String(item)).join(' | ');
      expect(combinedMessage).toContain(
        'window must be one of the following values',
      );
      expect(combinedMessage).toContain('all');
      return;
    }
    expect(String(message)).toContain(
      'window must be one of the following values',
    );
    expect(String(message)).toContain('all');
  });
});
