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
import {
  Enrollment,
  EnrollmentStatus,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { EnrollmentService } from '../src/modules/classrooms/enrollments/services/enrollment.service';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';

jest.setTimeout(30000);

const ensureMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required for classroom weekly report e2e.');
  }
};

type CreatedCourseResponse = { id: string };
type CreatedClassroomResponse = { id: string; joinCode: string };
type CreatedTaskResponse = { id: string };
type CreatedClassroomTaskResponse = { id: string };
type CreatedSubmissionResponse = { id: string };

type WeeklyReportJob = Pick<
  AiFeedbackJob,
  'submissionId' | 'taskId' | 'classroomTaskId' | 'studentId' | 'status'
> & { _id: Types.ObjectId };

type WeeklyReportResponse = {
  window: string;
  progress: {
    studentsCount: number;
    publishedClassroomTasks: number;
    dueClassroomTasks: number;
    distinctStudentsSubmitted: number;
    submissionRate: number;
    lateSubmissionsCount: number;
    lateStudentsCount: number;
  };
  atRisk: {
    notSubmittedStudentsCount: number;
    sampleStudentIds: string[];
  };
  aiHealth: {
    jobs: {
      total: number;
      succeeded: number;
      failed: number;
      dead: number;
      pending: number;
      running: number;
    };
    successRate: number;
    errors: Array<{ code: string; count: number }>;
  };
  topTags: Array<{ tag: string; count: number }>;
};

