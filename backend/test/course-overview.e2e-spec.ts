import {
  assertAuthTestConnection,
  authTestEnvironment,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { deleteFixtureRows } from './helpers/delete-fixture-rows';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Model, STATES, Types, type Connection, type mongo } from 'mongoose';
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
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

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
  let connection: Connection | undefined;
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
  let studentCId = '';
  let courseId = '';
  let taskId = '';
  let secondaryTaskId = '';
  let classroomAId = '';
  let classroomAJoinCode = '';
  let classroomBId = '';
  let classroomCId = '';
  let classroomTaskAId = '';
  let classroomTaskASecondId = '';
  let classroomTaskBId = '';
  let classroomTaskCId = '';
  const submissionIds: string[] = [];

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
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  };

  beforeAll(async () => {
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

    connection = await openAuthTestConnection();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();

    app = moduleFixture.createNestApplication();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
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
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentAPassword, 10),
      bcrypt.hash(studentBPassword, 10),
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
    });
    await userModel.create({
      _id: new Types.ObjectId(studentBId),
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
    });

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentAPassword);
    await login(studentBAgent, studentBEmail, studentBPassword);
  });

  afterAll(async () => {
    try {
      if (connection && teacherId) {
        await assertAuthTestConnection(connection);
        const db = connection.db;
        if (!db) throw new Error('Course overview cleanup requires MongoDB.');

        const objectIds = (ids: string[]) =>
          ids.filter(Boolean).map((id) => new Types.ObjectId(id));
        const classroomIds = objectIds([
          classroomAId,
          classroomBId,
          classroomCId,
        ]);
        const classroomTaskIds = objectIds([
          classroomTaskAId,
          classroomTaskASecondId,
          classroomTaskBId,
          classroomTaskCId,
        ]);
        const taskIds = objectIds([taskId, secondaryTaskId]);
        const userIds = objectIds([
          teacherId,
          studentAId,
          studentBId,
          studentCId,
        ]);
        const submissionObjectIds = objectIds(submissionIds);
        const targets: Array<[string, mongo.Document]> = [];
        const addTargets = (
          ids: Types.ObjectId[],
          ...collections: Array<[name: string, idField: string]>
        ) => {
          if (!ids.length) return;
          for (const [name, idField] of collections) {
            targets.push([name, { [idField]: { $in: ids } }]);
          }
        };
        addTargets(
          submissionObjectIds,
          [feedbackModel.collection.name, 'submissionId'],
          [aiFeedbackJobModel.collection.name, 'submissionId'],
          [submissionModel.collection.name, '_id'],
        );
        addTargets(classroomTaskIds, [
          classroomTaskModel.collection.name,
          '_id',
        ]);
        addTargets(taskIds, [taskModel.collection.name, '_id']);
        addTargets(
          classroomIds,
          [enrollmentModel.collection.name, 'classroomId'],
          [classroomModel.collection.name, '_id'],
        );
        addTargets(objectIds([courseId]), [courseModel.collection.name, '_id']);
        addTargets(
          userIds,
          [sessionModel.collection.name, 'userId'],
          [userModel.collection.name, '_id'],
        );
        for (const [collectionName, filter] of targets) {
          const collection = db.collection(collectionName);
          const ownedRows = await collection
            .find(filter, {
              projection: { _id: 1 },
              signal: AbortSignal.timeout(5000),
            })
            .toArray();
          if (ownedRows.length) {
            await deleteFixtureRows(
              db,
              collectionName,
              { _id: { $in: ownedRows.map(({ _id }) => _id) } },
              0,
            );
          }
          const residual = await collection.countDocuments(filter, {
            signal: AbortSignal.timeout(5000),
          });
          expect(residual).toBe(0);
        }
        console.info('Course overview fixture cleanup verified zero residual.');
      }
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          if (connection && connection.readyState !== STATES.disconnected)
            await connection.close();
        } finally {
          authTestEnvironment.restore();
        }
      }
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

    const createClassroom = async (name: string) => {
      const response = await teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name })
        .expect(201);
      return response.body as CreatedClassroomResponse;
    };
    const classroomABody = await createClassroom('Overview-Classroom-A');
    classroomAId = classroomABody.id;
    classroomAJoinCode = classroomABody.joinCode;
    const classroomBBody = await createClassroom('Overview-Classroom-B');
    classroomBId = classroomBBody.id;
    const classroomCBody = await createClassroom('Overview-Classroom-C');
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

    const publishTask = async (
      classroomId: string,
      taskId: string,
      dueAt?: string,
    ) => {
      const response = await teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({ taskId, dueAt, settings: { allowLate: true } })
        .expect(201);
      return (response.body as CreatedClassroomTaskResponse).id;
    };
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    classroomTaskAId = await publishTask(classroomAId, taskId, pastDue);
    classroomTaskBId = await publishTask(classroomBId, taskId, pastDue);
    classroomTaskASecondId = await publishTask(classroomAId, secondaryTaskId);
    classroomTaskCId = await publishTask(classroomCId, taskId);

    await Promise.all([
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomABody.joinCode })
        .expect(201),
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomBBody.joinCode })
        .expect(201),
      studentAAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomCBody.joinCode })
        .expect(201),
      studentBAgent
        .post('/api/classrooms/join')
        .send({ joinCode: classroomABody.joinCode })
        .expect(201),
    ]);

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

    // The production batch processor can claim any unfinished job in this DB.
    const foreignJob = await aiFeedbackJobModel
      .exists({
        submissionId: {
          $nin: submissionIds.map((id) => new Types.ObjectId(id)),
        },
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
      })
      .maxTimeMS(5000)
      .exec();
    if (foreignJob)
      throw new Error('Course overview requires a fixture-only AI queue.');
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

  it('supports window=all and defaults to all while preserving legacy windows', async () => {
    const legacyWindowOverview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '24h' })
      .expect(200);
    const legacyWindowBody =
      legacyWindowOverview.body as CourseOverviewResponse;
    expect(legacyWindowBody.window).toBe('24h');

    const defaultWindowOverview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .expect(200);
    const defaultWindowBody =
      defaultWindowOverview.body as CourseOverviewResponse;
    expect(defaultWindowBody.window).toBe('all');

    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await classroomTaskModel.collection.updateMany(
      {
        _id: {
          $in: [
            new Types.ObjectId(classroomTaskAId),
            new Types.ObjectId(classroomTaskASecondId),
          ],
        },
      },
      { $set: { createdAt: oldDate } },
    );

    const allOverview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: 'all' })
      .expect(200);
    const allBody = allOverview.body as CourseOverviewResponse;
    expect(allBody.window).toBe('all');

    const sevenDaysOverview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '7d' })
      .expect(200);
    const sevenDaysBody = sevenDaysOverview.body as CourseOverviewResponse;
    expect(sevenDaysBody.window).toBe('7d');

    const allClassroomA = allBody.items.find(
      (item) => item.classroomId === classroomAId,
    );
    const sevenDaysClassroomA = sevenDaysBody.items.find(
      (item) => item.classroomId === classroomAId,
    );
    expect(allClassroomA?.publishedClassroomTasks).toBe(2);
    expect(sevenDaysClassroomA?.publishedClassroomTasks).toBe(0);
    expect(allClassroomA?.distinctStudentsSubmitted).toBe(2);
    expect(sevenDaysClassroomA?.distinctStudentsSubmitted).toBe(0);
    expect(sevenDaysClassroomA?.overallSubmissionCoverage).toBe(0);
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

  it('restricts submission metrics to each classroom roster after removal and retains historical work', async () => {
    const studentCEmail = `studentC.course.overview.${Date.now()}@example.com`;
    const studentCHash = await bcrypt.hash(studentAPassword, 10);
    studentCId = new Types.ObjectId().toString();
    await userModel.create({
      _id: new Types.ObjectId(studentCId),
      email: studentCEmail,
      passwordHash: studentCHash,
      roles: ['student'],
    });
    const studentCAgent = request.agent(app.getHttpServer());
    await login(studentCAgent, studentCEmail, studentAPassword);
    await studentCAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomAJoinCode })
      .expect(201);

    const config = app.get(ConfigService);
    const cooldownKey = 'LEARNING_TASK_SUBMISSION_COOLDOWN_MS';
    const originalCooldown = config.get<number>(cooldownKey);
    config.set(cooldownKey, 0);
    try {
      const repeat = await studentAAgent
        .post(
          `/api/classrooms/${classroomAId}/tasks/${classroomTaskAId}/submissions`,
        )
        .send({
          content: {
            codeText: 'const overviewRevisedAnswer = 2;',
            language: 'typescript',
          },
        })
        .expect(201);
      submissionIds.push((repeat.body as CreatedSubmissionResponse).id);
    } finally {
      config.set(cooldownKey, originalCooldown);
    }

    const getHistory = () =>
      submissionModel
        .find({ classroomTaskId: new Types.ObjectId(classroomTaskAId) })
        .select('_id studentId attemptNo isLate')
        .sort({ studentId: 1, attemptNo: 1 })
        .lean()
        .exec();
    const initialHistory = await getHistory();
    expect(
      initialHistory.map(({ studentId, attemptNo, isLate }) => ({
        studentId: studentId.toString(),
        attemptNo,
        isLate,
      })),
    ).toEqual([
      { studentId: studentAId, attemptNo: 1, isLate: true },
      { studentId: studentAId, attemptNo: 2, isLate: true },
      { studentId: studentBId, attemptNo: 1, isLate: true },
    ]);
    const historyFilter = {
      submissionId: { $in: initialHistory.map(({ _id }) => _id) },
    };
    const getFeedback = () =>
      feedbackModel
        .find(historyFilter)
        .select('_id')
        .sort({ _id: 1 })
        .lean()
        .exec();
    const initialFeedback = await getFeedback();
    expect(initialFeedback).toHaveLength(2);

    const getOverview = async () => {
      const result = await teacherAgent
        .get(`/api/courses/${courseId}/overview`)
        .query({ window: 'all' })
        .expect(200);
      const getMetrics = (classroomId: string) => {
        const row = (result.body as CourseOverviewResponse).items.find(
          (item) => item.classroomId === classroomId,
        );
        if (!row) throw new Error('Course overview classroom missing.');
        return {
          studentsCount: row.studentsCount,
          publishedClassroomTasks: row.publishedClassroomTasks,
          distinctStudentsSubmitted: row.distinctStudentsSubmitted,
          submissionRate: row.submissionRate,
          overallSubmissionCoverage: row.overallSubmissionCoverage,
          lateStudentsCount: row.lateStudentsCount,
          lateSubmissionsCount: row.lateSubmissionsCount,
          jobsTotal: row.ai.jobsTotal,
        };
      };
      return { A: getMetrics(classroomAId), B: getMetrics(classroomBId) };
    };
    const expectedB = {
      studentsCount: 1,
      publishedClassroomTasks: 1,
      distinctStudentsSubmitted: 1,
      submissionRate: 1,
      overallSubmissionCoverage: 1,
      lateStudentsCount: 1,
      lateSubmissionsCount: 1,
      jobsTotal: 1,
    };
    const before = await getOverview();
    expect(before).toEqual({
      A: {
        studentsCount: 3,
        publishedClassroomTasks: 2,
        distinctStudentsSubmitted: 2,
        submissionRate: 2 / 3,
        overallSubmissionCoverage: 1 / 3,
        lateStudentsCount: 2,
        lateSubmissionsCount: 3,
        jobsTotal: 2,
      },
      B: expectedB,
    });

    await teacherAgent
      .post(`/api/classrooms/${classroomAId}/students/${studentAId}/remove`)
      .send({})
      .expect(201);
    const afterFirstRemoval = await getOverview();
    expect(afterFirstRemoval).toEqual({
      A: {
        studentsCount: 2,
        publishedClassroomTasks: 2,
        distinctStudentsSubmitted: 1,
        submissionRate: 0.5,
        overallSubmissionCoverage: 0.25,
        lateStudentsCount: 1,
        lateSubmissionsCount: 1,
        jobsTotal: 2,
      },
      B: expectedB,
    });

    await teacherAgent
      .post(`/api/classrooms/${classroomAId}/students/${studentBId}/remove`)
      .send({})
      .expect(201);
    const afterSecondRemoval = await getOverview();
    expect(afterSecondRemoval).toEqual({
      A: {
        studentsCount: 1,
        publishedClassroomTasks: 2,
        distinctStudentsSubmitted: 0,
        submissionRate: 0,
        overallSubmissionCoverage: 0,
        lateStudentsCount: 0,
        lateSubmissionsCount: 0,
        jobsTotal: 2,
      },
      B: expectedB,
    });
    expect(await getHistory()).toEqual(initialHistory);
    expect(await getFeedback()).toEqual(initialFeedback);
    expect(await aiFeedbackJobModel.countDocuments(historyFilter)).toBe(2);
    console.info(
      'Course overview membership metrics',
      JSON.stringify({ before, afterFirstRemoval, afterSecondRemoval }),
    );
  });
});
