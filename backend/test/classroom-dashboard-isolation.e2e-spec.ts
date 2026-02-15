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

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is required for classroom dashboard isolation e2e.',
    );
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
};

type TeacherDashboardTask = {
  classroomTaskId: string;
  submissionsCount: number;
  distinctStudentsSubmitted: number;
};

type TeacherDashboardResponse = {
  tasks: TeacherDashboardTask[];
};

type StudentDashboardTask = {
  classroomTaskId: string;
  mySubmissionsCount: number;
  myLatestSubmission: { submissionId: string } | null;
};

type StudentDashboardResponse = {
  items: Array<{
    classroom: { id: string };
    tasks: StudentDashboardTask[];
  }>;
};

describe('Classroom Dashboard Isolation (e2e)', () => {
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
  let student1Agent: ReturnType<typeof request.agent>;
  let student2Agent: ReturnType<typeof request.agent>;

  const createdClassroomIds: string[] = [];
  const createdClassroomTaskIds: string[] = [];
  const createdSubmissionIds: string[] = [];
  let courseId = '';
  let taskId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.iso.${Date.now()}@example.com`;
  const student1Email = `student1.iso.${Date.now()}@example.com`;
  const student2Email = `student2.iso.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const student1Password = 'StudentPass123!';
  const student2Password = 'StudentPass234!';

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
    student1Agent = request.agent(app.getHttpServer());
    student2Agent = request.agent(app.getHttpServer());

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));

    const [teacherHash, student1Hash, student2Hash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(student1Password, 10),
      bcrypt.hash(student2Password, 10),
    ]);

    await Promise.all([
      userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        email: student1Email,
        passwordHash: student1Hash,
        roles: ['student'],
      }),
      userModel.create({
        email: student2Email,
        passwordHash: student2Hash,
        roles: ['student'],
      }),
    ]);
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
    if (createdSubmissionIds.length > 0) {
      const submissionObjectIds = createdSubmissionIds.map(
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
    if (createdClassroomTaskIds.length > 0) {
      cleanup.push(
        classroomTaskModel.deleteMany({
          _id: {
            $in: createdClassroomTaskIds.map((id) => new Types.ObjectId(id)),
          },
        }),
      );
    }
    if (taskId) {
      cleanup.push(taskModel.deleteOne({ _id: new Types.ObjectId(taskId) }));
    }
    if (createdClassroomIds.length > 0) {
      cleanup.push(
        classroomModel.deleteMany({
          _id: { $in: createdClassroomIds.map((id) => new Types.ObjectId(id)) },
        }),
      );
    }
    if (courseId) {
      cleanup.push(
        courseModel.deleteOne({ _id: new Types.ObjectId(courseId) }),
      );
    }

    const users = await userModel
      .find({ email: { $in: [teacherEmail, student1Email, student2Email] } })
      .select('_id')
      .lean()
      .exec();
    const userIds = users.map((user) => user._id.toString());
    if (userIds.length > 0) {
      cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
      cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
    }

    await Promise.all(cleanup);
    await app.close();
  });

  it('isolates submissions and AI stats per classroomTaskId', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(student1Agent, student1Email, student1Password);
    await login(student2Agent, student2Email, student2Password);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `CS${Date.now()}`,
        name: 'Isolation 101',
        term: '2026-Spring',
      })
      .expect(201);
    const courseBody = createdCourse.body as CreatedCourseResponse;
    courseId = courseBody.id;

    const classroomA = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Classroom A' })
      .expect(201);
    const classroomABody = classroomA.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomABody.id);

    const classroomB = await teacherAgent
      .post('/api/classrooms')
      .send({ courseId, name: 'Classroom B' })
      .expect(201);
    const classroomBBody = classroomB.body as CreatedClassroomResponse;
    createdClassroomIds.push(classroomBBody.id);

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Shared Task',
        description: 'Shared across classrooms.',
        knowledgeModule: 'isolation',
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

    const classroomTaskA = await teacherAgent
      .post(`/api/classrooms/${classroomABody.id}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskABody =
      classroomTaskA.body as CreatedClassroomTaskResponse;
    createdClassroomTaskIds.push(classroomTaskABody.id);

    const classroomTaskB = await teacherAgent
      .post(`/api/classrooms/${classroomBBody.id}/tasks`)
      .send({ taskId })
      .expect(201);
    const classroomTaskBBody =
      classroomTaskB.body as CreatedClassroomTaskResponse;
    createdClassroomTaskIds.push(classroomTaskBBody.id);

    await student1Agent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomABody.joinCode })
      .expect(201);
    await student2Agent
      .post('/api/classrooms/join')
      .send({ joinCode: classroomBBody.joinCode })
      .expect(201);

    const submissionA = await student1Agent
      .post(
        `/api/classrooms/${classroomABody.id}/tasks/${classroomTaskABody.id}/submissions`,
      )
      .send({
        content: {
          codeText: 'function isolatedA() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionABody = submissionA.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(submissionABody.id);

    const submissionB = await student2Agent
      .post(
        `/api/classrooms/${classroomBBody.id}/tasks/${classroomTaskBBody.id}/submissions`,
      )
      .send({
        content: {
          codeText: 'function isolatedB() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBBody = submissionB.body as CreatedSubmissionResponse;
    createdSubmissionIds.push(submissionBBody.id);

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

    const teacherDashboardA = await teacherAgent
      .get(`/api/classrooms/${classroomABody.id}/dashboard`)
      .expect(200);
    const teacherBodyA = teacherDashboardA.body as TeacherDashboardResponse;
    const taskA = teacherBodyA.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    expect(taskA).toBeDefined();
    expect(taskA?.submissionsCount).toBe(1);
    expect(taskA?.distinctStudentsSubmitted).toBe(1);

    const teacherDashboardB = await teacherAgent
      .get(`/api/classrooms/${classroomBBody.id}/dashboard`)
      .expect(200);
    const teacherBodyB = teacherDashboardB.body as TeacherDashboardResponse;
    const taskB = teacherBodyB.tasks.find(
      (task) => task.classroomTaskId === classroomTaskBBody.id,
    );
    expect(taskB).toBeDefined();
    expect(taskB?.submissionsCount).toBe(1);
    expect(taskB?.distinctStudentsSubmitted).toBe(1);

    const student1Dashboard = await student1Agent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect((res) => {
        if (res.status !== 200) {
          // 直接把 400 的校验错误打印出来
          console.log('student dashboard error', res.status, res.body);
        }
      });
    const student1Body = student1Dashboard.body as StudentDashboardResponse;
    const student1ClassA = student1Body.items.find(
      (item) => item.classroom.id === classroomABody.id,
    );
    const student1ClassB = student1Body.items.find(
      (item) => item.classroom.id === classroomBBody.id,
    );
    const student1TaskA = student1ClassA?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    const student1TaskB = student1ClassB?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskBBody.id,
    );
    expect(student1TaskA?.mySubmissionsCount).toBe(1);
    expect(student1TaskA?.myLatestSubmission).toBeDefined();
    expect(student1TaskB?.mySubmissionsCount ?? 0).toBe(0);
    expect(student1TaskB?.myLatestSubmission ?? null).toBeNull();

    const student2Dashboard = await student2Agent
      .get('/api/classrooms/mine/dashboard')
      .query({ status: 'ACTIVE', page: 1, limit: 20 })
      .expect(200);
    const student2Body = student2Dashboard.body as StudentDashboardResponse;
    const student2ClassA = student2Body.items.find(
      (item) => item.classroom.id === classroomABody.id,
    );
    const student2ClassB = student2Body.items.find(
      (item) => item.classroom.id === classroomBBody.id,
    );
    const student2TaskA = student2ClassA?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskABody.id,
    );
    const student2TaskB = student2ClassB?.tasks.find(
      (task) => task.classroomTaskId === classroomTaskBBody.id,
    );
    expect(student2TaskB?.mySubmissionsCount).toBe(1);
    expect(student2TaskB?.myLatestSubmission).toBeDefined();
    expect(student2TaskA?.mySubmissionsCount ?? 0).toBe(0);
    expect(student2TaskA?.myLatestSubmission ?? null).toBeNull();
  });
});
