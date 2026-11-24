import { deleteFixtureRows } from './helpers/delete-fixture-rows';
import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { assertAuthTestWritesConfirmed } from './helpers/auth-test-writes';
import { createFixtureUser } from './helpers/create-fixture-user';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type Connection,
  type Model,
  type mongo,
  STATES,
  Types,
} from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AiContextReaderService } from '../src/modules/learning-tasks/ai-context/ai-context-reader.service';
import { LearningTasksService } from '../src/modules/learning-tasks/services/learning-tasks.service';
import { Task } from '../src/modules/learning-tasks/schemas/task.schema';
import { hashPassword } from '../src/modules/users/password.utils';
import { User, UserStatus } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(60000);

const namespace = `resource-write-${randomUUID()}`;
const teacherId = new Types.ObjectId();
const email = `${namespace}@example.invalid`;
// Deterministic synthetic application credential, unrelated to real accounts.
const password = 'ResourceWrite123!';
const timeout = { response: 10000, deadline: 15000 };
const description = '  第一行\n    第二行保留缩进\n第三行  ';
const updatedDescription = ' \n更新后的第一行\n    更新后的第二行\n ';
type Family = 'course' | 'classroom' | 'task';
type Resource = {
  _id: Types.ObjectId;
  createdBy?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  courseLabel?: string;
  status?: string;
  [field: string]: unknown;
};
type ResourceResponse = {
  id: string;
  courseLabel?: string;
  publishedAt?: string;
  [field: string]: unknown;
};
type HttpOutcome = { response: request.Response } | { error: unknown };

