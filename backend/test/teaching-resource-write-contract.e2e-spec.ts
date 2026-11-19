import {
  authTestEnvironment,
  assertAuthTestConnection,
  openAuthTestConnection,
} from './helpers/auth-test-environment';
import { prepareAuthSessionIndexes } from './helpers/auth-session-indexes';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type mongo, STATES, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/modules/users/password.utils';
import {
  User,
  UserSchema,
  UserStatus,
} from '../src/modules/users/schemas/user.schema';

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
  [field: string]: unknown;
};
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
      .find(ownership(family), { maxTimeMS: 5000 })
      .sort({ _id: 1 })
      .toArray();
  const raw = (family: Family) =>
    collection(family).findOne(
      { _id: new Types.ObjectId(ids[family]), ...ownership(family) },
      { maxTimeMS: 5000 },
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

  beforeAll(async () => {
    console.info(
      `Teaching resource fixture: ${namespace}; teacher ID: ${teacherId.toHexString()}`,
    );
    await prepareAuthSessionIndexes();
    connection = await openAuthTestConnection();
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
    await connection.model(User.name, UserSchema).create({
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
        const userRows = await db
          .collection<{ _id: Types.ObjectId; email: string; roles: string[] }>(
            'users',
          )
          .find(
            { $or: [{ _id: teacherId }, { email }] },
            { projection: { _id: 1, email: 1, roles: 1 }, maxTimeMS: 5000 },
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
            await collection(family).deleteOne(
              { _id: row._id, ...ownership(family) },
              { timeoutMS: 5000 },
            );
          }
        }
        await db
          .collection('sessions')
          .deleteMany({ userId: teacherId }, { timeoutMS: 5000 });
        const resetRows = await db
          .collection<{ userId: Types.ObjectId; email: string }>(
            'passwordresettokens',
          )
          .find(
            { userId: teacherId },
            { projection: { _id: 0, userId: 1, email: 1 }, maxTimeMS: 5000 },
          )
          .toArray();
        if (resetRows.some((row) => row.email !== email))
          throw new Error('RESOURCE_WRITE_RESET_OWNERSHIP_MISMATCH');
        await db
          .collection('passwordresettokens')
          .deleteMany({ userId: teacherId, email }, { timeoutMS: 5000 });
        await db
          .collection('users')
          .deleteOne(
            { _id: teacherId, email, roles: ['teacher'] },
            { timeoutMS: 5000 },
          );
        const residual = await Promise.all([
          ...(['task', 'classroom', 'course'] as const).map((family) =>
            collection(family).countDocuments(ownership(family), {
              maxTimeMS: 5000,
            }),
          ),
          db
            .collection('sessions')
            .countDocuments({ userId: teacherId }, { maxTimeMS: 5000 }),
          db
            .collection('passwordresettokens')
            .countDocuments({ userId: teacherId }, { maxTimeMS: 5000 }),
          db
            .collection('users')
            .countDocuments(
              { $or: [{ _id: teacherId }, { email }] },
              { maxTimeMS: 5000 },
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
});