describe('Classroom Weekly Report (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let courseModel: Model<Course>;
  let classroomModel: Model<Classroom>;
  let enrollmentModel: Model<Enrollment>;
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
  let submissionId = '';
  let removedSubmissionId = '';
  let teacherId = '';
  let studentId = '';
  let pendingStudentId = '';
  let removedStudentId = '';
  let previousWorkerEnabled: string | undefined;
  let previousDebugEnabled: string | undefined;

  const stamp = Date.now();
  const teacherEmail = `teacher.weekly.${stamp}@example.com`;
  const studentEmail = `student.weekly.${stamp}@example.com`;
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
    enrollmentModel = app.get(getModelToken(Enrollment.name));
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

    const teacherObjectId = new Types.ObjectId();
    const studentObjectId = new Types.ObjectId();
    const pendingStudentObjectId = new Types.ObjectId();
    const removedStudentObjectId = new Types.ObjectId();
    teacherId = teacherObjectId.toString();
    studentId = studentObjectId.toString();
    pendingStudentId = pendingStudentObjectId.toString();
    removedStudentId = removedStudentObjectId.toString();

    await userModel.create({
      _id: teacherObjectId,
      email: teacherEmail,
      passwordHash: teacherHash,
      roles: ['teacher'],
    });
    await userModel.create({
      _id: studentObjectId,
      email: studentEmail,
      passwordHash: studentHash,
      roles: ['student'],
    });
    await userModel.insertMany([
      {
        _id: pendingStudentObjectId,
        email: `student.weekly.pending.${stamp}@example.com`,
        passwordHash: studentHash,
        roles: ['student'],
      },
      {
        _id: removedStudentObjectId,
        email: `student.weekly.removed.${stamp}@example.com`,
        passwordHash: studentHash,
        roles: ['student'],
      },
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

    const cleanupErrors: unknown[] = [];
    try {
      const cleanup: Promise<unknown>[] = [];
      const userIds = [teacherId, studentId, pendingStudentId, removedStudentId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      const submissionIds = [submissionId, removedSubmissionId]
        .filter(Boolean)
        .map((id) => new Types.ObjectId(id));
      if (submissionIds.length > 0) {
        cleanup.push(
          feedbackModel.deleteMany({ submissionId: { $in: submissionIds } }),
        );
        cleanup.push(
          aiFeedbackJobModel.deleteMany({
            submissionId: { $in: submissionIds },
          }),
        );
        cleanup.push(
          submissionModel.deleteMany({ _id: { $in: submissionIds } }),
        );
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
      if (userIds.length > 0) {
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
      }
      const results = await Promise.allSettled(cleanup);
      for (const result of results) {
        if (result.status === 'rejected') cleanupErrors.push(result.reason);
      }
      if (classroomId) {
        expect(
          await enrollmentModel.countDocuments({
            classroomId: new Types.ObjectId(classroomId),
          }),
        ).toBe(0);
      }
      if (userIds.length > 0) {
        expect(
          await sessionModel.countDocuments({ userId: { $in: userIds } }),
        ).toBe(0);
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try {
        await app?.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Weekly report cleanup failed.');
    }
  });

  it('uses a single active roster for weekly progress and carries it into the snapshot', async () => {
    await login(teacherAgent, teacherEmail, teacherPassword);
    await login(studentAgent, studentEmail, studentPassword);

    const createdCourse = await teacherAgent
      .post('/api/courses')
      .send({
        code: `WEEKLY${Date.now()}`,
        name: 'Weekly Report Course',
        term: '2026-Spring',
      })
      .expect(201);
    courseId = (createdCourse.body as CreatedCourseResponse).id;

    const createdClassroom = await teacherAgent
      .post('/api/classrooms')
      .send({
        courseId,
        name: 'Weekly-Report-Classroom',
      })
      .expect(201);
    const classroomBody = createdClassroom.body as CreatedClassroomResponse;
    classroomId = classroomBody.id;

    const createdTask = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'Weekly Report Task',
        description: 'Task for classroom weekly report e2e.',
        knowledgeModule: 'weekly-report',
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
        dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    classroomTaskId = (
      createdClassroomTask.body as CreatedClassroomTaskResponse
    ).id;

    const emptyReport = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: '7d', includeRiskStudentIds: true })
      .expect(200);
    expect(emptyReport.body).toMatchObject({
      progress: {
        studentsCount: 0,
        distinctStudentsSubmitted: 0,
        submissionRate: 0,
        lateSubmissionsCount: 0,
        lateStudentsCount: 0,
      },
      atRisk: { notSubmittedStudentsCount: 0, sampleStudentIds: [] },
    });

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
          codeText: 'function weeklyReportCheck() { return "ok"; }',
          language: 'typescript',
        },
      })
      .expect(201);
    submissionId = (createdSubmission.body as CreatedSubmissionResponse).id;

    const classroomObjectId = new Types.ObjectId(classroomId);
    const removedStudentObjectId = new Types.ObjectId(removedStudentId);
    await enrollmentModel.insertMany([
      {
        classroomId: classroomObjectId,
        userId: pendingStudentId,
        status: EnrollmentStatus.Active,
      },
      {
        classroomId: classroomObjectId,
        userId: removedStudentObjectId,
        status: EnrollmentStatus.Active,
      },
    ]);
    const removedSubmissionObjectId = new Types.ObjectId();
    removedSubmissionId = removedSubmissionObjectId.toString();
    await submissionModel.create({
      _id: removedSubmissionObjectId,
      classroomTaskId: new Types.ObjectId(classroomTaskId),
      taskId: new Types.ObjectId(taskId),
      studentId: removedStudentObjectId,
      attemptNo: 1,
      isLate: true,
      lateBySeconds: 600,
      content: {
        codeText: 'const historicalAttempt = true;',
        language: 'typescript',
      },
      contentRevision: 0,
      status: SubmissionStatus.Submitted,
    });
    await teacherAgent
      .post(
        `/api/classrooms/${classroomId}/students/${removedStudentId}/remove`,
      )
      .expect(201);
    expect(
      await enrollmentModel.exists({
        classroomId: classroomObjectId,
        userId: removedStudentObjectId,
        status: EnrollmentStatus.Removed,
      }),
    ).not.toBeNull();
    expect(
      await submissionModel.exists({
        _id: removedSubmissionObjectId,
        isLate: true,
      }),
    ).not.toBeNull();

    await teacherAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({ expectedRevision: 0 })
      .expect(200);

    const jobs = await aiFeedbackJobModel
      .find({ submissionId: new Types.ObjectId(submissionId) })
      .select('_id submissionId taskId classroomTaskId studentId status')
      .lean<WeeklyReportJob[]>()
      .exec();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].submissionId.toString()).toBe(submissionId);
    expect(jobs[0].taskId.toString()).toBe(taskId);
    expect(jobs[0].classroomTaskId?.toString()).toBe(classroomTaskId);
    expect(jobs[0].studentId.toString()).toBe(studentId);
    expect(jobs[0].status).toBe(AiFeedbackJobStatus.Pending);

    const processed = await aiFeedbackProcessor.processOnce(5);
    expect(processed.succeeded).toBe(1);
    const completedJob = await aiFeedbackJobModel
      .findById(jobs[0]._id)
      .select('status -_id')
      .lean<Pick<AiFeedbackJob, 'status'>>()
      .exec();
    expect(completedJob?.status).toBe(AiFeedbackJobStatus.Succeeded);

    const enrollmentService = app.get(EnrollmentService);
    const listActiveStudentIds = jest.spyOn(
      enrollmentService,
      'listActiveStudentIds',
    );
    const countStudents = jest.spyOn(enrollmentService, 'countStudents');
    let body: WeeklyReportResponse;
    try {
      const report = await teacherAgent
        .get(`/api/classrooms/${classroomId}/weekly-report`)
        .query({ window: '7d', includeRiskStudentIds: true })
        .expect(200);
      expect(listActiveStudentIds).toHaveBeenCalledTimes(1);
      expect(listActiveStudentIds).toHaveBeenCalledWith(classroomObjectId);
      expect(countStudents).not.toHaveBeenCalled();
      body = report.body as WeeklyReportResponse;
    } finally {
      listActiveStudentIds.mockRestore();
      countStudents.mockRestore();
    }

    expect(body.window).toBe('7d');
    expect(body.progress).toMatchObject({
      studentsCount: 2,
      publishedClassroomTasks: 1,
      distinctStudentsSubmitted: 1,
      submissionRate: 0.5,
      lateSubmissionsCount: 0,
      lateStudentsCount: 0,
    });
    expect(body.atRisk).toEqual({
      notSubmittedStudentsCount: 1,
      sampleStudentIds: [pendingStudentId],
    });
    expect(
      body.progress.distinctStudentsSubmitted +
        body.atRisk.notSubmittedStudentsCount,
    ).toBe(body.progress.studentsCount);
    expect(body.aiHealth.jobs.total).toBe(1);
    expect(body.aiHealth.jobs.succeeded).toBe(1);
    expect(body.aiHealth.successRate).toBe(1);
    expect(Array.isArray(body.topTags)).toBe(true);

    const snapshot = await teacherAgent
      .get(`/api/classrooms/${classroomId}/export/snapshot`)
      .query({ window: '7d', includePerTask: false })
      .expect(200);
    const snapshotSummary = snapshot.body as {
      summary: { progress: WeeklyReportResponse['progress'] };
    };
    expect(snapshotSummary.summary.progress).toEqual(body.progress);

    const defaultWindowReport = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .expect(200);
    const defaultWindowBody = defaultWindowReport.body as WeeklyReportResponse;
    expect(defaultWindowBody.window).toBe('all');

    const allWindowReport = await teacherAgent
      .get(`/api/classrooms/${classroomId}/weekly-report`)
      .query({ window: 'all' })
      .expect(200);
    const allWindowBody = allWindowReport.body as WeeklyReportResponse;

    expect(defaultWindowBody.progress).toEqual(allWindowBody.progress);
    expect(allWindowBody.atRisk).toEqual({
      notSubmittedStudentsCount: 1,
      sampleStudentIds: [],
    });
    expect(defaultWindowBody.aiHealth.jobs).toEqual(
      allWindowBody.aiHealth.jobs,
    );
  });
});
