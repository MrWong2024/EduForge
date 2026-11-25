import {
  assertAuthTestConnection,
  authTestEnvironment,
} from './helpers/auth-test-environment';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Aggregate, Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackJob } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../src/lib/classroom-task-transaction';

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
  contentRevision: number;
  createdAt: string;
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
      completionStatus: {
        status: string;
        latestSubmissionId: string | null;
        teacherFeedbackCount: number;
        aiFeedbackCount: number;
      };
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

  const teacherId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  let courseId = '';
  let classroomId = '';
  let classroomTaskId = '';
  let taskId = '';
  const ownedCourseIds: Types.ObjectId[] = [];
  const ownedClassroomIds: Types.ObjectId[] = [];
  const ownedTaskIds: Types.ObjectId[] = [];
  const ownedInstanceIds: Types.ObjectId[] = [];
  const ownedSubmissionIds: Types.ObjectId[] = [];
  const ownedUserIds = [teacherId, studentId];
  let databaseVerified = false;

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

  const createAdditionalTask = async (title: string): Promise<string> => {
    const response = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title,
        description: 'Check dashboard aggregation.',
        knowledgeModule: 'basics',
        status: 'DRAFT',
      })
      .expect(201);
    const template = response.body as CreatedTaskResponse;
    ownedTaskIds.push(new Types.ObjectId(template.id));
    await teacherAgent
      .post(`/api/learning-tasks/tasks/${template.id}/publish`)
      .send({})
      .expect(201);
    const published = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({ taskId: template.id })
      .expect(201);
    const instance = published.body as CreatedClassroomTaskResponse;
    ownedInstanceIds.push(new Types.ObjectId(instance.id));
    return instance.id;
  };

  beforeAll(async () => {
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
    userModel = app.get(getModelToken(User.name));
    await assertAuthTestConnection(userModel.db);
    await assertAuthTestConnection(
      app.get<Connection>(
        getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
      ),
    );
    await app.init();

    teacherAgent = request.agent(app.getHttpServer());
    studentAgent = request.agent(app.getHttpServer());

    sessionModel = app.get(getModelToken(Session.name));
    courseModel = app.get(getModelToken(Course.name));
    classroomModel = app.get(getModelToken(Classroom.name));
    classroomTaskModel = app.get(getModelToken(ClassroomTask.name));
    taskModel = app.get(getModelToken(Task.name));
    submissionModel = app.get(getModelToken(Submission.name));
    feedbackModel = app.get(getModelToken(Feedback.name));
    aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
    databaseVerified = true;

    const [teacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);

    await Promise.all([
      userModel.create({
        _id: teacherId,
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      }),
      userModel.create({
        _id: studentId,
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      }),
    ]);
  });

  afterAll(async () => {
    try {
      if (!databaseVerified) return;
      await assertAuthTestConnection(userModel.db);
      const ownedSubmissionRef = { submissionId: { $in: ownedSubmissionIds } };
      await feedbackModel.deleteMany(ownedSubmissionRef);
      await aiFeedbackJobModel.deleteMany(ownedSubmissionRef);
      await submissionModel.deleteMany({ _id: { $in: ownedSubmissionIds } });
      await classroomTaskModel.deleteMany({ _id: { $in: ownedInstanceIds } });
      await taskModel.deleteMany({ _id: { $in: ownedTaskIds } });
      const enrollmentModel = app.get<Model<Enrollment>>(
        getModelToken(Enrollment.name),
      );
      await enrollmentModel.deleteMany({
        classroomId: { $in: ownedClassroomIds },
      });
      await classroomModel.deleteMany({ _id: { $in: ownedClassroomIds } });
      await courseModel.deleteMany({ _id: { $in: ownedCourseIds } });
      await sessionModel.deleteMany({ userId: { $in: ownedUserIds } });
      await userModel.deleteMany({ _id: { $in: ownedUserIds } });
      expect(await feedbackModel.countDocuments(ownedSubmissionRef)).toBe(0);
      expect(await aiFeedbackJobModel.countDocuments(ownedSubmissionRef)).toBe(
        0,
      );
      expect(
        await submissionModel.countDocuments({
          _id: { $in: ownedSubmissionIds },
        }),
      ).toBe(0);
      expect(
        await enrollmentModel.countDocuments({
          classroomId: { $in: ownedClassroomIds },
        }),
      ).toBe(0);
      expect(
        await sessionModel.countDocuments({ userId: { $in: ownedUserIds } }),
      ).toBe(0);
      expect(
        await userModel.countDocuments({ _id: { $in: ownedUserIds } }),
      ).toBe(0);
      expect(
        await classroomModel.countDocuments({
          _id: { $in: ownedClassroomIds },
        }),
      ).toBe(0);
      console.info('Dashboard fixture cleanup verified');
    } finally {
      try {
        await app?.close();
      } finally {
        authTestEnvironment.restore();
      }
    }
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
    ownedCourseIds.push(new Types.ObjectId(courseId));

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Dash-A',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;
    ownedClassroomIds.push(new Types.ObjectId(classroomId));

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Dashboard Lab',
        description: 'Check dashboard aggregation.',
        knowledgeModule: 'basics',
        status: 'DRAFT',
      })
      .expect(201);
    const taskBody = createdTask.body as CreatedTaskResponse;
    taskId = taskBody.id;
    ownedTaskIds.push(new Types.ObjectId(taskId));

    await teacherAgent
      .post(`/api/learning-tasks/tasks/${taskId}/publish`)
      .send({})
      .expect(201);

    const createdClassroomTask = await teacherAgent
      .post(`/api/classrooms/${classroomId}/tasks`)
      .send({
        taskId,
        dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        settings: {
          allowLate: true,
        },
      })
      .expect(201);
    const classroomTaskBody =
      createdClassroomTask.body as CreatedClassroomTaskResponse;
    classroomTaskId = classroomTaskBody.id;
    ownedInstanceIds.push(new Types.ObjectId(classroomTaskId));

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
      .post(
        `/api/classrooms/${classroomId}/tasks/${classroomTaskId}/submissions`,
      )
      .send({
        content: {
          codeText: 'function dashboardLab() { return true; }',
          language: 'typescript',
        },
      })
      .expect(201);
    const submissionBody = createdSubmission.body as CreatedSubmissionResponse;
    const submissionId = submissionBody.id;
    const oldSubmissionId = new Types.ObjectId(submissionId);
    ownedSubmissionIds.push(oldSubmissionId);
    await studentAgent
      .post(
        '/api/learning-tasks/submissions/' +
          submissionBody.id +
          '/ai-feedback/request',
      )
      .send({ expectedRevision: submissionBody.contentRevision })
      .expect(200);

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

    // The real processor can claim from the entire test database by default.
    const findOneAndUpdate = aiFeedbackJobModel.findOneAndUpdate.bind(
      aiFeedbackJobModel,
    ) as typeof aiFeedbackJobModel.findOneAndUpdate;
    const ownJob = jest
      .spyOn(aiFeedbackJobModel, 'findOneAndUpdate')
      .mockImplementation((...args) =>
        findOneAndUpdate(...args)
          .where('submissionId')
          .equals(oldSubmissionId),
      );
    try {
      await teacherAgent
        .post('/api/learning-tasks/ai-feedback/jobs/process-once')
        .send({ batchSize: 1 })
        .expect(201);
    } finally {
      ownJob.mockRestore();
    }

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

    await teacherAgent
      .post(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .send({
        expectedRevision: submissionBody.contentRevision,
        source: 'TEACHER',
        type: 'BUG',
        severity: 'ERROR',
        message: 'Synthetic error belonging to the old attempt',
      })
      .expect(201);

    const olderCreatedAt = new Date('2024-01-01T00:00:00.000Z');
    // Seed a known historical row and a skipped attempt without bypassing any indexes.
    const storedHistory = await submissionModel.updateOne(
      { _id: oldSubmissionId },
      {
        $set: {
          status: SubmissionStatus.Evaluated,
          'content.codeText': '/* historical dashboard source */\n'.repeat(512),
          'content.submissionNote': 'Historical dashboard note\n'.repeat(256),
        },
      },
    );
    expect(storedHistory.matchedCount).toBe(1);
    expect(new Date(submissionBody.createdAt).getTime()).toBeGreaterThan(
      olderCreatedAt.getTime(),
    );
    const latestSubmissionId = new Types.ObjectId();
    ownedSubmissionIds.push(latestSubmissionId);
    await submissionModel.collection.insertOne({
      _id: latestSubmissionId,
      studentId,
      taskId: new Types.ObjectId(taskId),
      classroomTaskId: new Types.ObjectId(classroomTaskId),
      attemptNo: 4,
      createdAt: olderCreatedAt,
      updatedAt: olderCreatedAt,
      submittedAt: olderCreatedAt,
      isLate: false,
      lateBySeconds: 0,
      status: SubmissionStatus.Submitted,
      contentRevision: 0,
      content: { codeText: 'return 4;', language: 'typescript' },
    });

    const pendingTaskId = await createAdditionalTask('Pending dashboard lab');
    const emptyTaskId = await createAdditionalTask('Empty dashboard lab');
    const pendingResponse = await studentAgent
      .post(`/api/classrooms/${classroomId}/tasks/${pendingTaskId}/submissions`)
      .send({ content: { codeText: 'return 1;', language: 'typescript' } })
      .expect(201);
    const pending = pendingResponse.body as CreatedSubmissionResponse;
    const pendingSubmissionId = new Types.ObjectId(pending.id);
    ownedSubmissionIds.push(pendingSubmissionId);
    await studentAgent
      .post(`/api/learning-tasks/submissions/${pending.id}/ai-feedback/request`)
      .send({ expectedRevision: pending.contentRevision })
      .expect(200);

    const matchingRows = await submissionModel.countDocuments({
      studentId,
      classroomTaskId: {
        $in: [classroomTaskId, pendingTaskId, emptyTaskId].map(
          (id) => new Types.ObjectId(id),
        ),
      },
    });
    expect(matchingRows).toBe(3);

    const aggregateSpy = jest.spyOn(submissionModel, 'aggregate');
    const execSpy = jest.spyOn(Aggregate.prototype, 'exec');
    const statusSpy = jest.spyOn(
      app.get(AiFeedbackJobService),
      'getStatusMapBySubmissionIds',
    );
    try {
      const dashboard = await studentAgent
        .get('/api/classrooms/mine/dashboard')
        .query({ status: 'ACTIVE', page: 1, limit: 20 })
        .expect(200);
      const body = dashboard.body as StudentDashboardResponse;
      const tasks = body.items.find(
        (item) => item.classroom.id === classroomId,
      )?.tasks;
      expect(tasks).toHaveLength(3);
      const findTask = (id: string) =>
        tasks?.find((task) => task.classroomTaskId === id);
      expect(findTask(classroomTaskId)).toMatchObject({
        mySubmissionsCount: 2,
        myLatestSubmission: {
          submissionId: latestSubmissionId.toString(),
          attemptNo: 4,
          createdAt: olderCreatedAt.toISOString(),
          aiFeedbackStatus: 'NOT_REQUESTED',
        },
        completionStatus: {
          status: 'NO_FEEDBACK',
          latestSubmissionId: latestSubmissionId.toString(),
          teacherFeedbackCount: 0,
          aiFeedbackCount: 0,
        },
      });
      expect(findTask(pendingTaskId)).toMatchObject({
        mySubmissionsCount: 1,
        myLatestSubmission: {
          submissionId: pending.id,
          attemptNo: 1,
          aiFeedbackStatus: 'PENDING',
        },
        completionStatus: {
          status: 'NO_FEEDBACK',
          latestSubmissionId: pending.id,
        },
      });
      expect(findTask(emptyTaskId)).toMatchObject({
        mySubmissionsCount: 0,
        myLatestSubmission: null,
        completionStatus: {
          status: 'NOT_SUBMITTED',
          latestSubmissionId: null,
        },
      });

      expect(aggregateSpy).toHaveBeenCalledTimes(1);
      const aggregation: unknown = aggregateSpy.mock.results[0]?.value;
      const execIndex = execSpy.mock.contexts.indexOf(aggregation);
      const result = execSpy.mock.results[execIndex];
      if (result?.type !== 'return') {
        throw new Error('The dashboard did not execute the submission query');
      }
      const aggregateRows: unknown = await result.value;
      if (!Array.isArray(aggregateRows)) {
        throw new Error('Expected a row list from MongoDB');
      }
      expect(aggregateRows).toHaveLength(2);
      expect(aggregateRows).toEqual(
        expect.arrayContaining([
          {
            _id: new Types.ObjectId(classroomTaskId),
            count: 2,
            latest: {
              _id: latestSubmissionId,
              attemptNo: 4,
              createdAt: olderCreatedAt,
            },
          },
          {
            _id: new Types.ObjectId(pendingTaskId),
            count: 1,
            latest: {
              _id: pendingSubmissionId,
              attemptNo: 1,
              createdAt: new Date(pending.createdAt),
            },
          },
        ]),
      );
      expect(statusSpy).toHaveBeenCalledTimes(1);
      expect(statusSpy).toHaveBeenCalledWith(
        expect.arrayContaining([latestSubmissionId, pendingSubmissionId]),
      );
      const queriedIds = statusSpy.mock.calls[0]?.[0];
      expect(queriedIds).toHaveLength(2);
      const firstRow = aggregateRows[0] as {
        latest: { _id: Types.ObjectId; attemptNo: number; createdAt: Date };
      };
      console.info(
        JSON.stringify({
          dashboardSubmissionEvidence: {
            matchingRows,
            aggregationRows: aggregateRows.length,
            fields: Object.keys(firstRow),
            latestFields: Object.keys(firstRow.latest),
            previousSubmissionId: submissionId,
            latestSubmissionIds: queriedIds?.map((id) => id.toString()),
            statusBatches: statusSpy.mock.calls.length,
            skippedAttemptLatest: latestSubmissionId.toString(),
            pendingLatest: pending.id,
          },
        }),
      );
    } finally {
      statusSpy.mockRestore();
      execSpy.mockRestore();
      aggregateSpy.mockRestore();
    }
  });

  it('enforces classroom member-or-owner and role access boundaries', async () => {
    const outsiderEmail = `student.outsider.${Date.now()}@example.com`;
    const outsiderPassword = 'StudentPass123!';
    const outsiderAgent = request.agent(app.getHttpServer());

    const outsiderHash = await bcrypt.hash(outsiderPassword, 10);
    const outsider = await userModel.create({
      _id: new Types.ObjectId(),
      email: outsiderEmail,
      passwordHash: outsiderHash,
      roles: ['student'],
    });
    ownedUserIds.push(outsider._id);

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
      ownedCourseIds.push(new Types.ObjectId(courseId));

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
      ownedClassroomIds.push(new Types.ObjectId(classroomId));

      const createdTask = await teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'RBAC Task',
          description: 'Check member-or-owner guard',
          knowledgeModule: 'basics',
          status: 'DRAFT',
        })
        .expect(201);
      const createdTaskBody = createdTask.body as CreatedTaskResponse;
      taskId = createdTaskBody.id;
      ownedTaskIds.push(new Types.ObjectId(taskId));

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
      ownedInstanceIds.push(new Types.ObjectId(classroomTaskId));

      await studentAgent
        .post('/api/classrooms/join')
        .send({ joinCode: createdClassroomBody.joinCode })
        .expect(201);

      await outsiderAgent.get(`/api/classrooms/${classroomId}`).expect(403);
      await outsiderAgent
        .get(`/api/classrooms/${classroomId}/tasks`)
        .expect(403);
      await outsiderAgent
        .get(`/api/classrooms/${classroomId}/tasks/${classroomTaskId}`)
        .expect(403);
      await studentAgent
        .get(`/api/classrooms/${classroomId}/dashboard`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/classrooms/${classroomId}`)
        .expect(401);
    } finally {
      await sessionModel.deleteMany({ userId: outsider._id });
      await userModel.deleteOne({ _id: outsider._id });
    }
  });
});
