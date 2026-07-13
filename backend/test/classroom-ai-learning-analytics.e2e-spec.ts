import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Course } from '../src/modules/courses/schemas/course.schema';
import {
  Classroom,
  ClassroomStatus,
} from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Enrollment,
  EnrollmentRole,
  EnrollmentStatus,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import {
  Task,
  TaskStatus,
} from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionStatus,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { User } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

type AnalyticsOverview = {
  context: {
    classroomId: string;
    courseId: string;
    window: string;
    effectiveTaskCount: number;
    excludedTaskIds: string[];
  };
  methodology: {
    scope: string;
    sampleUnit: string;
    qualityProxy: string;
    disclaimer: string;
  };
  summary: {
    activeStudentsCount: number;
    submittedStudentTaskCount: number;
    aiRequestedStudentTaskCount: number;
    aiDeliveredStudentTaskCount: number;
    postFeedbackResubmittedStudentTaskCount: number;
    postFeedbackCodeChangedStudentTaskCount: number;
    qualityComparableStudentTaskCount: number;
    improvedStudentTaskCount: number;
    stableStudentTaskCount: number;
    regressedStudentTaskCount: number;
    aiStudentCoverageRate: number;
    aiTaskCoverageRate: number;
    aiDeliveryRate: number;
    postFeedbackResubmissionRate: number;
    postFeedbackCodeChangeRate: number;
    qualityComparableRate: number;
    improvedRate: number;
    averageIssueLoadBefore: number;
    averageIssueLoadAfter: number;
    averageIssueLoadDelta: number;
  };
  taskTrends: Array<{
    classroomTaskId: string;
    submittedStudentCount: number;
    aiRequestedStudentCount: number;
    aiDeliveredStudentCount: number;
    postFeedbackResubmittedStudentCount: number;
    postFeedbackCodeChangedStudentCount: number;
    qualityComparableStudentCount: number;
    improvedStudentCount: number;
    stableStudentCount: number;
    regressedStudentCount: number;
    publishedAt: string;
  }>;
};

type AnalyticsStudentList = {
  page: number;
  limit: number;
  total: number;
  items: Array<{
    studentId: string;
    studentName: string;
    studentNo: string | null;
    submittedTasksCount: number;
    aiRequestedTasksCount: number;
    aiDeliveredTasksCount: number;
    postFeedbackResubmittedTasksCount: number;
    postFeedbackCodeChangedTasksCount: number;
    qualityComparableTasksCount: number;
    improvedTasksCount: number;
    stableTasksCount: number;
    regressedTasksCount: number;
    growthTrend: string;
  }>;
};

type AnalyticsStudentDetail = {
  student: {
    studentId: string;
    studentName: string;
    studentNo: string | null;
  };
  summary: Omit<
    AnalyticsStudentList['items'][number],
    'studentId' | 'studentName' | 'studentNo'
  >;
  taskPoints: Array<{
    classroomTaskId: string;
    attemptsCount: number;
    aiRequested: boolean;
    aiDelivered: boolean;
    postFeedbackResubmitted: boolean;
    postFeedbackCodeChanged: boolean;
    qualityComparable: boolean;
    issueLoadBefore: number | null;
    issueLoadAfter: number | null;
    issueLoadDelta: number | null;
    outcome: string;
  }>;
};

