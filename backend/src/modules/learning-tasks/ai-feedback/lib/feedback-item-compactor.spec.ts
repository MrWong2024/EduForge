import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import { AiFeedbackItem } from '../interfaces/ai-feedback-provider.interface';
import { compactAiFeedbackItems } from './feedback-item-compactor';

const buildItem = (partial: Partial<AiFeedbackItem>): AiFeedbackItem => ({
  type: FeedbackType.Other,
  severity: FeedbackSeverity.Info,
  message: 'default message',
  ...partial,
});

describe('compactAiFeedbackItems', () => {
  it('merges repeated semicolon syntax issues into one primary feedback', () => {
    const items: AiFeedbackItem[] = [
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 12 行缺少分号',
        suggestion: '补全分号',
      }),
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 26 行缺少分号',
        suggestion: '修复分号后再运行',
      }),
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 40 行也漏写分号',
      }),
    ];

    const compacted = compactAiFeedbackItems(items);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].type).toBe(FeedbackType.Syntax);
    expect(compacted[0].severity).toBe(FeedbackSeverity.Error);
    expect(compacted[0].message).toContain('多处');
    expect(compacted[0].message).toContain('分号');
  });

  it.each([
    {
      difference: 'case',
      firstSuggestion: '在 `foo()` 后补齐分号。',
      nextSuggestion: '在 `Foo()` 后补齐分号。',
    },
    {
      difference: 'operator',
      firstSuggestion: '将条件改为 `ready`。',
      nextSuggestion: '将条件改为 `!ready`。',
    },
  ])(
    'preserves $difference differences when merging suggestions',
    ({ firstSuggestion, nextSuggestion }) => {
      const compacted = compactAiFeedbackItems([
        buildItem({
          type: FeedbackType.Syntax,
          severity: FeedbackSeverity.Error,
          message: '第 12 行缺少分号',
          suggestion: firstSuggestion,
        }),
        buildItem({
          type: FeedbackType.Syntax,
          severity: FeedbackSeverity.Error,
          message: '第 26 行缺少分号',
          suggestion: nextSuggestion,
        }),
      ]);

      expect(compacted).toHaveLength(1);
      expect(compacted[0].suggestion).toBe(
        `${firstSuggestion}；${nextSuggestion}`,
      );
    },
  );

  it('drops low-value praise INFO when actionable error exists', () => {
    const items: AiFeedbackItem[] = [
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '存在语法错误，代码无法运行',
      }),
      buildItem({
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: '整体写得很好，继续保持',
      }),
      buildItem({
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Info,
        message: 'Good job, clean code!',
      }),
    ];

    const compacted = compactAiFeedbackItems(items);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].severity).toBe(FeedbackSeverity.Error);
    expect(compacted[0].message).toContain('语法错误');
  });

  it('keeps up to two independent issue categories', () => {
    const items: AiFeedbackItem[] = [
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: 'main 方法中存在括号不匹配，导致编译失败',
      }),
      buildItem({
        type: FeedbackType.Performance,
        severity: FeedbackSeverity.Warn,
        message: '排序逻辑使用了三层循环，时间复杂度偏高',
      }),
      buildItem({
        type: FeedbackType.Style,
        severity: FeedbackSeverity.Info,
        message: '代码写得不错',
      }),
    ];

    const compacted = compactAiFeedbackItems(items);

    expect(compacted).toHaveLength(2);
    expect(compacted[0].type).toBe(FeedbackType.Syntax);
    expect(compacted[1].type).toBe(FeedbackType.Performance);
  });

  it('preserves a supported affirmation without inventing a suggestion', () => {
    const message =
      '做得很好。空输入返回空结果；相同键按任务要求保留首次出现顺序。';
    const compacted = compactAiFeedbackItems([buildItem({ message })]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].severity).toBe(FeedbackSeverity.Info);
    expect(compacted[0].message).toBe(message);
    expect(compacted[0].suggestion).toBeUndefined();
  });

  it('preserves paragraphs and internal indentation while normalizing line endings', () => {
    const compacted = compactAiFeedbackItems([
      buildItem({
        message:
          '\r\n结论：输入判断符合要求。\r\n\r\n  依据：空集合有独立分支。\r\n',
        suggestion:
          '\r\n核对重复键：\r\n  - 输入两个相同键。\r\n  - 比较输出顺序。\r\n',
      }),
    ]);

    expect(compacted[0].message).toBe(
      '结论：输入判断符合要求。\n\n  依据：空集合有独立分支。',
    );
    expect(compacted[0].suggestion).toBe(
      '核对重复键：\n  - 输入两个相同键。\n  - 比较输出顺序。',
    );
  });

  it('deduplicates whitespace variants without flattening the retained display text', () => {
    const first = buildItem({
      type: FeedbackType.Bug,
      severity: FeedbackSeverity.Warn,
      message: 'Check empty input.\n\n  Preserve record order.',
      suggestion: 'Add an empty input case.\n  Compare record order.',
    });
    const compacted = compactAiFeedbackItems([
      first,
      {
        ...first,
        message: 'Check empty input. Preserve record order.',
        suggestion: 'Add an empty input case. Compare record order.',
      },
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].message).toBe(first.message);
    expect(compacted[0].suggestion).toBe(first.suggestion);
  });

  it('deduplicates merged suggestions by comparison key and preserves their display form', () => {
    const firstSuggestion = '补齐分号。\n  保留其他语句。';
    const nextSuggestion = '修复后编译。\n\n  核对原有输出。';
    const compacted = compactAiFeedbackItems([
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 12 行缺少分号',
        suggestion: firstSuggestion,
      }),
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 26 行缺少分号',
        suggestion: '补齐分号。 保留其他语句。',
      }),
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 40 行缺少分号',
        suggestion: nextSuggestion,
      }),
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '第 54 行缺少分号',
        suggestion: '仅保留前两段建议，不展示这一段。',
      }),
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].suggestion).toBe(
      `${firstSuggestion}；${nextSuggestion}`,
    );
  });

  it('keeps empty-array compatibility', () => {
    expect(compactAiFeedbackItems([])).toEqual([]);
  });

  it('respects maxItems=1 while preserving primary severity', () => {
    const items: AiFeedbackItem[] = [
      buildItem({
        type: FeedbackType.Syntax,
        severity: FeedbackSeverity.Error,
        message: '存在语法错误，无法编译',
      }),
      buildItem({
        type: FeedbackType.Design,
        severity: FeedbackSeverity.Warn,
        message: '职责拆分不清晰',
      }),
    ];

    const compacted = compactAiFeedbackItems(items, { maxItems: 1 });

    expect(compacted).toHaveLength(1);
    expect(compacted[0].severity).toBe(FeedbackSeverity.Error);
  });
});
