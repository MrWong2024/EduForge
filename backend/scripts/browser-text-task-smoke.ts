import 'reflect-metadata';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';
import mongoose, { type Connection, Types } from 'mongoose';
import type { INestApplicationContext, Type } from '@nestjs/common';
import { createBrowserAcceptanceEnvironment } from '../src/config/browser-acceptance-environment';
import {
  assertConnectedDatabaseMatchesPurpose,
  DatabaseGateError,
} from '../src/config/database-purpose';
import {
  User,
  UserSchema,
  UserStatus,
} from '../src/modules/users/schemas/user.schema';
import {
  validateNewPassword,
  hashPassword,
  comparePassword,
} from '../src/modules/users/password.utils';
import {
  Course,
  CourseSchema,
} from '../src/modules/courses/schemas/course.schema';
import {
  Classroom,
  ClassroomSchema,
} from '../src/modules/classrooms/schemas/classroom.schema';
import {
  Task,
  TaskSchema,
  TaskStatus,
} from '../src/modules/learning-tasks/schemas/task.schema';
import {
  Submission,
  SubmissionSchema,
} from '../src/modules/learning-tasks/schemas/submission.schema';
import {
  Feedback,
  FeedbackSchema,
} from '../src/modules/learning-tasks/schemas/feedback.schema';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from '../src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema';
import {
  Enrollment,
  EnrollmentSchema,
} from '../src/modules/classrooms/enrollments/schemas/enrollment.schema';
import {
  AiFeedbackJob,
  AiFeedbackJobSchema,
  AiFeedbackJobStatus,
} from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import { AiFeedbackMode } from '../src/modules/classrooms/classroom-tasks/classroom-task-content';

export const SYNTHETIC_PASSWORD = '12345678';
export const SMOKE_MATERIALS = {
  A: {
    codeText:
      " \n// FILE: sum.js\nexport function sum(values) {\n  return values[0]; // version A\n}\n\n// FILE: main.js\nconst values = [1, 2, 3];\nconsole.log('🧪', sum(values));\n \n",
    submissionNote:
      ' \n版本 A：先验证输入与输出，尚未完成累加。🧪\n  保留独立说明、缩进与首尾空白。 \n',
  },
  B: {
    codeText:
      " \n// FILE: sum.js\nexport function sum(values) {\n  return values.reduce((total, value) => total + value, 0); // version B\n}\n\n// FILE: main.js\nconst values = [1, 2, 3];\nconsole.log('🧪 revision B', sum(values));\n \n",
    submissionNote:
      ' \n版本 B：根据教师反馈改为累加，并补充空数组思考。🧪\n  两份作品分别保留，不覆盖版本 A。 \n',
  },
} as const;

type SmokeRecord = {
  namespace: string;
  frontendPort: number;
  backendPort: number;
  teacherId: string;
  studentId: string;
  courseId?: string;
  classroomId?: string;
  taskIds: string[];
};
type DbRole = { db: string; role: string };
type IdRow = { _id: Types.ObjectId };
type UserRow = IdRow &
  Pick<User, 'email' | 'roles' | 'status' | 'passwordHash'>;
type CourseRow = IdRow & Pick<Course, 'createdBy' | 'code'>;
type TaskRow = IdRow &
  Pick<Task, 'createdBy' | 'title' | 'status' | 'visibility'>;
type ClassroomRow = IdRow &
  Pick<
    Classroom,
    'courseId' | 'teacherId' | 'studentIds' | 'name' | 'joinCode'
  >;
type ClassroomTaskRow = IdRow &
  Pick<
    ClassroomTask,
    'classroomId' | 'taskId' | 'createdBy' | 'settings' | 'status'
  >;
type SubmissionRow = IdRow &
  Pick<
    Submission,
    'studentId' | 'taskId' | 'classroomTaskId' | 'attemptNo' | 'content'
  >;
type JobRow = IdRow &
  Pick<
    AiFeedbackJob,
    | 'submissionId'
    | 'studentId'
    | 'classroomTaskId'
    | 'taskId'
    | 'status'
    | 'budgetVersion'
    | 'attempts'
    | 'provider'
    | 'requests'
  >;
type FeedbackRow = IdRow &
  Pick<Feedback, 'submissionId' | 'createdBy' | 'source' | 'message'>;

