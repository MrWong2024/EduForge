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
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for classroom student task detail e2e.',
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
type RequestAiFeedbackResponse = {
  submissionId: string;
  jobId: string;
  status: string;
  aiFeedbackStatus: string;
};
type SubmissionDetailItem = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus: string;
  feedbackSummary: {
    totalItems: number;
    topTags: Array<{ tag: string; count: number }>;
    severityBreakdown: { INFO: number; WARN: number; ERROR: number };
  };
  feedbackItems?: Array<{
    source: string;
    type: string;
    severity: string;
    message: string;
  }>;
};
type MyTaskDetailResponse = {
  classroom: { id: string; name: string; courseId: string };
  classroomTask: { id: string; classroomId: string; taskId: string };
  task: { id: string; title: string; status: string };
  me: { studentId: string };
  submissions: SubmissionDetailItem[];
  latest: {
    submissionId: string;
    attemptNo: number;
    aiFeedbackStatus: string;
    feedbackSummary: {
      totalItems: number;
      topTags: Array<{ tag: string; count: number }>;
      severityBreakdown: { INFO: number; WARN: number; ERROR: number };
    };
    feedbackItems?: Array<{
      source: string;
      type: string;
      severity: string;
      message: string;
    }>;
  } | null;
};

describe('Classroom Student Task Detail (e2e)', () => {
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
  let studentAgent: ReturnType<typeof request.agent>;

  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  const submissionIds: string[] = [];

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;
  let previousAutoOnSubmit: string | undefined;
  let previousFirstAttemptOnly: string | undefined;

  const teacherEmail = `teacher.student.detail.${Date.now()}@example.com`;
  const studentEmail = `student.student.detail.${Date.now()}@example.com`;
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

  const findAttempt = (items: SubmissionDetailItem[], attemptNo: number) =>
    items.find((item) => item.attemptNo === attemptNo);

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
    studentAgent = request.agent(app.getHttpServer());

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

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
    ]);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `STDDETAIL${Date.now()}`,
        name: 'Student Detail Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Student-Detail-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Student Task Detail Task',
        description: 'Verify classroom task detail aggregate.',
        knowledgeModule: 'student-detail',
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

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);
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
      const submissionObjectIds = submissionIds.map(
        (id) => new Types.ObjectId(id),
      );
      if (submissionObjectIds.length > 0) {
        await feedbackModel.deleteMany({
          submissionId: { $in: submissionObjectIds },
        });
        await aiFeedbackJobModel.deleteMany({
          submissionId: { $in: submissionObjectIds },
        });
        await submissionModel.deleteMany({ _id: { $in: submissionObjectIds } });
      }
      if (classroomTaskId) {
        await classroomTaskModel.deleteOne({
          _id: new Types.ObjectId(classroomTaskId),
        });
      }
      if (taskId) {
        await taskModel.deleteOne({ _id: new Types.ObjectId(taskId) });
      }
      if (classroomId) {
        await classroomModel.deleteOne({
          _id: new Types.ObjectId(classroomId),
        });
      }
      if (courseId) {
        await courseModel.deleteOne({ _id: new Types.ObjectId(courseId) });
      }
      const users = await userModel
        .find({ email: { $in: [teacherEmail, studentEmail] } })
        .select('_id')
        .lean()
        .exec();
      const userIds = users.map((user) => user._id);
      if (userIds.length > 0) {
        await sessionModel.deleteMany({ userId: { $in: userIds } });
        await userModel.deleteMany({ _id: { $in: userIds } });
      }
    }

    await app.close();
  });

  it('aggregates student classroom task detail and reflects Z2 NOT_REQUESTED + manual request lifecycle', async () => {
    const firstSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function firstDetailAttempt() { return "first"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const firstSubmissionBody =
      firstSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(firstSubmissionBody.id);
    expect(firstSubmissionBody.attemptNo).toBe(1);
    expect(firstSubmissionBody.aiFeedbackStatus).toBe('PENDING');

    await aiFeedbackProcessor.processOnce(5);

    let firstAttemptStatus = '';
    for (let index = 0; index < 5; index += 1) {
      const detail = await studentAgent
        .get(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
        )
        .query({ includeFeedbackItems: true, feedbackLimit: 5 })
        .expect(200);
      const detailBody = detail.body as MyTaskDetailResponse;
      firstAttemptStatus = detailBody.latest?.aiFeedbackStatus ?? '';
      if (firstAttemptStatus === 'SUCCEEDED') {
        expect(detailBody.submissions.length).toBeGreaterThanOrEqual(1);
        expect(
          detailBody.latest?.feedbackSummary.totalItems ?? 0,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (detailBody.latest?.feedbackSummary.topTags ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        break;
      }
      await aiFeedbackProcessor.processOnce(5);
      await waitMs(60);
    }
    expect(firstAttemptStatus).toBe('SUCCEEDED');

    const secondSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function secondDetailAttempt() { return "second"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const secondSubmissionBody =
      secondSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(secondSubmissionBody.id);
    expect(secondSubmissionBody.attemptNo).toBe(2);
    expect(secondSubmissionBody.aiFeedbackStatus).toBe('NOT_REQUESTED');

    const detailAfterSecond = await studentAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
      )
      .expect(200);
    const detailAfterSecondBody =
      detailAfterSecond.body as MyTaskDetailResponse;
    const secondAttemptBeforeRequest = findAttempt(
      detailAfterSecondBody.submissions,
      2,
    );
    expect(secondAttemptBeforeRequest).toBeDefined();
    expect(secondAttemptBeforeRequest?.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(secondAttemptBeforeRequest?.feedbackSummary.totalItems).toBe(0);
    expect(secondAttemptBeforeRequest?.feedbackSummary.topTags).toEqual([]);

    const requestResponse = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondSubmissionBody.id}/ai-feedback/request`,
      )
      .send({ reason: 'Need ai detail for second attempt' })
      .expect(200);
    const requestBody = requestResponse.body as RequestAiFeedbackResponse;
    expect(requestBody.submissionId).toBe(secondSubmissionBody.id);
    expect(requestBody.status).toBe('PENDING');
    expect(requestBody.aiFeedbackStatus).toBe('PENDING');

    const detailAfterRequest = await studentAgent
      .get(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
      )
      .expect(200);
    const detailAfterRequestBody =
      detailAfterRequest.body as MyTaskDetailResponse;
    const secondAttemptPending = findAttempt(
      detailAfterRequestBody.submissions,
      2,
    );
    expect(secondAttemptPending?.aiFeedbackStatus).toBe('PENDING');

    await aiFeedbackProcessor.processOnce(5);

    let secondFinalStatus = '';
    for (let index = 0; index < 5; index += 1) {
      const detail = await studentAgent
        .get(
          `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/my-task-detail`,
        )
        .query({ includeFeedbackItems: true, feedbackLimit: 5 })
        .expect(200);
      const detailBody = detail.body as MyTaskDetailResponse;
      const secondAttempt = findAttempt(detailBody.submissions, 2);
      secondFinalStatus = secondAttempt?.aiFeedbackStatus ?? '';
      if (secondFinalStatus === 'SUCCEEDED') {
        expect(
          secondAttempt?.feedbackSummary.totalItems ?? 0,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (secondAttempt?.feedbackSummary.topTags ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (secondAttempt?.feedbackItems ?? []).length,
        ).toBeGreaterThanOrEqual(1);
        break;
      }
      await aiFeedbackProcessor.processOnce(5);
      await waitMs(60);
    }
    expect(secondFinalStatus).toBe('SUCCEEDED');
  });
});
