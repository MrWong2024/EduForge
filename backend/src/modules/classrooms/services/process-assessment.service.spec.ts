import { Types } from 'mongoose';
import { ProcessAssessmentService } from './process-assessment.service';

const CSV_HEADER =
  'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,avgErrorItems,topTags';
const RUBRIC = {
  submittedTasksRate: 0.4,
  submissionsCount: 0.2,
  aiRequestQualityProxy: 0.2,
  codeQualityProxy: 0.2,
};

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const makeAggregate = <T>(result: T) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const createService = () =>
  new ProcessAssessmentService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

const createAssessmentHarness = () => {
  const classroomId = objectId();
  const teacherId = objectId();
  const submittedStudentId = objectId();
  const zeroSubmissionStudentId = objectId();
  const classroomTaskId = objectId();
  const anotherClassroomTaskId = objectId();
  const submissionId = objectId();
  const anotherSubmissionId = objectId();

  const classroomModel = {
    findOne: jest.fn().mockReturnValue(makeQuery({ _id: classroomId })),
  };
  const classroomTaskModel = {
    find: jest
      .fn()
      .mockReturnValue(
        makeQuery([{ _id: classroomTaskId }, { _id: anotherClassroomTaskId }]),
      ),
  };
  const submissionModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate([
        {
          _id: submittedStudentId,
          submissionsCount: 2,
          submittedTasksCount: 1,
          lateSubmissionsCount: 0,
          lateTasksCount: 0,
          submissionIds: [submissionId, anotherSubmissionId],
        },
      ]),
    ),
  };
  const aiFeedbackJobModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate([
        {
          _id: submittedStudentId,
          aiRequestedCount: 2,
          aiSucceededCount: 1,
        },
      ]),
    ),
  };
  const feedbackModel = {
    aggregate: jest.fn().mockReturnValue(
      makeAggregate([
        {
          totals: [
            {
              _id: submittedStudentId,
              totalFeedbackItems: 3,
              totalErrorItems: 1,
            },
          ],
          tags: [{ _id: submittedStudentId, topTags: [] }],
        },
      ]),
    ),
  };
  const userModel = {
    find: jest.fn().mockReturnValue(
      makeQuery([
        {
          _id: submittedStudentId,
          name: 'Submitted Student',
          studentNo: '2026001',
        },
        {
          _id: zeroSubmissionStudentId,
          name: 'Zero Submission Student',
          studentNo: '2026002',
        },
      ]),
    ),
  };
  const enrollmentService = {
    countStudents: jest.fn().mockResolvedValue(2),
    listActiveStudentIdsByClassroomPage: jest
      .fn()
      .mockResolvedValue([
        submittedStudentId.toString(),
        zeroSubmissionStudentId.toString(),
      ]),
  };
  const service = new ProcessAssessmentService(
    classroomModel as never,
    classroomTaskModel as never,
    submissionModel as never,
    aiFeedbackJobModel as never,
    feedbackModel as never,
    userModel as never,
    enrollmentService as never,
  );

  return {
    classroomId,
    teacherId,
    submittedStudentId,
    zeroSubmissionStudentId,
    service,
  };
};

describe('ProcessAssessmentService getProcessAssessment', () => {
  it('keeps active students with zero submissions in the list and fixes their score at 0', async () => {
    const {
      classroomId,
      teacherId,
      submittedStudentId,
      zeroSubmissionStudentId,
      service,
    } = createAssessmentHarness();

    const result = await service.getProcessAssessment(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.items).toHaveLength(2);
    const zeroSubmissionItem = result.items.find(
      (item) => item.studentId === zeroSubmissionStudentId.toString(),
    );
    expect(zeroSubmissionItem).toBeDefined();
    expect(zeroSubmissionItem).toMatchObject({
      studentId: zeroSubmissionStudentId.toString(),
      submissionsCount: 0,
      score: 0,
    });
    expect(zeroSubmissionItem?.score).not.toBe(20);

    const submittedItem = result.items.find(
      (item) => item.studentId === submittedStudentId.toString(),
    );
    expect(submittedItem).toBeDefined();
    expect(submittedItem).toMatchObject({
      submissionsCount: 2,
      submittedTasksCount: 1,
      score: 46,
    });
    expect(submittedItem?.score).toBeGreaterThan(0);
  });
});

describe('ProcessAssessmentService exportProcessAssessmentCsv', () => {
  it('prefixes CSV with UTF-8 BOM and preserves header order with Chinese text', async () => {
    const service = createService();
    jest.spyOn(service as never, 'buildPayload').mockResolvedValue({
      classroomId: 'classroom-1',
      window: 'all',
      generatedAt: '2026-05-20T00:00:00.000Z',
      page: 1,
      limit: 50,
      total: 1,
      rubric: RUBRIC,
      items: [
        {
          studentId: 'student-1',
          studentName: '张三',
          studentNo: '2025001',
          submittedTasksCount: 1,
          publishedTasksCount: 2,
          submittedTasksRate: 0.5,
          submissionsCount: 2,
          lateSubmissionsCount: 1,
          lateTasksCount: 1,
          aiRequestedCount: 2,
          aiSucceededCount: 1,
          avgFeedbackItems: 1.5,
          avgErrorItems: 0.5,
          topTags: [{ tag: '中文标签', count: 2 }],
          riskLevel: 'MEDIUM',
          score: 82.5,
        },
      ],
    });

    const result = await service.exportProcessAssessmentCsv(
      'classroom-1',
      {},
      'teacher-1',
    );

    expect(result.startsWith('\uFEFF')).toBe(true);
    const [headerLine, firstDataLine] = result.slice(1).split('\n');
    expect(headerLine).toBe(CSV_HEADER);
    expect(firstDataLine).toContain('张三');
    expect(firstDataLine).toContain('中文标签:2');
  });

  it('returns BOM plus header row when there are no items', async () => {
    const service = createService();
    jest.spyOn(service as never, 'buildPayload').mockResolvedValue({
      classroomId: 'classroom-1',
      window: 'all',
      generatedAt: '2026-05-20T00:00:00.000Z',
      page: 1,
      limit: 50,
      total: 0,
      rubric: RUBRIC,
      items: [],
    });

    const result = await service.exportProcessAssessmentCsv(
      'classroom-1',
      {},
      'teacher-1',
    );

    expect(result).toBe(`\uFEFF${CSV_HEADER}`);
  });

  it('exports zero-submission active students with score 0 while preserving BOM and columns', async () => {
    const { classroomId, teacherId, zeroSubmissionStudentId, service } =
      createAssessmentHarness();

    const result = await service.exportProcessAssessmentCsv(
      classroomId.toString(),
      {},
      teacherId.toString(),
    );

    expect(result.startsWith('\uFEFF')).toBe(true);
    const [headerLine, ...dataLines] = result.slice(1).split('\n');
    expect(headerLine).toBe(CSV_HEADER);
    const zeroSubmissionLine = dataLines.find((line) =>
      line.includes(zeroSubmissionStudentId.toString()),
    );
    expect(zeroSubmissionLine).toBeDefined();
    expect(zeroSubmissionLine?.split(',')[3]).toBe('0');
  });
});