function fail(code: string): never {
  throw new DatabaseGateError(code);
}
export function assertNamespace(namespace: string): void {
  if (!/^b1-2-[a-z0-9-]{4,64}$/.test(namespace))
    fail('SMOKE_NAMESPACE_INVALID');
}
export function assertSmokeRole(roles: DbRole[], role: 'APP' | 'ADMIN'): void {
  const expected = role === 'APP' ? 'readWrite' : 'dbOwner';
  if (
    !roles.length ||
    roles.some(
      (entry) =>
        entry.db !== 'eduforge_browser_test' || entry.role !== expected,
    )
  )
    fail('SMOKE_DATABASE_ROLE_MISMATCH');
}
export function assertExclusiveJob(
  targetId: string,
  jobs: Pick<JobRow, '_id' | 'status' | 'budgetVersion' | 'attempts'>[],
): void {
  if (
    jobs.length !== 1 ||
    jobs[0]._id.toString() !== targetId ||
    jobs[0].status !== AiFeedbackJobStatus.Pending ||
    jobs[0].budgetVersion !== 1 ||
    jobs[0].attempts !== 0
  )
    fail('SMOKE_EXCLUSIVE_PENDING_JOB_REQUIRED');
}
export function assertTargetOwnership(
  record: SmokeRecord,
  job: JobRow,
  submission: SubmissionRow,
  classroomTask: ClassroomTaskRow,
): void {
  if (
    job.studentId.toString() !== record.studentId ||
    submission.studentId.toString() !== record.studentId ||
    job.submissionId.toString() !== submission._id.toString() ||
    job.classroomTaskId?.toString() !== classroomTask._id.toString() ||
    submission.classroomTaskId?.toString() !== classroomTask._id.toString() ||
    classroomTask.classroomId.toString() !== record.classroomId ||
    classroomTask.createdBy.toString() !== record.teacherId ||
    job.taskId.toString() !== classroomTask.taskId.toString() ||
    submission.taskId.toString() !== classroomTask.taskId.toString() ||
    !record.taskIds.includes(classroomTask.taskId.toString())
  )
    fail('SMOKE_TARGET_OWNERSHIP_MISMATCH');
}
export async function assertSyntheticAccount(
  user: UserRow | null,
  record: SmokeRecord,
  role: 'teacher' | 'student',
): Promise<void> {
  const id = role === 'teacher' ? record.teacherId : record.studentId;
  if (
    !user ||
    user._id.toString() !== id ||
    user.email !== record.namespace + '.' + role + '@example.invalid' ||
    user.status !== UserStatus.Active ||
    user.roles.length !== 1 ||
    user.roles[0] !== role ||
    !(await comparePassword(SYNTHETIC_PASSWORD, user.passwordHash))
  )
    fail('SMOKE_ACCOUNT_REQUIRES_EXPLICIT_REPLACE');
}
function statePath(namespace: string): string {
  assertNamespace(namespace);
  return resolve(
    __dirname,
    '..',
    'coverage',
    'browser-text-task-smoke',
    namespace + '.json',
  );
}
function saveRecord(record: SmokeRecord): void {
  mkdirSync(resolve(__dirname, '..', 'coverage', 'browser-text-task-smoke'), {
    recursive: true,
  });
  writeFileSync(
    statePath(record.namespace),
    JSON.stringify(record, null, 2) + '\n',
    'utf8',
  );
}
function loadRecord(namespace: string): SmokeRecord {
  const raw: unknown = JSON.parse(readFileSync(statePath(namespace), 'utf8'));
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('namespace' in raw) ||
    raw.namespace !== namespace
  )
    fail('SMOKE_RECORD_INVALID');
  const value = raw as SmokeRecord;
  if (
    !Types.ObjectId.isValid(value.teacherId) ||
    !Types.ObjectId.isValid(value.studentId) ||
    !Array.isArray(value.taskIds) ||
    value.taskIds.some((id) => !Types.ObjectId.isValid(id)) ||
    !Number.isInteger(value.frontendPort) ||
    !Number.isInteger(value.backendPort)
  )
    fail('SMOKE_RECORD_INVALID');
  return value;
}
function readEnvironment(): {
  file: Record<string, string>;
  environment: NodeJS.ProcessEnv;
} {
  const file = parse(
    readFileSync(resolve(__dirname, '..', '.env.browser-acceptance')),
  );
  return {
    file,
    environment: createBrowserAcceptanceEnvironment(file, process.env),
  };
}
async function verifyConnection(
  connection: Connection,
  role: 'APP' | 'ADMIN',
): Promise<void> {
  assertConnectedDatabaseMatchesPurpose({
    nodeEnv: 'test',
    purpose: 'browser_acceptance',
    databaseName: connection.db?.databaseName,
  });
  if (!connection.db) fail('SMOKE_DATABASE_NOT_CONNECTED');
  const status: unknown = await connection.db.command(
    { connectionStatus: 1, showPrivileges: false },
    { timeoutMS: 5000 },
  );
  const rawRoles = readObject(
    readObject(status).authInfo,
  ).authenticatedUserRoles;
  if (!Array.isArray(rawRoles)) fail('SMOKE_DATABASE_ROLE_MISMATCH');
  const roles = rawRoles.map((entry: unknown) => ({
    db: stringField(entry, 'db'),
    role: stringField(entry, 'role'),
  }));
  assertSmokeRole(roles, role);
}
function models(connection: Connection) {
  return {
    users: connection.model(User.name, UserSchema),
    courses: connection.model(Course.name, CourseSchema),
    classrooms: connection.model(Classroom.name, ClassroomSchema),
    tasks: connection.model(Task.name, TaskSchema),
    classroomTasks: connection.model(ClassroomTask.name, ClassroomTaskSchema),
    submissions: connection.model(Submission.name, SubmissionSchema),
    jobs: connection.model(AiFeedbackJob.name, AiFeedbackJobSchema),
    feedback: connection.model(Feedback.name, FeedbackSchema),
    enrollments: connection.model(Enrollment.name, EnrollmentSchema),
  };
}
async function inventory(connection: Connection, record: SmokeRecord) {
  const m = models(connection);
  const teacherId = new Types.ObjectId(record.teacherId);
  const studentId = new Types.ObjectId(record.studentId);
  const users = await m.users
    .find({ _id: { $in: [teacherId, studentId] } })
    .select('+passwordHash')
    .lean<UserRow[]>()
    .maxTimeMS(5000)
    .exec();
  for (const user of users) {
    const role = user._id.equals(teacherId) ? 'teacher' : 'student';
    if (user.email !== record.namespace + '.' + role + '@example.invalid')
      fail('SMOKE_USER_OWNERSHIP_MISMATCH');
  }
  const courses = await m.courses
    .find({ createdBy: teacherId })
    .select('_id createdBy code')
    .lean<CourseRow[]>()
    .maxTimeMS(5000)
    .exec();
  const tasks = await m.tasks
    .find({ createdBy: teacherId })
    .select('_id createdBy title status visibility')
    .lean<TaskRow[]>()
    .maxTimeMS(5000)
    .exec();
  const classrooms = await m.classrooms
    .find({ teacherId })
    .select('_id courseId teacherId studentIds name joinCode')
    .lean<ClassroomRow[]>()
    .maxTimeMS(5000)
    .exec();
  const modes = Object.values(AiFeedbackMode);
  if (
    courses.some(
      (row) =>
        row.code !== record.namespace ||
        (record.courseId && row._id.toString() !== record.courseId),
    ) ||
    tasks.some(
      (row) =>
        !modes.some((mode) => row.title === record.namespace + ' ' + mode),
    ) ||
    classrooms.some(
      (row) =>
        row.name !== record.namespace + ' 合成验收班' ||
        !courses.some((course) => course._id.equals(row.courseId)) ||
        row.studentIds.some((id) => !id.equals(studentId)),
    )
  )
    fail('SMOKE_CONTAINER_OWNERSHIP_MISMATCH');
  const taskIds = tasks.map((row) => row._id);
  const classroomIds = classrooms.map((row) => row._id);
  const classroomTasks = await m.classroomTasks
    .find({
      $or: [
        { classroomId: { $in: classroomIds } },
        { taskId: { $in: taskIds } },
      ],
    })
    .select('_id classroomId taskId createdBy settings status')
    .lean<ClassroomTaskRow[]>()
    .maxTimeMS(5000)
    .exec();
  if (
    classroomTasks.some(
      (row) =>
        !row.createdBy.equals(teacherId) ||
        !classroomIds.some((id) => id.equals(row.classroomId)) ||
        !taskIds.some((id) => id.equals(row.taskId)),
    )
  )
    fail('SMOKE_CLASSROOM_TASK_OWNERSHIP_MISMATCH');
  const classroomTaskIds = classroomTasks.map((row) => row._id);
  const submissions = await m.submissions
    .find({
      $or: [
        { studentId },
        { classroomTaskId: { $in: classroomTaskIds } },
        { taskId: { $in: taskIds } },
      ],
    })
    .select('_id studentId classroomTaskId taskId attemptNo content')
    .lean<SubmissionRow[]>()
    .maxTimeMS(5000)
    .exec();
  if (
    submissions.some(
      (row) =>
        !row.studentId.equals(studentId) ||
        !classroomTaskIds.some((id) => id.equals(row.classroomTaskId)) ||
        !taskIds.some((id) => id.equals(row.taskId)),
    )
  )
    fail('SMOKE_SUBMISSION_OWNERSHIP_MISMATCH');
  const submissionIds = submissions.map((row) => row._id);
  const jobs = await m.jobs
    .find({
      $or: [
        { studentId },
        { submissionId: { $in: submissionIds } },
        { classroomTaskId: { $in: classroomTaskIds } },
      ],
    })
    .lean<JobRow[]>()
    .maxTimeMS(5000)
    .exec();
  const completeRecord = {
    ...record,
    classroomId: classrooms[0]?._id.toString(),
    taskIds: taskIds.map(String),
  };
  for (const job of jobs) {
    const submission = submissions.find((row) =>
      row._id.equals(job.submissionId),
    );
    const classroomTask = classroomTasks.find((row) =>
      row._id.equals(job.classroomTaskId),
    );
    if (!submission || !classroomTask) fail('SMOKE_JOB_ASSOCIATION_MISSING');
    assertTargetOwnership(completeRecord, job, submission, classroomTask);
  }
  const feedback = await m.feedback
    .find({ submissionId: { $in: submissionIds } })
    .select('_id submissionId createdBy source message')
    .lean<FeedbackRow[]>()
    .maxTimeMS(5000)
    .exec();
  if (feedback.some((row) => row.createdBy && !row.createdBy.equals(teacherId)))
    fail('SMOKE_FEEDBACK_OWNERSHIP_MISMATCH');
  const enrollments = await m.enrollments
    .find({
      $or: [{ classroomId: { $in: classroomIds } }, { userId: studentId }],
    })
    .select('_id classroomId userId')
    .lean<(IdRow & Pick<Enrollment, 'classroomId' | 'userId'>)[]>()
    .maxTimeMS(5000)
    .exec();
  if (
    enrollments.some(
      (row) =>
        !row.userId.equals(studentId) ||
        !classroomIds.some((id) => id.equals(row.classroomId)),
    )
  )
    fail('SMOKE_ENROLLMENT_OWNERSHIP_MISMATCH');
  return {
    m,
    users,
    courses,
    tasks,
    classrooms,
    classroomTasks,
    submissions,
    jobs,
    feedback,
    enrollments,
  };
}
export function cleanupFilters(
  record: SmokeRecord,
  owned: {
    courseIds: string[];
    classroomIds: string[];
    taskIds: string[];
    classroomTaskIds: string[];
    submissionIds: string[];
    jobIds: string[];
    feedbackIds: string[];
    enrollmentIds: string[];
  },
) {
  const ids = (values: string[]) => ({
    $in: values.map((id) => new Types.ObjectId(id)),
  });
  return {
    feedback: {
      _id: ids(owned.feedbackIds),
      submissionId: ids(owned.submissionIds),
    },
    jobs: {
      _id: ids(owned.jobIds),
      studentId: new Types.ObjectId(record.studentId),
      submissionId: ids(owned.submissionIds),
    },
    submissions: {
      _id: ids(owned.submissionIds),
      studentId: new Types.ObjectId(record.studentId),
      classroomTaskId: ids(owned.classroomTaskIds),
    },
    classroomTasks: {
      _id: ids(owned.classroomTaskIds),
      classroomId: ids(owned.classroomIds),
      createdBy: new Types.ObjectId(record.teacherId),
    },
    tasks: {
      _id: ids(owned.taskIds),
      createdBy: new Types.ObjectId(record.teacherId),
    },
    enrollments: {
      _id: ids(owned.enrollmentIds),
      classroomId: ids(owned.classroomIds),
      userId: new Types.ObjectId(record.studentId),
    },
    classrooms: {
      _id: ids(owned.classroomIds),
      teacherId: new Types.ObjectId(record.teacherId),
    },
    courses: {
      _id: ids(owned.courseIds),
      createdBy: new Types.ObjectId(record.teacherId),
    },
    users: {
      _id: ids([record.teacherId, record.studentId]),
      email: {
        $in: [
          record.namespace + '.teacher@example.invalid',
          record.namespace + '.student@example.invalid',
        ],
      },
    },
    sessions: { userId: ids([record.teacherId, record.studentId]) },
  };
}
function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('SMOKE_HTTP_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}
function stringField(value: unknown, key: string): string {
  const result = readObject(value)[key];
  if (typeof result !== 'string' || !result)
    fail('SMOKE_HTTP_RESPONSE_INVALID');
  return result;
}
async function prepare(
  connection: Connection,
  namespace: string,
  frontendPort: number,
  backendPort: number,
): Promise<void> {
  if (existsSync(statePath(namespace)))
    fail('SMOKE_NAMESPACE_ALREADY_RECORDED_INSPECT_FIRST');
  const record: SmokeRecord = {
    namespace,
    frontendPort,
    backendPort,
    teacherId: new Types.ObjectId().toString(),
    studentId: new Types.ObjectId().toString(),
    taskIds: [],
  };
  saveRecord(record); // Ownership persists before the first possible write.
  const m = models(connection);
  const existing = await m.users
    .countDocuments({
      email: {
        $in: [
          namespace + '.teacher@example.invalid',
          namespace + '.student@example.invalid',
        ],
      },
    })
    .maxTimeMS(5000)
    .exec();
  if (existing) fail('SMOKE_SYNTHETIC_EMAIL_ALREADY_EXISTS');
  const passwordHash = await hashPassword(
    validateNewPassword(SYNTHETIC_PASSWORD),
  );
  for (const role of ['teacher', 'student'] as const) {
    const id = role === 'teacher' ? record.teacherId : record.studentId;
    const user = new m.users({
      _id: new Types.ObjectId(id),
      email: namespace + '.' + role + '@example.invalid',
      passwordHash,
      roles: [role],
      status: UserStatus.Active,
      name: '合成 ' + role,
    });
    await user.validate();
    await user.save({ wtimeout: 5000 });
  }
  let cookie = '';
  const origin = 'http://127.0.0.1:' + frontendPort;
  const request = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(origin + '/api/proxy/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) fail('SMOKE_HTTP_' + response.status);
    if (path === 'auth/login') {
      const session = response.headers
        .getSetCookie()
        .find((header) => header.startsWith('ef_session='));
      if (!session) fail('SMOKE_LOGIN_COOKIE_MISSING');
      cookie = session.split(';')[0]; // Memory only: never persisted or logged.
    }
    return readObject(await response.json());
  };
  try {
    const teacher = await request('auth/login', {
      email: namespace + '.teacher@example.invalid',
      password: SYNTHETIC_PASSWORD,
    });
    if (stringField(teacher, 'id') !== record.teacherId)
      fail('SMOKE_LOGIN_ID_MISMATCH');
    const course = await request('courses', {
      code: namespace,
      name: namespace + ' 合成编程验收',
      term: '2026 合成验收',
    });
    record.courseId = stringField(course, 'id');
    saveRecord(record);
    const classroom = await request('classrooms', {
      courseId: record.courseId,
      name: namespace + ' 合成验收班',
    });
    record.classroomId = stringField(classroom, 'id');
    saveRecord(record);
    for (const mode of Object.values(AiFeedbackMode)) {
      const task = await request('learning-tasks/tasks', {
        title: namespace + ' ' + mode,
        description:
          '合成编程任务：将数组求和逻辑拆为 sum.js 与 main.js 两个 FILE 片段；提交独立说明并按教师意见修订。此材料仅用于工程验收。',
        knowledgeModule: '合成数组与函数',
        stage: 1,
        status: 'PUBLISHED',
        visibility: 'PRIVATE',
        rubric: {
          dimensions: { correctness: 60, codeStyle: 40 },
          notes: '合成验收评分参考：覆盖空数组及多个元素，并说明修改理由。',
        },
      });
      record.taskIds.push(stringField(task, 'id'));
      saveRecord(record);
    }
    await request('auth/logout', {});
    cookie = '';
    const student = await request('auth/login', {
      email: namespace + '.student@example.invalid',
      password: SYNTHETIC_PASSWORD,
    });
    if (stringField(student, 'id') !== record.studentId)
      fail('SMOKE_LOGIN_ID_MISMATCH');
    await request('classrooms/join', {
      joinCode: stringField(classroom, 'joinCode'),
    });
    await request('auth/logout', {});
    cookie = '';
  } finally {
    cookie = '';
  } // Never replay an uncertain write: inspect ownership first.
  await inspect(connection, record, true);
}
async function inspect(
  connection: Connection,
  record: SmokeRecord,
  requirePrepared = false,
): Promise<void> {
  const owned = await inventory(connection, record);
  if (requirePrepared) {
    for (const role of ['teacher', 'student'] as const) {
      const id = role === 'teacher' ? record.teacherId : record.studentId;
      await assertSyntheticAccount(
        owned.users.find((row) => row._id.toString() === id) ?? null,
        record,
        role,
      );
    }
    if (
      owned.courses.length !== 1 ||
      owned.classrooms.length !== 1 ||
      owned.tasks.length !== 4 ||
      owned.tasks.some(
        (task) =>
          task.status !== TaskStatus.Published || task.visibility !== 'PRIVATE',
      ) ||
      owned.enrollments.length !== 1 ||
      owned.classroomTasks.length ||
      owned.submissions.length ||
      owned.jobs.length
    )
      fail('SMOKE_PREPARED_SHAPE_MISMATCH');
  }
  console.log(
    JSON.stringify({
      ok: true,
      processRole: 'ADMIN',
      databaseName: connection.db?.databaseName,
      namespace: record.namespace,
      preparedVerified: requirePrepared,
      ids: {
        teacherId: record.teacherId,
        studentId: record.studentId,
        courses: owned.courses.map((row) => row._id.toString()),
        classrooms: owned.classrooms.map((row) => row._id.toString()),
        templates: owned.tasks.map((row) => ({
          id: row._id.toString(),
          title: row.title,
        })),
        classroomTasks: owned.classroomTasks.map((row) => ({
          id: row._id.toString(),
          mode: row.settings?.aiFeedbackMode,
          status: row.status,
        })),
      },
      counts: {
        users: owned.users.length,
        courses: owned.courses.length,
        classrooms: owned.classrooms.length,
        tasks: owned.tasks.length,
        classroomTasks: owned.classroomTasks.length,
        submissions: owned.submissions.length,
        jobs: owned.jobs.length,
        feedback: owned.feedback.length,
        enrollments: owned.enrollments.length,
      },
      submissions: owned.submissions.map((row) => ({
        id: row._id.toString(),
        classroomTaskId: row.classroomTaskId?.toString(),
        attemptNo: row.attemptNo,
        exactVersion:
          Object.entries(SMOKE_MATERIALS).find(
            ([, material]) =>
              row.content.codeText === material.codeText &&
              row.content.submissionNote === material.submissionNote,
          )?.[0] ?? null,
      })),
      jobs: owned.jobs.map((row) => ({
        id: row._id.toString(),
        submissionId: row.submissionId.toString(),
        status: row.status,
        provider: row.provider,
        attempts: row.attempts,
      })),
      feedback: owned.feedback.map((row) => ({
        id: row._id.toString(),
        submissionId: row.submissionId.toString(),
        source: row.source,
      })),
    }),
  );
}
async function cleanup(
  connection: Connection,
  record: SmokeRecord,
): Promise<void> {
  const owned = await inventory(connection, record);
  if (owned.jobs.some((job) => job.status === AiFeedbackJobStatus.Running))
    fail('SMOKE_IN_FLIGHT_JOB_REFUSES_CLEANUP');
  const strings = (rows: IdRow[]) => rows.map((row) => row._id.toString());
  const filters = cleanupFilters(record, {
    courseIds: strings(owned.courses),
    classroomIds: strings(owned.classrooms),
    taskIds: strings(owned.tasks),
    classroomTaskIds: strings(owned.classroomTasks),
    submissionIds: strings(owned.submissions),
    jobIds: strings(owned.jobs),
    feedbackIds: strings(owned.feedback),
    enrollmentIds: strings(owned.enrollments),
  });
  if (!connection.db) fail('SMOKE_DATABASE_NOT_CONNECTED');
  for (const name of [
    'feedback',
    'jobs',
    'submissions',
    'classroomTasks',
    'tasks',
    'enrollments',
    'classrooms',
    'courses',
  ] as const)
    await connection.db
      .collection(owned.m[name].collection.name)
      .deleteMany(filters[name], { maxTimeMS: 5000 });
  if (!connection.db) fail('SMOKE_DATABASE_NOT_CONNECTED');
  for (const name of ['sessions', 'passwordresettokens'])
    await connection.db
      .collection(name)
      .deleteMany(filters.sessions, { maxTimeMS: 5000 });
  await owned.m.users.deleteMany(filters.users).maxTimeMS(5000).exec();
  await inspect(connection, record);
  const residual = await inventory(connection, record);
  if (
    residual.users.length ||
    residual.courses.length ||
    residual.classrooms.length ||
    residual.tasks.length ||
    residual.classroomTasks.length ||
    residual.submissions.length ||
    residual.jobs.length ||
    residual.feedback.length ||
    residual.enrollments.length
  )
    fail('SMOKE_CLEANUP_RESIDUAL');
  for (const name of ['sessions', 'passwordresettokens'])
    if (
      await connection.db
        .collection(name)
        .countDocuments(filters.sessions, { maxTimeMS: 5000 })
    )
      fail('SMOKE_AUTH_RESIDUAL');
  console.log(
    JSON.stringify({
      ok: true,
      namespace: record.namespace,
      cleanup: 'completed',
      ownResidual: 0,
    }),
  );
}
async function processAi(record: SmokeRecord, jobId: string): Promise<void> {
  if (!Types.ObjectId.isValid(jobId)) fail('SMOKE_JOB_ID_INVALID');
  process.env = readEnvironment().environment;
  const load = createRequire(__filename); // App imports follow both declaration gates.
  const { NestFactory } = await import('@nestjs/core');
  const { ConfigService } = await import('@nestjs/config');
  const { getConnectionToken } = await import('@nestjs/mongoose');
  const { AppModule } = load('../src/app.module') as {
    AppModule: Type<unknown>;
  };
  const { AiFeedbackProcessor } = load(
    '../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service',
  ) as typeof import('../src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service');
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: false,
      logger: false,
    });
    const config = app.get(ConfigService);
    if (
      config.get('AI_FEEDBACK_PROVIDER') !== 'stub' ||
      config.get('AI_FEEDBACK_WORKER_ENABLED') !== false ||
      config.get('AI_FEEDBACK_DEBUG_ENABLED') !== 'false' ||
      config.get('mongo.purpose') !== 'browser_acceptance'
    )
      fail('SMOKE_PROCESSOR_CONFIGURATION_MISMATCH');
    const connection = app.get<Connection>(getConnectionToken());
    await verifyConnection(connection, 'APP');
    const owned = await inventory(connection, record);
    const job = owned.jobs.find((row) => row._id.toString() === jobId);
    if (!job) fail('SMOKE_TARGET_JOB_NOT_OWNED');
    // processOnce is global. The operator must serialize producers/consumers in
    // an exclusive acceptance window; the following query is not a lock.
    const pending = await owned.m.jobs
      .find({
        status: {
          $in: [
            AiFeedbackJobStatus.Pending,
            AiFeedbackJobStatus.Failed,
            AiFeedbackJobStatus.Running,
          ],
        },
      })
      .select('_id status budgetVersion attempts')
      .lean<Pick<JobRow, '_id' | 'status' | 'budgetVersion' | 'attempts'>[]>()
      .maxTimeMS(5000)
      .exec();
    assertExclusiveJob(jobId, pending);
    const result = await app.get(AiFeedbackProcessor).processOnce(1);
    const actual = await owned.m.jobs
      .findById(jobId)
      .select('_id status provider attempts requests')
      .lean<
        Pick<JobRow, '_id' | 'status' | 'provider' | 'attempts' | 'requests'>
      >()
      .maxTimeMS(5000)
      .exec();
    const feedback = await owned.m.feedback
      .countDocuments({ submissionId: job.submissionId, source: 'AI' })
      .maxTimeMS(5000)
      .exec();
    if (
      result.processed !== 1 ||
      result.succeeded !== 1 ||
      result.failed !== 0 ||
      result.dead !== 0 ||
      actual?.status !== AiFeedbackJobStatus.Succeeded ||
      actual.provider !== 'stub' ||
      actual.requests?.length ||
      feedback < 1
    )
      fail('SMOKE_PROCESSOR_RESULT_MISMATCH');
    console.log(
      JSON.stringify({
        ok: true,
        processRole: 'APP',
        databaseName: connection.db?.databaseName,
        namespace: record.namespace,
        targetJobId: jobId,
        nonterminalBefore: 1,
        result,
        status: actual.status,
        provider: actual.provider,
        realModelCalled: false,
        feedbackCount: feedback,
      }),
    );
  } finally {
    if (app) await app.close();
  }
}
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || !command) {
    console.log(
      'browser:text-smoke prepare|replace|inspect|process-ai|cleanup --namespace b1-2-<unique> [--frontend-port 3100 --backend-port 5100] [--prepared] [--job-id <id> --confirm-exclusive <namespace>] [--confirm-namespace <namespace>]',
    );
    return;
  }
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const namespace = option('--namespace') ?? '';
  assertNamespace(namespace);
  if (
    !['prepare', 'replace', 'inspect', 'process-ai', 'cleanup'].includes(
      command,
    )
  )
    fail('SMOKE_COMMAND_INVALID');
  if (
    (command === 'cleanup' || command === 'replace') &&
    option('--confirm-namespace') !== namespace
  )
    fail('SMOKE_CLEANUP_CONFIRMATION_REQUIRED');
  if (command === 'process-ai') {
    if (option('--confirm-exclusive') !== namespace)
      fail('SMOKE_EXCLUSIVE_WINDOW_CONFIRMATION_REQUIRED');
    await processAi(loadRecord(namespace), option('--job-id') ?? '');
    return;
  }
  const { file, environment } = readEnvironment();
  delete environment.MONGO_URI;
  process.env = environment;
  let connection: Connection | undefined;
  try {
    connection = mongoose.createConnection(
      file.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI,
      {
        autoIndex: false,
        autoCreate: false,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
      },
    );
    await connection.asPromise();
    await verifyConnection(connection, 'ADMIN');
    if (command === 'prepare') {
      const frontendPort = Number(option('--frontend-port') ?? 3100);
      const backendPort = Number(option('--backend-port') ?? 5100);
      if (
        ![frontendPort, backendPort].every(
          (port) => Number.isInteger(port) && port > 1024 && port < 65536,
        ) ||
        frontendPort === backendPort ||
        [frontendPort, backendPort].some(
          (port) => port === 3000 || port === 5000,
        )
      )
        fail('SMOKE_PORT_INVALID');
      await prepare(connection, namespace, frontendPort, backendPort);
    } else if (command === 'replace') {
      const previous = loadRecord(namespace);
      await cleanup(connection, previous);
      unlinkSync(statePath(namespace));
      await prepare(
        connection,
        namespace,
        previous.frontendPort,
        previous.backendPort,
      );
    } else if (command === 'inspect')
      await inspect(
        connection,
        loadRecord(namespace),
        args.includes('--prepared'),
      );
    else await cleanup(connection, loadRecord(namespace));
  } finally {
    if (connection) await connection.close();
  }
}
if (require.main === module) {
  const deadline = setTimeout(() => {
    console.error(
      JSON.stringify({
        ok: false,
        code: 'SMOKE_TIMED_OUT_AUDIT_BEFORE_RETRY',
        sideEffects: 'unknown',
      }),
    );
    process.exit(124);
  }, 120000);
  void main()
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          ok: false,
          code:
            error instanceof DatabaseGateError
              ? error.code
              : 'SMOKE_COMMAND_FAILED_INSPECT_BEFORE_RETRY',
        }),
      );
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(deadline));
}
