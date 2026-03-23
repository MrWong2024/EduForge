export const RUBRIC_DIMENSION_LABELS = {
  functionality: "功能完成度权重",
  correctness: "正确性权重",
  codeStyle: "代码规范权重",
  design: "设计/思路权重",
} as const;

type RubricDimensionKey = keyof typeof RUBRIC_DIMENSION_LABELS;

const hasRubricDimensionKey = (key: string): key is RubricDimensionKey =>
  Object.prototype.hasOwnProperty.call(RUBRIC_DIMENSION_LABELS, key);

export const getRubricDimensionLabel = (key: string): string => {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return "未命名维度";
  }
  if (hasRubricDimensionKey(normalizedKey)) {
    return RUBRIC_DIMENSION_LABELS[normalizedKey];
  }
  return normalizedKey;
};
