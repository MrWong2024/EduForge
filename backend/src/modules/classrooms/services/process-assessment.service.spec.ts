import { ProcessAssessmentService } from './process-assessment.service';

const CSV_HEADER =
  'studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,avgErrorItems,topTags';

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
      rubric: {
        submittedTasksRate: 0.4,
        submissionsCount: 0.2,
        aiRequestQualityProxy: 0.2,
        codeQualityProxy: 0.2,
      },
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
      rubric: {
        submittedTasksRate: 0.4,
        submissionsCount: 0.2,
        aiRequestQualityProxy: 0.2,
        codeQualityProxy: 0.2,
      },
      items: [],
    });

    const result = await service.exportProcessAssessmentCsv(
      'classroom-1',
      {},
      'teacher-1',
    );

    expect(result).toBe(`\uFEFF${CSV_HEADER}`);
  });
});
