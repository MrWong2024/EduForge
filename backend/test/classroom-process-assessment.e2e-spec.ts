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
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for classroom process-assessment e2e.',
    );
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
};
type ProcessAssessmentResponse = {
  rubric: {
    submittedTasksRate: number;
    submissionsCount: number;
    aiRequestQualityProxy: number;
    codeQualityProxy: number;
  };
  total: number;
  items: Array<{
    studentId: string;
    submittedTasksCount: number;
    submissionsCount: number;
    aiRequestedCount: number;
    aiSucceededCount: number;
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

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.process.assessment.${Date.now()}@example.com`;
  const studentAEmail = `studentA.process.assessment.${Date.now()}@example.com`;
  const studentBEmail = `studentB.process.assessment.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

  const waitMs = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

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
    aiFeedbackProcessor = app.get(AiFeedbackProcessor);

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
      await Promise.all(cleanup);
    }

    await app.close();
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

    const [createdTaskA, createdTaskB] = await Promise.all([
      teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Process Task A',
          description: 'Task A for process assessment.',
          knowledgeModule: 'process-assessment',
          stage: 2,
          status: 'DRAFT',
        })
        .expect(201),
      teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Process Task B',
          description: 'Task B for process assessment.',
          knowledgeModule: 'process-assessment',
          stage: 2,
          status: 'DRAFT',
        })
        .expect(201),
    ]);
    taskAId = (createdTaskA.body as CreatedTaskResponse).id;
    taskBId = (createdTaskB.body as CreatedTaskResponse).id;

    await Promise.all([
      teacherAgent
        .post(`/api/learning-tasks/tasks/${taskAId}/publish`)
        .send({})
        .expect(201),
      teacherAgent
        .post(`/api/learning-tasks/tasks/${taskBId}/publish`)
        .send({})
        .expect(201),
    ]);

    const [createdClassroomTaskA, createdClassroomTaskB] = await Promise.all([
      teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({ taskId: taskAId })
        .expect(201),
      teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({ taskId: taskBId })
        .expect(201),
    ]);
    classroomTaskAId = (
      createdClassroomTaskA.body as CreatedClassroomTaskResponse
    ).id;
    classroomTaskBId = (
      createdClassroomTaskB.body as CreatedClassroomTaskResponse
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

    const [submissionA1, submissionA2] = await Promise.all([
      studentAAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskAId}/submissions`,
        )
        .send({
          content: {
            codeText: 'function paA1() { return 1; }',
            language: 'typescript',
          },
        })
        .expect(201),
      studentAAgent
        .post(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskBId}/submissions`,
        )
        .send({
          content: {
            codeText: 'function paB1() { return 2; }',
            language: 'typescript',
          },
        })
        .expect(201),
    ]);
    const submissionA1Body = submissionA1.body as CreatedSubmissionResponse;
    const submissionA2Body = submissionA2.body as CreatedSubmissionResponse;
    submissionIds.push(submissionA1Body.id, submissionA2Body.id);

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
      .send({ reason: 'Need process assessment proxy data on attempt 2' })
      .expect(200);

    for (let index = 0; index < 8; index += 1) {
      await aiFeedbackProcessor.processOnce(20);
      await waitMs(70);
    }

    const processAssessment = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment`)
      .query({
        window: '30d',
        page: 1,
        limit: 50,
        sort: 'score',
        order: 'desc',
      })
      .expect(200);
    const body = processAssessment.body as ProcessAssessmentResponse;
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.rubric).toEqual({
      submittedTasksRate: 0.4,
      submissionsCount: 0.2,
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
    expect(
      (studentAItem?.submittedTasksCount ?? 0) >
        (studentBItem?.submittedTasksCount ?? 0) ||
        (studentAItem?.score ?? 0) >= (studentBItem?.score ?? 0),
    ).toBe(true);

    const csvResponse = await teacherAgent
      .get(`/api/classrooms/${classroomId}/process-assessment.csv`)
      .query({ window: '30d' })
      .expect(200);
    const contentType = String(csvResponse.headers['content-type'] ?? '');
    expect(contentType).toContain('text/csv');
    const csvText = csvResponse.text ?? '';
    expect(csvText).toContain(
      'studentId,score,riskLevel,submittedTasksRate,submissionsCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,avgErrorItems,topTags',
    );
    expect(csvText).toContain(studentAId);
    expect(csvText).not.toContain('codeText');
  });
});
