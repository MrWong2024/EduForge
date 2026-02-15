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

/*
$env:NODE_ENV="test"
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
$env:AI_FEEDBACK_WORKER_ENABLED="false"
npm run test:e2e -- classroom-dashboard.e2e-spec.ts
*/
const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom dashboard e2e.');
  }
};

type CreatedCourseResponse = {
  id: string;
  code: string;
};

type CreatedClassroomResponse = {
  id: string;
  joinCode: string;
};

type CreatedTaskResponse = {
  id: string;
  status: string;
};

type CreatedClassroomTaskResponse = {
  id: string;
  taskId: string;
};

type CreatedSubmissionResponse = {
  id: string;
  attemptNo: number;
  aiFeedbackStatus?: string;
};

type TeacherDashboardResponse = {
  summary: { studentsCount: number };
  tasks: Array<{ classroomTaskId: string; taskId: string }>;
};

type StudentDashboardResponse = {
  items: Array<{
    classroom: { id: string; name: string; courseId: string; status: string };
    tasks: Array<{
      classroomTaskId: string;
      taskId: string;
      myLatestSubmission: {
        submissionId: string;
        attemptNo: number;
        createdAt: string;
        aiFeedbackStatus: string;
      } | null;
      mySubmissionsCount: number;
    }>;
  }>;
};

