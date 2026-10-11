import { Types } from 'mongoose';
import { createBrowserAcceptanceEnvironment } from '../src/config/browser-acceptance-environment';
import { assertConnectedDatabaseMatchesPurpose } from '../src/config/database-purpose';
import { hashPassword } from '../src/modules/users/password.utils';
import { UserStatus } from '../src/modules/users/schemas/user.schema';
import { AiFeedbackJobStatus } from '../src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema';
import {
  assertNamespace,
  assertSmokeRole,
  assertExclusiveJob,
  assertTargetOwnership,
  assertSyntheticAccount,
  cleanupFilters,
  SYNTHETIC_PASSWORD,
} from './browser-text-task-smoke';

describe('B1-2 thin smoke support gates (no database)', () => {
  const teacherId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const taskId = new Types.ObjectId();
  const classroomId = new Types.ObjectId();
  const classroomTaskId = new Types.ObjectId();
  const submissionId = new Types.ObjectId();
  const jobId = new Types.ObjectId();
  const record = {
    namespace: 'b1-2-unit',
    frontendPort: 3100,
    backendPort: 5100,
    teacherId: teacherId.toString(),
    studentId: studentId.toString(),
    classroomId: classroomId.toString(),
    taskIds: [taskId.toString()],
  };
  const job = {
    _id: jobId,
    studentId,
    taskId,
    classroomTaskId,
    submissionId,
    status: AiFeedbackJobStatus.Pending,
    attempts: 0,
    budgetVersion: 1,
  };
  const submission = {
    _id: submissionId,
    studentId,
    taskId,
    classroomTaskId,
    attemptNo: 1,
    content: { codeText: 'synthetic', language: 'javascript' },
  };
  const classroomTask = {
    _id: classroomTaskId,
    taskId,
    classroomId,
    createdBy: teacherId,
    status: 'ACTIVE' as const,
  };

  it('reuses fail-closed declared-purpose and actual-database gates', () => {
    const file = {
      EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
      BROWSER_ACCEPTANCE_APP_MONGO_URI:
        'mongodb://127.0.0.1/eduforge_browser_test?appName=app',
      BROWSER_ACCEPTANCE_ADMIN_MONGO_URI:
        'mongodb://127.0.0.1/eduforge_browser_test?appName=admin',
    };
    expect(() =>
      createBrowserAcceptanceEnvironment(
        { ...file, EDUFORGE_DATABASE_PURPOSE: 'standard_test' },
        {},
      ),
    ).toThrow();
    expect(() =>
      createBrowserAcceptanceEnvironment(
        {
          ...file,
          BROWSER_ACCEPTANCE_APP_MONGO_URI: 'mongodb://127.0.0.1/eduforge_dev',
        },
        {},
      ),
    ).toThrow();
    expect(() =>
      assertConnectedDatabaseMatchesPurpose({
        nodeEnv: 'test',
        purpose: 'browser_acceptance',
        databaseName: 'eduforge_test',
      }),
    ).toThrow();
    const environment = createBrowserAcceptanceEnvironment(file, {
      MONGO_ADMIN_URI: 'inherited',
      AI_FEEDBACK_WORKER_ENABLED: 'true',
    });
    expect(environment.MONGO_ADMIN_URI).toBeUndefined();
    expect(environment.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI).toBeUndefined();
    expect(environment.AI_FEEDBACK_WORKER_ENABLED).toBe('false');
  });
  it('refuses swapped, privileged or cross-database roles', () => {
    expect(() =>
      assertSmokeRole(
        [{ db: 'eduforge_browser_test', role: 'readWrite' }],
        'APP',
      ),
    ).not.toThrow();
    expect(() =>
      assertSmokeRole(
        [{ db: 'eduforge_browser_test', role: 'dbOwner' }],
        'ADMIN',
      ),
    ).not.toThrow();
    expect(() =>
      assertSmokeRole(
        [{ db: 'eduforge_browser_test', role: 'dbOwner' }],
        'APP',
      ),
    ).toThrow();
    expect(() =>
      assertSmokeRole([{ db: 'admin', role: 'root' }], 'ADMIN'),
    ).toThrow();
    expect(() => assertSmokeRole([], 'APP')).toThrow();
  });
  it('allows only the exact current pending target', () => {
    expect(() => assertExclusiveJob(jobId.toString(), [job])).not.toThrow();
    for (const jobs of [
      [],
      [{ ...job, _id: new Types.ObjectId() }],
      [job, { ...job, _id: new Types.ObjectId() }],
      [{ ...job, budgetVersion: undefined }],
      [{ ...job, attempts: 1 }],
      [{ ...job, status: AiFeedbackJobStatus.Failed }],
      [{ ...job, status: AiFeedbackJobStatus.Running }],
    ])
      expect(() => assertExclusiveJob(jobId.toString(), jobs)).toThrow();
  });
  it('requires the complete job/submission/classroom/teacher/student chain', () => {
    expect(() =>
      assertTargetOwnership(record, job, submission, classroomTask),
    ).not.toThrow();
    expect(() =>
      assertTargetOwnership(
        record,
        { ...job, studentId: new Types.ObjectId() },
        submission,
        classroomTask,
      ),
    ).toThrow();
    expect(() =>
      assertTargetOwnership(
        record,
        job,
        { ...submission, classroomTaskId: new Types.ObjectId() },
        classroomTask,
      ),
    ).toThrow();
    expect(() =>
      assertTargetOwnership(record, job, submission, {
        ...classroomTask,
        createdBy: new Types.ObjectId(),
      }),
    ).toThrow();
    expect(() =>
      assertTargetOwnership(record, job, submission, {
        ...classroomTask,
        classroomId: new Types.ObjectId(),
      }),
    ).toThrow();
  });
  it('uses one fixed password and refuses a prepared account with another hash', async () => {
    expect(SYNTHETIC_PASSWORD).toBe('12345678');
    const user = {
      _id: teacherId,
      email: 'b1-2-unit.teacher@example.invalid',
      status: UserStatus.Active,
      roles: ['teacher'],
      passwordHash: await hashPassword(SYNTHETIC_PASSWORD),
    };
    await expect(
      assertSyntheticAccount(user, record, 'teacher'),
    ).resolves.toBeUndefined();
    await expect(
      assertSyntheticAccount(
        { ...user, passwordHash: await hashPassword('87654321') },
        record,
        'teacher',
      ),
    ).rejects.toThrow('SMOKE_ACCOUNT_REQUIRES_EXPLICIT_REPLACE');
    await expect(
      assertSyntheticAccount(
        { ...user, roles: ['teacher', 'admin'] },
        record,
        'teacher',
      ),
    ).rejects.toThrow();
  });
  it('cleanup always includes exact ids and association ownership; empty sets stay empty', () => {
    const filters = cleanupFilters(record, {
      courseIds: [],
      classroomIds: [classroomId.toString()],
      taskIds: [taskId.toString()],
      classroomTaskIds: [classroomTaskId.toString()],
      submissionIds: [submissionId.toString()],
      jobIds: [jobId.toString()],
      feedbackIds: [],
      enrollmentIds: [],
    });
    expect(filters.jobs).toEqual({
      _id: { $in: [jobId] },
      studentId,
      submissionId: { $in: [submissionId] },
    });
    expect(filters.submissions.classroomTaskId).toEqual({
      $in: [classroomTaskId],
    });
    expect(filters.courses).toEqual({ _id: { $in: [] }, createdBy: teacherId });
    expect(filters.users.email.$in).toEqual([
      'b1-2-unit.teacher@example.invalid',
      'b1-2-unit.student@example.invalid',
    ]);
    expect(JSON.stringify(filters)).not.toContain('$regex');
  });
  it('rejects broad or path-like namespaces', () => {
    expect(() => assertNamespace(record.namespace)).not.toThrow();
    for (const value of ['', 'b1-2-*', '../b1-2-unit', 'real-users'])
      expect(() => assertNamespace(value)).toThrow();
  });
});
