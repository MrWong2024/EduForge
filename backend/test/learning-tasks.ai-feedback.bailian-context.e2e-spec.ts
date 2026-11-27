import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AiContextReaderService } from '../src/modules/learning-tasks/ai-context/ai-context-reader.service';
import type { AiContextRef } from '../src/modules/learning-tasks/ai-context/ai-context.types';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { Connection, Model, mongo, Types } from 'mongoose';
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
import { PasswordResetToken } from '../src/modules/auth/schemas/password-reset-token.schema';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { Submission } from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import { AiFeedbackProcessor } from '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service';
import { LearningTasksService } from '../src/modules/learning-tasks/services/learning-tasks.service';
import {
  AiFeedbackJob,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiReviewSummary } from '../src/modules/learning-tasks/ai-feedback/lib/ai-review-summary';
import type { FeedbackResponseDto } from '../src/modules/learning-tasks/dto/feedback-response.dto';
import { isLocalSingleNodeReplicaSetPrimary } from '../src/config/local-mongo-replica-set';
import {
  CLASSROOM_TASK_TRANSACTION_CONNECTION,
  getClassroomTaskTransactionModel,
  runClassroomTaskTransaction,
} from '../src/lib/classroom-task-transaction';
import type * as AppModuleExports from '../src/app.module';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from './helpers/local-test-database-auth';

jest.setTimeout(30000);

type CreatedTaskResponse = {
  id: string;
};

type ReferenceTaskEvidence = {
  _id: Types.ObjectId;
  title: string;
  description: string;
  status: string;
  aiContextRefs?: AiContextRef[];
  publishedAt?: Date;
  updatedAt: Date;
};

type CreatedSubmissionResponse = {
  id: string;
  contentRevision: number;
};

type ProcessOnceResponse = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

