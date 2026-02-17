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

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom export snapshot e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string };
type SnapshotResponse = {
  meta: {
    generatedAt: string;
    notes: string[];
  };
  students: {
    total: number;
  };
  classroomTasks: Array<{ classroomTaskId: string }>;
  statsByClassroomTask: unknown[];
  processAssessment: {
    items: unknown[];
  };
};

describe('Classroom Export Snapshot (e2e)', () => {
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
  let studentAgent: ReturnType<typeof request.agent>;

  let teacherId = '';
  let studentId = '';
  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  let submissionId = '';

  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.snapshot.${Date.now()}@example.com`;
  const studentEmail = `student.snapshot.${Date.now()}@example.com`;
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
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    const [teacher, student] = await Promise.all([
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

    teacherId = teacher._id.toString();
    studentId = student._id.toString();

    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);
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

    if (!KEEP_DB) {
      const cleanup: Promise<unknown>[] = [];
      if (submissionId) {
        const submissionObjectId = new Types.ObjectId(submissionId);
        cleanup.push(
          feedbackModel.deleteMany({ submissionId: submissionObjectId }),
        );
        cleanup.push(
          aiFeedbackJobModel.deleteMany({ submissionId: submissionObjectId }),
        );
        cleanup.push(submissionModel.deleteOne({ _id: submissionObjectId }));
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
          classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
        );
      }
      if (courseId) {
        cleanup.push(
          courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
        );
      }
      const userIds = [teacherId, studentId]
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

  it('exports sanitized classroom snapshot and supports per-task omission', async () => {
    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `SNAP${Date.now()}`,
        name: 'Snapshot Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Snapshot-Class',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Snapshot Task',
        description: 'Snapshot aggregation task.',
        knowledgeModule: 'snapshot',
        stage: 1,
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
      .send({
        taskId,
        dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
        settings: {
          allowLate: true,
        },
      })
      .expect(201);
    classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const createdSubmission = await studentAgent
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function snapshotLateSubmission() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionId = (createdSubmission.body as CreatedSubmissionResponse).id;

    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({ reason: 'snapshot-export-test' })
      .expect(200);

    const snapshot = await teacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .query({ window: 'term' })
      .expect(200);
    const body = snapshot.body as SnapshotResponse;

    expect(typeof body.meta.generatedAt).toBe('string');
    expect(Array.isArray(body.classroomTasks)).toBe(true);
    expect(body.classroomTasks.length).toBeGreaterThanOrEqual(1);
    expect(body.students.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.processAssessment.items)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('codeText');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('apiKey');

    const withoutPerTask = await teacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .query({ includePerTask: 'false' })
      .expect(200);
    const withoutPerTaskBody = withoutPerTask.body as SnapshotResponse;

    expect(withoutPerTaskBody.statsByClassroomTask).toEqual([]);
    const hasOmittedNote = (withoutPerTaskBody.meta.notes ?? []).some((note) =>
      note.toLowerCase().includes('pertask omitted'),
    );
    expect(hasOmittedNote).toBe(true);
  });
});
