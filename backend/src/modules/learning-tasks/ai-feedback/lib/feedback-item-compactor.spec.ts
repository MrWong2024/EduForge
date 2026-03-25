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

  it('converts praise-only output into one improvement-oriented feedback', () => {
    const items: AiFeedbackItem[] = [
      buildItem({
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: '做得很好，逻辑清晰',
      }),
      buildItem({
        type: FeedbackType.Other,
        severity: FeedbackSeverity.Info,
        message: 'Great job overall',
      }),
    ];

    const compacted = compactAiFeedbackItems(items);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].severity).toBe(FeedbackSeverity.Info);
    expect(compacted[0].suggestion).toContain('测试');
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
