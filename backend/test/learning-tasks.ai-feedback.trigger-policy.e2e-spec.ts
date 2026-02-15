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
      'MONGO_URI is required for learning-tasks ai-feedback trigger-policy e2e.',
    );
  }
};

type CreatedCourseResponse = {
  id: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type CreatedTaskResponse = {
  id: string;
};

type CreatedClassroomTaskResponse = {
  id: string;
};

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

type SubmissionListItem = {
  id: string;
  aiFeedbackStatus: string;
};

describe('LearningTasks AI Feedback Trigger Policy (e2e)', () => {
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
  let previousFirstOnly: string | undefined;

  const teacherEmail = `teacher.policy.${Date.now()}@example.com`;
  const studentEmail = `student.policy.${Date.now()}@example.com`;
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

  const findSubmission = (items: SubmissionListItem[], id: string) =>
    items.find((item) => item.id === id);

  beforeAll(async () => {
    ensureMongoUri();

    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
    process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
    previousAutoOnSubmit = process.env.AI_FEEDBACK_AUTO_ON_SUBMIT;
    process.env.AI_FEEDBACK_AUTO_ON_SUBMIT = 'true';
    previousFirstOnly = process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
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
        code: `POLICY${Date.now()}`,
        name: 'Trigger Policy',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Policy-Classroom' })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Trigger Policy Task',
        description: 'Validate attempt-based auto enqueue policy.',
        knowledgeModule: 'ai-policy',
        stage: 1,
        status: 'DRAFT',
      })
      .expect(201);
    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskBody =
      createdClassroomTask.body as CreatedClassroomTaskResponse;
    classroomTaskId = classroomTaskBody.id;

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
    if (previousFirstOnly === undefined) {
      delete process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY;
    } else {
      process.env.AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY = previousFirstOnly;
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

  it('auto-enqueues first attempt only, supports manual request for later attempts, and then succeeds', async () => {
    const firstSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function firstAttemptPolicy() { return 1; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const firstBody = firstSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(firstBody.id);
    expect(firstBody.attemptNo).toBe(1);
    expect(firstBody.aiFeedbackStatus).toBe('PENDING');

    const secondSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function secondAttemptPolicy() { return 2; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const secondBody = secondSubmission.body as CreatedSubmissionResponse;
    submissionIds.push(secondBody.id);
    expect(secondBody.attemptNo).toBe(2);
    expect(secondBody.aiFeedbackStatus).toBe('NOT_REQUESTED');

    const [firstJobCount, secondJobCount] = await Promise.all([
      aiFeedbackJobModel.countDocuments({
        submissionId: new Types.ObjectId(firstBody.id),
      }),
      aiFeedbackJobModel.countDocuments({
        submissionId: new Types.ObjectId(secondBody.id),
      }),
    ]);
    expect(firstJobCount).toBe(1);
    expect(secondJobCount).toBe(0);

    const requestResult = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondBody.id}/ai-feedback/request`,
      )
      .send({ reason: 'Need AI feedback for second attempt' })
      .expect(200);
    const requestBody = requestResult.body as RequestAiFeedbackResponse;
    expect(requestBody.submissionId).toBe(secondBody.id);
    expect(typeof requestBody.jobId).toBe('string');
    expect(requestBody.status).toBe('PENDING');
    expect(requestBody.aiFeedbackStatus).toBe('PENDING');

    const requestAgain = await studentAgent
      .post(
        `/api/learning-tasks/submissions/${secondBody.id}/ai-feedback/request`,
      )
      .send({ reason: 'Idempotency check' })
      .expect(200);
    const requestAgainBody = requestAgain.body as RequestAiFeedbackResponse;
    expect(requestAgainBody.jobId).toBe(requestBody.jobId);

    const mineAfterRequest = await studentAgent
      .get(`/api/learning-tasks/tasks/${taskId}/submissions/mine`)
      .expect(200);
    const mineAfterRequestItems = mineAfterRequest.body as SubmissionListItem[];
    const secondAfterRequest = findSubmission(
      mineAfterRequestItems,
      secondBody.id,
    );
    expect(secondAfterRequest?.aiFeedbackStatus).toBe('PENDING');

    await aiFeedbackProcessor.processOnce(5);

    let secondFinalStatus = '';
    for (let index = 0; index < 5; index += 1) {
      const mine = await studentAgent
        .get(`/api/learning-tasks/tasks/${taskId}/submissions/mine`)
        .expect(200);
      const mineItems = mine.body as SubmissionListItem[];
      secondFinalStatus =
        findSubmission(mineItems, secondBody.id)?.aiFeedbackStatus ?? '';
      if (secondFinalStatus === 'SUCCEEDED') {
        break;
      }
      await aiFeedbackProcessor.processOnce(5);
      await waitMs(60);
    }
    expect(secondFinalStatus).toBe('SUCCEEDED');

    const feedbackList = await studentAgent
      .get(`/api/learning-tasks/submissions/${secondBody.id}/feedback`)
      .expect(200);
    const feedbackItems = feedbackList.body as unknown[];
    expect(Array.isArray(feedbackItems)).toBe(true);
    expect(feedbackItems.length).toBeGreaterThanOrEqual(1);
  });
});
