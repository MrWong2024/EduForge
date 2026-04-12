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
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for course overview e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string };

type CourseOverviewResponse = {
  window: string;
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
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
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
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

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
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstAttemptOnly =
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = 'false';

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
    await login(studentAAgent, studentAEmail, studentAPassword);
    await login(studentBAgent, studentBEmail, studentBPassword);
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
      if (classroomAId || classroomBId || classroomCId) {
        const classroomIds = [classroomAId, classroomBId, classroomCId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        if (classroomIds.length > 0) {
          cleanup.push(
            classroomModel.deleteMany({ _id: { $in: classroomIds } }),
          );
        }
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
      await Promise.all(cleanup);
    }

    await app.close();
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

    const [createdClassroomA, createdClassroomB, createdClassroomC] =
      await Promise.all([
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Classroom-A' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Classroom-B' })
        .expect(201),
      teacherAgent
        .post('/api/classrooms')
        .send({ courseId, name: 'Overview-Classroom-C' })
        .expect(201),
      ]);
    const classroomABody = createdClassroomA.body as CreatedClassroomResponse;
    const classroomBBody = createdClassroomB.body as CreatedClassroomResponse;
    const classroomCBody = createdClassroomC.body as CreatedClassroomResponse;
    classroomAId = classroomABody.id;
    classroomBId = classroomBBody.id;
    classroomCId = classroomCBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Course Overview Task',
        description: 'Task for cross-classroom overview aggregation.',
        knowledgeModule: 'course-overview',
        stage: 2,
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
        stage: 2,
        status: 'DRAFT',
      })
      .expect(201);
    secondaryTaskId = (secondaryTask.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${secondaryTaskId}/publish`)
      .send({})
      .expect(201);

    const [classroomTaskA, classroomTaskB, classroomTaskASecond, classroomTaskC] =
      await Promise.all([
      teacherAgent
        .post(`/api/classrooms/${classroomAId}/tasks`)
        .send({ taskId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomBId}/tasks`)
        .send({ taskId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomAId}/tasks`)
        .send({ taskId: secondaryTaskId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomCId}/tasks`)
        .send({ taskId })
        .expect(201),
      ]);
    classroomTaskAId = (classroomTaskA.body as CreatedClassroomTaskResponse).id;
    classroomTaskBId = (classroomTaskB.body as CreatedClassroomTaskResponse).id;
    classroomTaskASecondId = (
      classroomTaskASecond.body as CreatedClassroomTaskResponse
    ).id;
    classroomTaskCId = (classroomTaskC.body as CreatedClassroomTaskResponse).id;

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
    submissionIds.push(
      (createdSubmissionA1.body as CreatedSubmissionResponse).id,
    );

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
    submissionIds.push(
      (createdSubmissionB1.body as CreatedSubmissionResponse).id,
    );

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
    submissionIds.push(
      (createdSubmissionA2.body as CreatedSubmissionResponse).id,
    );

    await aiFeedbackProcessor.processOnce(20);

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
    expect(classroomCOverview?.ai.jobsTotal).toBe(0);
    expect(classroomCOverview?.ai.aiSuccessRate).toBeNull();

    const classroomAJobTaskIds = [
      new Types.ObjectId(classroomTaskAId),
      new Types.ObjectId(classroomTaskASecondId),
    ];
    const classroomAJobsTotal = await aiFeedbackJobModel.countDocuments({
      classroomTaskId: { $in: classroomAJobTaskIds },
    });
    const classroomASucceededJobs = await aiFeedbackJobModel.countDocuments({
      classroomTaskId: { $in: classroomAJobTaskIds },
      status: AiFeedbackJobStatus.Succeeded,
    });
    const expectedClassroomAAiSuccessRate =
      classroomAJobsTotal > 0 ? classroomASucceededJobs / classroomAJobsTotal : null;
    expect(classroomAOverview?.ai.jobsTotal).toBe(classroomAJobsTotal);
    expect(classroomAOverview?.ai.aiSuccessRate).toBe(
      expectedClassroomAAiSuccessRate,
    );

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
  });

  it('supports window=all and defaults to all while preserving legacy windows', async () => {
    const legacyWindowOverview = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: '24h' })
      .expect(200);
    const legacyWindowBody = legacyWindowOverview.body as CourseOverviewResponse;
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
  });

  it('rejects invalid course overview window', async () => {
    const invalidWindowResponse = await teacherAgent
      .get(`/api/courses/${courseId}/overview`)
      .query({ window: 'not-supported' })
      .expect(400);

    const message = invalidWindowResponse.body?.message;
    if (Array.isArray(message)) {
      const combinedMessage = message.map((item) => String(item)).join(' | ');
      expect(combinedMessage).toContain(
        'window must be one of the following values',
      );
      expect(combinedMessage).toContain('all');
      return;
    }
    expect(String(message)).toContain('window must be one of the following values');
    expect(String(message)).toContain('all');
  });
});
