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
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
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
type CreatedSubmissionResponse = {
  contentRevision: number;
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
};
type ProcessAssessmentResponse = {
  window: string;
  rubric: {
    submittedTasksRate: number;
    submissionsCount: number;
    aiRequestQualityProxy: number;
    codeQualityProxy: number;
  };
  total: number;
  items: Array<{
    studentId: string;
    studentName: string;
    studentNo: string | null;
    submittedTasksCount: number;
    submissionsCount: number;
    iteratedTasksCount: number;
    aiRequestedCount: number;
    aiSucceededCount: number;
    aiRequestedTasksCount: number;
    aiSucceededTasksCount: number;
    avgWarnItems: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    topTags: Array<{ tag: string; count: number }>;
  }>;
};

describe('Classroom Process Assessment (e2e)', () => {
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
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let configService: ConfigService;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAAgent: ReturnType<typeof request.agent>;
  let studentBAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentAId = '';
  let studentBId = '';
  let courseId = '';
  let classroomId = '';
  let classroomTaskAId = '';
  let classroomTaskBId = '';
  let taskAId = '';
  let taskBId = '';
  const submissionIds: string[] = [];
  let fixtureAuthorized = false;

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousSubmissionCooldownMs: string | undefined;

  const teacherEmail = `teacher.process.assessment.${Date.now()}@example.com`;
  const studentAEmail = `studentA.process.assessment.${Date.now()}@example.com`;
  const studentBEmail = `studentB.process.assessment.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

  const waitMs = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

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
      console.info('Process assessment database counts: ' + phase, counts);
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    } finally {
      await cursor.close();
    }
  };

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

  beforeAll(async () => {
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousSubmissionCooldownMs =
      process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
    process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS = '0';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    configService = app.get(ConfigService);
    configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);

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
      'Process assessment database gate: standard_test / eduforge_test / loopback standalone / root@admin user and role verified',
    );
    await expectEmptyDatabase('before fixtures');
    fixtureAuthorized = true;

    const [teacherHash, studentAHash, studentBHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
      bcrypt.hash(studentPassword, 10),
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
      name: '学生甲',
      studentNo: 'S-A-001',
    });
    studentAId = studentA._id.toString();
    const studentB = await userModel.create({
      email: studentBEmail,
      passwordHash: studentBHash,
      roles: ['student'],
      name: '   ',
    });
    studentBId = studentB._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAAgent, studentAEmail, studentPassword);
    await login(studentBAgent, studentBEmail, studentPassword);
  });

  afterAll(async () => {
    try {
      if (!fixtureAuthorized) return;
      const cleanup: Promise<unknown>[] = [];
      if (submissionIds.length > 0) {
        const submissionObjectIds = submissionIds.map(
          (id) => new Types.ObjectId(id),
        );
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
      if (classroomTaskAId || classroomTaskBId) {
        const classroomTaskIds = [classroomTaskAId, classroomTaskBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        cleanup.push(
          classroomTaskModel.deleteMany({ _id: { $in: classroomTaskIds } }),
        );
      }
      if (taskAId || taskBId) {
        const taskIds = [taskAId, taskBId]
          .filter(Boolean)
          .map((id) => new Types.ObjectId(id));
        cleanup.push(taskModel.deleteMany({ _id: { $in: taskIds } }));
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
      const userObjectIds = [teacherId, studentAId, studentBId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (userObjectIds.length > 0) {
        cleanup.push(
          sessionModel.deleteMany({ userId: { $in: userObjectIds } }),
        );
        cleanup.push(userModel.deleteMany({ _id: { $in: userObjectIds } }));
      }
      const results = await Promise.allSettled(cleanup);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Process assessment scoped fixture cleanup failed');
      }
      await expectEmptyDatabase('after scoped cleanup');
    } finally {
      try {
        await app?.close();
      } finally {
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
        if (previousSubmissionCooldownMs === undefined) {
          delete process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS;
        } else {
          process.env.LEARNING_TASK_SUBMISSION_COOLDOWN_MS =
            previousSubmissionCooldownMs;
        }
      }
    }
  });

  it('returns process-assessment panel and csv export', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `PACLS${Date.now()}`,
        name: 'Process Assessment Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Process-Assessment-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTaskA = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Process Task A',
        description: 'Task A for process assessment.',
        knowledgeModule: 'process-assessment',
        status: 'DRAFT',
      })
      .expect(201);
    taskAId = (createdTaskA.body as CreatedTaskResponse).id;
    const createdTaskB = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Process Task B',
        description: 'Task B for process assessment.',
        knowledgeModule: 'process-assessment',
        status: 'DRAFT',
      })
      .expect(201);
    taskBId = (createdTaskB.body as CreatedTaskResponse).id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskAId}/publish`)
      .send({})
      .expect(201);
    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskBId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTaskA = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({
        taskId: taskAId,
      })
      .expect(201);
    classroomTaskAId = (
      createdClassroomTaskA.body as CreatedClassroomTaskResponse
    ).id;
    const createdClassroomTaskB = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({
        taskId: taskBId,
      })
      .expect(201);
    classroomTaskBId = (
      createdClassroomTaskB.body as CreatedClassroomTaskResponse
    ).id;

    await studentAAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
    await studentBAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const submissionA1 = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function paA1() { return 1; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA1Body = submissionA1.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA1Body.id);
    const submissionA2 = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskBId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function paB1() { return 2; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA2Body = submissionA2.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA2Body.id);
    await studentAAgent
      .post(
        '/api/learning-tasks/submissions/' +
          submissionA1Body.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: submissionA1Body.contentRevision })
      .expect(200);
    await studentAAgent
      .post(
        '/api/learning-tasks/submissions/' +
          submissionA2Body.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: submissionA2Body.contentRevision })
      .expect(200);

    const submissionA3 = await studentAAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskAId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function paA2() { return 3; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionA3Body = submissionA3.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA3Body.id);
    expect(submissionA3Body.attemptNo).toBe(2);
    expect(submissionA3Body.aiFeedbackStatus).toBe('NOT_REQUESTED');

    await studentAAgent
      .post(
        `/api/learning-tasks/submissions/${submissionA3Body.id}/ai-feedback/request`,
      )
      .send({
        expectedRevision: 0,
        reason: 'Need process assessment proxy data on attempt 2',
      })
      .expect(200);

    for (let index = 0; index < 8; index += 1) {
      await aiFeedbackProcessor.processOnce(20);
      await waitMs(70);
    }

    const processAssessment = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({
        page: 1,
        limit: 50,
        sort: 'score',
        order: 'desc',
      })
      .expect(200);
    const body = processAssessment.body as ProcessAssessmentResponse;
    expect(body.window).toBe('all');
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.rubric).toEqual({
      submittedTasksRate: 0.45,
      submissionsCount: 0.15,
      aiRequestQualityProxy: 0.2,
      codeQualityProxy: 0.2,
    });
    const studentAItem = body.items.find(
      (item) => item.studentId === studentAId,
    );
    const studentBItem = body.items.find(
      (item) => item.studentId === studentBId,
    );
    expect(studentAItem).toBeDefined();
    expect(studentBItem).toBeDefined();
    expect(studentAItem?.studentName).toBe('学生甲');
    expect(studentAItem?.studentNo).toBe('S-A-001');
    expect(studentBItem?.studentName).toBe('未知学生');
    expect(studentBItem?.studentNo).toBeNull();
    expect(
      (studentAItem?.submittedTasksCount ?? 0) >
        (studentBItem?.submittedTasksCount ?? 0) ||
        (studentAItem?.score ?? 0) >= (studentBItem?.score ?? 0),
    ).toBe(true);

    const explicitAllProcessAssessment = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({
        window: 'all',
        page: 1,
        limit: 50,
        sort: 'score',
        order: 'desc',
      })
      .expect(200);
    const explicitAllBody =
      explicitAllProcessAssessment.body as ProcessAssessmentResponse;
    expect(explicitAllBody.window).toBe('all');
    expect(explicitAllBody.total).toBe(body.total);
    expect(explicitAllBody.items).toEqual(body.items);

    const csvResponse = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment.csv`)
      .query({ window: 'all' })
      .expect(200);
    const contentType = String(csvResponse.headers['content-type'] ?? '');
    expect(contentType).toContain('text/csv');
    const csvText = csvResponse.text ?? '';
    expect(csvText).toContain(
      'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,aiRequestedTasksCount,aiSucceededTasksCount,avgWarnItems,avgErrorItems,topTags',
    );
    expect(csvText).toContain('学生甲');
    expect(csvText).toContain('S-A-001');
    expect(csvText).toContain(studentAId);
    expect(csvText).not.toContain('codeText');
    const csvLines = csvText.trim().split('\n');
    expect(csvLines.length - 1).toBe(body.items.length);
    const csvStudentIds = csvLines.slice(1).map((line) => line.split(',')[2]);
    expect(csvStudentIds.sort()).toEqual(
      body.items.map((item) => item.studentId).sort(),
    );

    for (const window of ['7d', '30d']) {
      const response = await teacherAgent
        .get(`/api/classrooms/${classroomId}/process-assessment`)
        .query({ window })
        .expect(200);
      const windowBody = response.body as ProcessAssessmentResponse;
      expect(windowBody.window).toBe(window);
      expect(windowBody.total).toBe(body.total);
      expect(windowBody.items).toEqual(body.items);
    }
    for (const window of [undefined, '7d', '30d']) {
      const path =
        `/api/classrooms/${classroomId}/process-assessment.csv` +
        (window === undefined ? '' : `?window=${window}`);
      const response = await teacherAgent.get(path).expect(200);
      expect(String(response.headers['content-type'] ?? '')).toContain(
        'text/csv',
      );
      const lines = (response.text ?? '').trim().split('\n');
      expect(lines[0]).toBe(csvLines[0]);
      expect(lines.length - 1).toBe(body.items.length);
      expect(
        lines
          .slice(1)
          .map((line) => line.split(',')[2])
          .sort(),
      ).toEqual(body.items.map((item) => item.studentId).sort());
    }
  });

  it.each(['process-assessment', 'process-assessment.csv'])(
    'rejects term and other invalid windows at %s through the public DTO',
    async (endpoint) => {
      for (const window of ['term', 'not-supported']) {
        const path = `/api/classrooms/${classroomId}/${endpoint}?window=${window}`;
        const response = await teacherAgent.get(path).expect(400);
        expect(response.body).toMatchObject({ statusCode: 400, path });
        expect(response.body).toHaveProperty(
          'message',
          expect.stringContaining(
            'window must be one of the following values: 7d, 30d, all',
          ),
        );
      }
    },
  );

  it('keeps authentication and role rejection ahead of term validation', async () => {
    await studentAAgent
      .get(`/api/classrooms/${classroomId}/process-assessment?window=term`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/classrooms/${classroomId}/process-assessment.csv?window=term`)
      .timeout({ response: 5000, deadline: 10000 })
      .expect(401);
  });
});
