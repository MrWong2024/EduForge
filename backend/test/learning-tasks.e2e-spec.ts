import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedTaskResponse = {
  id: string;
  title: string;
  status: string;
};

type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus?: string;
};

type CreatedFeedbackResponse = {
  id: string;
  createdBy?: string;
  message: string;
  severity?: string;
  tags?: string[];
  scoreHint?: number;
  createdAt?: string;
  updatedAt?: string;
};
type InvalidFeedbackTagsResponse = {
  statusCode: number;
  message: string;
  error: string;
};

type PublishedTaskResponse = {
  status: string;
};

type TaskStatsResponse = {
  submissionsCount: number;
  distinctStudentsCount: number;
  topTags?: string[];
};
type SubmissionDetailResponse = {
  id: string;
  taskId: string;
  classroomTaskId: string | null;
  studentId: string;
  studentName: string | null;
  taskTitle: string | null;
  language: string | null;
  content: {
    language: string | null;
    codeText: string | null;
  };
  submittedAt: string | null;
  attemptNo: number | null;
  isLate: boolean;
  lateBySeconds: number;
  aiFeedbackStatus: string;
};

describe('LearningTasks (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection | undefined;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let teacherAgent: ReturnType<typeof request.agent>;
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let otherTeacherId = '';
  let studentId = '';
  let courseId = '',
    classroomId = '',
    classroomTaskId = '';
  let taskId = '';
  let submissionId = '';
  let feedbackId = '';
  let mismatchedFeedbackId = '';
  let aiFeedbackId = '';
  const authorBoundaryFeedbackIds: string[] = [];

  const teacherEmail = `teacher.${Date.now()}@example.com`;
  const otherTeacherEmail = `other.teacher.${Date.now()}@example.com`;
  const studentEmail = `student.${Date.now()}@example.com`;
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
    assertLocalStandardTestEnvironment({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: process.env.MONGO_URI,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    connection.set('maxTimeMS', 10000);
    const database = connection.db;
    if (!database) throw new Error('Missing connected test database');
    const config = app.get(ConfigService);
    const auth = await database.command(
      { connectionStatus: 1, showPrivileges: false },
      { timeoutMS: 5000 },
    );
    assertLocalStandardTestAuthentication({
      nodeEnv: process.env.NODE_ENV,
      purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
      mongoUri: config.get<string>('MONGO_URI'),
      databaseName: database.databaseName,
      connectedHost: connection.host,
      authInfo: auth.authInfo,
    });
    expect(config.get('AI_FEEDBACK_PROVIDER')).toBe('stub');
    expect(config.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
    expect(config.get('MAIL_PROVIDER')).toBe('log');

    teacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    otherTeacherAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });
    studentAgent = request
      .agent(app.getHttpServer())
      .timeout({ response: 5000, deadline: 10000 });

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    console.log('[e2e] feedback collection =', feedbackModel.collection.name);

    const [teacherHash, otherTeacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const teacher = await userModel.create({
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    teacherId = teacher._id.toString();
    const otherTeacher = await userModel.create({
      email: otherTeacherEmail,
      passwordHash: otherTeacherHash,
      roles: ['teacher'],
    });
    otherTeacherId = otherTeacher._id.toString();
    const student = await userModel.create({
      email: studentEmail,
      passwordHash: studentHash,
      roles: ['student'],
    });
    studentId = student._id.toString();
  });

  it('rejects unauthorized and role-mismatched access with expected status codes', async () => {
    await request(app.getHttpServer())
      .get('/api/learning-tasks/tasks')
      .expect(401);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    await studentAgent.post('/api/learning-tasks/tasks').send({}).expect(403);

    await teacherAgent
      .get('/api/learning-tasks/tasks')
      .query({ page: 1, limit: 20 })
      .expect(200);
  });

  it('keeps public and auth-only routes aligned with global session guard', async () => {
    await request(app.getHttpServer()).get('/api').expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: teacherEmail, password: teacherPassword })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected login status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
    const headers: Record<string, unknown> = loginResponse.headers;
    const rawCookies: unknown = headers['set-cookie'];
    const cookies: string[] =
      rawCookies === undefined
        ? []
        : typeof rawCookies === 'string'
          ? [rawCookies]
          : Array.isArray(rawCookies)
            ? rawCookies.filter(
                (cookie): cookie is string => typeof cookie === 'string',
              )
            : [];

    expect(cookies.some((cookie) => cookie.includes('ef_session='))).toBe(true);

    await request(app.getHttpServer()).get('/api/users/me').expect(401);
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);

    await login(teacherAgent, teacherEmail, teacherPassword);
    await teacherAgent.get('/api/users/me').expect(200);
    await teacherAgent
      .post('/api/auth/logout')
      .send({})
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected logout status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });
  });

  afterAll(async () => {
    try {
      const cleanup: Promise<unknown>[] = [];
      const userIds = [teacherId, otherTeacherId, studentId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));

      const feedbackIds = [
        feedbackId,
        mismatchedFeedbackId,
        aiFeedbackId,
        ...authorBoundaryFeedbackIds,
      ].filter(Boolean);
      if (feedbackIds.length > 0) {
        cleanup.push(feedbackModel.deleteMany({ _id: { $in: feedbackIds } }));
      }
      if (submissionId) {
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: new Types.ObjectId(submissionId),
          }),
        );
      }
      if (submissionId) {
        cleanup.push(submissionModel.deleteOne({ _id: submissionId }));
      }
      if (taskId) {
        cleanup.push(taskModel.deleteOne({ _id: taskId }));
      }
      if (userIds.length > 0) {
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
      }

      for (const operation of cleanup) await operation;
      if (classroomTaskId)
        await app
          .get<Model<ClassroomTask>>(getModelToken(ClassroomTask.name))
          .deleteOne({ _id: classroomTaskId });
      if (classroomId) {
        await app
          .get<Model<Enrollment>>(getModelToken(Enrollment.name))
          .deleteMany({ classroomId: new Types.ObjectId(classroomId) });
        await app
          .get<Model<Classroom>>(getModelToken(Classroom.name))
          .deleteOne({ _id: classroomId });
      }
      if (courseId)
        await app
          .get<Model<Course>>(getModelToken(Course.name))
          .deleteOne({ _id: courseId });
    } finally {
      if (app) {
        await app.close();
        if (connection) expect(connection.readyState).toBe(0);
      }
    }
  });

  it('teacher creates task, publishes, student submits, teacher feedback, stats', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(otherTeacherAgent, otherTeacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    await teacherAgent.get('/api/users/me').expect(200);
    await studentAgent.get('/api/users/me').expect(200);

    const createTaskPayload = {
      title: 'Sorting Lab',
      description: 'Implement quicksort.',
      knowledgeModule: 'algorithms',
      status: 'DRAFT',
    };

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send(createTaskPayload)
      .expect(201);

    const taskBody = createdTask.body as CreatedTaskResponse;

    expect(typeof taskBody.id).toBe('string');
    expect(typeof taskBody.title).toBe('string');
    expect(typeof taskBody.status).toBe('string');
    taskId = taskBody.id;

    const publishedTask = await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const publishedBody = publishedTask.body as PublishedTaskResponse;
    expect(publishedBody.status).toBe('PUBLISHED');
    const course = await teacherAgent
      .post('/api/courses')
      .send({
        code: 'fixture-' + taskId,
        name: 'Synthetic task course',
        term: '2026',
      })
      .expect(201);
    courseId = (course.body as { id: string }).id;
    const classroom = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Synthetic task classroom' })
      .expect(201);
    const room = classroom.body as { id: string; joinCode: string };
    classroomId = room.id;
    const instance = await teacherAgent
      .post('/api/classrooms/' + classroomId + '/tasks')
      .send({ taskId })
      .expect(201);
    classroomTaskId = (instance.body as { id: string }).id;
    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: room.joinCode })
      .expect(201);

    const submissionPayload = {
      content: {
        codeText: 'function quicksort(arr) { return arr; }',
        language: 'typescript',
      },
    };

    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send(submissionPayload)
      .expect(201);

    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    expect(typeof submissionBody.id).toBe('string');
    expect(submissionBody.attemptNo).toBe(1);
    submissionId = submissionBody.id;
    expect(submissionBody.aiFeedbackStatus).toBe('NOT_REQUESTED');

    const teacherDetail = await teacherAgent
      .get(`/api/learning-tasks/submissions/${submissionId}`)
      .expect(200);
    const teacherDetailBody = teacherDetail.body as SubmissionDetailResponse;
    expect(teacherDetailBody.id).toBe(submissionId);
    expect(teacherDetailBody.taskId).toBe(taskId);
    expect(teacherDetailBody.classroomTaskId).toBe(classroomTaskId);
    expect(teacherDetailBody.studentId).toBe(studentId);
    expect(teacherDetailBody.taskTitle).toBe('Sorting Lab');
    expect(teacherDetailBody.language).toBe('typescript');
    expect(teacherDetailBody.content.language).toBe('typescript');
    expect(teacherDetailBody.content.codeText).toBe(
      'function quicksort(arr) { return arr; }',
    );
    expect(teacherDetailBody.aiFeedbackStatus).toBe('NOT_REQUESTED');
    expect(teacherDetailBody).not.toHaveProperty('passwordHash');

    const studentDetail = await studentAgent
      .get(`/api/learning-tasks/submissions/${submissionId}`)
      .expect(200);
    const studentDetailBody = studentDetail.body as SubmissionDetailResponse;
    expect(studentDetailBody.id).toBe(submissionId);
    expect(studentDetailBody.studentId).toBe(studentId);
    expect(studentDetailBody.classroomTaskId).toBe(classroomTaskId);

    const invalidFeedbackPayload = {
      source: 'TEACHER',
      type: 'STYLE',
      severity: 'WARN',
      message: 'Naming could be clearer.',
      tags: ['clarity'],
    };

    const invalidFeedback = await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({ expectedRevision: 0, ...invalidFeedbackPayload })
      .expect(400);
    const invalidFeedbackBody =
      invalidFeedback.body as InvalidFeedbackTagsResponse;
    expect(invalidFeedbackBody.message).toBe(
      'Invalid tag(s), please select from predefined tags',
    );

    const feedbackPayload = {
      source: 'TEACHER',
      type: 'STYLE',
      severity: 'WARN',
      message: 'Naming could be clearer.',
    };

    const createdFeedback = await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({ expectedRevision: 0, ...feedbackPayload })
      .expect(201);

    const feedbackBody = createdFeedback.body as CreatedFeedbackResponse;

    expect(typeof feedbackBody.id).toBe('string');
    expect(typeof feedbackBody.message).toBe('string');
    expect(feedbackBody.createdBy).toBe(teacherId);
    expect(typeof feedbackBody.createdAt).toBe('string');
    expect(typeof feedbackBody.updatedAt).toBe('string');
    feedbackId = feedbackBody.id;

    const persistedFeedback = await feedbackModel.collection.findOne({
      _id: new Types.ObjectId(feedbackId),
    });
    if (!persistedFeedback) {
      console.log('[e2e] feedback not persisted', {
        id: feedbackId,
        persisted: persistedFeedback,
        collection: feedbackModel.collection.name,
      });
    }
    expect(persistedFeedback).toBeTruthy();
    expect(persistedFeedback?.tags).toEqual(['other']);
    expect(persistedFeedback?.createdBy).toEqual(new Types.ObjectId(teacherId));
    if (typeof feedbackBody.createdAt !== 'string') {
      throw new Error('Missing feedback creation timestamp');
    }
    expect(persistedFeedback?.createdAt).toEqual(
      new Date(feedbackBody.createdAt),
    );

    await studentAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({ message: 'Student cannot update teacher feedback.' })
      .expect(403);

    await otherTeacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({ message: 'Other teacher cannot update this feedback.' })
      .expect(403);

    await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({})
      .expect(400);

    await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({ message: '' })
      .expect(400);

    const invalidUpdate = await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({ tags: ['not-in-vocabulary'] })
      .expect(400);
    expect((invalidUpdate.body as InvalidFeedbackTagsResponse).message).toBe(
      'Invalid tag(s), please select from predefined tags',
    );

    const mismatchedFeedback = await feedbackModel.create({
      submissionId: new Types.ObjectId(),
      source: FeedbackSource.Teacher,
      type: FeedbackType.Style,
      severity: FeedbackSeverity.Warn,
      message: `Mismatched feedback ${Date.now()}`,
      tags: ['other'],
    });
    mismatchedFeedbackId = mismatchedFeedback._id.toString();
    await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${mismatchedFeedbackId}`,
      )
      .send({ message: 'Should not reveal cross-submission feedback.' })
      .expect(404);

    const aiFeedback = await feedbackModel.create({
      submissionId: new Types.ObjectId(submissionId),
      source: FeedbackSource.AI,
      type: FeedbackType.Bug,
      severity: FeedbackSeverity.Error,
      message: `AI readonly feedback ${Date.now()}`,
      tags: ['logic'],
    });
    aiFeedbackId = aiFeedback._id.toString();

    const aiUpdate = await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${aiFeedbackId}`,
      )
      .send({ message: 'Trying to edit AI feedback.' })
      .expect(403);
    expect((aiUpdate.body as InvalidFeedbackTagsResponse).message).toBe(
      'Only teacher feedback can be updated',
    );

    const updatedFeedback = await teacherAgent
      .patch(
        `/api/learning-tasks/submissions/${submissionId}/feedback/${feedbackId}`,
      )
      .send({
        message: 'Naming and decomposition should be improved.',
        severity: 'ERROR',
        tags: ['readability', 'naming'],
        scoreHint: 72,
        suggestion: '',
      })
      .expect(200);
    const updatedFeedbackBody = updatedFeedback.body as CreatedFeedbackResponse;
    expect(updatedFeedbackBody.id).toBe(feedbackId);
    expect(updatedFeedbackBody.createdBy).toBe(teacherId);
    expect(updatedFeedbackBody.createdAt).toBe(feedbackBody.createdAt);
    expect(updatedFeedbackBody.message).toBe(
      'Naming and decomposition should be improved.',
    );
    expect(updatedFeedbackBody.severity).toBe('ERROR');
    expect(updatedFeedbackBody.tags).toEqual(['readability', 'naming']);
    expect(updatedFeedbackBody.scoreHint).toBe(72);
    expect(typeof updatedFeedbackBody.updatedAt).toBe('string');
    const updatedRawFeedback = await feedbackModel.collection.findOne({
      _id: new Types.ObjectId(feedbackId),
    });
    expect(updatedRawFeedback).not.toBeNull();
    expect(updatedRawFeedback?.createdBy).toEqual(persistedFeedback?.createdBy);
    expect(updatedRawFeedback?.createdAt).toEqual(persistedFeedback?.createdAt);

    const feedbackList = await teacherAgent
      .get(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .expect(200);

    const list = feedbackList.body as unknown;
    expect(Array.isArray(list)).toBe(true);

    const listArr = list as unknown[];
    expect(listArr.length).toBeGreaterThanOrEqual(1);
    const updatedListItem = listArr.find((item) => {
      const feedback = item as Record<string, unknown>;
      return feedback.id === feedbackId;
    }) as CreatedFeedbackResponse | undefined;
    expect(updatedListItem?.createdBy).toBe(teacherId);
    expect(updatedListItem?.message).toBe(
      'Naming and decomposition should be improved.',
    );
    expect(typeof updatedListItem?.updatedAt).toBe('string');

    const stats = await teacherAgent
      .get(`/api/learning-tasks/tasks/${taskId}/stats`)
      .expect(200);

    const statsBody = stats.body as TaskStatsResponse;
    expect(statsBody.submissionsCount).toBeGreaterThanOrEqual(1);
    expect(statsBody.distinctStudentsCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps historical teacher feedback read-only when its author is missing, null or another teacher', async () => {
    expect(submissionId).not.toBe('');
    const submissionObjectId = new Types.ObjectId(submissionId);
    const feedbackUrl = `/api/learning-tasks/submissions/${submissionId}/feedback`;
    const readSubmissionFacts = async () => {
      const [submission, feedback, jobs] = await Promise.all([
        submissionModel.collection.findOne(
          { _id: submissionObjectId },
          { maxTimeMS: 10000 },
        ),
        feedbackModel.collection
          .find({ submissionId: submissionObjectId }, { maxTimeMS: 10000 })
          .sort({ _id: 1 })
          .toArray(),
        aiFeedbackJobModel.collection
          .find({ submissionId: submissionObjectId }, { maxTimeMS: 10000 })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      return { submission, feedback, jobs };
    };

    for (const authorState of ['missing', 'null', 'other-teacher']) {
      const created = await teacherAgent
        .post(feedbackUrl)
        .send({
          expectedRevision: 0,
          source: 'TEACHER',
          type: 'STYLE',
          severity: 'WARN',
          message: `Author boundary ${authorState} ${submissionId}`,
          tags: ['other'],
        })
        .expect(201);
      const createdBody = created.body as CreatedFeedbackResponse;
      authorBoundaryFeedbackIds.push(createdBody.id);
      expect(createdBody.createdBy).toBe(teacherId);
      const feedbackObjectId = new Types.ObjectId(createdBody.id);
      const target = {
        _id: feedbackObjectId,
        submissionId: submissionObjectId,
      };
      const injected = await feedbackModel.collection.updateOne(
        target,
        authorState === 'missing'
          ? { $unset: { createdBy: '' } }
          : {
              $set: {
                createdBy:
                  authorState === 'null'
                    ? null
                    : new Types.ObjectId(otherTeacherId),
              },
            },
        { maxTimeMS: 10000 },
      );
      expect(injected.matchedCount).toBe(1);
      expect(injected.modifiedCount).toBe(1);
      const rawFeedback = await feedbackModel.collection.findOne(target, {
        maxTimeMS: 10000,
      });
      expect(rawFeedback).not.toBeNull();
      expect(rawFeedback?.source).toBe(FeedbackSource.Teacher);
      if (authorState === 'missing') {
        expect(rawFeedback).not.toHaveProperty('createdBy');
      } else if (authorState === 'null') {
        expect(rawFeedback).toHaveProperty('createdBy', null);
      } else {
        expect(rawFeedback?.createdBy).toEqual(
          new Types.ObjectId(otherTeacherId),
        );
      }

      const before = await readSubmissionFacts();
      expect(before.submission).not.toBeNull();
      expect(before.submission?.contentRevision).toBe(0);
      expect(before.submission?.reviewStartedAt).toBeInstanceOf(Date);
      expect(before.feedback).toContainEqual(rawFeedback);

      if (authorState === 'missing' || authorState === 'null') {
        for (const reader of [teacherAgent, studentAgent]) {
          const listed = await reader.get(feedbackUrl).expect(200);
          const listedFeedback = listed.body as CreatedFeedbackResponse[];
          const historical = listedFeedback.find(
            (item) => item.id === createdBody.id,
          );
          expect(historical).toBeDefined();
          expect(historical).not.toHaveProperty('createdBy');
          expect(historical?.message).toBe(createdBody.message);
        }
        expect(await readSubmissionFacts()).toEqual(before);
      }

      const rejected = await teacherAgent
        .patch(`${feedbackUrl}/${createdBody.id}`)
        .send({
          type: 'DESIGN',
          severity: 'INFO',
          message: `Rejected author update ${authorState}`,
          suggestion: 'This historical feedback must remain unchanged.',
          tags: ['readability'],
          scoreHint: 99,
        })
        .expect(403);
      expect((rejected.body as InvalidFeedbackTagsResponse).message).toBe(
        'Not allowed to update feedback',
      );
      expect(await readSubmissionFacts()).toEqual(before);
    }
  });
});
