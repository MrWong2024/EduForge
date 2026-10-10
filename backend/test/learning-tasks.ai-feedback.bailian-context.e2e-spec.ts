import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import http from 'http';
import request from 'supertest';
import { App } from 'supertest/types';
import { Course } from '../src/modules/courses/schemas/course.schema';
import { Classroom } from '../src/modules/classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Enrollment } from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import { User } from '../src/modules/users/schemas/user.schema';
import { Session } from '../src/modules/auth/schemas/session.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import { Feedback } from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiReviewSummary } from '../src/modules/learning-tasks/ai-feedback/lib/ai-review-summary';
import type * as AppModuleExports from '../src/app.module';

jest.setTimeout(30000);

const KEEP_DB = process.env.KEEP_E2E_DB === '1';

type CreatedTaskResponse = {
  id: string;
};

type CreatedSubmissionResponse = {
  id: string;
};

type ProcessOnceResponse = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

type BailianMessage = {
  role?: string;
  content?: string;
};

type BailianRequestPayload = {
  model?: string;
  max_tokens?: number;
  enable_thinking?: boolean;
  messages?: BailianMessage[];
};

type MockResponse = {
  status?: number;
  finish?: string;
  content?: string;
  usage?: unknown;
  hold?: boolean;
  raw?: string;
};
const validUsage = {
  prompt_tokens: 100,
  completion_tokens: 20,
  total_tokens: 120,
};
const validContent = JSON.stringify({
  items: [
    {
      type: 'BUG',
      severity: 'WARN',
      message: 'Mock feedback',
      tags: ['correctness'],
    },
  ],
});
const startMockBailian = () =>
  new Promise<{
    server: http.Server;
    url: string;
    getCapturedPayloads: () => BailianRequestPayload[];
    clearCapturedPayloads: () => void;
    setResponses: (responses: MockResponse[]) => void;
  }>((resolve, reject) => {
    const capturedPayloads: BailianRequestPayload[] = [];
    let responses: MockResponse[] = [];
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const bodyChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer | string) => {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        const rawBody = Buffer.concat(bodyChunks).toString('utf8');
        if (rawBody.trim().length > 0) {
          try {
            capturedPayloads.push(JSON.parse(rawBody) as BailianRequestPayload);
          } catch {
            capturedPayloads.push({});
          }
        } else {
          capturedPayloads.push({});
        }
        const response = responses.shift() ?? {};
        if (response.hold) return;
        res.statusCode = response.status ?? 200;
        const payload = {
          choices: [
            {
              finish_reason: response.finish ?? 'stop',
              message: { content: response.content ?? validContent },
            },
          ],
          usage: Object.hasOwn(response, 'usage') ? response.usage : validUsage,
        };
        res.setHeader('content-type', 'application/json');
        res.end(response.raw ?? JSON.stringify(payload));
      });
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    const startupTimeout = setTimeout(() => {
      server.close();
      reject(new Error('Mock Bailian startup timed out'));
    }, 5000);
    server.once('error', (error) => {
      clearTimeout(startupTimeout);
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      clearTimeout(startupTimeout);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Mock Bailian address unavailable'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        getCapturedPayloads: () => [...capturedPayloads],
        setResponses: (next) => {
          responses = [...next];
        },
        clearCapturedPayloads: () => {
          capturedPayloads.length = 0;
        },
      });
    });
  });

