import { Types } from 'mongoose';
import { AiFeedbackStatus } from '../../../learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum';
import { ClassReviewPackService } from './class-review-pack.service';

const createService = () =>
  new ClassReviewPackService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

const buildStudentId = (prefix: string, index: number) =>
  `${prefix}-${index.toString().padStart(3, '0')}`;

const buildSubmission = (studentId: string, attemptNo = 1) => ({
  _id: new Types.ObjectId(),
  studentId: new Types.ObjectId(),
  attemptNo,
  isLate: false,
  createdAt: new Date('2026-05-21T00:00:00.000Z'),
});

describe('ClassReviewPackService buildStudentTiers', () => {
  it('returns full active-student tiers beyond previous backend limits and excludes removed students', () => {
    const service = createService();
    const activeStudentIds: string[] = [];
    const attemptsCountByStudentId = new Map<string, number>();
    const latestSubmissionByStudentId = new Map<
      string,
      ReturnType<typeof buildSubmission>
    >();
    const latestErrorCountBySubmissionId = new Map<string, number>();
    const latestAiStatusMap = new Map<string, AiFeedbackStatus>();
    const studentPublicMap = new Map<
      string,
      { studentName: string; studentNo: string | null }
    >();

    for (let index = 1; index <= 21; index += 1) {
      const studentId = buildStudentId('good', index);
      const submission = buildSubmission(studentId);
      activeStudentIds.push(studentId);
      attemptsCountByStudentId.set(studentId, 1);
      latestSubmissionByStudentId.set(studentId, submission);
      latestErrorCountBySubmissionId.set(submission._id.toString(), 0);
      latestAiStatusMap.set(
        submission._id.toString(),
        AiFeedbackStatus.Succeeded,
      );
      studentPublicMap.set(studentId, {
        studentName: `Good ${index}`,
        studentNo: `G${index.toString().padStart(3, '0')}`,
      });
    }

    for (let index = 1; index <= 3; index += 1) {
      const studentId = buildStudentId('watch', index);
      const submission = buildSubmission(studentId, 2);
      activeStudentIds.push(studentId);
      attemptsCountByStudentId.set(studentId, 2);
      latestSubmissionByStudentId.set(studentId, submission);
      latestErrorCountBySubmissionId.set(submission._id.toString(), 1);
      latestAiStatusMap.set(
        submission._id.toString(),
        AiFeedbackStatus.Succeeded,
      );
      studentPublicMap.set(studentId, {
        studentName: `Watch ${index}`,
        studentNo: `W${index.toString().padStart(3, '0')}`,
      });
    }

    for (let index = 1; index <= 51; index += 1) {
      const studentId = buildStudentId('missing', index);
      activeStudentIds.push(studentId);
      attemptsCountByStudentId.set(studentId, 0);
      studentPublicMap.set(studentId, {
        studentName: `Missing ${index}`,
        studentNo: `N${index.toString().padStart(3, '0')}`,
      });
    }

    const removedStudentId = 'removed-001';
    attemptsCountByStudentId.set(removedStudentId, 0);
    studentPublicMap.set(removedStudentId, {
      studentName: 'Removed Student',
      studentNo: 'R001',
    });

    const tiers = (
      service as never as {
        buildStudentTiers: (
          activeIds: string[],
          attemptsMap: Map<string, number>,
          latestSubmissionMap: Map<string, ReturnType<typeof buildSubmission>>,
          errorCountMap: Map<string, number>,
          aiStatusMap: Map<string, AiFeedbackStatus>,
          studentMap: Map<
            string,
            { studentName: string; studentNo: string | null }
          >,
        ) => {
          good: Array<{ studentId: string }>;
          watch: Array<{ studentId: string }>;
          notSubmitted: Array<{ studentId: string }>;
        };
      }
    ).buildStudentTiers(
      activeStudentIds,
      attemptsCountByStudentId,
      latestSubmissionByStudentId,
      latestErrorCountBySubmissionId,
      latestAiStatusMap,
      studentPublicMap,
    );

    expect(tiers.good).toHaveLength(21);
    expect(tiers.watch).toHaveLength(3);
    expect(tiers.notSubmitted).toHaveLength(51);
    expect(
      tiers.good.length + tiers.watch.length + tiers.notSubmitted.length,
    ).toBe(activeStudentIds.length);
    expect(tiers.good.length).toBeGreaterThan(20);
    expect(tiers.notSubmitted.length).toBeGreaterThan(50);
    expect(
      tiers.good.some((student) => student.studentId === removedStudentId),
    ).toBe(false);
    expect(
      tiers.watch.some((student) => student.studentId === removedStudentId),
    ).toBe(false);
    expect(
      tiers.notSubmitted.some(
        (student) => student.studentId === removedStudentId,
      ),
    ).toBe(false);
  });

  it('returns empty tiers when there are no active students', () => {
    const service = createService();

    const tiers = (
      service as never as {
        buildStudentTiers: (
          activeIds: string[],
          attemptsMap: Map<string, number>,
          latestSubmissionMap: Map<string, ReturnType<typeof buildSubmission>>,
          errorCountMap: Map<string, number>,
          aiStatusMap: Map<string, AiFeedbackStatus>,
          studentMap: Map<
            string,
            { studentName: string; studentNo: string | null }
          >,
        ) => {
          good: unknown[];
          watch: unknown[];
          notSubmitted: unknown[];
        };
      }
    ).buildStudentTiers(
      [],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(tiers).toEqual({
      good: [],
      watch: [],
      notSubmitted: [],
    });
  });
});
