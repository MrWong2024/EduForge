import { FeedbackSeverity, FeedbackType } from '../../schemas/feedback.schema';
import { AiFeedbackItem } from '../interfaces/ai-feedback-provider.interface';

type CompactOptions = {
  maxItems?: number;
};

type Cluster = {
  items: AiFeedbackItem[];
  type: FeedbackType;
  severity: FeedbackSeverity;
};

const DEFAULT_MAX_OUTPUT_ITEMS = 2;
const DEFAULT_MAX_ITEMS_ENV = 20;
const MIN_MAX_OUTPUT_ITEMS = 1;
const MERGED_TAG_LIMIT = 6;
const MESSAGE_SIMILARITY_THRESHOLD = 0.58;
const MESSAGE_NEAR_DUP_THRESHOLD = 0.42;

const SEVERITY_RANK: Record<FeedbackSeverity, number> = {
  [FeedbackSeverity.Error]: 3,
  [FeedbackSeverity.Warn]: 2,
  [FeedbackSeverity.Info]: 1,
};

const TYPE_RANK: Record<FeedbackType, number> = {
  [FeedbackType.Syntax]: 7,
  [FeedbackType.Bug]: 6,
  [FeedbackType.Security]: 5,
  [FeedbackType.Performance]: 4,
  [FeedbackType.Design]: 3,
  [FeedbackType.Style]: 2,
  [FeedbackType.Other]: 1,
};

const LOW_VALUE_INFO_PATTERNS = [
  /good job|great job|excellent|well done|looks good|nice work|clean code/i,
  /做得很好|很棒|不错|写得很好|整体很好|继续保持|表现很好|代码很好/u,
];

const BLOCKING_PATTERNS = [
  /syntax|compile|compiler|parse|runtime|cannot run|build fail|failed to run/i,
  /语法|编译|运行|无法执行|无法运行|报错|错误/u,
];

const SEMICOLON_PATTERNS = [
  /semicolon|missing ;/i,
  /分号|缺少;|缺少；|漏写分号/u,
];

const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');