describe('Classroom AI learning analytics (e2e)', () => {
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
  let otherTeacherAgent: ReturnType<typeof request.agent>;
  let activeStudentAgent: ReturnType<typeof request.agent>;

  const createdUserIds: Types.ObjectId[] = [];
  const createdCourseIds: Types.ObjectId[] = [];
  const createdClassroomIds: Types.ObjectId[] = [];
  const createdTaskIds: Types.ObjectId[] = [];
  const createdClassroomTaskIds: Types.ObjectId[] = [];
  const createdSubmissionIds: Types.ObjectId[] = [];

  let teacherId: Types.ObjectId;
  let otherTeacherId: Types.ObjectId;
  let activeStudentId: Types.ObjectId;
  let zeroSubmissionStudentId: Types.ObjectId;
  let removedStudentId: Types.ObjectId;
  let foreignStudentId: Types.ObjectId;
  let courseId: Types.ObjectId;
  let classroomId: Types.ObjectId;
  let otherClassroomId: Types.ObjectId;
  let improvedClassroomTaskId: Types.ObjectId;
  let stableClassroomTaskId: Types.ObjectId;
  let regressedClassroomTaskId: Types.ObjectId;
  let zeroSubmissionClassroomTaskId: Types.ObjectId;
  let failedClassroomTaskId: Types.ObjectId;
  let earlyOnlyClassroomTaskId: Types.ObjectId;
  let otherClassroomTaskId: Types.ObjectId;

  const teacherEmail = `teacher.ai.analytics.${Date.now()}@example.com`;
  const otherTeacherEmail = `teacher.other.ai.analytics.${Date.now()}@example.com`;
  const activeStudentEmail = `student.active.ai.analytics.${Date.now()}@example.com`;
  const zeroStudentEmail = `student.zero.ai.analytics.${Date.now()}@example.com`;
  const removedStudentEmail = `student.removed.ai.analytics.${Date.now()}@example.com`;
  const foreignStudentEmail = `student.foreign.ai.analytics.${Date.now()}@example.com`;
  const teacherPassword = 'TeacherPass123!';
  const studentPassword = 'StudentPass123!';

  let previousWorkerEnabled: string | undefined;
  let previousProvider: string | undefined;

  const login = async (
    agent: ReturnType<typeof request.agent>,
    email: string,
    password: string,
  ) => {
    await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect((response) => {
        if (![200, 201].includes(response.status)) {
          throw new Error(
            `Unexpected login status ${response.status}: ${JSON.stringify(response.body)}`,
          );
        }
      });
  };

  const createSubmission = async (params: {
    classroomTaskId: Types.ObjectId;
    taskId: Types.ObjectId;
    studentId: Types.ObjectId;
    attemptNo: number;
    submittedAt: Date;
    codeText: string;
  }) => {
    const created = await submissionModel.create({
      classroomTaskId: params.classroomTaskId,
      taskId: params.taskId,
      studentId: params.studentId,
      attemptNo: params.attemptNo,
      submittedAt: params.submittedAt,
      isLate: false,
      lateBySeconds: 0,
      content: {
        codeText: params.codeText,
        language: 'typescript',
      },
      status: SubmissionStatus.Submitted,
    });
    createdSubmissionIds.push(created._id);
    return created;
  };

  const insertJob = async (params: {
    submissionId: Types.ObjectId;
    taskId: Types.ObjectId;
    classroomTaskId: Types.ObjectId;
    studentId: Types.ObjectId;
    status: AiFeedbackJobStatus;
    updatedAt: Date;
  }) => {
    await aiFeedbackJobModel.collection.insertOne({
      _id: new Types.ObjectId(),
      submissionId: params.submissionId,
      taskId: params.taskId,
      classroomTaskId: params.classroomTaskId,
      studentId: params.studentId,
      status: params.status,
      attempts: params.status === AiFeedbackJobStatus.Failed ? 1 : 0,
      maxAttempts: 3,
      notBefore: null,
      createdAt: new Date(params.updatedAt.getTime() - 1000),
      updatedAt: params.updatedAt,
    });
  };

  const insertFeedback = async (params: {
    submissionId: Types.ObjectId;
    severity: FeedbackSeverity;
    source?: FeedbackSource;
  }) => {
    await feedbackModel.create({
      submissionId: params.submissionId,
      source: params.source ?? FeedbackSource.AI,
      type: FeedbackType.Other,
      severity: params.severity,
      message: `Controlled analytics feedback ${new Types.ObjectId().toString()}`,
    });
  };

  beforeAll(async () => {
    previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
    previousProvider = process.env.AI_FEEDBACK_PROVIDER;
    process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
    process.env.AI_FEEDBACK_PROVIDER = 'stub';

    const appModuleImport =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    if (!process.env.MONGO_URI) {
      throw new Error(
        'MONGO_URI is required for classroom AI learning analytics e2e.',
      );
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [appModuleImport.AppModule],
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

    teacherAgent = request.agent(app.getHttpServer());
    otherTeacherAgent = request.agent(app.getHttpServer());
    activeStudentAgent = request.agent(app.getHttpServer());

    const [teacherHash, otherTeacherHash, studentHash] = await Promise.all([
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(teacherPassword, 10),
      bcrypt.hash(studentPassword, 10),
    ]);
    const users = await userModel.create([
      {
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
        name: 'Analytics Teacher',
      },
      {
        email: otherTeacherEmail,
        passwordHash: otherTeacherHash,
        roles: ['teacher'],
        name: 'Other Teacher',
      },
      {
        email: activeStudentEmail,
        passwordHash: studentHash,
        roles: ['student'],
        name: 'Active Student',
        studentNo: 'S-001',
      },
      {
        email: zeroStudentEmail,
        passwordHash: studentHash,
        roles: ['student'],
        name: 'Zero Submission Student',
        studentNo: 'S-002',
      },
      {
        email: removedStudentEmail,
        passwordHash: studentHash,
        roles: ['student'],
        name: 'Removed Student',
        studentNo: 'S-003',
      },
      {
        email: foreignStudentEmail,
        passwordHash: studentHash,
        roles: ['student'],
        name: 'Foreign Student',
        studentNo: 'S-004',
      },
    ]);
    [
      teacherId,
      otherTeacherId,
      activeStudentId,
      zeroSubmissionStudentId,
      removedStudentId,
      foreignStudentId,
    ] = users.map((user) => user._id);
    createdUserIds.push(...users.map((user) => user._id));

    await Promise.all([
      login(teacherAgent, teacherEmail, teacherPassword),
      login(otherTeacherAgent, otherTeacherEmail, teacherPassword),
      login(activeStudentAgent, activeStudentEmail, studentPassword),
    ]);

    const course = await courseModel.create({
      code: `AIA-${Date.now()}`,
      name: 'AI Analytics Course',
      term: '2026-Spring',
      status: 'ACTIVE',
      createdBy: teacherId,
    });
    courseId = course._id;
    createdCourseIds.push(courseId);

    const [classroom, otherClassroom] = await classroomModel.create([
      {
        courseId,
        name: 'AI Analytics Classroom',
        teacherId,
        joinCode: `AIA${Date.now().toString().slice(-5)}`,
        status: ClassroomStatus.Active,
      },
      {
        courseId,
        name: 'Other AI Analytics Classroom',
        teacherId: otherTeacherId,
        joinCode: `AIB${Date.now().toString().slice(-5)}`,
        status: ClassroomStatus.Active,
      },
    ]);
    classroomId = classroom._id;
    otherClassroomId = otherClassroom._id;
    createdClassroomIds.push(classroomId, otherClassroomId);

    await enrollmentModel.create([
      {
        classroomId,
        userId: activeStudentId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      },
      {
        classroomId,
        userId: zeroSubmissionStudentId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      },
      {
        classroomId,
        userId: removedStudentId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Removed,
        removedAt: new Date(),
      },
      {
        classroomId: otherClassroomId,
        userId: foreignStudentId,
        role: EnrollmentRole.Student,
        status: EnrollmentStatus.Active,
      },
    ]);

    const taskDefinitions = [
      'Improved Task',
      'Stable Task',
      'Regressed Task',
      'Zero Submission Task',
      'Failed Request Task',
      'Early Only Task',
    ];
    const tasks = await taskModel.create(
      taskDefinitions.map((title) => ({
        title,
        description: `${title} for controlled analytics`,
        knowledgeModule: 'ai-learning-analytics',
        stage: 2,
        status: TaskStatus.Published,
        createdBy: teacherId,
        publishedAt: new Date(),
      })),
    );
    createdTaskIds.push(...tasks.map((task) => task._id));

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const classroomTasks = await classroomTaskModel.create([
      {
        classroomId,
        taskId: tasks[0]._id,
        publishedAt: new Date(now - 2 * dayMs),
        createdBy: teacherId,
      },
      {
        classroomId,
        taskId: tasks[1]._id,
        publishedAt: new Date(now - 20 * dayMs),
        createdBy: teacherId,
      },
      {
        classroomId,
        taskId: tasks[2]._id,
        publishedAt: new Date(now - 40 * dayMs),
        createdBy: teacherId,
      },
      {
        classroomId,
        taskId: tasks[3]._id,
        publishedAt: new Date(now - 1.5 * dayMs),
        createdBy: teacherId,
      },
      {
        classroomId,
        taskId: tasks[4]._id,
        publishedAt: new Date(now - dayMs),
        createdBy: teacherId,
      },
      {
        classroomId,
        taskId: tasks[5]._id,
        publishedAt: new Date(now - 0.5 * dayMs),
        createdBy: teacherId,
      },
      {
        classroomId: otherClassroomId,
        taskId: tasks[0]._id,
        publishedAt: new Date(now - 2 * dayMs),
        createdBy: otherTeacherId,
      },
    ]);
    [
      improvedClassroomTaskId,
      stableClassroomTaskId,
      regressedClassroomTaskId,
      zeroSubmissionClassroomTaskId,
      failedClassroomTaskId,
      earlyOnlyClassroomTaskId,
      otherClassroomTaskId,
    ] = classroomTasks.map((classroomTask) => classroomTask._id);
    createdClassroomTaskIds.push(
      ...classroomTasks.map((classroomTask) => classroomTask._id),
    );

    const improvedAnchorTime = new Date(now - 46 * 60 * 60 * 1000);
    const improvedCompletedAt = new Date(now - 45 * 60 * 60 * 1000);
    const improvedEarlyTime = new Date(now - 45.5 * 60 * 60 * 1000);
    const improvedPostTime = new Date(now - 44 * 60 * 60 * 1000);
    const improvedAnchor = await createSubmission({
      classroomTaskId: improvedClassroomTaskId,
      taskId: tasks[0]._id,
      studentId: activeStudentId,
      attemptNo: 1,
      submittedAt: improvedAnchorTime,
      codeText: 'function improve() { return 0; }',
    });
    await createSubmission({
      classroomTaskId: improvedClassroomTaskId,
      taskId: tasks[0]._id,
      studentId: activeStudentId,
      attemptNo: 2,
      submittedAt: improvedEarlyTime,
      codeText: 'function improve() { return 1; }',
    });
    const improvedPost = await createSubmission({
      classroomTaskId: improvedClassroomTaskId,
      taskId: tasks[0]._id,
      studentId: activeStudentId,
      attemptNo: 3,
      submittedAt: improvedPostTime,
      codeText: 'function improve() { return 2; }',
    });
    await Promise.all([
      insertJob({
        submissionId: improvedAnchor._id,
        taskId: tasks[0]._id,
        classroomTaskId: improvedClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: improvedCompletedAt,
      }),
      insertJob({
        submissionId: improvedPost._id,
        taskId: tasks[0]._id,
        classroomTaskId: improvedClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: new Date(improvedPostTime.getTime() + 60 * 60 * 1000),
      }),
      insertFeedback({
        submissionId: improvedAnchor._id,
        severity: FeedbackSeverity.Error,
      }),
      insertFeedback({
        submissionId: improvedAnchor._id,
        severity: FeedbackSeverity.Warn,
      }),
      insertFeedback({
        submissionId: improvedPost._id,
        severity: FeedbackSeverity.Warn,
      }),
    ]);

    const stableAnchorTime = new Date(now - 19 * dayMs);
    const stablePostTime = new Date(now - 18 * dayMs);
    const stableAnchor = await createSubmission({
      classroomTaskId: stableClassroomTaskId,
      taskId: tasks[1]._id,
      studentId: activeStudentId,
      attemptNo: 1,
      submittedAt: stableAnchorTime,
      codeText: '  const stable = 1;\r\n  console.log(stable);  ',
    });
    const stablePost = await createSubmission({
      classroomTaskId: stableClassroomTaskId,
      taskId: tasks[1]._id,
      studentId: activeStudentId,
      attemptNo: 2,
      submittedAt: stablePostTime,
      codeText: '\nconst stable = 1;\n  console.log(stable);\n',
    });
    await Promise.all([
      insertJob({
        submissionId: stableAnchor._id,
        taskId: tasks[1]._id,
        classroomTaskId: stableClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: new Date(stableAnchorTime.getTime() + 60 * 60 * 1000),
      }),
      insertJob({
        submissionId: stablePost._id,
        taskId: tasks[1]._id,
        classroomTaskId: stableClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: new Date(stablePostTime.getTime() + 60 * 60 * 1000),
      }),
      insertFeedback({
        submissionId: stablePost._id,
        severity: FeedbackSeverity.Error,
        source: FeedbackSource.Teacher,
      }),
    ]);

    const regressedAnchorTime = new Date(now - 39 * dayMs);
    const regressedPostTime = new Date(now - 38 * dayMs);
    const regressedAnchor = await createSubmission({
      classroomTaskId: regressedClassroomTaskId,
      taskId: tasks[2]._id,
      studentId: activeStudentId,
      attemptNo: 1,
      submittedAt: regressedAnchorTime,
      codeText: 'const regress = 0;',
    });
    const regressedPost = await createSubmission({
      classroomTaskId: regressedClassroomTaskId,
      taskId: tasks[2]._id,
      studentId: activeStudentId,
      attemptNo: 2,
      submittedAt: regressedPostTime,
      codeText: 'const regress = broken;',
    });
    await Promise.all([
      insertJob({
        submissionId: regressedAnchor._id,
        taskId: tasks[2]._id,
        classroomTaskId: regressedClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: new Date(regressedAnchorTime.getTime() + 60 * 60 * 1000),
      }),
      insertJob({
        submissionId: regressedPost._id,
        taskId: tasks[2]._id,
        classroomTaskId: regressedClassroomTaskId,
        studentId: activeStudentId,
        status: AiFeedbackJobStatus.Succeeded,
        updatedAt: new Date(regressedPostTime.getTime() + 60 * 60 * 1000),
      }),
      insertFeedback({
        submissionId: regressedPost._id,
        severity: FeedbackSeverity.Error,
      }),
    ]);

    const failedSubmission = await createSubmission({
      classroomTaskId: failedClassroomTaskId,
      taskId: tasks[4]._id,
      studentId: activeStudentId,
      attemptNo: 1,
      submittedAt: new Date(now - 20 * 60 * 60 * 1000),
      codeText: 'const failed = true;',
    });
    await insertJob({
      submissionId: failedSubmission._id,
      taskId: tasks[4]._id,
      classroomTaskId: failedClassroomTaskId,
      studentId: activeStudentId,
      status: AiFeedbackJobStatus.Failed,
      updatedAt: new Date(now - 19 * 60 * 60 * 1000),
    });

    const earlyAnchorTime = new Date(now - 10 * 60 * 60 * 1000);
    const earlyNextTime = new Date(now - 9 * 60 * 60 * 1000);
    const earlyCompletedAt = new Date(now - 8 * 60 * 60 * 1000);
    const earlyAnchor = await createSubmission({
      classroomTaskId: earlyOnlyClassroomTaskId,
      taskId: tasks[5]._id,
      studentId: activeStudentId,
      attemptNo: 1,
      submittedAt: earlyAnchorTime,
      codeText: 'const early = 0;',
    });
    await createSubmission({
      classroomTaskId: earlyOnlyClassroomTaskId,
      taskId: tasks[5]._id,
      studentId: activeStudentId,
      attemptNo: 2,
      submittedAt: earlyNextTime,
      codeText: 'const early = 1;',
    });
    await insertJob({
      submissionId: earlyAnchor._id,
      taskId: tasks[5]._id,
      classroomTaskId: earlyOnlyClassroomTaskId,
      studentId: activeStudentId,
      status: AiFeedbackJobStatus.Succeeded,
      updatedAt: earlyCompletedAt,
    });

    const removedSubmission = await createSubmission({
      classroomTaskId: improvedClassroomTaskId,
      taskId: tasks[0]._id,
      studentId: removedStudentId,
      attemptNo: 1,
      submittedAt: improvedAnchorTime,
      codeText: 'const removed = true;',
    });
    await insertJob({
      submissionId: removedSubmission._id,
      taskId: tasks[0]._id,
      classroomTaskId: improvedClassroomTaskId,
      studentId: removedStudentId,
      status: AiFeedbackJobStatus.Succeeded,
      updatedAt: improvedCompletedAt,
    });

    const foreignSubmission = await createSubmission({
      classroomTaskId: otherClassroomTaskId,
      taskId: tasks[0]._id,
      studentId: foreignStudentId,
      attemptNo: 1,
      submittedAt: improvedAnchorTime,
      codeText: 'const foreign = true;',
    });
    await insertJob({
      submissionId: foreignSubmission._id,
      taskId: tasks[0]._id,
      classroomTaskId: otherClassroomTaskId,
      studentId: foreignStudentId,
      status: AiFeedbackJobStatus.Succeeded,
      updatedAt: improvedCompletedAt,
    });
  });

  afterAll(async () => {
    if (!KEEP_DB && app) {
      await Promise.all([
        feedbackModel.deleteMany({
          submissionId: { $in: createdSubmissionIds },
        }),
        aiFeedbackJobModel.deleteMany({
          submissionId: { $in: createdSubmissionIds },
        }),
        submissionModel.deleteMany({ _id: { $in: createdSubmissionIds } }),
        enrollmentModel.deleteMany({
          classroomId: { $in: createdClassroomIds },
        }),
        classroomTaskModel.deleteMany({
          _id: { $in: createdClassroomTaskIds },
        }),
        taskModel.deleteMany({ _id: { $in: createdTaskIds } }),
        classroomModel.deleteMany({ _id: { $in: createdClassroomIds } }),
        courseModel.deleteMany({ _id: { $in: createdCourseIds } }),
        sessionModel.deleteMany({ userId: { $in: createdUserIds } }),
        userModel.deleteMany({ _id: { $in: createdUserIds } }),
      ]);
    }

    if (app) {
      await app.close();
    }
    if (previousWorkerEnabled === undefined) {
      delete process.env.AI_FEEDBACK_WORKER_ENABLED;
    } else {
      process.env.AI_FEEDBACK_WORKER_ENABLED = previousWorkerEnabled;
    }
    if (previousProvider === undefined) {
      delete process.env.AI_FEEDBACK_PROVIDER;
    } else {
      process.env.AI_FEEDBACK_PROVIDER = previousProvider;
    }
  });

  it('enforces authentication, TEACHER role and owner-only non-disclosure', async () => {
    await request(app.getHttpServer())
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .expect(401);

    await activeStudentAgent
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .expect(403);

    await otherTeacherAgent
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .expect(404);

    await teacherAgent
      .get(
        `/api/classrooms/${otherClassroomId.toString()}/ai-learning-analytics`,
      )
      .expect(404);

    await teacherAgent
      .get('/api/classrooms/not-an-object-id/ai-learning-analytics')
      .expect(400);
  });

  it('returns stable overview, separates requested/delivered and isolates ACTIVE enrollment plus classroomTaskId', async () => {
    const response = await teacherAgent
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .expect(200);
    const body = response.body as AnalyticsOverview;

    expect(body.context).toMatchObject({
      classroomId: classroomId.toString(),
      courseId: courseId.toString(),
      window: 'all',
      effectiveTaskCount: 6,
      excludedTaskIds: [],
    });
    expect(body.methodology).toEqual({
      scope: 'AI_FEEDBACK_INTERVENTION_V1',
      sampleUnit: 'STUDENT_CLASSROOM_TASK',
      qualityProxy: 'ERROR_PLUS_HALF_WARN',
      disclaimer:
        '本分析仅反映 EduForge AI 反馈介入后的提交行为与代码问题代理变化，不代表 AI 对学习成绩或能力提升的因果贡献。',
    });
    expect(body.summary).toEqual({
      activeStudentsCount: 2,
      submittedStudentTaskCount: 5,
      aiRequestedStudentTaskCount: 5,
      aiDeliveredStudentTaskCount: 4,
      postFeedbackResubmittedStudentTaskCount: 3,
      postFeedbackCodeChangedStudentTaskCount: 2,
      qualityComparableStudentTaskCount: 3,
      improvedStudentTaskCount: 1,
      stableStudentTaskCount: 1,
      regressedStudentTaskCount: 1,
      aiStudentCoverageRate: 0.5,
      aiTaskCoverageRate: 1,
      aiDeliveryRate: 0.8,
      postFeedbackResubmissionRate: 0.75,
      postFeedbackCodeChangeRate: 0.6667,
      qualityComparableRate: 0.75,
      improvedRate: 0.3333,
      averageIssueLoadBefore: 0.5,
      averageIssueLoadAfter: 0.5,
      averageIssueLoadDelta: 0,
    });
    expect(body.taskTrends).toHaveLength(6);
    expect(
      body.taskTrends.some(
        (task) => task.classroomTaskId === otherClassroomTaskId.toString(),
      ),
    ).toBe(false);
    expect(
      body.taskTrends.map((task) => new Date(task.publishedAt).getTime()),
    ).toEqual(
      [...body.taskTrends]
        .map((task) => new Date(task.publishedAt).getTime())
        .sort((left, right) => left - right),
    );

    const improved = body.taskTrends.find(
      (task) => task.classroomTaskId === improvedClassroomTaskId.toString(),
    );
    const stable = body.taskTrends.find(
      (task) => task.classroomTaskId === stableClassroomTaskId.toString(),
    );
    const regressed = body.taskTrends.find(
      (task) => task.classroomTaskId === regressedClassroomTaskId.toString(),
    );
    const failed = body.taskTrends.find(
      (task) => task.classroomTaskId === failedClassroomTaskId.toString(),
    );
    const zero = body.taskTrends.find(
      (task) =>
        task.classroomTaskId === zeroSubmissionClassroomTaskId.toString(),
    );
    const earlyOnly = body.taskTrends.find(
      (task) => task.classroomTaskId === earlyOnlyClassroomTaskId.toString(),
    );
    expect(improved).toMatchObject({
      submittedStudentCount: 1,
      aiRequestedStudentCount: 1,
      aiDeliveredStudentCount: 1,
      postFeedbackResubmittedStudentCount: 1,
      postFeedbackCodeChangedStudentCount: 1,
      qualityComparableStudentCount: 1,
      improvedStudentCount: 1,
    });
    expect(stable).toMatchObject({
      postFeedbackResubmittedStudentCount: 1,
      postFeedbackCodeChangedStudentCount: 0,
      qualityComparableStudentCount: 1,
      stableStudentCount: 1,
    });
    expect(regressed).toMatchObject({
      qualityComparableStudentCount: 1,
      regressedStudentCount: 1,
    });
    expect(failed).toMatchObject({
      aiRequestedStudentCount: 1,
      aiDeliveredStudentCount: 0,
    });
    expect(zero).toMatchObject({
      submittedStudentCount: 0,
      aiRequestedStudentCount: 0,
    });
    expect(earlyOnly).toMatchObject({
      aiDeliveredStudentCount: 1,
      postFeedbackResubmittedStudentCount: 0,
      qualityComparableStudentCount: 0,
    });
  });

  it('supports task-window selection and excluded classroomTaskIds without cross-class effects', async () => {
    const [sevenDays, thirtyDays, all, excluded, foreignExcluded] =
      await Promise.all([
        teacherAgent
          .get(
            `/api/classrooms/${classroomId.toString()}/ai-learning-analytics`,
          )
          .query({ window: '7d' })
          .expect(200),
        teacherAgent
          .get(
            `/api/classrooms/${classroomId.toString()}/ai-learning-analytics`,
          )
          .query({ window: '30d' })
          .expect(200),
        teacherAgent
          .get(
            `/api/classrooms/${classroomId.toString()}/ai-learning-analytics`,
          )
          .query({ window: 'all' })
          .expect(200),
        teacherAgent
          .get(
            `/api/classrooms/${classroomId.toString()}/ai-learning-analytics`,
          )
          .query({
            excludedTaskIds: `${improvedClassroomTaskId.toString()},${zeroSubmissionClassroomTaskId.toString()}`,
          })
          .expect(200),
        teacherAgent
          .get(
            `/api/classrooms/${classroomId.toString()}/ai-learning-analytics`,
          )
          .query({ excludedTaskIds: otherClassroomTaskId.toString() })
          .expect(200),
      ]);

    expect(
      (sevenDays.body as AnalyticsOverview).context.effectiveTaskCount,
    ).toBe(4);
    expect(
      (thirtyDays.body as AnalyticsOverview).context.effectiveTaskCount,
    ).toBe(5);
    expect((all.body as AnalyticsOverview).context.effectiveTaskCount).toBe(6);
    expect((excluded.body as AnalyticsOverview).context).toMatchObject({
      effectiveTaskCount: 4,
      excludedTaskIds: [
        improvedClassroomTaskId.toString(),
        zeroSubmissionClassroomTaskId.toString(),
      ],
    });
    expect(
      (excluded.body as AnalyticsOverview).summary.improvedStudentTaskCount,
    ).toBe(0);
    expect(
      (foreignExcluded.body as AnalyticsOverview).context.effectiveTaskCount,
    ).toBe(6);
  });

  it('validates window and excludedTaskIds through the global DTO pipe', async () => {
    await teacherAgent
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .query({ window: 'term' })
      .expect(400);

    await teacherAgent
      .get(`/api/classrooms/${classroomId.toString()}/ai-learning-analytics`)
      .query({ excludedTaskIds: 'not-an-object-id' })
      .expect(400);
  });

  it('paginates all ACTIVE students, preserves zero metrics and excludes REMOVED enrollment', async () => {
    const firstPage = await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students`,
      )
      .query({ page: 1, limit: 1 })
      .expect(200);
    const secondPage = await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students`,
      )
      .query({ page: 2, limit: 1 })
      .expect(200);
    const first = firstPage.body as AnalyticsStudentList;
    const second = secondPage.body as AnalyticsStudentList;

    expect(first).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(second).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect(first.items[0]).toMatchObject({
      studentId: activeStudentId.toString(),
      studentNo: 'S-001',
      submittedTasksCount: 5,
      aiRequestedTasksCount: 5,
      aiDeliveredTasksCount: 4,
      postFeedbackResubmittedTasksCount: 3,
      postFeedbackCodeChangedTasksCount: 2,
      qualityComparableTasksCount: 3,
      improvedTasksCount: 1,
      stableTasksCount: 1,
      regressedTasksCount: 1,
      growthTrend: 'STABLE',
    });
    expect(second.items[0]).toMatchObject({
      studentId: zeroSubmissionStudentId.toString(),
      studentNo: 'S-002',
      submittedTasksCount: 0,
      aiRequestedTasksCount: 0,
      qualityComparableTasksCount: 0,
      growthTrend: 'INSUFFICIENT_DATA',
    });
    expect(
      [...first.items, ...second.items].some(
        (item) => item.studentId === removedStudentId.toString(),
      ),
    ).toBe(false);
  });

  it('returns every effective task in ACTIVE student detail with stable nullable non-comparable fields', async () => {
    const response = await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students/${activeStudentId.toString()}`,
      )
      .expect(200);
    const body = response.body as AnalyticsStudentDetail;

    expect(body.student).toEqual({
      studentId: activeStudentId.toString(),
      studentName: 'Active Student',
      studentNo: 'S-001',
    });
    expect(body.taskPoints).toHaveLength(6);
    const improved = body.taskPoints.find(
      (point) => point.classroomTaskId === improvedClassroomTaskId.toString(),
    );
    const stable = body.taskPoints.find(
      (point) => point.classroomTaskId === stableClassroomTaskId.toString(),
    );
    const regressed = body.taskPoints.find(
      (point) => point.classroomTaskId === regressedClassroomTaskId.toString(),
    );
    const failed = body.taskPoints.find(
      (point) => point.classroomTaskId === failedClassroomTaskId.toString(),
    );
    const earlyOnly = body.taskPoints.find(
      (point) => point.classroomTaskId === earlyOnlyClassroomTaskId.toString(),
    );
    const zero = body.taskPoints.find(
      (point) =>
        point.classroomTaskId === zeroSubmissionClassroomTaskId.toString(),
    );
    expect(improved).toMatchObject({
      attemptsCount: 3,
      postFeedbackResubmitted: true,
      postFeedbackCodeChanged: true,
      qualityComparable: true,
      issueLoadBefore: 1.5,
      issueLoadAfter: 0.5,
      issueLoadDelta: 1,
      outcome: 'IMPROVED',
    });
    expect(stable).toMatchObject({
      postFeedbackCodeChanged: false,
      qualityComparable: true,
      issueLoadBefore: 0,
      issueLoadAfter: 0,
      issueLoadDelta: 0,
      outcome: 'STABLE',
    });
    expect(regressed).toMatchObject({
      issueLoadBefore: 0,
      issueLoadAfter: 1,
      issueLoadDelta: -1,
      outcome: 'REGRESSED',
    });
    expect(failed).toMatchObject({
      aiRequested: true,
      aiDelivered: false,
      qualityComparable: false,
      issueLoadBefore: null,
      issueLoadAfter: null,
      issueLoadDelta: null,
      outcome: 'NOT_COMPARABLE',
    });
    expect(earlyOnly).toMatchObject({
      attemptsCount: 2,
      aiDelivered: true,
      postFeedbackResubmitted: false,
      postFeedbackCodeChanged: false,
      qualityComparable: false,
      outcome: 'NOT_COMPARABLE',
    });
    expect(zero).toMatchObject({
      attemptsCount: 0,
      aiRequested: false,
      aiDelivered: false,
      outcome: 'NOT_COMPARABLE',
    });
  });

  it('returns safe 404 for REMOVED, foreign and invalid student detail IDs', async () => {
    await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students/${removedStudentId.toString()}`,
      )
      .expect(404);
    await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students/${foreignStudentId.toString()}`,
      )
      .expect(404);
    await teacherAgent
      .get(
        `/api/classrooms/${classroomId.toString()}/ai-learning-analytics/students/not-an-object-id`,
      )
      .expect(404);
  });
});