async function waitForResultBarrier<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out: ' + label)),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  prompt_tokens_details: { text_tokens: 100, cached_tokens: 30 },
  completion_tokens_details: { text_tokens: 20, reasoning_tokens: 12 },
};
const fixedSampleUsage = {
  prompt_tokens: 12993,
  completion_tokens: 3632,
  total_tokens: 16625,
  prompt_tokens_details: { text_tokens: 12993, cached_tokens: 0 },
  completion_tokens_details: { text_tokens: 3632, reasoning_tokens: 3230 },
};
const expectedValidRequestUsage = {
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  inputTextTokens: 100,
  cachedInputTokens: 30,
  outputTextTokens: 20,
  reasoningTokens: 12,
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
  let taskModel: Model<Task>;
  let submissionModel: Model<Submission>;
  let feedbackModel: Model<Feedback>;
  let aiFeedbackJobModel: Model<AiFeedbackJob>;
  let transactionConnection: Connection;
  let independentConnection: Connection;
  let databaseVerified = false;
  let aiFeedbackProcessor: AiFeedbackProcessor;
  let teacherAgent: ReturnType<typeof request.agent>;
  let studentAgent: ReturnType<typeof request.agent>;
  let mockServer: http.Server;
  let getCapturedPayloads: () => BailianRequestPayload[];
  let clearCapturedPayloads: () => void;
  let setResponses: (responses: MockResponse[]) => void;

  let contextRoot = '';
  const contextTaskIds: string[] = [];
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
      contentRevision: number;
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
      .send({
        expectedRevision: (res.body as CreatedSubmissionResponse)
          .contentRevision,
      })
      .expect(200);
    return id;
  };
  const processOwned = async (batchSize: number) => {
    const foreign = await aiFeedbackJobModel.countDocuments({
      status: {
        $in: [
          AiFeedbackJobStatus.Pending,
          AiFeedbackJobStatus.Failed,
          AiFeedbackJobStatus.Running,
        ],
      },
      submissionId: { $nin: submissionIds.map((id) => new Types.ObjectId(id)) },
    });
    expect(foreign).toBe(0);
    return aiFeedbackProcessor.processOnce(batchSize);
  };
  const refs: AiContextRef[] = [
    {
      archivePath: 'book/student.zip',
      entryPaths: ['资料/AI任务委托卡.md', 'src/C++.cpp'],
    },
    { archivePath: 'book/teacher.zip', entryPaths: ['teacher/guide.md'] },
  ];
  const replacementRefs: AiContextRef[] = [
    { archivePath: 'book/teacher.zip', entryPaths: ['teacher/alternate.md'] },
    { archivePath: 'book/student.zip', entryPaths: ['src/C++.cpp'] },
  ];
  const readReferenceTask = async (id: string) => {
    const database = taskModel.db.db;
    if (!database) throw new Error('Missing connected test database');
    const task = await database
      .collection<ReferenceTaskEvidence>(taskModel.collection.collectionName)
      .findOne(
        { _id: new Types.ObjectId(id) },
        {
          projection: {
            title: 1,
            description: 1,
            status: 1,
            aiContextRefs: 1,
            publishedAt: 1,
            updatedAt: 1,
          },
          maxTimeMS: 5000,
        },
      );
    if (!task) throw new Error('Missing owned reference task');
    return task;
  };
  const holdValidatedReferences = () => {
    const reader = app.get<AiContextReaderService>(AiContextReaderService);
    const validate = reader.validateForSave.bind(
      reader,
    ) as AiContextReaderService['validateForSave'];
    const service = app.get<LearningTasksService>(LearningTasksService);
    // Call-through spies retain the real server promises, including requests
    // whose clients time out before their business operations finish.
    const handlers = [
      jest.spyOn(service, 'updateTask'),
      jest.spyOn(service, 'publishTask'),
    ];
    let release!: () => void;
    let reached!: () => void;
    let held = false;
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const validated = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const withinDeadline = async (
      operation: Promise<void>,
      timeoutMs: number,
      message = 'Reference validation barrier timed out',
    ) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          operation,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const spy = jest
      .spyOn(reader, 'validateForSave')
      .mockImplementation(async (references) => {
        await validate(references);
        if (!held && JSON.stringify(references) === JSON.stringify(refs)) {
          held = true;
          reached();
          await withinDeadline(resumed, 10000);
        }
      });
    return {
      waitUntilValidated: () => withinDeadline(validated, 5000),
      release,
      waitForRequests: async () => {
        const requests: Promise<unknown>[] = [];
        for (const handler of handlers) {
          for (const result of handler.mock.results) {
            if (result.type === 'return')
              requests.push(Promise.resolve(result.value));
          }
        }
        await withinDeadline(
          Promise.allSettled(requests).then(() => undefined),
          15000,
          'Reference task handler drain timed out',
        );
      },
      restore: () => {
        spy.mockRestore();
        for (const handler of handlers) handler.mockRestore();
      },
    };
  };
  const contextTask = async (aiContextRefs = refs, status = 'PUBLISHED') => {
    const response = await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: 'ZIP task',
        description: 'ZIP_REQUIREMENTS',
        rubric: { criterion: 'ZIP_RUBRIC' },
        knowledgeModule: 'zip-context',
        status,
        aiContextRefs,
      })
      .expect(201);
    const id = (response.body as CreatedTaskResponse).id;
    contextTaskIds.push(id);
    return id;
  };
  const publishContext = async (id: string) => {
    const response = await teacherAgent
      .post('/api/classrooms/' + classroomIds[0] + '/tasks')
      .send({ taskId: id })
      .expect(201);
    const instance = (response.body as CreatedTaskResponse).id;
    instanceIds.push(instance);
    return instance;
  };
  const submitContext = async (instance: string) => {
    const response = await studentAgent
      .post(
        '/api/classrooms/' +
          classroomIds[0] +
          '/tasks/' +
          instance +
          '/submissions',
      )
      .send({
        content: {
          codeText: 'STUDENT_ZIP_CODE',
          language: 'cpp',
          submissionNote: 'STUDENT_ZIP_NOTE',
        },
        meta: { aiUsageDeclaration: 'STUDENT_ZIP_AI' },
      })
      .expect(201);
    const id = (response.body as CreatedSubmissionResponse).id;
    submissionIds.push(id);
    return id;
  };
  const requestContext = async (id: string) => {
    const detail = await readReview(id);
    return studentAgent
      .post('/api/learning-tasks/submissions/' + id + '/ai-feedback/request')
      .send({ expectedRevision: detail.contentRevision })
      .expect(200);
  };
  const makeDue = async (id: string) => {
    // Approved controlled scheduling advancement; no status/attempt/usage rewrite.
    await aiFeedbackJobModel.updateOne(
      {
        submissionId: new Types.ObjectId(id),
        status: AiFeedbackJobStatus.Failed,
      },
      { $set: { notBefore: new Date(0) } },
    );
  };

  const holdResultInsert = (
    submission: Types.ObjectId,
    message: string,
    abort: boolean,
  ) => {
    let signalReached!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const models = [
      feedbackModel,
      getClassroomTaskTransactionModel(transactionConnection, feedbackModel),
    ];
    const spies = models.map(({ collection, db }) => {
      const database = db.db;
      if (!database) throw new Error('Missing feedback write database');
      const insertMany = collection.insertMany.bind(
        collection,
      ) as typeof collection.insertMany;
      return jest
        .spyOn(collection, 'insertMany')
        .mockImplementation(async (docs, options) => {
          if (
            !docs.some(
              (doc) =>
                submission.equals(doc.submissionId as Types.ObjectId) &&
                doc.message === message,
            )
          ) {
            return insertMany(docs, options);
          }
          const write = await insertMany(docs, options).then(
            (result) => ({ result }) as const,
            (error: unknown) => {
              // Before the fix an unordered write could insert the new row and
              // report the historical duplicate in the same response.
              if (
                options?.session ||
                !(error instanceof mongo.MongoServerError) ||
                error.code !== 11000
              ) {
                throw error;
              }
              return { error } as const;
            },
          );
          if (
            !(await database.collection(collection.name).findOne(
              {
                submissionId: submission,
                source: FeedbackSource.AI,
                message,
              },
              {
                session: options?.session,
                maxTimeMS: 3000,
                readPreference: 'primary',
              },
            ))
          ) {
            throw new Error('No new feedback was written at the barrier');
          }
          signalReached();
          await waitForResultBarrier(released, 'release the result write');
          if (abort)
            throw new Error('Controlled non-transient result write failure');
          if ('error' in write) throw write.error;
          return write.result;
        });
    });
    return {
      reached: waitForResultBarrier(reached, 'new feedback write'),
      release,
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  };

  beforeAll(async () => {
    contextRoot = await mkdtemp(resolve(tmpdir(), 'eduforge-context-http-'));
    await mkdir(resolve(contextRoot, 'book'));
    for (const file of ['student.zip', 'teacher.zip']) {
      await copyFile(
        resolve(__dirname, 'fixtures/ai-context', file),
        resolve(contextRoot, 'book', file),
      );
    }
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
      // strictBindCallApply=false drops bind's type; restore the known signature.
      const originalForRoot = ConfigModule.forRoot.bind(
        ConfigModule,
      ) as typeof ConfigModule.forRoot;
      const isolatedConfig = jest
        .spyOn(ConfigModule, 'forRoot')
        .mockImplementation((options) =>
          originalForRoot({ ...options, envFilePath: ['.env.test'] }),
        );
      let appModuleExports: typeof AppModuleExports;
      try {
        appModuleExports =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../src/app.module') as typeof AppModuleExports;
      } finally {
        isolatedConfig.mockRestore();
      }
      const { AppModule } = appModuleExports;
      if (!process.env.MONGO_URI) {
        throw new Error(
          'MONGO_URI is required for learning-tasks ai-feedback bailian context e2e.',
        );
      }
      assertLocalStandardTestEnvironment({
        nodeEnv: process.env.NODE_ENV,
        purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
        mongoUri: process.env.MONGO_URI,
      });

      const contextReader = new AiContextReaderService();
      Object.defineProperty(contextReader, 'resourceRoot', {
        value: contextRoot,
      });
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(AiContextReaderService)
        .useValue(contextReader)
        .compile();

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
      const configService = app.get(ConfigService);
      expect(configService.get<string>('AI_FEEDBACK_PROVIDER')).toBe('bailian');
      expect(configService.get<string>('BAILIAN_BASE_URL')).toBe(mock.url);
      expect(configService.get('AI_FEEDBACK_WORKER_ENABLED')).toBe(false);
      expect(configService.get<string>('AI_FEEDBACK_DEBUG_ENABLED')).toBe(
        'true',
      );
      expect(configService.get('MAIL_PROVIDER')).toBe('log');

      teacherAgent = request
        .agent(app.getHttpServer())
        .timeout({ response: 5000, deadline: 10000 });
      studentAgent = request
        .agent(app.getHttpServer())
        .timeout({ response: 5000, deadline: 10000 });

      userModel = app.get(getModelToken(User.name));
      taskModel = app.get(getModelToken(Task.name));
      submissionModel = app.get(getModelToken(Submission.name));
      feedbackModel = app.get(getModelToken(Feedback.name));
      aiFeedbackJobModel = app.get(getModelToken(AiFeedbackJob.name));
      aiFeedbackProcessor = app.get(AiFeedbackProcessor);
      transactionConnection = app.get<Connection>(
        getConnectionToken(CLASSROOM_TASK_TRANSACTION_CONNECTION),
      );
      const mongoUri = configService.getOrThrow<string>('MONGO_URI');
      const environment = {
        nodeEnv: process.env.NODE_ENV,
        purpose: process.env.EDUFORGE_DATABASE_PURPOSE,
        mongoUri,
      };
      assertLocalStandardTestEnvironment(environment);
      independentConnection = mongoose.createConnection(mongoUri, {
        autoCreate: false,
        autoIndex: false,
        readPreference: 'primary',
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        waitQueueTimeoutMS: 5000,
      });
      await independentConnection.asPromise();
      for (const connection of [
        userModel.db,
        transactionConnection,
        independentConnection,
      ]) {
        const database = connection.db;
        if (!database) throw new Error('Missing connected test database');
        const options = {
          signal: AbortSignal.timeout(5000),
          readPreference: 'primary',
        } as const;
        const auth = await database.command(
          { connectionStatus: 1, showPrivileges: false },
          options,
        );
        assertLocalStandardTestAuthentication({
          ...environment,
          databaseName: database.databaseName,
          connectedHost: connection.host,
          authInfo: auth.authInfo,
        });
        const seed = connection.getClient().options.hosts[0]?.toString() ?? '';
        const hello: unknown = await database.command({ hello: 1 }, options);
        expect(isLocalSingleNodeReplicaSetPrimary(hello, seed)).toBe(true);
      }
      await runClassroomTaskTransaction(
        transactionConnection,
        async (transaction) => {
          await transaction
            .model(aiFeedbackJobModel)
            .findOne({ _id: new Types.ObjectId() })
            .session(transaction.session)
            .setOptions(transaction.readOptions())
            .lean()
            .exec();
        },
      );
      databaseVerified = true;
      userModel.db.set('maxTimeMS', 10000);
      await app.init();
      console.info(
        'Bailian context E2E gate: default, transaction and independent connections use standard_test / eduforge_test, local writable rs0 and root@admin; read-only transaction committed; envFiles=.env.test; worker=false; local mock',
      );
      expect(
        await aiFeedbackJobModel.countDocuments({
          status: {
            $in: [
              AiFeedbackJobStatus.Pending,
              AiFeedbackJobStatus.Failed,
              AiFeedbackJobStatus.Running,
            ],
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

      await userModel.create({
        email: teacherEmail,
        passwordHash: teacherHash,
        roles: ['teacher'],
      });
      await userModel.create({
        email: studentEmail,
        passwordHash: studentHash,
        roles: ['student'],
      });

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
          status: 'DRAFT',
        })
        .expect(201);
      taskId = (createdTask.body as CreatedTaskResponse).id;

      await teacherAgent
        .post(`/api/learning-tasks/tasks/${taskId}/publish`)
        .send({})
        .expect(201);
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
          .send({ taskId })
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
      if (databaseVerified) {
        const database = independentConnection.db;
        if (!database) throw new Error('Missing cleanup verification database');
        const emails = { $in: [teacherEmail, studentEmail] };
        const users = await userModel
          .find({ email: emails })
          .select('_id')
          .lean<Array<{ _id: Types.ObjectId }>>()
          .exec();
        const owned = (ids: string[]) => ({
          $in: ids.filter(Boolean).map((id) => new Types.ObjectId(id)),
        });
        const ownedSubmissions = owned(submissionIds);
        const ownedClassrooms = owned(classroomIds);
        const ownedUsers = { $in: users.map((user) => user._id) };
        const scopes: Array<[string, Record<string, unknown>]> = [
          [Feedback.name, { submissionId: ownedSubmissions }],
          [AiFeedbackJob.name, { submissionId: ownedSubmissions }],
          [Submission.name, { _id: ownedSubmissions }],
          [ClassroomTask.name, { _id: owned(instanceIds) }],
          [Task.name, { _id: owned([taskId, ...contextTaskIds]) }],
          [Enrollment.name, { classroomId: ownedClassrooms }],
          [Classroom.name, { _id: ownedClassrooms }],
          [Course.name, { _id: owned([courseId]) }],
          [Session.name, { userId: ownedUsers }],
          [PasswordResetToken.name, { userId: ownedUsers }],
          [User.name, { email: emails }],
        ];
        for (const [name, filter] of scopes) {
          const model = app.get<Model<unknown>>(getModelToken(name));
          await model.deleteMany(filter).exec();
          expect(
            await database
              .collection(model.collection.name)
              .countDocuments(filter, {
                maxTimeMS: 4000,
                readPreference: 'primary',
              }),
          ).toBe(0);
        }
        console.info(
          'Fixture cleanup independently verified: ' + fixtureNamespace,
        );
      }
    } finally {
      try {
        if (contextRoot) {
          await rm(contextRoot, { recursive: true, force: true });
          await expect(stat(contextRoot)).rejects.toMatchObject({
            code: 'ENOENT',
          });
        }
      } finally {
        try {
          if (app) {
            await app.close();
            if (userModel) expect(userModel.db.readyState).toBe(0);
            if (transactionConnection)
              expect(transactionConnection.readyState).toBe(0);
            const server = app.getHttpServer();
            expect(server).toBeInstanceOf(http.Server);
            if (server instanceof http.Server)
              expect(server.listening).toBe(false);
          }
        } finally {
          try {
            if (independentConnection) {
              await independentConnection.close();
              expect(independentConnection.readyState).toBe(0);
            }
          } finally {
            if (mockServer?.listening) {
              mockServer.closeAllConnections();
              await new Promise<void>((resolve) =>
                mockServer.close(() => resolve()),
              );
              expect(mockServer.listening).toBe(false);
              console.info('A2 app/DB/mock closed');
            }
          }
        }
      }
    }
  });

  it.each([
    ['commits', false],
    ['rolls back', true],
  ] as const)(
    '08 %s Job success and new AI feedback atomically',
    async (_outcome, abort) => {
      clearCapturedPayloads();
      const duplicate = {
        type: FeedbackType.Bug,
        severity: FeedbackSeverity.Warn,
        message: 'Existing boundary case message',
      };
      const novel = {
        type: FeedbackType.Design,
        severity: FeedbackSeverity.Error,
        message: 'Separate the parser from the renderer',
        tags: ['api-design'],
      };
      setResponses([
        {
          usage: validUsage,
          content: JSON.stringify({
            items: [
              {
                ...duplicate,
                suggestion: 'New draft suggestion',
                tags: ['correctness'],
                scoreHint: 31,
              },
              novel,
            ],
          }),
        },
      ]);
      const id = await submitAndRequest();
      const submission = new Types.ObjectId(id);
      const historical = await feedbackModel.create({
        submissionId: submission,
        source: FeedbackSource.AI,
        ...duplicate,
        suggestion: 'Keep historical suggestion',
        tags: ['edge-cases'],
        scoreHint: 72,
      });
      const teacher = await feedbackModel.create({
        submissionId: submission,
        source: FeedbackSource.Teacher,
        ...novel,
      });
      const database = independentConnection.db;
      if (!database) throw new Error('Missing result verification database');
      const jobs = database.collection<AiFeedbackJob>(
        aiFeedbackJobModel.collection.name,
      );
      const feedback = database.collection<Feedback>(
        feedbackModel.collection.name,
      );
      const options = { maxTimeMS: 4000, readPreference: 'primary' } as const;
      const claim = await jobs.findOne({ submissionId: submission }, options);
      if (!claim) throw new Error('Missing owned AI Job');
      const originalRows = await feedback
        .find({ submissionId: submission }, options)
        .toArray();
      const history = originalRows.find((row) =>
        row._id.equals(historical._id),
      );
      const teacherHistory = originalRows.find((row) =>
        row._id.equals(teacher._id),
      );
      expect(history).toBeDefined();
      expect(teacherHistory).toBeDefined();
      // Exercise removal of stale failure fields from a successful claim.
      await aiFeedbackJobModel.updateOne(
        { _id: claim._id },
        {
          $set: {
            lastError: 'Previous failure',
            failureCode: 'INTERNAL_ERROR',
          },
        },
      );

      const readEvidence = async (
        phase: 'paused' | 'committed' | 'rolled-back',
      ) => {
        const [job, rows, response] = await Promise.all([
          jobs.findOne({ _id: claim._id }, options),
          feedback.find({ submissionId: submission }, options).toArray(),
          studentAgent
            .get('/api/learning-tasks/submissions/' + id + '/feedback')
            .expect(200),
        ]);
        const publicRows = response.body as FeedbackResponseDto[];
        const newCount = rows.filter(
          (row) =>
            row.source === FeedbackSource.AI && row.message === novel.message,
        ).length;
        const reported = job?.requests?.filter(
          (item) => item.usage !== null,
        ).length;
        console.info('08 result evidence', {
          phase,
          submissionId: id,
          jobId: claim._id.toString(),
          status: job?.status,
          historicalAI: rows.filter((row) => row._id.equals(historical._id))
            .length,
          newAI: newCount,
          httpFeedbackStatus: response.status,
          httpHistoricalAI: publicRows.filter(
            (row) => row.id === historical._id.toString(),
          ).length,
          httpNewAI: publicRows.filter(
            (row) =>
              row.source === FeedbackSource.AI && row.message === novel.message,
          ).length,
          modelHttp: getCapturedPayloads().length,
          reserved: job?.requests?.length,
          reported,
          attempts: job?.attempts,
        });
        expect(rows.find((row) => row._id.equals(historical._id))).toEqual(
          history,
        );
        expect(rows.find((row) => row._id.equals(teacher._id))).toEqual(
          teacherHistory,
        );
        expect(publicRows.map((row) => row.id).sort()).toEqual(
          rows.map((row) => row._id.toString()).sort(),
        );
        expect(getCapturedPayloads()).toHaveLength(1);
        expect(job?.attempts).toBe(1);
        expect(job?.requests).toHaveLength(1);
        expect(job?.requests?.[0]).toMatchObject({
          claimNo: 1,
          usage: expectedValidRequestUsage,
        });
        return { job, rows, newCount };
      };

      const barrier = holdResultInsert(submission, novel.message, abort);
      const processing = processOwned(1);
      void processing.catch(() => undefined);
      let paused: Awaited<ReturnType<typeof readEvidence>>;
      let processed: ProcessOnceResponse;
      try {
        let reached = false;
        await Promise.race([
          barrier.reached.then(() => {
            reached = true;
          }),
          processing.then(async (result) => {
            if (reached) return;
            const ended = await jobs.findOne({ _id: claim._id }, options);
            throw new Error(
              'Processing finished before the feedback write barrier: ' +
                JSON.stringify({
                  result,
                  status: ended?.status,
                  failureCode: ended?.failureCode,
                  modelHttp: getCapturedPayloads().length,
                  reserved: ended?.requests?.length,
                }),
            );
          }),
        ]);
        paused = await readEvidence('paused');
      } finally {
        barrier.release();
        try {
          processed = await processing;
          console.info('08 processOnce evidence', processed);
        } finally {
          barrier.restore();
        }
      }
      expect(paused.job?.status).toBe(AiFeedbackJobStatus.Running);
      expect(paused.job?.lockOwner).toEqual(expect.any(String));
      // This also reproduces the regression: the legacy write allows one new
      // item to escape while the still-locked Job is externally RUNNING.
      expect(paused.newCount).toBe(0);
      expect(paused.rows).toHaveLength(2);

      const completed = await readEvidence(abort ? 'rolled-back' : 'committed');
      expect(completed.newCount).toBe(abort ? 0 : 1);
      expect(completed.rows).toHaveLength(abort ? 2 : 3);
      expect(completed.job).toMatchObject({
        status: abort
          ? AiFeedbackJobStatus.Dead
          : AiFeedbackJobStatus.Succeeded,
        lockOwner: null,
        lockedAt: null,
        notBefore: null,
        lastError: abort ? 'AI_FEEDBACK: INTERNAL_ERROR' : null,
        failureCode: abort ? 'INTERNAL_ERROR' : null,
      });
      expect(completed.job?.requests).toEqual(paused.job?.requests);
      expect(processed).toEqual({
        processed: 1,
        succeeded: abort ? 0 : 1,
        failed: 0,
        dead: abort ? 1 : 0,
      });
    },
  );

  it('passes task context and zh-cn instruction to mock Bailian and keeps feedback pipeline persisted', async () => {
    clearCapturedPayloads();
    setResponses([{ usage: fixedSampleUsage }]);

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

    await requestContext(submissionId);

    const processResult: ProcessOnceResponse = await processOwned(1);
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
      enable_thinking: true,
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
      'Valid boundary example C (supported affirmation without suggestion)',
    );
    expect(systemPrompt).toContain(
      'Valid protocol boundary example D (empty-array compatibility): {"items":[]}.',
    );
    expect(systemPrompt).toContain(
      'Invalid example E: an evaluable submission with a concrete conclusion',
    );
    expect(systemPrompt).toContain('rubric 的语义识别并审查所有实质评价维度');
    expect(systemPrompt).toContain(
      '来源、执行者及模拟声明只作用于其实际指向的活动、段落或材料',
    );
    expect(userPrompt).not.toContain('NOTE_EXCLUDED_FROM_A1_MODEL_INPUT');
    expect(userPrompt).not.toContain('B revised');
    expect(userPrompt).toContain('TaskTitle: Bailian Context Task');
    expect(userPrompt).toContain(
      'TaskDescription: 实现一个函数并满足题目要求与评分标准。',
    );
    expect(userPrompt).toContain('TaskRubric:');
    expect(userPrompt).toContain('必须处理边界条件');
    expect(systemPrompt).toContain(
      '必须区分“未实现功能”与“已写出逻辑但因语法/编译错误无法运行”',
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
    expect(systemPrompt).toContain('返回 1 条 INFO，suggestion 可以省略');
    expect(userPrompt).toContain(
      'keep all substantive dimensions traceable in message',
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
        unreportedRequests: 0,
        promptTokens: 12993,
        completionTokens: 3632,
        totalTokens: 16625,
        inputTextTokens: 12993,
        cachedInputTokens: 0,
        uncachedInputTokens: 12993,
        outputTextTokens: 3632,
        reasoningTokens: 3230,
        answerTokens: 402,
      },
    });
    const teacherDetail = await readReview(submissionId, teacherAgent);
    expect(teacherDetail.aiReview.usage).toEqual(detail.aiReview.usage);
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
    expect(savedRecord?.requests?.[0].usage).toEqual({
      promptTokens: 12993,
      completionTokens: 3632,
      totalTokens: 16625,
      inputTextTokens: 12993,
      cachedInputTokens: 0,
      outputTextTokens: 3632,
      reasoningTokens: 3230,
    });
    expect(savedRecord?.requests?.[0].usage).not.toHaveProperty('answerTokens');
    expect(savedRecord?.requests?.[0].usage).not.toHaveProperty(
      'uncachedInputTokens',
    );
    expect(savedRecord?.requests?.[0].usage).not.toHaveProperty(
      'unreportedRequests',
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
    await requestContext(id);
    expect(await processOwned(1)).toEqual({
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
      expect(await processOwned(1)).toEqual({
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
          unreportedRequests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          inputTextTokens: 0,
          cachedInputTokens: 0,
          uncachedInputTokens: 0,
          outputTextTokens: 0,
          reasoningTokens: 0,
          answerTokens: 0,
        },
      });
      expect(getCapturedPayloads()).toHaveLength(0);
      expect(
        await feedbackModel.countDocuments({
          submissionId: new Types.ObjectId(id),
          source: FeedbackSource.AI,
        }),
      ).toBe(0);
      const repeated = await requestContext(id);
      expect(repeated.body).toMatchObject({ status: 'DEAD' });
      expect(await processOwned(1)).toMatchObject({
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
      expect(await processOwned(1)).toMatchObject({
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
          unreportedRequests: reported ? 0 : 1,
          promptTokens: reported ? 100 : null,
          completionTokens: reported ? 20 : null,
          totalTokens: reported ? 120 : null,
          inputTextTokens: reported ? 100 : null,
          cachedInputTokens: reported ? 30 : null,
          uncachedInputTokens: reported ? 70 : null,
          outputTextTokens: reported ? 20 : null,
          reasoningTokens: reported ? 12 : null,
          answerTokens: reported ? 8 : null,
        },
      });
      const failedJob = await aiFeedbackJobModel
        .findOne({ submissionId: new Types.ObjectId(id) })
        .lean()
        .exec();
      expect(failedJob?.requests).toHaveLength(1);
      expect(failedJob?.requests?.[0].usage).toEqual(
        reported ? expectedValidRequestUsage : null,
      );
      expect(getCapturedPayloads()).toHaveLength(1);
      expect(
        await feedbackModel.countDocuments({
          submissionId: new Types.ObjectId(id),
          source: FeedbackSource.AI,
        }),
      ).toBe(0);
    },
  );

  it('keeps successful missing usage unknown, including across student/teacher detail reads', async () => {
    clearCapturedPayloads();
    setResponses([{ usage: undefined }]);
    const id = await submitAndRequest();
    expect(await processOwned(1)).toMatchObject({
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
        unreportedRequests: 1,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        inputTextTokens: null,
        cachedInputTokens: null,
        uncachedInputTokens: null,
        outputTextTokens: null,
        reasoningTokens: null,
        answerTokens: null,
      },
    });
    expect(JSON.stringify(student.aiReview)).not.toMatch(
      /lastError|lockOwner|requests|inputBytes|test-key|reasoning_content/,
    );
  });

  it.each([
    {
      scenario: 'all three request records have full details',
      firstUsage: validUsage,
      expectedFirstUsage: expectedValidRequestUsage,
      expectedUsage: {
        reservedRequests: 3,
        reportedRequests: 3,
        unreportedRequests: 0,
        promptTokens: 300,
        completionTokens: 60,
        totalTokens: 360,
        inputTextTokens: 300,
        cachedInputTokens: 90,
        uncachedInputTokens: 210,
        outputTextTokens: 60,
        reasoningTokens: 36,
        answerTokens: 24,
      },
    },
    {
      scenario: 'one request has no reasoning detail',
      firstUsage: {
        ...validUsage,
        completion_tokens_details: { text_tokens: 20 },
      },
      expectedFirstUsage: {
        ...expectedValidRequestUsage,
        reasoningTokens: null,
      },
      expectedUsage: {
        reservedRequests: 3,
        reportedRequests: 3,
        unreportedRequests: 0,
        promptTokens: 300,
        completionTokens: 60,
        totalTokens: 360,
        inputTextTokens: 300,
        cachedInputTokens: 90,
        uncachedInputTokens: 210,
        outputTextTokens: 60,
        reasoningTokens: null,
        answerTokens: null,
      },
    },
    {
      scenario: 'one request has no valid main usage',
      firstUsage: undefined,
      expectedFirstUsage: null,
      expectedUsage: {
        reservedRequests: 3,
        reportedRequests: 2,
        unreportedRequests: 1,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        inputTextTokens: null,
        cachedInputTokens: null,
        uncachedInputTokens: null,
        outputTextTokens: null,
        reasoningTokens: null,
        answerTokens: null,
      },
    },
  ])(
    'counts retryable failure usage across all claims when $scenario',
    async ({ firstUsage, expectedFirstUsage, expectedUsage }) => {
      clearCapturedPayloads();
      setResponses([{ status: 429, usage: firstUsage }, { status: 503 }, {}]);
      const id = await submitAndRequest();
      expect(await processOwned(1)).toMatchObject({
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
      expect(await processOwned(1)).toMatchObject({
        failed: 1,
      });
      await makeDue(id);
      expect(await processOwned(1)).toMatchObject({
        succeeded: 1,
      });
      expect(await processOwned(1)).toMatchObject({
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
      expect(job?.requests?.map((r) => r.usage)).toEqual([
        expectedFirstUsage,
        expectedValidRequestUsage,
        expectedValidRequestUsage,
      ]);
      expect(getCapturedPayloads()).toHaveLength(3);
      expect((await readReview(id)).aiReview.usage).toEqual(expectedUsage);
      expect((await readReview(id, teacherAgent)).aiReview.usage).toEqual(
        expectedUsage,
      );
      console.info(
        'A2 retry evidence: requests=3; totalTokens=' +
          expectedUsage.totalTokens,
      );
    },
  );

  it('stops after three retryable failures, retaining the final reason and valid failure usage', async () => {
    clearCapturedPayloads();
    setResponses([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const id = await submitAndRequest();
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await makeDue(id);
      expect(await processOwned(1)).toMatchObject(
        i === 2 ? { dead: 1 } : { failed: 1 },
      );
    }
    const detail = await readReview(id);
    expect(detail.aiReview).toMatchObject({
      failure: { code: 'UPSTREAM_UNAVAILABLE' },
      retryScheduled: false,
      nextRetryAt: null,
      usage: {
        reservedRequests: 3,
        reportedRequests: 3,
        unreportedRequests: 0,
        totalTokens: 360,
        reasoningTokens: 36,
        answerTokens: 24,
      },
    });
    expect(await processOwned(1)).toMatchObject({
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
      expect(await processOwned(1)).toMatchObject({
        failed: 1,
      });
      expect((await readReview(id)).aiReview).toMatchObject({
        failure: { code: 'UPSTREAM_UNAVAILABLE' },
        usage: {
          reservedRequests: 1,
          reportedRequests: 0,
          unreportedRequests: 1,
          totalTokens: null,
        },
      });
      await makeDue(id);
      expect(await processOwned(1)).toMatchObject({
        succeeded: 1,
      });
      expect((await readReview(id)).aiReview.usage).toMatchObject({
        reservedRequests: 2,
        reportedRequests: 1,
        unreportedRequests: 1,
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
      Array.from({ length: 3 }, () => requestContext(id)),
    );
    expect(
      new Set(requests.map((r) => (r.body as { jobId: string }).jobId)).size,
    ).toBe(1);
    const processed = await Promise.all([processOwned(1), processOwned(1)]);
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
    const repeated = await requestContext(id);
    expect(repeated.body).toMatchObject({ status: 'SUCCEEDED' });
    expect(await processOwned(1)).toMatchObject({
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
    expect(await processOwned(1)).toMatchObject({ dead: 1 });
    expect((await readReview(id)).aiReview).toMatchObject({
      inputCoverage: 'UNKNOWN',
      failure: { code: 'LEGACY_JOB_UNSUPPORTED' },
      usage: {
        reservedRequests: null,
        reportedRequests: null,
        unreportedRequests: null,
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
    expect(await processOwned(1)).toMatchObject({
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
  it('persists nested references through HTTP, preserves omission, clears [], and rejects invalid saves atomically', async () => {
    const id = await contextTask(refs, 'DRAFT');
    const detail = () =>
      teacherAgent.get('/api/learning-tasks/tasks/' + id).expect(200);
    expect((await detail()).body).toMatchObject({ aiContextRefs: refs });
    expect(await taskModel.findById(id).lean()).toMatchObject({
      aiContextRefs: refs,
    });
    await teacherAgent
      .patch('/api/learning-tasks/tasks/' + id)
      .send({ title: 'Kept refs' })
      .expect(200);
    expect((await detail()).body).toMatchObject({
      title: 'Kept refs',
      aiContextRefs: refs,
    });
    for (const invalid of [
      null,
      [{ archivePath: 'book/missing.zip', entryPaths: ['a.txt'] }],
      [{ archivePath: '../escape.zip', entryPaths: ['a.txt'] }],
      [...refs, refs[0]],
    ]) {
      const rejected = await teacherAgent
        .patch('/api/learning-tasks/tasks/' + id)
        .send({ title: 'MUST_NOT_SAVE', aiContextRefs: invalid })
        .expect(400);
      expect(JSON.stringify(rejected.body)).not.toContain(contextRoot);
      expect((await detail()).body).toMatchObject({
        title: 'Kept refs',
        aiContextRefs: refs,
      });
    }
    await teacherAgent
      .patch('/api/learning-tasks/tasks/' + id)
      .send({ aiContextRefs: [] })
      .expect(200);
    expect((await detail()).body).toMatchObject({ aiContextRefs: [] });
    await teacherAgent
      .patch('/api/learning-tasks/tasks/' + id)
      .send({ aiContextRefs: refs })
      .expect(200);
    const invalidTitle = fixtureNamespace + '-invalid-published';
    await teacherAgent
      .post('/api/learning-tasks/tasks')
      .send({
        title: invalidTitle,
        description: 'invalid',
        knowledgeModule: 'zip',
        status: 'PUBLISHED',
        aiContextRefs: [
          { archivePath: 'book/missing.zip', entryPaths: ['a.txt'] },
        ],
      })
      .expect(400);
    expect(await taskModel.countDocuments({ title: invalidTitle })).toBe(0);
  });

  it('revalidates effective saves and real template/classroom publish before any write', async () => {
    const draft = await contextTask(refs, 'DRAFT');
    const published = await contextTask();
    const clearable = await contextTask(refs, 'DRAFT');
    const publishedBefore = await readReferenceTask(published);
    expect(publishedBefore.publishedAt).toBeInstanceOf(Date);
    await rm(resolve(contextRoot, 'book/teacher.zip'));
    try {
      await teacherAgent
        .patch('/api/learning-tasks/tasks/' + draft)
        .send({ title: 'MUST_NOT_SAVE' })
        .expect(400);
      expect(await taskModel.findById(draft).lean()).toMatchObject({
        title: 'ZIP task',
        status: 'DRAFT',
        aiContextRefs: refs,
      });
      const unchangedDraft = await readReferenceTask(draft);
      for (const patch of [{}, { status: 'DRAFT' }]) {
        await teacherAgent
          .patch('/api/learning-tasks/tasks/' + draft)
          .send(patch)
          .expect(400);
        expect(await readReferenceTask(draft)).toEqual(unchangedDraft);
      }
      await teacherAgent
        .post('/api/learning-tasks/tasks/' + draft + '/publish')
        .send({})
        .expect(400);
      expect(await taskModel.findById(draft).lean()).toMatchObject({
        status: 'DRAFT',
      });
      await teacherAgent
        .post('/api/classrooms/' + classroomIds[0] + '/tasks')
        .send({ taskId: published })
        .expect(400);
      expect(
        await app
          .get<Model<ClassroomTask>>(getModelToken(ClassroomTask.name))
          .countDocuments({ taskId: published }),
      ).toBe(0);
      const validation = jest.spyOn(
        app.get(AiContextReaderService),
        'validateForSave',
      );
      try {
        const repeated = await teacherAgent
          .post('/api/learning-tasks/tasks/' + published + '/publish')
          .send({})
          .expect(201);
        expect(validation).not.toHaveBeenCalled();
        expect(repeated.body).toMatchObject({
          status: 'PUBLISHED',
          aiContextRefs: refs,
          publishedAt: publishedBefore.publishedAt?.toISOString(),
        });
        const detail = await teacherAgent
          .get('/api/learning-tasks/tasks/' + published)
          .expect(200);
        expect(detail.body).toMatchObject({
          status: 'PUBLISHED',
          aiContextRefs: refs,
          publishedAt: publishedBefore.publishedAt?.toISOString(),
        });
        expect(await readReferenceTask(published)).toEqual(publishedBefore);
      } finally {
        validation.mockRestore();
      }
      await teacherAgent
        .patch('/api/learning-tasks/tasks/' + clearable)
        .send({ aiContextRefs: [] })
        .expect(200);
      expect(await readReferenceTask(clearable)).toMatchObject({
        status: 'DRAFT',
        aiContextRefs: [],
      });
      await teacherAgent
        .post('/api/learning-tasks/tasks/' + clearable + '/publish')
        .send({})
        .expect(201);
      const cleared = await teacherAgent
        .get('/api/learning-tasks/tasks/' + clearable)
        .expect(200);
      expect(cleared.body).toMatchObject({
        status: 'PUBLISHED',
        aiContextRefs: [],
      });
      expect(await readReferenceTask(clearable)).toMatchObject({
        status: 'PUBLISHED',
        aiContextRefs: [],
      });
    } finally {
      await copyFile(
        resolve(__dirname, 'fixtures/ai-context/teacher.zip'),
        resolve(contextRoot, 'book/teacher.zip'),
      );
    }
    await teacherAgent
      .post('/api/learning-tasks/tasks/' + draft + '/publish')
      .send({})
      .expect(201);
    const before = await taskModel.findById(draft).lean();
    await teacherAgent
      .post('/api/learning-tasks/tasks/' + draft + '/publish')
      .send({})
      .expect(201);
    expect((await taskModel.findById(draft).lean())?.publishedAt).toEqual(
      before?.publishedAt,
    );
  });

  it('rejects an omitted-reference edit after validated ZIP references change', async () => {
    const id = await contextTask(refs, 'DRAFT');
    const barrier = holdValidatedReferences();
    const pending = teacherAgent
      .patch('/api/learning-tasks/tasks/' + id)
      .timeout({ response: 12000, deadline: 15000 })
      .send({ title: 'STALE_ZIP_EDIT_MUST_NOT_SAVE' })
      .then((response) => response);
    const settled = Promise.allSettled([pending]);
    try {
      await barrier.waitUntilValidated();
      const replacement = await teacherAgent
        .patch('/api/learning-tasks/tasks/' + id)
        .timeout({ response: 5000, deadline: 10000 })
        .send({ aiContextRefs: replacementRefs })
        .expect(200);
      expect(replacement.body).toMatchObject({
        title: 'ZIP task',
        status: 'DRAFT',
        aiContextRefs: replacementRefs,
      });
      const afterReplacement = await readReferenceTask(id);
      expect(afterReplacement.aiContextRefs).toEqual(replacementRefs);
      barrier.release();
      const rejected = await pending;
      expect(rejected.status).toBe(409);
      expect(rejected.body).toMatchObject({
        statusCode: 409,
        message: '任务模板已变化，请刷新后再操作。',
      });
      expect(rejected.body).not.toHaveProperty('code');
      const detail = await teacherAgent
        .get('/api/learning-tasks/tasks/' + id)
        .expect(200);
      expect(detail.body).toMatchObject({
        title: 'ZIP task',
        description: 'ZIP_REQUIREMENTS',
        status: 'DRAFT',
        aiContextRefs: replacementRefs,
      });
      const final = await readReferenceTask(id);
      expect(final).toEqual(afterReplacement);
      expect(final.publishedAt).toBeUndefined();
      console.info('ZIP reference edit race', {
        taskId: id,
        sequence: 'validate old refs -> replace refs HTTP 200 -> release edit',
        status: rejected.status,
        finalStatus: final.status,
        finalTitle: final.title,
        finalRefs: final.aiContextRefs,
      });
    } finally {
      barrier.release();
      try {
        await settled;
        await barrier.waitForRequests();
      } finally {
        barrier.restore();
      }
    }
  });

  it('rejects draft publication after validated ZIP references change', async () => {
    const id = await contextTask(refs, 'DRAFT');
    const barrier = holdValidatedReferences();
    const pending = teacherAgent
      .post('/api/learning-tasks/tasks/' + id + '/publish')
      .timeout({ response: 12000, deadline: 15000 })
      .send({})
      .then((response) => response);
    const settled = Promise.allSettled([pending]);
    try {
      await barrier.waitUntilValidated();
      const replacement = await teacherAgent
        .patch('/api/learning-tasks/tasks/' + id)
        .timeout({ response: 5000, deadline: 10000 })
        .send({ aiContextRefs: replacementRefs })
        .expect(200);
      expect(replacement.body).toMatchObject({
        status: 'DRAFT',
        aiContextRefs: replacementRefs,
      });
      const afterReplacement = await readReferenceTask(id);
      expect(afterReplacement.aiContextRefs).toEqual(replacementRefs);
      expect(afterReplacement.publishedAt).toBeUndefined();
      barrier.release();
      const rejected = await pending;
      expect(rejected.status).toBe(409);
      expect(rejected.body).toMatchObject({
        statusCode: 409,
        message: '任务模板已变化，请刷新后再操作。',
      });
      expect(rejected.body).not.toHaveProperty('code');
      const detail = await teacherAgent
        .get('/api/learning-tasks/tasks/' + id)
        .expect(200);
      expect(detail.body).toMatchObject({
        title: 'ZIP task',
        description: 'ZIP_REQUIREMENTS',
        status: 'DRAFT',
        aiContextRefs: replacementRefs,
      });
      const final = await readReferenceTask(id);
      expect(final).toEqual(afterReplacement);
      expect(final.publishedAt).toBeUndefined();
      console.info('ZIP reference publish race', {
        taskId: id,
        sequence:
          'validate old refs -> replace refs HTTP 200 -> release publish',
        status: rejected.status,
        finalStatus: final.status,
        finalRefs: final.aiContextRefs,
        hasPublishedAt: final.publishedAt !== undefined,
      });
    } finally {
      barrier.release();
      try {
        await settled;
        await barrier.waitForRequests();
      } finally {
        barrier.restore();
      }
    }
  });

  it('sends multiple exact files in the actual HTTP model request from the frozen instance and hides references in member responses', async () => {
    clearCapturedPayloads();
    const id = await contextTask();
    const instance = await publishContext(id);
    const instances = app.get<Model<ClassroomTask>>(
      getModelToken(ClassroomTask.name),
    );
    expect(
      (await instances.findById(instance).lean())?.taskSnapshot?.aiContextRefs,
    ).toEqual(refs);
    await teacherAgent
      .patch('/api/learning-tasks/tasks/' + id)
      .send({
        aiContextRefs: [
          {
            archivePath: 'book/teacher.zip',
            entryPaths: ['teacher/alternate.md'],
          },
        ],
      })
      .expect(200);
    const frozen = await instances.findById(instance).lean();
    await teacherAgent
      .post('/api/classrooms/' + classroomIds[0] + '/tasks')
      .send({ taskId: id })
      .expect(400);
    expect((await instances.findById(instance).lean())?.taskSnapshot).toEqual(
      frozen?.taskSnapshot,
    );
    const base = '/api/classrooms/' + classroomIds[0] + '/tasks';
    for (const path of [
      base,
      base + '/' + instance,
      base + '/' + instance + '/my-task-detail',
    ]) {
      const response = await studentAgent.get(path).expect(200);
      const json = JSON.stringify(response.body);
      for (const hidden of [
        'aiContextRefs',
        'book/teacher.zip',
        'teacher/guide.md',
        '# REF_B',
        contextRoot,
      ])
        expect(json).not.toContain(hidden);
      expect(json).toContain('ZIP_REQUIREMENTS');
      expect(json).toContain('ZIP_RUBRIC');
      expect(json).toContain('taskSnapshotAvailable');
      expect(json).not.toContain('aiFeedbackMode');
    }
    const my = await studentAgent
      .get(base + '/' + instance + '/my-task-detail')
      .expect(200);
    expect(my.body).toMatchObject({
      participationStatus: {
        canSubmit: true,
        canRequestAiFeedback: true,
        readOnly: false,
      },
    });
    const submission = await submitContext(instance);
    await requestContext(submission);
    expect(await processOwned(1)).toMatchObject({ succeeded: 1 });
    expect(getCapturedPayloads()).toHaveLength(1);
    const payload = getCapturedPayloads()[0];
    const input =
      payload.messages?.map((m) => m.content ?? '').join('\n') ?? '';
    for (const text of [
      '# REF_A\nfirst reference\n',
      'int reference() { return 14; }\n',
      '# REF_B\nsecond reference\n',
      'ZIP_REQUIREMENTS',
      'ZIP_RUBRIC',
      'STUDENT_ZIP_CODE',
      'STUDENT_ZIP_NOTE',
      'STUDENT_ZIP_AI',
    ])
      expect(input).toContain(text);
    expect(input.indexOf('# REF_A')).toBeLessThan(
      input.indexOf('int reference()'),
    );
    expect(input.indexOf('int reference()')).toBeLessThan(
      input.indexOf('# REF_B'),
    );
    expect(input).not.toContain('ALTERNATE_REFERENCE');
    expect(input).not.toContain('book/teacher.zip');
    const job = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(submission) })
      .lean();
    expect(job?.requests?.[0].inputBytes).toBe(
      Buffer.byteLength(JSON.stringify(payload.messages), 'utf8'),
    );
    expect((await readReview(submission)).aiReview.inputCoverage).toBe('FULL');
  });

  it('keeps saved work when manually requested materials disappear', async () => {
    clearCapturedPayloads();
    const id = await contextTask();
    const instance = await publishContext(id);
    const submission = await submitContext(instance);
    await requestContext(submission);
    const pending = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(submission) })
      .lean();
    expect(pending?.status).toBe('PENDING');
    await rm(resolve(contextRoot, 'book/teacher.zip'));
    try {
      expect(await processOwned(1)).toMatchObject({ processed: 1, dead: 1 });
      const detail = await readReview(submission);
      expect(detail.content).toMatchObject({
        codeText: 'STUDENT_ZIP_CODE',
        submissionNote: 'STUDENT_ZIP_NOTE',
      });
      expect(detail.aiReview).toMatchObject({
        failure: {
          code: 'AI_CONTEXT_UNAVAILABLE',
          message:
            '作业已保存，任务参考资料暂不可用，本次未生成 AI 反馈，请联系教师。',
        },
        usage: { reservedRequests: 0 },
        retryScheduled: false,
        inputCoverage: 'NOT_SENT',
      });
      expect(getCapturedPayloads()).toHaveLength(0);
      expect(
        await feedbackModel.countDocuments({
          submissionId: new Types.ObjectId(submission),
        }),
      ).toBe(0);
      expect(await submissionModel.countDocuments({ _id: submission })).toBe(1);
      const job = await aiFeedbackJobModel
        .findOne({ submissionId: new Types.ObjectId(submission) })
        .lean();
      expect(job).toMatchObject({
        status: 'DEAD',
        attempts: 1,
        failureCode: 'AI_CONTEXT_UNAVAILABLE',
        notBefore: null,
        lockedAt: null,
      });
      const retry = await requestContext(submission);
      expect(retry.body).toMatchObject({ status: 'DEAD' });
      const safe = JSON.stringify(detail.aiReview);
      for (const hidden of [
        'aiContextRefs',
        'teacher.zip',
        'ENOENT',
        contextRoot,
        '# REF_B',
      ])
        expect(safe).not.toContain(hidden);
    } finally {
      await copyFile(
        resolve(__dirname, 'fixtures/ai-context/teacher.zip'),
        resolve(contextRoot, 'book/teacher.zip'),
      );
    }
  });

  it('uses the existing complete messages budget when references push an otherwise small submission over it', async () => {
    clearCapturedPayloads();
    const id = await contextTask([
      { archivePath: 'book/student.zip', entryPaths: ['limit.txt'] },
    ]);
    const instance = await publishContext(id);
    const submission = await submitContext(instance);
    await requestContext(submission);
    expect(await processOwned(1)).toMatchObject({ dead: 1 });
    expect(getCapturedPayloads()).toHaveLength(0);
    const job = await aiFeedbackJobModel
      .findOne({ submissionId: new Types.ObjectId(submission) })
      .lean();
    expect(job).toMatchObject({
      status: 'DEAD',
      failureCode: 'INPUT_BUDGET_EXCEEDED',
      requests: [],
    });
    expect(
      await feedbackModel.countDocuments({
        submissionId: new Types.ObjectId(submission),
      }),
    ).toBe(0);
    expect((await readReview(submission)).content.codeText).toBe(
      'STUDENT_ZIP_CODE',
    );
  });
});
