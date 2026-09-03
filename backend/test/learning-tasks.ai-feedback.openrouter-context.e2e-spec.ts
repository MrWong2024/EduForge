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

type OpenRouterMessage = {
  role?: string;
  content?: string;
};

type OpenRouterRequestPayload = {
  model?: string;
  messages?: OpenRouterMessage[];
};

const startMockOpenRouter = () =>
  new Promise<{
    server: http.Server;
    url: string;
    getCapturedPayloads: () => OpenRouterRequestPayload[];
    clearCapturedPayloads: () => void;
  }>((resolve) => {
    const capturedPayloads: OpenRouterRequestPayload[] = [];
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
            capturedPayloads.push(
              JSON.parse(rawBody) as OpenRouterRequestPayload,
            );
          } catch {
            capturedPayloads.push({});
          }
        } else {
          capturedPayloads.push({});
        }
        const payload = {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      type: 'LOGIC',
                      severity: 'WARN',
                      message: 'Mock item 1',
                      suggestion: 'Mock suggestion 1',
                      tags: ['correctness'],
                    },
                  ],
                  meta: { model: 'mock-openrouter' },
                }),
              },
            },
          ],
        };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        resolve({
          server,
          url: 'http://127.0.0.1:0',
          getCapturedPayloads: () => [...capturedPayloads],
          clearCapturedPayloads: () => {
            capturedPayloads.length = 0;
          },
        });
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        getCapturedPayloads: () => [...capturedPayloads],
        clearCapturedPayloads: () => {
          capturedPayloads.length = 0;
        },
      });
    });
  });

describe('LearningTasks AI Feedback OpenRouter Context (e2e)', () => {
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
  let getCapturedPayloads: () => OpenRouterRequestPayload[];
  let clearCapturedPayloads: () => void;

  let teacherId = '';
  let studentId = '';
  let taskId = '';
  let submissionId = '';
  let previousWorkerEnabled: string | undefined;
  let previousProvider: string | undefined;
  let previousApiKey: string | undefined;
  let previousBaseUrl: string | undefined;
  let previousDebugEnabled: string | undefined;

  const teacherEmail = `teacher.openrouter.ctx.${Date.now()}@example.com`;
  const studentEmail = `student.openrouter.ctx.${Date.now()}@example.com`;
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

  beforeAll(async () => {
    const mock = await startMockOpenRouter();
    mockServer = mock.server;
    getCapturedPayloads = mock.getCapturedPayloads;
    clearCapturedPayloads = mock.clearCapturedPayloads;

    try {
      previousWorkerEnabled = process.env.AI_FEEDBACK_WORKER_ENABLED;
      process.env.AI_FEEDBACK_WORKER_ENABLED = 'false';
      previousProvider = process.env.AI_FEEDBACK_PROVIDER;
      process.env.AI_FEEDBACK_PROVIDER = 'openrouter';
      previousApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-key';
      previousBaseUrl = process.env.OPENROUTER_BASE_URL;
      process.env.OPENROUTER_BASE_URL = mock.url;
      previousDebugEnabled = process.env.AI_FEEDBACK_DEBUG_ENABLED;
      process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

      // Load AppModule after env is set, otherwise provider config can be fixed too early.
      const appModuleExports =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/app.module') as typeof AppModuleExports;
      const { AppModule } = appModuleExports;
      if (!process.env.MONGO_URI) {
        throw new Error(
          'MONGO_URI is required for learning-tasks ai-feedback openrouter context e2e.',
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
      expect(configService.get<string>('AI_FEEDBACK_PROVIDER')).toBe(
        'openrouter',
      );
      expect(configService.get<string>('OPENROUTER_BASE_URL')).toBe(mock.url);

      teacherAgent = request.agent(app.getHttpServer());
      studentAgent = request.agent(app.getHttpServer());

      userModel = app.get(getModelToken(User.name));
      sessionModel = app.get(getModelToken(Session.name));
      taskModel = app.get(getModelToken(Task.name));
      submissionModel = app.get(getModelToken(Submission.name));
      feedbackModel = app.get(getModelToken(Feedback.name));
      aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
      aiFeedbackProcessor = app.get(AiFeedbackProcessor);

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

      const createdTask = await teacherAgent
        .post('/api/learning-tasks/tasks')
        .send({
          title: 'OpenRouter Context Task',
          description: '实现一个函数并满足题目要求与评分标准。',
          rubric: {
            keyRequirements: ['必须处理边界条件', '必须给出可读实现'],
            scoring: { correctness: 70, readability: 30 },
          },
          knowledgeModule: 'ai-openrouter',
          stage: 1,
          status: 'DRAFT',
        })
        .expect(201);
      taskId = (createdTask.body as CreatedTaskResponse).id;

      await teacherAgent
        .post(`/api/learning-tasks/tasks/${taskId}/publish`)
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
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousApiKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousBaseUrl;
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
      if (taskId) {
        cleanup.push(taskModel.deleteOne({ _id: taskId }));
      }
      const userIds = [teacherId, studentId].filter(Boolean);
      if (userIds.length > 0) {
        cleanup.push(sessionModel.deleteMany({ userId: { $in: userIds } }));
        cleanup.push(userModel.deleteMany({ _id: { $in: userIds } }));
      }
      await Promise.all(cleanup);
    }

    if (app) {
      await app.close();
    }
    if (mockServer && mockServer.listening) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it('passes task context and zh-cn instruction to mock OpenRouter and keeps feedback pipeline persisted', async () => {
    clearCapturedPayloads();

    const createdSubmission = await studentAgent
      .post(`/api/learning-tasks/tasks/${taskId}/submissions`)
      .send({
        content: {
          codeText:
            'function solveQuadratic(a: number, b: number, c: number) { return [a, b, c]; }',
          language: 'typescript',
        },
        meta: {
          aiUsageDeclaration: 'I used AI for brainstorming only.',
        },
      })
      .expect(201);
    submissionId = (createdSubmission.body as CreatedSubmissionResponse).id;

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
    expect(userPrompt).toContain('TaskTitle: OpenRouter Context Task');
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
});