async function bounded<T>(
  operation: Promise<T>,
  label: string,
  milliseconds = 10000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const startHttp = (
  operation: PromiseLike<request.Response>,
): Promise<HttpOutcome> =>
  Promise.resolve(operation).then(
    (response) => ({ response }),
    (error: unknown) => ({ error }),
  );

async function httpResponse(
  operation: Promise<HttpOutcome>,
): Promise<request.Response> {
  const outcome = await bounded(
    operation,
    'RESOURCE_WRITE_HTTP_DRAIN_TIMEOUT',
    30000,
  );
  if ('error' in outcome) throw outcome.error;
  return outcome.response;
}
function expectValidation400(
  response: request.Response,
  field: string,
  path: string,
): void {
  expect(response.status).toBe(400);
  const body = response.body as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual([
    'message',
    'path',
    'statusCode',
    'timestamp',
  ]);
  expect(body.statusCode).toBe(400);
  expect(body.path).toBe(path);
  expect(typeof body.timestamp).toBe('string');
  expect(body.message).toEqual(expect.stringContaining(field));
}
const paths: Record<Family, string> = {
  course: '/api/courses',
  classroom: '/api/classrooms',
  task: '/api/learning-tasks/tasks',
};
const names: Record<Family, string> = {
  course: 'courses',
  classroom: 'classrooms',
  task: 'tasks',
};
// Independent field matrix from the locked public contract, not DTO reflection.
const requiredFields: { family: Family; field: string }[] = [
  { family: 'course', field: 'code' },
  { family: 'course', field: 'name' },
  { family: 'course', field: 'term' },
  { family: 'classroom', field: 'name' },
  { family: 'task', field: 'title' },
  { family: 'task', field: 'description' },
  { family: 'task', field: 'knowledgeModule' },
];
const postCases = requiredFields.flatMap((item) => [
  { ...item, kind: 'missing', value: undefined },
  { ...item, kind: 'empty', value: '' },
  { ...item, kind: 'whitespace', value: ' \t\r\n ' },
]);
const patchCases = requiredFields.flatMap((item) => [
  { ...item, kind: 'null', value: null },
  { ...item, kind: 'non-string', value: 42 },
  { ...item, kind: 'empty', value: '' },
  { ...item, kind: 'whitespace', value: ' \t\r\n ' },
]);

describe('Teaching resource writes (real HTTP and Mongo)', () => {
  let app: INestApplication<App> | undefined;
  let moduleFixture: TestingModule | undefined;
  let connection: Connection | undefined;
  let httpServer: Server | undefined;
  let db: mongo.Db | undefined;
  let agent: ReturnType<typeof request.agent>;
  const ids: Record<Family, string> = { course: '', classroom: '', task: '' };
  let serial = 0;

  function collection(family: Family): mongo.Collection<Resource> {
    if (!db) throw new Error('RESOURCE_WRITE_DATABASE_REQUIRED');
    return db.collection<Resource>(names[family]);
  }
  const ownership = (family: Family) =>
    family === 'classroom' ? { teacherId } : { createdBy: teacherId };
  const ownedRows = (family: Family) =>
    collection(family)
      .find(ownership(family), {
        maxTimeMS: 5000,
        signal: AbortSignal.timeout(5000),
      })
      .sort({ _id: 1 })
      .toArray();
  const raw = (family: Family) =>
    collection(family).findOne(
      { _id: new Types.ObjectId(ids[family]), ...ownership(family) },
      { maxTimeMS: 5000, signal: AbortSignal.timeout(5000) },
    );
  const post = (family: Family, body: Record<string, unknown>) =>
    agent.post(paths[family]).timeout(timeout).send(body);
  const patch = (family: Family, body: Record<string, unknown>) =>
    agent.patch(`${paths[family]}/${ids[family]}`).timeout(timeout).send(body);
  const get = (family: Family) =>
    agent.get(`${paths[family]}/${ids[family]}`).timeout(timeout);
  function validCreate(family: Family): Record<string, unknown> {
    serial += 1;
    if (family === 'course')
      return {
        code: `  ${namespace}-${serial}  `,
        name: '  合法课程名称  ',
        term: '  2026-Fall  ',
      };
    if (family === 'classroom')
      return { courseId: ids.course, name: '  合法班级名称  ' };
    return {
      title: `  ${namespace}-${serial}  `,
      description,
      knowledgeModule: '  基础模块  ',
      courseLabel: 'Java 程序设计',
      status: 'DRAFT',
    };
  }
  async function establishJavaClassification(): Promise<void> {
    await patch('task', { courseLabel: 'Java 程序设计' }).expect(200);
    expect((await raw('task'))?.courseLabel).toBe('Java 程序设计');
  }

  async function createLifecycleTask(status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
    const response = await post('task', {
      ...validCreate('task'),
      status,
      rubric: { notes: 'Initial grading guidance' },
    }).expect(201);
    const body = response.body as ResourceResponse;
    expect(Types.ObjectId.isValid(body.id)).toBe(true);
    return body.id;
  }

  const lifecycle = (id: string, action: 'publish' | 'archive') =>
    agent.post(`${paths.task}/${id}/${action}`).timeout(timeout).send({});
  const fetchTask = (id: string) =>
    agent.get(`${paths.task}/${id}`).timeout(timeout);
  const storedTask = (id: string) =>
    collection('task').findOne(
      { _id: new Types.ObjectId(id), createdBy: teacherId },
      {
        projection: {
          _id: 1,
          status: 1,
          publishedAt: 1,
          title: 1,
          description: 1,
          rubric: 1,
        },
        maxTimeMS: 5000,
        signal: AbortSignal.timeout(5000),
      },
    );

  function observeTaskRequests() {
    if (!app) throw new Error('RESOURCE_WRITE_APPLICATION_REQUIRED');
    const service = app.get<LearningTasksService>(LearningTasksService);
    // These spies call through unchanged and retain the server-side promises.
    // A client timeout must not allow fixture cleanup to race an ongoing write.
    const handlers = [
      jest.spyOn(service, 'publishTask'),
      jest.spyOn(service, 'updateTask'),
      jest.spyOn(service, 'archiveTask'),
    ];
    return async (requests: Promise<HttpOutcome>[]) => {
      try {
        await bounded(
          Promise.allSettled(requests),
          'RESOURCE_WRITE_HTTP_DRAIN_TIMEOUT',
          30000,
        );
        const pending: Promise<unknown>[] = [];
        for (const handler of handlers) {
          for (const result of handler.mock.results) {
            if (result.type === 'return')
              pending.push(Promise.resolve(result.value));
          }
        }
        await bounded(
          Promise.allSettled(pending),
          'RESOURCE_WRITE_HANDLER_DRAIN_TIMEOUT',
          30000,
        );
      } finally {
        for (const handler of handlers) handler.mockRestore();
      }
    };
  }

  function pauseNextValidatedSave() {
    if (!app) throw new Error('RESOURCE_WRITE_APPLICATION_REQUIRED');
    const reader = app.get<AiContextReaderService>(AiContextReaderService);
    const validate = reader.validateForSave.bind(
      reader,
    ) as AiContextReaderService['validateForSave'];
    const closeRequests = observeTaskRequests();
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const spy = jest
      .spyOn(reader, 'validateForSave')
      .mockImplementation(async (references) => {
        await validate(references);
        if (!held) {
          held = true;
          entered();
          await bounded(
            released,
            'RESOURCE_WRITE_VALIDATION_RELEASE_TIMEOUT',
            20000,
          );
        }
      });
    return {
      reached: () =>
        bounded(reached, 'RESOURCE_WRITE_VALIDATION_ENTRY_TIMEOUT', 5000),
      release,
      close: async (requests: Promise<HttpOutcome>[]) => {
        release();
        try {
          await closeRequests(requests);
        } finally {
          spy.mockRestore();
        }
      },
    };
  }

  beforeAll(async () => {
    console.info(
      `Teaching resource fixture: ${namespace}; teacher ID: ${teacherId.toHexString()}`,
    );
    await prepareAuthSessionIndexes();
    connection = await openAuthTestConnection({ budgetModelReads: true });
    db = connection.db;
    if (!db) throw new Error('RESOURCE_WRITE_DATABASE_REQUIRED');
    // Real HTTP/models use the gated real connection without automatic DDL.
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await assertAuthTestConnection(app.get<Connection>(getConnectionToken()));
    const users = app.get<Model<User>>(getModelToken(User.name));
    await createFixtureUser(users, {
      _id: teacherId,
      email,
      roles: ['teacher'],
      status: UserStatus.Active,
      passwordHash: await hashPassword(password),
      credentialVersion: 0,
      passwordResetRequestedAt: null,
    });
    httpServer = app.getHttpServer() as Server;
    agent = request.agent(httpServer);
    await agent
      .post('/api/auth/login')
      .timeout(timeout)
      .send({ email, password })
      .expect(201);
    for (const family of ['course', 'classroom', 'task'] as const) {
      const response = await post(family, validCreate(family)).expect(201);
      const body = response.body as ResourceResponse;
      expect(Types.ObjectId.isValid(body.id)).toBe(true);
      ids[family] = body.id;
    }
  });

  afterAll(async () => {
    try {
      if (connection && db) {
        await assertAuthTestConnection(connection);
        assertAuthTestWritesConfirmed(db);
        const userRows = await db
          .collection<{ _id: Types.ObjectId; email: string; roles: string[] }>(
            'users',
          )
          .find(
            { $or: [{ _id: teacherId }, { email }] },
            {
              projection: { _id: 1, email: 1, roles: 1 },
              maxTimeMS: 5000,
              signal: AbortSignal.timeout(5000),
            },
          )
          .toArray();
        if (
          userRows.some(
            (row) =>
              !row._id.equals(teacherId) ||
              row.email !== email ||
              row.roles.length !== 1 ||
              row.roles[0] !== 'teacher',
          )
        )
          throw new Error('RESOURCE_WRITE_USER_OWNERSHIP_MISMATCH');
        // Ownership remains identifiable even when an invalid POST unexpectedly
        // creates a record with no usable name/code, or its response was lost.
        for (const family of ['task', 'classroom', 'course'] as const) {
          for (const row of await ownedRows(family)) {
            await deleteFixtureRows(db, collection(family).collectionName, {
              _id: row._id,
              ...ownership(family),
            });
          }
        }
        await deleteFixtureRows(db, 'sessions', { userId: teacherId }, 0);
        const resetRows = await db
          .collection<{ userId: Types.ObjectId; email: string }>(
            'passwordresettokens',
          )
          .find(
            { userId: teacherId },
            {
              projection: { _id: 0, userId: 1, email: 1 },
              maxTimeMS: 5000,
              signal: AbortSignal.timeout(5000),
            },
          )
          .toArray();
        if (resetRows.some((row) => row.email !== email))
          throw new Error('RESOURCE_WRITE_RESET_OWNERSHIP_MISMATCH');
        await deleteFixtureRows(
          db,
          'passwordresettokens',
          { userId: teacherId, email },
          0,
        );
        await deleteFixtureRows(db, 'users', {
          _id: teacherId,
          email,
          roles: ['teacher'],
        });
        const residual = await Promise.all([
          ...(['task', 'classroom', 'course'] as const).map((family) =>
            collection(family).countDocuments(ownership(family), {
              maxTimeMS: 5000,
              signal: AbortSignal.timeout(5000),
            }),
          ),
          db
            .collection('sessions')
            .countDocuments(
              { userId: teacherId },
              { maxTimeMS: 5000, signal: AbortSignal.timeout(5000) },
            ),
          db
            .collection('passwordresettokens')
            .countDocuments(
              { userId: teacherId },
              { maxTimeMS: 5000, signal: AbortSignal.timeout(5000) },
            ),
          db
            .collection('users')
            .countDocuments(
              { $or: [{ _id: teacherId }, { email }] },
              { maxTimeMS: 5000, signal: AbortSignal.timeout(5000) },
            ),
        ]);
        expect(residual).toEqual([0, 0, 0, 0, 0, 0]);
        console.info(
          'Teaching resource residual: Task/Classroom/Course/Session/ResetToken/User = 0/0/0/0/0/0.',
        );
      }
    } finally {
      try {
        if (app) await app.close();
        else await moduleFixture?.close();
      } finally {
        try {
          if (connection && connection.readyState !== STATES.disconnected)
            await connection.close();
          if (connection)
            expect(connection.readyState).toBe(STATES.disconnected);
          if (httpServer) expect(httpServer.listening).toBe(false);
          console.info(
            'Teaching resource cleanup: Mongo connection disconnected; HTTP server closed or not started.',
          );
        } finally {
          authTestEnvironment.restore();
        }
      }
    }
  });

  it('preserves existing trim rules and the exact multiline description on legal creation', async () => {
    expect(await raw('course')).toMatchObject({
      name: '  合法课程名称  ',
      term: '  2026-Fall  ',
      status: 'ACTIVE',
    });
    expect((await raw('course'))?.code).toBe(`${namespace}-1`);
    expect(await raw('classroom')).toMatchObject({
      name: '  合法班级名称  ',
      status: 'ACTIVE',
    });
    expect(await raw('task')).toMatchObject({
      title: `${namespace}-3`,
      description,
      knowledgeModule: '基础模块',
      courseLabel: 'Java 程序设计',
    });
    const response = await get('task').expect(200);
    expect((response.body as ResourceResponse).description).toBe(description);
  });

  it('keeps task classification in PATCH-title response, fresh GET, raw Mongo and the original-label list', async () => {
    const title = `${namespace}-renamed`;
    const updated = await patch('task', { title }).expect(200);
    const fetched = await get('task').expect(200);
    const list = await agent
      .get(paths.task)
      .query({ courseLabel: 'Java 程序设计', scope: 'mine' })
      .timeout(timeout)
      .expect(200);
    const items = (list.body as { items: ResourceResponse[] }).items;
    expect((updated.body as ResourceResponse).courseLabel).toBe(
      'Java 程序设计',
    );
    expect((fetched.body as ResourceResponse).courseLabel).toBe(
      'Java 程序设计',
    );
    expect(await raw('task')).toMatchObject({
      title,
      courseLabel: 'Java 程序设计',
      description,
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ids.task, courseLabel: 'Java 程序设计' }),
      ]),
    );
  });

  it('updates a legal trimmed task classification', async () => {
    const response = await patch('task', {
      courseLabel: '  Python 程序设计  ',
    }).expect(200);
    expect((response.body as ResourceResponse).courseLabel).toBe(
      'Python 程序设计',
    );
    expect((await raw('task'))?.courseLabel).toBe('Python 程序设计');
  });

  it.each([
    { kind: 'empty', value: '' },
    { kind: 'whitespace', value: ' \t\r\n ' },
    { kind: 'null', value: null },
  ])(
    'clears task classification for explicit $kind after restoring a classified state',
    async ({ value }) => {
      await establishJavaClassification();
      const response = await patch('task', { courseLabel: value }).expect(200);
      const fetched = await get('task').expect(200);
      expect((response.body as ResourceResponse).courseLabel).toBeUndefined();
      expect((fetched.body as ResourceResponse).courseLabel).toBeUndefined();
      const stored = await raw('task');
      expect(stored).not.toBeNull();
      expect(stored?.courseLabel).toBeUndefined();
    },
  );

  it.each(['not-a-course-label', 42])(
    'rejects invalid classification %p atomically',
    async (value) => {
      await establishJavaClassification();
      const before = await raw('task');
      const response = await patch('task', {
        title: `${namespace}-must-not-save`,
        courseLabel: value,
      });
      const after = await raw('task');
      expectValidation400(response, 'courseLabel', `${paths.task}/${ids.task}`);
      expect({ status: response.status, after }).toEqual({
        status: 400,
        after: before,
      });
    },
  );

  it.each([
    { family: 'course' as const, field: 'name', value: '  修改后的课程名称  ' },
    {
      family: 'classroom' as const,
      field: 'name',
      value: '  修改后的班级名称  ',
    },
    {
      family: 'task' as const,
      field: 'description',
      value: updatedDescription,
    },
  ])(
    'allows partial $family updates and preserves every omitted field including status',
    async ({ family, field, value }) => {
      const before = await raw(family);
      if (!before) throw new Error('RESOURCE_WRITE_FIXTURE_REQUIRED');
      await patch(family, { [field]: value }).expect(200);
      const after = await raw(family);
      expect(after?.updatedAt).toBeInstanceOf(Date);
      expect(after).toEqual({
        ...before,
        [field]: value,
        updatedAt: after?.updatedAt,
      });
      const response = await get(family).expect(200);
      expect((response.body as ResourceResponse)[field]).toBe(value);
      expect((response.body as ResourceResponse).status).toBe(before.status);
    },
  );

  it.each(postCases)(
    'POST $family rejects $kind $field without creating a resource',
    async ({ family, field, value }) => {
      const before = await ownedRows(family);
      const body = validCreate(family);
      if (value === undefined) delete body[field];
      else body[field] = value;
      const response = await post(family, body);
      const after = await ownedRows(family);
      expectValidation400(response, field, paths[family]);
      expect({ status: response.status, after }).toEqual({
        status: 400,
        after: before,
      });
    },
  );

  it.each(patchCases)(
    'PATCH $family rejects $kind $field without any persisted change',
    async ({ family, field, value }) => {
      const before = await raw(family);
      const response = await patch(family, { [field]: value });
      const after = await raw(family);
      expectValidation400(response, field, `${paths[family]}/${ids[family]}`);
      expect({ status: response.status, after }).toEqual({
        status: 400,
        after: before,
      });
    },
  );

  it.each([
    { family: 'course' as const, value: null },
    { family: 'classroom' as const, value: null },
    { family: 'course' as const, value: 'INVALID' },
    { family: 'classroom' as const, value: 'INVALID' },
  ])(
    'rejects explicit invalid $family status %p without saving a legal sibling change',
    async ({ family, value }) => {
      const before = await raw(family);
      const response = await patch(family, {
        name: `${namespace}-must-not-save`,
        status: value,
      });
      const after = await raw(family);
      expectValidation400(
        response,
        'status',
        `${paths[family]}/${ids[family]}`,
      );
      expect({ status: response.status, after }).toEqual({
        status: 400,
        after: before,
      });
    },
  );

  it('rejects a delayed publish after another request publishes and archives the draft', async () => {
    const id = await createLifecycleTask();
    const gate = pauseNextValidatedSave();
    const delayed = startHttp(
      agent
        .post(`${paths.task}/${id}/publish`)
        .timeout({ response: 25000, deadline: 30000 })
        .send({}),
    );
    try {
      await gate.reached();
      const published = await lifecycle(id, 'publish').expect(201);
      const firstPublishedAt = (published.body as ResourceResponse).publishedAt;
      expect(typeof firstPublishedAt).toBe('string');
      const archived = await lifecycle(id, 'archive').expect(201);
      expect((archived.body as ResourceResponse).publishedAt).toBe(
        firstPublishedAt,
      );
      expect(await storedTask(id)).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: new Date(firstPublishedAt as string),
      });

      gate.release();
      const delayedResponse = await httpResponse(delayed);
      const fetched = await fetchTask(id).expect(200);
      const stored = await storedTask(id);
      console.info(
        'Teaching resource lifecycle a:',
        JSON.stringify({
          id,
          delayedStatus: delayedResponse.status,
          firstPublishedAt,
          getStatus: (fetched.body as ResourceResponse).status,
          getPublishedAt: (fetched.body as ResourceResponse).publishedAt,
          mongoStatus: stored?.status,
          mongoPublishedAt: stored?.publishedAt,
        }),
      );
      expect({
        delayedStatus: delayedResponse.status,
        getStatus: (fetched.body as ResourceResponse).status,
        mongoStatus: stored?.status,
        getPublishedAt: (fetched.body as ResourceResponse).publishedAt,
        mongoPublishedAt: stored?.publishedAt,
      }).toEqual({
        delayedStatus: 400,
        getStatus: 'ARCHIVED',
        mongoStatus: 'ARCHIVED',
        getPublishedAt: firstPublishedAt,
        mongoPublishedAt: new Date(firstPublishedAt as string),
      });
      expect((delayedResponse.body as Record<string, unknown>).message).toBe(
        'Archived task templates cannot be published',
      );
      expect(fetched.body).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: firstPublishedAt,
      });
      expect(stored).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: new Date(firstPublishedAt as string),
      });
    } finally {
      await gate.close([delayed]);
    }
  });

  it('rejects a delayed content PATCH after another request archives the published template', async () => {
    const id = await createLifecycleTask('PUBLISHED');
    const original = (await fetchTask(id).expect(200)).body as ResourceResponse;
    const gate = pauseNextValidatedSave();
    const delayed = startHttp(
      agent
        .patch(`${paths.task}/${id}`)
        .timeout({ response: 25000, deadline: 30000 })
        .send({
          title: `${namespace}-must-not-land`,
          description: 'Pending replacement description',
        }),
    );
    try {
      await gate.reached();
      await lifecycle(id, 'archive').expect(201);
      gate.release();
      const response = await httpResponse(delayed);
      const fetched = (await fetchTask(id).expect(200))
        .body as ResourceResponse;
      const stored = await storedTask(id);
      console.info(
        'Teaching resource lifecycle b:',
        JSON.stringify({
          id,
          delayedStatus: response.status,
          getStatus: fetched.status,
          mongoStatus: stored?.status,
          getContentUnchanged:
            fetched.title === original.title &&
            fetched.description === original.description,
          mongoContentUnchanged:
            stored?.title === original.title &&
            stored?.description === original.description,
          getPublishedAt: fetched.publishedAt,
          mongoPublishedAt: stored?.publishedAt,
        }),
      );
      expect(response.status).toBe(400);
      expect((response.body as Record<string, unknown>).message).toBe(
        'Archived tasks cannot be updated',
      );
      expect(fetched).toMatchObject({
        status: 'ARCHIVED',
        title: original.title,
        description: original.description,
        publishedAt: original.publishedAt,
      });
      expect(stored).toMatchObject({
        status: 'ARCHIVED',
        title: original.title,
        description: original.description,
        publishedAt: new Date(original.publishedAt as string),
      });
    } finally {
      await gate.close([delayed]);
    }
  });

  it('publishes one draft once and returns its first publishedAt to both interleaved requests', async () => {
    const id = await createLifecycleTask();
    if (!connection) throw new Error('RESOURCE_WRITE_DATABASE_REQUIRED');
    const taskCollection = connection.model<Task>(Task.name).collection;
    const writes = jest.spyOn(taskCollection, 'findOneAndUpdate');
    const legacyWrites = jest.spyOn(taskCollection, 'updateOne');
    const gate = pauseNextValidatedSave();
    const delayed = startHttp(
      agent
        .post(`${paths.task}/${id}/publish`)
        .timeout({ response: 25000, deadline: 30000 })
        .send({}),
    );
    try {
      await gate.reached();
      const first = await lifecycle(id, 'publish').expect(201);
      const firstPublishedAt = (first.body as ResourceResponse).publishedAt;
      expect(typeof firstPublishedAt).toBe('string');
      const beforeRelease = await storedTask(id);
      expect(beforeRelease).toMatchObject({
        status: 'PUBLISHED',
        publishedAt: new Date(firstPublishedAt as string),
      });

      gate.release();
      const second = await httpResponse(delayed);
      const fetched = (await fetchTask(id).expect(200))
        .body as ResourceResponse;
      const stored = await storedTask(id);
      // Observe real driver receipts: one conditional write matched, the other
      // returned null. No database behavior or HTTP response is substituted.
      const receipts: unknown[] = [];
      for (const result of writes.mock.results) {
        expect(result.type).toBe('return');
        if (result.type === 'return') receipts.push(await result.value);
      }
      const matched = receipts.filter((receipt) => receipt !== null);
      const missed = receipts.filter((receipt) => receipt === null);
      console.info(
        'Teaching resource lifecycle c:',
        JSON.stringify({
          id,
          statuses: [first.status, second.status],
          firstPublishedAt,
          secondPublishedAt: (second.body as ResourceResponse).publishedAt,
          getPublishedAt: fetched.publishedAt,
          mongoPublishedAt: stored?.publishedAt,
          matchedPublicationWrites: matched.length,
          conditionalMisses: missed.length,
        }),
      );
      expect(second.status).toBe(201);
      expect((second.body as ResourceResponse).publishedAt).toBe(
        firstPublishedAt,
      );
      expect(writes).toHaveBeenCalledTimes(2);
      for (const [filter] of writes.mock.calls) {
        expect(filter).toMatchObject({
          _id: new Types.ObjectId(id),
          createdBy: teacherId,
          status: 'DRAFT',
        });
      }
      expect(matched).toHaveLength(1);
      expect(missed).toHaveLength(1);
      expect(matched[0]).toMatchObject({
        _id: new Types.ObjectId(id),
        status: 'PUBLISHED',
        publishedAt: new Date(firstPublishedAt as string),
      });
      expect(legacyWrites).not.toHaveBeenCalled();
      expect(fetched).toMatchObject({
        status: 'PUBLISHED',
        publishedAt: firstPublishedAt,
      });
      expect(stored).toMatchObject({
        status: 'PUBLISHED',
        publishedAt: new Date(firstPublishedAt as string),
      });
    } finally {
      try {
        await gate.close([delayed]);
      } finally {
        writes.mockRestore();
        legacyWrites.mockRestore();
      }
    }
  });

  it('archives a published template only once for overlapping HTTP requests', async () => {
    const id = await createLifecycleTask('PUBLISHED');
    const original = (await fetchTask(id).expect(200)).body as ResourceResponse;
    const closeRequests = observeTaskRequests();
    const first = startHttp(lifecycle(id, 'archive'));
    const second = startHttp(lifecycle(id, 'archive'));
    try {
      const responses = await Promise.all([
        httpResponse(first),
        httpResponse(second),
      ]);
      const fetched = (await fetchTask(id).expect(200))
        .body as ResourceResponse;
      const stored = await storedTask(id);
      const statuses = responses
        .map((response) => response.status)
        .sort((a, b) => a - b);
      console.info(
        'Teaching resource lifecycle d archive:',
        JSON.stringify({
          id,
          statuses,
          getStatus: fetched.status,
          mongoStatus: stored?.status,
          firstPublishedAt: original.publishedAt,
          getPublishedAt: fetched.publishedAt,
          mongoPublishedAt: stored?.publishedAt,
        }),
      );
      expect(statuses).toEqual([201, 400]);
      const failure = responses.find((response) => response.status === 400);
      expect(failure?.body).toMatchObject({
        message: 'Only published task templates can be archived',
      });
      const success = responses.find((response) => response.status === 201);
      expect(success?.body).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: original.publishedAt,
      });
      expect(fetched).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: original.publishedAt,
      });
      expect(stored).toMatchObject({
        status: 'ARCHIVED',
        publishedAt: new Date(original.publishedAt as string),
      });
    } finally {
      await closeRequests([first, second]);
    }
  });

  it('preserves disjoint PATCH changes across publication when the earlier validated request finishes last', async () => {
    const id = await createLifecycleTask();
    const title = `${namespace}-interleaved-title`;
    expect((await storedTask(id))?.rubric).toEqual({
      notes: 'Initial grading guidance',
    });
    const gate = pauseNextValidatedSave();
    const delayed = startHttp(
      agent
        .patch(`${paths.task}/${id}`)
        .timeout({ response: 25000, deadline: 30000 })
        .send({ title: `  ${title}  ` }),
    );
    try {
      await gate.reached();
      const published = await lifecycle(id, 'publish').expect(201);
      const firstPublishedAt = (published.body as ResourceResponse).publishedAt;
      expect(typeof firstPublishedAt).toBe('string');
      const first = await agent
        .patch(`${paths.task}/${id}`)
        .timeout(timeout)
        .send({ description: updatedDescription, rubric: {} })
        .expect(200);
      gate.release();
      const second = await httpResponse(delayed);
      const fetched = (await fetchTask(id).expect(200))
        .body as ResourceResponse;
      const stored = await storedTask(id);
      console.info(
        'Teaching resource lifecycle d partial PATCH:',
        JSON.stringify({
          id,
          statuses: [first.status, second.status],
          getStatus: fetched.status,
          mongoStatus: stored?.status,
          getTitle: fetched.title,
          mongoTitle: stored?.title,
          getDescriptionPreserved: fetched.description === updatedDescription,
          mongoDescriptionPreserved: stored?.description === updatedDescription,
          getRubric: fetched.rubric,
          mongoRubric: stored?.rubric,
          firstPublishedAt,
          getPublishedAt: fetched.publishedAt,
          mongoPublishedAt: stored?.publishedAt,
        }),
      );
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({
        status: 'PUBLISHED',
        title,
        description: updatedDescription,
        publishedAt: firstPublishedAt,
      });
      expect(fetched).toMatchObject({
        status: 'PUBLISHED',
        title,
        description: updatedDescription,
        publishedAt: firstPublishedAt,
      });
      expect(stored).toMatchObject({
        status: 'PUBLISHED',
        title,
        description: updatedDescription,
        publishedAt: new Date(firstPublishedAt as string),
      });
      expect(fetched.rubric).toEqual({});
      expect(stored?.rubric).toEqual({});
    } finally {
      await gate.close([delayed]);
    }
  });
});
