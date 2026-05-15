import { buildSystemPrompt, buildUserPrompt } from './ai-feedback.prompt';

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
      'For mostly correct or directionally correct submissions, return one integrated feedback item',
    );
    expect(systemPrompt).toContain('Language is a hint, not ground truth.');
    expect(systemPrompt).toContain(
      'If language hint is auto/unknown/empty, infer language mainly from code content.',
    );
    expect(systemPrompt).toContain(
      'If language hint conflicts with code syntax/tokens, trust the code and avoid wrong-language diagnostics.',
    );
    expect(systemPrompt).toContain(
      '必须区分“未实现功能”与“已写出逻辑但因语法/编译错误无法运行”',
    );
  });

  it('includes valid/invalid output-shape examples in system prompt', () => {
    const systemPrompt = buildSystemPrompt();

    expect(systemPrompt).toContain('Valid shape example A (1 item)');
    expect(systemPrompt).toContain('Valid shape example B (2 items)');
    expect(systemPrompt).toContain(
      'Valid boundary example C (correct but improvable): return exactly 1 integrated item with brief acknowledgement + 1~2 actionable improvements.',
    );
    expect(systemPrompt).toContain(
      'Valid boundary example D (truly nothing to improve): {"items":[]}.',
    );
    expect(systemPrompt).toContain(
      'Invalid example C: five praise-only INFO items.',
    );
    expect(systemPrompt).toContain(
      'Invalid example D: split same syntax issue by line numbers into many items.',
    );
    expect(systemPrompt).toContain(
      'Invalid example E: mostly correct code with improvable points but returns {"items":[]}.',
    );
  });

  it('defines empty-array boundary explicitly', () => {
    const systemPrompt = buildSystemPrompt();

    expect(systemPrompt).toContain(
      'Use {"items":[]} only when there is truly nothing worth flagging, no actionable suggestion, and no learning-value improvement point.',
    );
    expect(systemPrompt).toContain(
      'Do not treat "mostly correct but improvable" as no-issues.',
    );
  });

  it('includes multi-file boundary recognition safeguards in system prompt', () => {
    const systemPrompt = buildSystemPrompt();

    expect(systemPrompt).toContain(
      'codeText may contain a normal single-file submission',
    );
    expect(systemPrompt).toContain(
      'For normal single-file submissions without boundary markers',
    );
    expect(systemPrompt).toContain('analyze the code as a single file');
    expect(systemPrompt).toContain('do not require file markers');
    expect(systemPrompt).toContain('recommended multi-file marker');
    expect(systemPrompt).toContain(
      'File boundary markers have three confidence levels',
    );
    expect(systemPrompt).toContain('Standard markers');
    expect(systemPrompt).toContain('Keyword-based near-miss markers');
    expect(systemPrompt).toContain('Keyword-less boundary markers');
    expect(systemPrompt).toContain('case-insensitive');
    expect(systemPrompt).toContain('plausible relative file path or filename');
    expect(systemPrompt).toContain(
      'Do not merge different file blocks into one source file',
    );
    expect(systemPrompt).toContain(
      'Only mention unclear file boundaries when there is strong evidence',
    );
    expect(systemPrompt).toContain('If CodeTruncated is true');
    expect(systemPrompt).toContain('===== FILE: src/main.py =====');
    expect(systemPrompt).toContain('== file: main.py =====');
    expect(systemPrompt).toContain('=====FILE:src/main.py=====');
    expect(systemPrompt).toContain('File: package.json');
    expect(systemPrompt).toContain('文件：main.cpp');
    expect(systemPrompt).toContain('===== src/main.py =====');
    expect(systemPrompt).toContain('--- package.json ---');
    expect(systemPrompt).toContain('### App.vue');
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
      'Treat language as a weak hint. Infer language primarily from code features when needed.',
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
    expect(userPrompt).toContain(
      'Boundary rule: if the submission is mostly correct but still improvable, return one integrated item; return empty items only when truly nothing can be improved.',
    );
    expect(userPrompt).toContain('Language hint: typescript');
    expect(userPrompt).toContain(
      'Language hint may be missing or incorrect; prioritize code evidence for language-specific judgement.',
    );
  });

  it('includes multi-file convention guidance in user prompt', () => {
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

    expect(userPrompt).toContain('Multi-file convention');
    expect(userPrompt).toContain(
      'For normal single-file submissions without boundary markers',
    );
    expect(userPrompt).toContain('standard multi-file marker');
    expect(userPrompt).toContain('programming language is not limited');
    expect(userPrompt).toContain('relative path or only a plausible filename');
    expect(userPrompt).toContain('malformed but understandable variants');
    expect(userPrompt).toContain(
      'Analyze each inferred file block separately first',
    );
    expect(userPrompt).toContain(
      'Do not treat content from different inferred file blocks as if it belonged to one source file',
    );
  });
});