const normalizeForCompare = (value: string) =>
  value
    .toLowerCase()
    .replace(/[，。！？；：,.!?;:()[\]{}'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string) => {
  const normalized = normalizeForCompare(value);
  if (!normalized) {
    return new Set<string>();
  }
  return new Set<string>(
    normalized.split(' ').filter((part) => part.length > 1),
  );
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const textSimilarity = (left: string, right: string) => {
  const a = normalizeForCompare(left);
  const b = normalizeForCompare(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b || a.includes(b) || b.includes(a)) {
    return 1;
  }
  return jaccardSimilarity(tokenize(a), tokenize(b));
};

const isBlockingIssue = (item: AiFeedbackItem) => {
  if (item.severity === FeedbackSeverity.Error) {
    return true;
  }
  const text = `${item.message} ${item.suggestion ?? ''}`;
  return BLOCKING_PATTERNS.some((pattern) => pattern.test(text));
};

const isLowValueInfo = (item: AiFeedbackItem) => {
  if (item.severity !== FeedbackSeverity.Info) {
    return false;
  }
  const text = `${item.message} ${item.suggestion ?? ''}`;
  return LOW_VALUE_INFO_PATTERNS.some((pattern) => pattern.test(text));
};

const hasActionableIssue = (items: AiFeedbackItem[]) =>
  items.some(
    (item) => item.severity !== FeedbackSeverity.Info || isBlockingIssue(item),
  );

const normalizeTags = (tags?: string[]) => {
  if (!tags || tags.length === 0) {
    return undefined;
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim();
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MERGED_TAG_LIMIT) {
      break;
    }
  }
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeScoreHint = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeItem = (item: AiFeedbackItem): AiFeedbackItem | null => {
  const message = cleanText(item.message ?? '');
  if (!message) {
    return null;
  }
  const suggestionRaw =
    typeof item.suggestion === 'string' ? cleanText(item.suggestion) : '';
  return {
    type: item.type,
    severity: item.severity,
    message,
    suggestion: suggestionRaw ? suggestionRaw : undefined,
    tags: normalizeTags(item.tags),
    scoreHint: normalizeScoreHint(item.scoreHint),
  };
};

const dedupeExact = (items: AiFeedbackItem[]) => {
  const seen = new Set<string>();
  const result: AiFeedbackItem[] = [];
  for (const item of items) {
    const key = [
      item.type,
      item.severity,
      normalizeForCompare(item.message),
      normalizeForCompare(item.suggestion ?? ''),
      (item.tags ?? []).join('|'),
    ].join('::');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
};

const issueScore = (item: AiFeedbackItem, clusterSize = 1) =>
  SEVERITY_RANK[item.severity] * 100 +
  TYPE_RANK[item.type] * 10 +
  Math.min(clusterSize, 9);

const pickPrimaryItem = (items: AiFeedbackItem[]) => {
  if (items.length === 0) {
    return null;
  }
  let best = items[0];
  for (let index = 1; index < items.length; index += 1) {
    const candidate = items[index];
    const bestScore = issueScore(best);
    const candidateScore = issueScore(candidate);
    if (candidateScore > bestScore) {
      best = candidate;
      continue;
    }
    if (
      candidateScore === bestScore &&
      candidate.message.length > best.message.length
    ) {
      best = candidate;
    }
  }
  return best;
};

const collectMergedSuggestion = (items: AiFeedbackItem[]) => {
  const suggestions = Array.from(
    new Set(
      items
        .map((item) => item.suggestion ?? '')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  if (suggestions.length === 0) {
    return undefined;
  }
  if (suggestions.length === 1) {
    return suggestions[0];
  }
  return `${suggestions[0]}；${suggestions[1]}`;
};

const isRepeatedSemicolonIssue = (items: AiFeedbackItem[]) => {
  if (items.length < 2) {
    return false;
  }
  if (!items.every((item) => item.type === FeedbackType.Syntax)) {
    return false;
  }
  let matched = 0;
  for (const item of items) {
    const text = `${item.message} ${item.suggestion ?? ''}`;
    if (SEMICOLON_PATTERNS.some((pattern) => pattern.test(text))) {
      matched += 1;
    }
  }
  return matched >= 2;
};

const isSemicolonIssue = (item: AiFeedbackItem) => {
  const text = `${item.message} ${item.suggestion ?? ''}`;
  return SEMICOLON_PATTERNS.some((pattern) => pattern.test(text));
};

const mergeCluster = (cluster: Cluster): AiFeedbackItem => {
  const primary = pickPrimaryItem(cluster.items) ?? cluster.items[0];
  const mergedTags = normalizeTags(
    cluster.items.flatMap((item) => item.tags ?? []),
  );
  const mergedSuggestion = collectMergedSuggestion(cluster.items);
  if (cluster.items.length === 1) {
    return {
      ...primary,
      tags: mergedTags,
      suggestion: mergedSuggestion ?? primary.suggestion,
    };
  }
  if (isRepeatedSemicolonIssue(cluster.items)) {
    return {
      type: FeedbackType.Syntax,
      severity: cluster.severity,
      message: '存在多处语句末尾缺少分号的问题，导致代码无法稳定编译或运行。',
      suggestion:
        mergedSuggestion ??
        '先统一补齐语句末尾分号，再重新编译并执行测试用例确认修复结果。',
      tags: mergedTags,
      scoreHint: primary.scoreHint,
    };
  }
  return {
    type: cluster.type,
    severity: cluster.severity,
    message: `${primary.message}（同类问题共 ${cluster.items.length} 处，已合并提示）`,
    suggestion: mergedSuggestion ?? primary.suggestion,
    tags: mergedTags,
    scoreHint: primary.scoreHint,
  };
};

const shouldMergeInCluster = (cluster: Cluster, candidate: AiFeedbackItem) => {
  if (
    cluster.type !== candidate.type ||
    cluster.severity !== candidate.severity
  ) {
    return false;
  }
  if (
    cluster.type === FeedbackType.Syntax &&
    cluster.items.some((item) => isSemicolonIssue(item)) &&
    isSemicolonIssue(candidate)
  ) {
    return true;
  }
  const primary = pickPrimaryItem(cluster.items) ?? cluster.items[0];
  return (
    textSimilarity(primary.message, candidate.message) >=
    MESSAGE_SIMILARITY_THRESHOLD
  );
};

const buildClusters = (items: AiFeedbackItem[]) => {
  const clusters: Cluster[] = [];
  for (const item of items) {
    let merged = false;
    for (const cluster of clusters) {
      if (!shouldMergeInCluster(cluster, item)) {
        continue;
      }
      cluster.items.push(item);
      merged = true;
      break;
    }
    if (merged) {
      continue;
    }
    clusters.push({ items: [item], type: item.type, severity: item.severity });
  }
  return clusters;
};

const isIndependentIssue = (
  primary: AiFeedbackItem,
  candidate: AiFeedbackItem,
) => {
  if (primary.type === candidate.type) {
    return false;
  }
  if (
    textSimilarity(primary.message, candidate.message) >=
    MESSAGE_NEAR_DUP_THRESHOLD
  ) {
    return false;
  }
  if (isLowValueInfo(candidate)) {
    return false;
  }
  return true;
};

const ensureImprovementForPraiseOnly = (item: AiFeedbackItem) => {
  if (!isLowValueInfo(item)) {
    return item;
  }
  const hasSuggestion =
    typeof item.suggestion === 'string' && item.suggestion.trim().length > 0;
  if (hasSuggestion) {
    return item;
  }
  return {
    ...item,
    message:
      '整体实现方向基本正确。建议继续完善边界条件、异常输入处理与代码可读性。',
    suggestion: '可补充 1-2 个边界测试用例，并检查命名与注释是否足够清晰。',
  };
};

const resolveMaxItems = (maxItems?: number) => {
  if (!Number.isFinite(maxItems)) {
    return DEFAULT_MAX_OUTPUT_ITEMS;
  }
  const value = Math.floor(maxItems ?? DEFAULT_MAX_ITEMS_ENV);
  return Math.max(
    MIN_MAX_OUTPUT_ITEMS,
    Math.min(DEFAULT_MAX_OUTPUT_ITEMS, value),
  );
};

export const compactAiFeedbackItems = (
  items: ReadonlyArray<AiFeedbackItem>,
  options?: CompactOptions,
): AiFeedbackItem[] => {
  const maxItems = resolveMaxItems(options?.maxItems);
  if (!items || items.length === 0) {
    return [];
  }

  const normalized = dedupeExact(
    items
      .map((item) => normalizeItem(item))
      .filter((item): item is AiFeedbackItem => item !== null),
  );
  if (normalized.length === 0) {
    return [];
  }

  const actionable = hasActionableIssue(normalized);
  const pruned = actionable
    ? normalized.filter((item) => !isLowValueInfo(item))
    : normalized;
  const workingItems = pruned.length > 0 ? pruned : normalized;
  const merged = buildClusters(workingItems)
    .map((cluster) => mergeCluster(cluster))
    .sort((left, right) => issueScore(right) - issueScore(left));
  if (merged.length === 0) {
    return [];
  }

  const selected: AiFeedbackItem[] = [merged[0]];
  if (maxItems > 1 && merged.length > 1) {
    for (let index = 1; index < merged.length; index += 1) {
      const candidate = merged[index];
      if (
        selected[0].severity === FeedbackSeverity.Error &&
        candidate.severity === FeedbackSeverity.Info
      ) {
        continue;
      }
      if (!isIndependentIssue(selected[0], candidate)) {
        continue;
      }
      selected.push(candidate);
      break;
    }
  }

  if (!actionable && selected.length > 0) {
    selected[0] = ensureImprovementForPraiseOnly(selected[0]);
  }

  return selected.slice(0, maxItems);
};