describe('LearningTasks AI Feedback Bailian Context (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;
  let mockServer: http.Server;
  let getCapturedPayloads: () => BailianRequestPayload[];
  let clearCapturedPayloads: () => void;
  let setResponses: (responses: MockResponse[]) => void;

  let courseId = '';
  const classroomIds: string[] = [],
    instanceIds: string[] = [],
    submissionIds: string[] = [];
  let classroomTaskAId = '',
    classroomTaskBId = '';
  let taskId = '';
  let submissionId = '';
  let previousWorkerEnabled: string | undefined;
  let previousProvider: string | undefined;
  let previousApiKey: string | undefined;
  let previousBaseUrl: string | undefined;
  let previousDebugEnabled: string | undefined;

  const fixtureNamespace = 'ai-bailian-bailian-context-' + Date.now();
  const teacherEmail = 'teacher.' + fixtureNamespace + '@example.invalid';
  const studentEmail = 'student.' + fixtureNamespace + '@example.invalid';
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

  const waitForSucceededJob = async (id: string) => {
    const objectId = new Types.ObjectId(id);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const job = await aiFeedbackJobModel.findOne({ submissionId: objectId });
      if (job?.status === AiFeedbackJobStatus.Succeeded) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return aiFeedbackJobModel.findOne({ submissionId: objectId });
  };

  const readReview = async (id: string, agent = studentAgent) => {
    const res = await agent
      .get('/api/learning-tasks/submissions/' + id)
      .expect(200);
    return res.body as {
      aiFeedbackStatus: string;
      aiReview: AiReviewSummary;
      content: { codeText: string; submissionNote: string };
    };
  };
  const submitAndRequest = async (
    codeText = 'console.log("saved");',
    submissionNote = '完整说明',
  ) => {
    const res = await studentAgent
      .post(
        '/api/classrooms/' +
          classroomIds[0] +
          '/tasks/' +
          classroomTaskAId +
          '/submissions',
      )
      .send({ content: { codeText, language: 'javascript', submissionNote } })
      .expect(201);
    const id = (res.body as CreatedSubmissionResponse).id;
    submissionIds.push(id);
    await studentAgent
      .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
      .send({})
      .expect(200);
    return id;
  };
  const makeDue = async (id: string) => {
    // Approved controlled scheduling advancement; no status/attempt/usage rewrite.
    await aiFeedbackJobModel.updateOne(
      { submissionId: new Types.ObjectId(id), status: 'FAILED' },
      { $set: { notBefore: new Date(0) } },
    );
  };

  beforeAll(async () => {
    const mock = await startMockBailian();
    mockServer = mock.server;
    getCapturedPayloads = mock.getCapturedPayloads;
    clearCapturedPayloads = mock.clearCapturedPayloads;
    setResponses = mock.setResponses;

    try {
      previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
      process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
      previousProvider = process.env.AI_FEEDBACK_PROVIDER;
      process.env.AI_FEEDBACK_PROVIDER = 'bailian';
      previousApiKey = process.env.BAILIAN_API_KEY;
      process.env.BAILIAN_API_KEY = 'test-key';
      previousBaseUrl = process.env.BAILIAN_BASE_URL;
      process.env.BAILIAN_BASE_URL = mock.url;
      previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
      process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

      // Load AppModule after env is set, otherwise provider config can be fixed too early.
      const appModuleExports =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/app.module') as typeof AppModuleExports;
      const { AppModule } = appModuleExports;
      if (!process.env.MONGO_URI) {
        throw new Error(
          'MONGO_URI is required for learning-tasks ai-feedback bailian context e2e.',
        );
      }

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
      const configService = app.get(ConfigService);
      expect(configService.get<string>('AI_FEEDBACK_PROVIDER')).toBe('bailian');
      expect(configService.get<string>('BAILIAN_BASE_URL')).toBe(mock.url);

      teacherAgent = request
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
      aiFeedbackProcessor = app.get(AiFeedbackProcessor);
      expect(process.env.EDUFORGE_DATABASE_PURPOSE).toBe('standard_test');
      expect(userModel.db.name).toBe('eduforge_test');
      userModel.db.set('maxTimeMS', 10000);
      expect(
        await aiFeedbackJobModel.countDocuments({
          status: {
            $in: [AiFeedbackJobStatus.Pending, AiFeedbackJobStatus.Failed],
          },
        }),
      ).toBe(0);
      console.info(
        'Bailian context E2E: standard_test / ' +
          userModel.db.name +
          '; namespace=' +
          fixtureNamespace +
          '; mock=' +
          mock.url,
      );

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

      const createdTask = await teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'Bailian Context Task',
          description: '实现一个函数并满足题目要求与评分标准。',
          rubric: {
            keyRequirements: ['必须处理边界条件', '必须给出可读实现'],
            scoring: { correctness: 70, readability: 30 },
          },
          knowledgeModule: 'ai-bailian',
          stage: 1,
          status: 'DRAFT',
        })
        .expect(201);
      taskId = (createdTask.body as CreatedTaskResponse).id;

      await teacherAgent
        .post(`/api/learning-tasks/tasks/${taskId}/publish`)
        .send({})
        .expect(201);
      configService.set('AI_FEEDBACK_AUTO_ON_SUBMIT', false);
      configService.set('LEARNING_TASK_SUBMISSION_COOLDOWN_MS', 0);
      const course = await teacherAgent
        .post('/api/courses')
        .send({ code: fixtureNamespace, name: 'Context course', term: '2026' })
        .expect(201);
      courseId = (course.body as CreatedTaskResponse).id;
      for (let index = 0; index < 2; index += 1) {
        const classroom = await teacherAgent
          .post('/api/classrooms')
          .send({ courseId, name: 'Context classroom ' + index })
          .expect(201);
        const body = classroom.body as { id: string; joinCode: string };
        classroomIds.push(body.id);
        await studentAgent
          .post('/api/classrooms/join')
          .send({ joinCode: body.joinCode })
          .expect(201);
        if (index === 1) {
          await teacherAgent
            .patch('/api/learning-tasks/tasks/' + taskId)
            .send({
              title: 'B revised context',
              description: 'B revised description',
              rubric: { criterion: 'B revised rubric' },
            })
            .expect(200);
        }
        const instance = await teacherAgent
          .post('/api/classrooms/' + body.id + '/tasks')
          .send({ taskId, settings: { aiFeedbackMode: 'MANUAL' } })
          .expect(201);
        instanceIds.push((instance.body as CreatedTaskResponse).id);
      }
      [classroomTaskAId, classroomTaskBId] = instanceIds;
      await teacherAgent
        .post('/api/learning-tasks/tasks/' + taskId + '/archive')
        .send({})
        .expect(201);
    } catch (error) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      throw error;
    }
  });

  afterAll(async () => {
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
    if (previousApiKey === undefined) {
      delete process.env.BAILIAN_API_KEY;
    } else {
      process.env.BAILIAN_API_KEY = previousApiKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.BAILIAN_BASE_URL;
    } else {
      process.env.BAILIAN_BASE_URL = previousBaseUrl;
    }
    if (previousDebugEnabled === undefined) {
      delete process.env.AI_FEEDBACK_DEBUG_ENABLED;
    } else {
      process.env.AI_FEEDBACK_DEBUG_ENABLED = previousDebugEnabled;
    }

    try {
      if (!KEEP_DB && userModel) {
        const cleanup: Promise<unknown>[] = [];
        for (const ownedId of submissionIds) {
          const submissionObjectId = new Types.ObjectId(ownedId);
          cleanup.push(
            feedbackModel.deleteMany({ submissionId: submissionObjectId }),
          );
          cleanup.push(
            aiFeedbackJobModel.deleteMany({ submissionId: submissionObjectId }),
          );
          cleanup.push(submissionModel.deleteOne({ _id: submissionObjectId }));
        }
        if (taskId) {
          cleanup.push(taskModel.deleteOne({ _id: taskId }));
        }
        const users = await userModel
          .find({ email: { $in: [teacherEmail, studentEmail] } })
          .select('_id')
          .lean<Array<{ _id: Types.ObjectId }>>()
          .exec();
        const userIds = users.map((user) => user._id);
        if (userIds.length > 0) {
          cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
          cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
        }
        for (const operation of cleanup) await operation;
        await app
          .get<Model<ClassroomTask>>(getModelToken(ClassroomTask.name))
          .deleteMany({ _id: { $in: instanceIds } });
        await app
          .get<Model<Enrollment>>(getModelToken(Enrollment.name))
          .deleteMany({
            classroomId: {
              $in: classroomIds.map((id) => new Types.ObjectId(id)),
            },
          });
        await app
          .get<Model<Classroom>>(getModelToken(Classroom.name))
          .deleteMany({ _id: { $in: classroomIds } });
        if (courseId)
          await app
            .get<Model<Course>>(getModelToken(Course.name))
            .deleteOne({ _id: courseId });
        if (submissionId) {
          expect(await feedbackModel.countDocuments({ submissionId })).toBe(0);
          expect(
            await aiFeedbackJobModel.countDocuments({ submissionId }),
          ).toBe(0);
          expect(
            await submissionModel.countDocuments({ _id: submissionId }),
          ).toBe(0);
        }
        if (taskId)
          expect(await taskModel.countDocuments({ _id: taskId })).toBe(0);
        expect(
          await userModel.countDocuments({
            email: { $in: [teacherEmail, studentEmail] },
          }),
        ).toBe(0);
        expect(
          await sessionModel.countDocuments({ userId: { $in: userIds } }),
        ).toBe(0);
        const ownedIds = submissionIds.map((id) => new Types.ObjectId(id));
        expect(
          await aiFeedbackJobModel.countDocuments({
            submissionId: { $in: ownedIds },
          }),
        ).toBe(0);
        expect(
          await feedbackModel.countDocuments({
            submissionId: { $in: ownedIds },
          }),
        ).toBe(0);
        expect(
          await submissionModel.countDocuments({ _id: { $in: ownedIds } }),
        ).toBe(0);
        console.info('Fixture cleanup verified: ' + fixtureNamespace);
      }
    } finally {
      try {
        if (app) {
          await app.close();
          if (userModel) expect(userModel.db.readyState).toBe(0);
          const server = app.getHttpServer();
          expect(server).toBeInstanceOf(http.Server);
          if (server instanceof http.Server)
            expect(server.listening).toBe(false);
        }
      } finally {
        if (mockServer?.listening) {
          mockServer.closeAllConnections();
          await new Promise<void>((resolve) =>
            mockServer.close(() => resolve()),
          );
          expect(mockServer.listening).toBe(false);
          console.info('A2 app/DB/mock closed; scoped residuals zero');
        }
      }
    }
  });

  it('passes task context and zh-cn instruction to mock Bailian and keeps feedback pipeline persisted', async () => {
    clearCapturedPayloads();

    const createdSubmission = await studentAgent
      .post(
        '/api/classrooms/' +
          classroomIds[0] +
          '/tasks/' +
          classroomTaskAId +
          '/submissions',
      )
      .send({
        content: {
          codeText:
            'function solveQuadratic(a: number, b: number, c: number) { return [a, b, c]; }' +
            '// source padding'.repeat(900) +
            'SOURCE_TAIL_A2',
          language: 'typescript',
          submissionNote: 'NOTE_FULL_A2_MODEL_INPUT',
        },
        meta: {
          aiUsageDeclaration: 'I used AI for brainstorming only.',
        },
      })
      .expect(201);
    submissionId = (createdSubmission.body as CreatedSubmissionResponse).id;
    submissionIds.push(submissionId);

    await studentAgent
      .post(
        `/api/learning-tasks/submissions/${submissionId}/ai-feedback/request`,
      )
      .send({})
      .expect(200);

    const processResult = (await aiFeedbackProcessor.processOnce(
      1,
    )) as ProcessOnceResponse;
    expect(processResult.processed).toBe(1);
    expect(processResult.succeeded).toBe(1);

    const succeededJob = await waitForSucceededJob(submissionId);
    expect(succeededJob?.status).toBe(AiFeedbackJobStatus.Succeeded);

    const capturedPayloads = getCapturedPayloads();
    expect(capturedPayloads.length).toBeGreaterThan(0);
    const matchedPayload = capturedPayloads.find((payload) =>
      (payload.messages ?? []).some(
        (message) =>
          message.role === 'user' &&
          typeof message.content === 'string' &&
          message.content.includes(`SubmissionId: ${submissionId}`),
      ),
    );
    expect(matchedPayload).toBeTruthy();
    expect(capturedPayloads).toHaveLength(1);
    expect(matchedPayload).toMatchObject({
      max_tokens: 2048,
      enable_thinking: false,
    });
    expect(matchedPayload).not.toHaveProperty('extra_body');
    expect(matchedPayload).not.toHaveProperty('max_completion_tokens');

    const systemPrompt =
      matchedPayload?.messages?.find((message) => message.role === 'system')
        ?.content ?? '';
    const userPrompt =
      matchedPayload?.messages?.find((message) => message.role === 'user')
        ?.content ?? '';
    expect(systemPrompt).toContain('message 与 suggestion 默认使用简体中文');
    expect(systemPrompt).toContain('不翻译代码元素');
    expect(systemPrompt).toContain('Language is a hint, not ground truth.');
    expect(systemPrompt).toContain(
      'If language hint is auto/unknown/empty, infer language mainly from code content.',
    );
    expect(systemPrompt).toContain('默认只输出 1 条主反馈');
    expect(systemPrompt).toContain('Never output more than 2 items');
    expect(systemPrompt).toContain('禁止把同类问题按出现位置拆成多条');
    expect(systemPrompt).toContain(
      '多处同类语法问题（如多处缺少分号）必须合并为 1 条主问题反馈',
    );
    expect(systemPrompt).toContain(
      '若存在语法/编译/运行阻断问题，必须优先作为主反馈',
    );
    expect(systemPrompt).toContain('Valid shape example A (1 item)');
    expect(systemPrompt).toContain(
      'Invalid example C: five praise-only INFO items.',
    );
    expect(systemPrompt).toContain(
      'Valid boundary example C (correct but improvable): return exactly 1 integrated item with brief acknowledgement + 1~2 actionable improvements.',
    );
    expect(systemPrompt).toContain(
      'Valid boundary example D (truly nothing to improve): {"items":[]}.',
    );
    expect(systemPrompt).toContain(
      'Invalid example E: mostly correct code with improvable points but returns {"items":[]}.',
    );
    expect(systemPrompt).toContain(
      'Use {"items":[]} only when there is truly nothing worth flagging, no actionable suggestion, and no learning-value improvement point.',
    );
    expect(userPrompt).not.toContain('NOTE_EXCLUDED_FROM_A1_MODEL_INPUT');
    expect(userPrompt).not.toContain('B revised');
    expect(userPrompt).toContain('TaskTitle: Bailian Context Task');
    expect(userPrompt).toContain(
      'TaskDescription: 实现一个函数并满足题目要求与评分标准。',
    );
    expect(userPrompt).toContain('TaskRubric:');
    expect(userPrompt).toContain('必须处理边界条件');
    expect(userPrompt).toContain(
      'Differentiate between "feature not implemented" and "logic exists but cannot run due to syntax/compile errors".',
    );
    expect(userPrompt).toContain(
      'Prefer exactly one item. Output two items only when the second category is clearly independent and improves student understanding.',
    );
    expect(userPrompt).toContain(
      'Treat language as a weak hint. Infer language primarily from code features when needed.',
    );
    expect(userPrompt).toContain('Language hint: typescript');
    expect(userPrompt).toContain(
      'Language hint may be missing or incorrect; prioritize code evidence for language-specific judgement.',
    );
    expect(userPrompt).toContain(
      'Boundary rule: if the submission is mostly correct but still improvable, return one integrated item; return empty items only when truly nothing can be improved.',
    );
    expect(userPrompt).toContain(
      'AIUsageDeclaration: I used AI for brainstorming only.',
    );
    expect(userPrompt).toContain('Code:');
    expect(userPrompt).toContain('solveQuadratic');
    expect(userPrompt).toContain('SOURCE_TAIL_A2');
    const detail = await readReview(submissionId);
    expect(detail.aiReview).toMatchObject({
      provider: 'bailian',
      canRequest: false,
      inputCoverage: 'FULL',
      failure: null,
      usage: {
        reservedRequests: 1,
        reportedRequests: 1,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      },
    });
    console.info(
      'A2 success public aiReview=' + JSON.stringify(detail.aiReview),
    );
    const savedRecord = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(submissionId) })
      .lean()
      .exec();
    expect(savedRecord?.requests?.[0].inputBytes).toBe(
      Buffer.byteLength(JSON.stringify(matchedPayload?.messages), 'utf8'),
    );
    expect(JSON.stringify(savedRecord?.requests)).not.toContain(
      'SOURCE_TAIL_A2',
    );

    const feedbackCount = await feedbackModel.countDocuments({
      submissionId: new Types.ObjectId(submissionId),
    });
    expect(feedbackCount).toBeGreaterThan(0);

    const feedbackList = await studentAgent
      .get(`/api/learning-tasks/submissions/${submissionId}/feedback`)
      .expect(200);
    const feedbackItems = feedbackList.body as unknown[];
    expect(Array.isArray(feedbackItems)).toBe(true);
    expect(feedbackItems.length).toBeGreaterThan(0);
  });
  it('uses B snapshot and saved source in the actual mock request after the template is archived', async () => {
    clearCapturedPayloads();
    const created = await studentAgent
      .post(
        '/api/classrooms/' +
          classroomIds[1] +
          '/tasks/' +
          classroomTaskBId +
          '/submissions',
      )
      .send({
        content: {
          codeText: 'B_SAVED_SOURCE_ONLY',
          language: 'typescript',
          submissionNote: 'B_NOTE_FULL_A2',
        },
      })
      .expect(201);
    const id = (created.body as CreatedSubmissionResponse).id;
    submissionIds.push(id);
    await studentAgent
      .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
      .send({})
      .expect(200);
    expect(await aiFeedbackProcessor.processOnce(1)).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      dead: 0,
    });
    const payloads = getCapturedPayloads();
    expect(payloads).toHaveLength(1);
    const prompt =
      payloads[0].messages?.find((message) => message.role === 'user')
        ?.content ?? '';
    expect(prompt).toContain('TaskTitle: B revised context');
    expect(prompt).toContain('TaskDescription: B revised description');
    expect(prompt).toContain('B revised rubric');
    expect(prompt).toContain('B_SAVED_SOURCE_ONLY');
    expect(prompt).not.toContain('B_NOTE_EXCLUDED_A1');
    expect(prompt).not.toContain('必须处理边界条件');
    const savedFeedback = await feedbackModel
      .findOne({ submissionId: new Types.ObjectId(id) })
      .lean()
      .exec();
    expect(savedFeedback?.source).toBe('AI');
    const first = await studentAgent
      .get('/api/learning-tasks/submissions/' + submissionId)
      .expect(200);
    const second = await studentAgent
      .get('/api/learning-tasks/submissions/' + id)
      .expect(200);
    expect(
      (first.body as { content: { submissionNote: string } }).content
        .submissionNote,
    ).toBe('NOTE_FULL_A2_MODEL_INPUT');
    expect(
      (second.body as { content: { submissionNote: string } }).content
        .submissionNote,
    ).toBe('B_NOTE_FULL_A2');
  });
  it.each(['source', 'note'])(
    'rejects complete input oversized by %s without losing saved work or calling HTTP',
    async (material) => {
      clearCapturedPayloads();
      setResponses([]);
      const long = '中'.repeat(19990) + '完整尾部';
      const code =
        material === 'source' ? long : 'console.log("small source");';
      const note = material === 'note' ? long : 'small note';
      const id = await submitAndRequest(code, note);
      expect(await aiFeedbackProcessor.processOnce(1)).toEqual({
        processed: 1,
        succeeded: 0,
        failed: 0,
        dead: 1,
      });
      const detail = await readReview(id);
      expect(detail.aiFeedbackStatus).toBe('DEAD');
      expect(detail.content).toMatchObject({
        codeText: code,
        submissionNote: note,
      });
      expect(detail.aiReview).toMatchObject({
        provider: 'bailian',
        inputCoverage: 'NOT_SENT',
        failure: {
          code: 'INPUT_BUDGET_EXCEEDED',
          message: '作业已保存，完整内容超过 AI 输入限额，本次未生成 AI 反馈。',
        },
        usage: {
          reservedRequests: 0,
          reportedRequests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      });
      expect(getCapturedPayloads()).toHaveLength(0);
      expect(
        await feedbackModel.countDocuments({
          submissionId: new Types.ObjectId(id),
          source: 'AI',
        }),
      ).toBe(0);
      const repeated = await studentAgent
        .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
        .send({})
        .expect(200);
      expect(repeated.body).toMatchObject({ status: 'DEAD' });
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        processed: 0,
      });
      expect(getCapturedPayloads()).toHaveLength(0);
      const saved = await aiFeedbackJobModel
        .findOne({ submissionId: new Types.ObjectId(id) })
        .lean()
        .exec();
      expect(saved?.attempts).toBe(1);
      if (material === 'source')
        console.info(
          'A2 budget rejection public aiReview=' +
            JSON.stringify(detail.aiReview),
        );
    },
  );

  it.each([
    ['length', { finish: 'length' }, 'OUTPUT_LIMIT_REACHED', 1],
    ['bad JSON', { content: 'not-json' }, 'INVALID_RESPONSE', 1],
    ['malformed envelope', { raw: '{broken' }, 'INVALID_RESPONSE', 0],
    ['auth', { status: 401 }, 'PROVIDER_CONFIGURATION', 1],
  ] as const)(
    'preserves usage for %s without partial feedback',
    async (_name, response, code, reported) => {
      clearCapturedPayloads();
      setResponses([response]);
      const id = await submitAndRequest();
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        dead: 1,
        succeeded: 0,
      });
      const detail = await readReview(id);
      expect(detail.aiReview).toMatchObject({
        failure: { code },
        inputCoverage: 'UNKNOWN',
        usage: {
          reservedRequests: 1,
          reportedRequests: reported,
          promptTokens: reported ? 100 : null,
          completionTokens: reported ? 20 : null,
          totalTokens: reported ? 120 : null,
        },
      });
      expect(getCapturedPayloads()).toHaveLength(1);
      expect(
        await feedbackModel.countDocuments({
          submissionId: new Types.ObjectId(id),
          source: 'AI',
        }),
      ).toBe(0);
    },
  );

  it('keeps successful missing usage unknown, including across student/teacher detail reads', async () => {
    clearCapturedPayloads();
    setResponses([{ usage: undefined }]);
    const id = await submitAndRequest();
    expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
      succeeded: 1,
    });
    const student = await readReview(id),
      teacher = await readReview(id, teacherAgent);
    expect(student.aiReview).toEqual(teacher.aiReview);
    expect(student.aiReview).toMatchObject({
      inputCoverage: 'FULL',
      usage: {
        reservedRequests: 1,
        reportedRequests: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
    });
    expect(JSON.stringify(student.aiReview)).not.toMatch(
      /lastError|lockOwner|requests|inputBytes|test-key|reasoning_content/,
    );
  });

  it.each([false, true])(
    'counts retryable failure usage across three claims; unknownFirst=%p',
    async (unknownFirst) => {
      clearCapturedPayloads();
      setResponses([
        { status: 429, usage: unknownFirst ? undefined : validUsage },
        { status: 503 },
        {},
      ]);
      const id = await submitAndRequest();
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        failed: 1,
      });
      const config = app.get(ConfigService);
      expect((await readReview(id)).aiReview.retryScheduled).toBe(false);
      config.set('AI_FEEDBACK_WORKER_ENABLED', true);
      expect((await readReview(id)).aiReview).toMatchObject({
        retryScheduled: true,
        failure: { code: 'RATE_LIMITED' },
      });
      config.set('AI_FEEDBACK_WORKER_ENABLED', false);
      await makeDue(id);
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        failed: 1,
      });
      await makeDue(id);
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        succeeded: 1,
      });
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        processed: 0,
      });
      const job = await aiFeedbackJobModel
        .findOne({ submissionId: new Types.ObjectId(id) })
        .lean()
        .exec();
      expect(job).toMatchObject({
        budgetVersion: 1,
        attempts: 3,
        maxAttempts: 3,
      });
      expect(job?.requests?.map((r) => r.claimNo)).toEqual([1, 2, 3]);
      expect(getCapturedPayloads()).toHaveLength(3);
      expect((await readReview(id)).aiReview.usage).toEqual({
        reservedRequests: 3,
        reportedRequests: unknownFirst ? 2 : 3,
        promptTokens: unknownFirst ? null : 300,
        completionTokens: unknownFirst ? null : 60,
        totalTokens: unknownFirst ? null : 360,
      });
      console.info(
        'A2 retry evidence: requests=3; totalTokens=' +
          (unknownFirst ? 'null' : '360'),
      );
    },
  );

  it('stops after three retryable failures, retaining the final reason and valid failure usage', async () => {
    clearCapturedPayloads();
    setResponses([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const id = await submitAndRequest();
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await makeDue(id);
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject(
        i === 2 ? { dead: 1 } : { failed: 1 },
      );
    }
    const detail = await readReview(id);
    expect(detail.aiReview).toMatchObject({
      failure: { code: 'UPSTREAM_UNAVAILABLE' },
      retryScheduled: false,
      nextRetryAt: null,
      usage: { reservedRequests: 3, reportedRequests: 3, totalTokens: 360 },
    });
    expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
      processed: 0,
    });
    expect(getCapturedPayloads()).toHaveLength(3);
    const job = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(id) })
      .lean()
      .exec();
    expect(job).toMatchObject({
      status: 'DEAD',
      attempts: 3,
      notBefore: null,
      lockedAt: null,
      lockOwner: null,
    });
  });

  it('records timeout reservation as unknown and retries at most once per claim', async () => {
    clearCapturedPayloads();
    setResponses([{ hold: true }, {}]);
    const config = app.get(ConfigService),
      previous = config.get<number>('BAILIAN_TIMEOUT_MS');
    config.set('BAILIAN_TIMEOUT_MS', 1000);
    try {
      const id = await submitAndRequest();
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        failed: 1,
      });
      expect((await readReview(id)).aiReview).toMatchObject({
        failure: { code: 'UPSTREAM_UNAVAILABLE' },
        usage: { reservedRequests: 1, reportedRequests: 0, totalTokens: null },
      });
      await makeDue(id);
      expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
        succeeded: 1,
      });
      expect((await readReview(id)).aiReview.usage).toMatchObject({
        reservedRequests: 2,
        reportedRequests: 1,
        totalTokens: null,
      });
      expect(getCapturedPayloads()).toHaveLength(2);
    } finally {
      config.set('BAILIAN_TIMEOUT_MS', previous);
    }
  });

  it('keeps concurrent process-once and repeated public requests idempotent', async () => {
    clearCapturedPayloads();
    setResponses([]);
    const id = await submitAndRequest();
    const requests = await Promise.all(
      Array.from({ length: 3 }, () =>
        studentAgent
          .post(
            '/api/learning-tasks/submissions/' + id + '/ai-feedback/request',
          )
          .send({})
          .expect(200),
      ),
    );
    expect(
      new Set(requests.map((r) => (r.body as { jobId: string }).jobId)).size,
    ).toBe(1);
    const processed = await Promise.all([
      aiFeedbackProcessor.processOnce(1),
      aiFeedbackProcessor.processOnce(1),
    ]);
    expect(processed.reduce((n, r) => n + r.processed, 0)).toBe(1);
    expect(getCapturedPayloads()).toHaveLength(1);
    expect(
      await aiFeedbackJobModel.countDocuments({
        submissionId: new Types.ObjectId(id),
      }),
    ).toBe(1);
    expect(
      (
        await aiFeedbackJobModel
          .findOne({ submissionId: new Types.ObjectId(id) })
          .lean()
          .exec()
      )?.attempts,
    ).toBe(1);
    const repeated = await studentAgent
      .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
      .send({})
      .expect(200);
    expect(repeated.body).toMatchObject({ status: 'SUCCEEDED' });
    expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
      processed: 0,
    });
    expect(getCapturedPayloads()).toHaveLength(1);
    console.info(
      'A2 concurrency: one claim, one Job, one mock request; terminal repeated request unchanged',
    );
  });

  it('terminates legacy nonterminal jobs without calls and leaves terminal history untouched', async () => {
    clearCapturedPayloads();
    setResponses([]);
    const id = await submitAndRequest();
    await aiFeedbackJobModel.updateOne(
      { submissionId: new Types.ObjectId(id) },
      { $unset: { budgetVersion: 1, requests: 1 } },
    );
    expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({ dead: 1 });
    expect((await readReview(id)).aiReview).toMatchObject({
      inputCoverage: 'UNKNOWN',
      failure: { code: 'LEGACY_JOB_UNSUPPORTED' },
      usage: {
        reservedRequests: null,
        reportedRequests: null,
        totalTokens: null,
      },
    });
    const historyId = await submitAndRequest();
    await aiFeedbackJobModel.updateOne(
      { submissionId: new Types.ObjectId(historyId) },
      {
        $set: { status: 'SUCCEEDED' },
        $unset: { budgetVersion: 1, requests: 1 },
      },
    );
    const before = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(historyId) })
      .lean()
      .exec();
    expect(await aiFeedbackProcessor.processOnce(1)).toMatchObject({
      processed: 0,
    });
    const after = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(historyId) })
      .lean()
      .exec();
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('budgetVersion');
    expect((await readReview(historyId)).aiReview.usage.totalTokens).toBeNull();
    expect(getCapturedPayloads()).toHaveLength(0);
    console.info(
      'A2 legacy: zero mock requests; terminal document unchanged; usage null',
    );
  });
});