describe('Classroom Dashboards (e2e)', () => {
  jest.setTimeout(30000);
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

  const teacherEmail = `teacher.dashboard.${Date.now()}@example.com`;
  const studentEmail = `student.dashboard.${Date.now()}@example.com`;
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
        transformOptions: { enableImplicitConversion: true },
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

    if (KEEP_DB) {
      await app.close();
      return;
    }

    const cleanup: Promise<unknown>[] = [];
    const userIds = [teacherId, studentId].filter(Boolean);

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
        classroomModel.deleteOne({ _id: new Types.ObjectId(classroomId) }),
      );
    }
    if (courseId) {
      cleanup.push(
        courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
      );
    }
    if (userIds.length > 0) {
      cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
      cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
    }

    await Promise.all(cleanup);
    await app.close();
  });

  it('teacher and student dashboards reflect classroom task and AI status change', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `CS${Date.now()}`,
        name: 'Dashboard 101',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Dash-A',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Dashboard Lab',
        description: 'Check dashboard aggregation.',
        knowledgeModule: 'basics',
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
      .send({
        taskId,
        dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        settings: { allowLate: true, maxAttempts: 3 },
      })
      .expect(201);
    const classroomTaskBody =
      createdClassroomTask.body as CreatedClassroomTaskResponse;
    classroomTaskId = classroomTaskBody.id;

    await studentAgent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBody.joinCode })
      .expect(201);

    const teacherDashboard = await teacherAgent
      .get(`/api/classrooms/${classroomId}/dashboard`)
      .expect(200);
    const teacherBody = teacherDashboard.body as TeacherDashboardResponse;
    expect(teacherBody.summary.studentsCount).toBeGreaterThanOrEqual(1);
    const teacherTaskIds = teacherBody.tasks.map(
      (task) => task.classroomTaskId,
    );
    expect(teacherTaskIds).toContain(classroomTaskId);

    const createdSubmission = await studentAgent
      .post(`/api/learning-tasks/tasks/${taskId}/submissions`)
      .send({
        content: {
          codeText: 'function dashboardLab() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    submissionId = submissionBody.id;

    const studentDashboardBefore = await studentAgent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect(200);
    const studentBodyBefore =
      studentDashboardBefore.body as StudentDashboardResponse;
    const studentClassroom = studentBodyBefore.items.find(
      (item) => item.classroom.id === classroomId,
    );
    expect(studentClassroom).toBeDefined();
    const studentTaskBefore = studentClassroom?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskId,
    );
    expect(studentTaskBefore).toBeDefined();
    expect(studentTaskBefore?.mySubmissionsCount).toBe(1);
    expect(studentTaskBefore?.myLatestSubmission?.submissionId).toBe(
      submissionId,
    );
    expect(studentTaskBefore?.myLatestSubmission?.aiFeedbackStatus).toBe(
      'PENDING',
    );

    await teacherAgent
      .post('/api/learning-tasks/ai-feedback/jobs/process-once')
      .send({})
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Unexpected process-once status ${res.status}, body=${JSON.stringify(res.body)}`,
          );
        }
      });

    const studentDashboardAfter = await studentAgent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect(200);
    const studentBodyAfter =
      studentDashboardAfter.body as StudentDashboardResponse;
    const studentClassroomAfter = studentBodyAfter.items.find(
      (item) => item.classroom.id === classroomId,
    );
    const studentTaskAfter = studentClassroomAfter?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskId,
    );
    expect(studentTaskAfter?.myLatestSubmission?.aiFeedbackStatus).toBe(
      'SUCCEEDED',
    );
  });

  it('enforces classroom member-or-owner and role access boundaries', async () => {
    const outsiderEmail = `student.outsider.${Date.now()}@example.com`;
    const outsiderPassword = 'StudentPass123!';
    const outsiderAgent = request.agent(app.getHttpServer());

    const outsiderHash = await bcrypt.hash(outsiderPassword, 10);
    const outsider = await userModel.create({
      email: outsiderEmail,
      passwordHash: outsiderHash,
      roles: ['student'],
    });

    try {
      await login(teacherAgent, teacherEmail, teacherPassword);
      await login(studentAgent, studentEmail, studentPassword);
      await login(outsiderAgent, outsiderEmail, outsiderPassword);

      const createdCourse = await teacherAgent
        .post('/api/courses')
        .send({
          code: `CS${Date.now()}`,
          name: 'RBAC Class',
          term: '2026-Spring',
        })
        .expect(201);
      const createdCourseBody = createdCourse.body as CreatedCourseResponse;
      courseId = createdCourseBody.id;

      const createdClassroom = await teacherAgent
        .post('/api/classrooms')
        .send({
          courseId,
          name: 'RBAC-A',
        })
        .expect(201);
      const createdClassroomBody =
        createdClassroom.body as CreatedClassroomResponse;
      classroomId = createdClassroomBody.id;

      const createdTask = await teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'RBAC Task',
          description: 'Check member-or-owner guard',
          knowledgeModule: 'basics',
          stage: 1,
          status: 'DRAFT',
        })
        .expect(201);
      const createdTaskBody = createdTask.body as CreatedTaskResponse;
      taskId = createdTaskBody.id;

      await teacherAgent
        .post(`/api/learning-tasks/tasks/${taskId}/publish`)
        .send({})
        .expect(201);

      const createdClassroomTask = await teacherAgent
        .post(`/api/classrooms/${classroomId}/tasks`)
        .send({ taskId })
        .expect(201);
      const createdClassroomTaskBody =
        createdClassroomTask.body as CreatedClassroomTaskResponse;
      classroomTaskId = createdClassroomTaskBody.id;

      await studentAgent
        .post('/api/classrooms/join')
        .send({ joinCode: createdClassroomBody.joinCode })
        .expect(201);

      await outsiderAgent.get(`/api/classrooms/${classroomId}`).expect(403);
      await outsiderAgent.get(`/api/classrooms/${classroomId}/tasks`).expect(403);
      await outsiderAgent
        .get(`/api/classrooms/${classroomId}/tasks/${classroomTaskId}`)
        .expect(403);
      await studentAgent.get(`/api/classrooms/${classroomId}/dashboard`).expect(403);
      await request(app.getHttpServer())
        .get(`/api/classrooms/${classroomId}`)
        .expect(401);
    } finally {
      await sessionModel.deleteMany({ userId: outsider._id });
      await userModel.deleteOne({ _id: outsider._id });
    }
  });
});
