import {
  buildSystemPrompt,
  buildUserPrompt,
} from './openrouter-feedback.prompt';

describe('openrouter-feedback prompt constraints', () => {
  it('includes hard cardinality, merge and anti-noise constraints in system prompt', () => {
    const systemPrompt = buildSystemPrompt();

    expect(systemPrompt).toContain(
      'items length must be 1; only when a second issue category is clearly independent and cannot be merged may items length be 2',
    );
    expect(systemPrompt).toContain('Never output more than 2 items');
    expect(systemPrompt).toContain('同类问题必须聚合为综合反馈');
    expect(systemPrompt).toContain(
      '若存在语法/编译/运行阻断问题，必须优先作为主反馈',
    );
    expect(systemPrompt).toContain(
      '若存在 ERROR/WARN，不要输出独立的表扬型 INFO 噪音条目',
    );
    expect(systemPrompt).toContain('若代码整体正确，也必须返回 1 条综合反馈');
    expect(systemPrompt).toContain(
      '必须区分“未实现功能”与“已写出逻辑但因语法/编译错误无法运行”',
    );
  });

  it('includes valid/invalid output-shape examples in system prompt', () => {
    const systemPrompt = buildSystemPrompt();

    expect(systemPrompt).toContain('Valid shape example A (1 item)');
    expect(systemPrompt).toContain('Valid shape example B (2 items)');
    expect(systemPrompt).toContain(
      'Invalid example C: five praise-only INFO items.',
    );
    expect(systemPrompt).toContain(
      'Invalid example D: split same syntax issue by line numbers into many items.',
    );
  });

  it('includes primary-problem user instructions', () => {
    const userPrompt = buildUserPrompt({
      maxCodeChars: 5000,
      context: {
        submissionId: 'sub-1',
        classroomTaskId: 'ct-1',
        attemptNo: 2,
        language: 'typescript',
        codeText: 'function main(){return 1;}',
        aiUsageDeclaration: 'none',
        taskId: 'task-1',
        taskTitle: 'Task title',
        taskDescription: 'Task desc',
        taskRubric: { k: 'v' },
      },
    });

    expect(userPrompt).toContain(
      'Focus on primary-problem-oriented integrated feedback',
    );
    expect(userPrompt).toContain(
      'Prefer exactly one item. Output two items only when the second category is clearly independent and improves student understanding.',
    );
    expect(userPrompt).toContain(
      'Differentiate between "feature not implemented" and "logic exists but cannot run due to syntax/compile errors".',
    );
    expect(userPrompt).toContain(
      'For repeated same-category issues (for example repeated missing semicolons), merge into one integrated item.',
    );
  });
});
