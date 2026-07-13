import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const AI_LEARNING_ANALYTICS_WINDOWS = ['all', '7d', '30d'] as const;
export type AiLearningAnalyticsWindow =
  (typeof AI_LEARNING_ANALYTICS_WINDOWS)[number];

const normalizeExcludedTaskIds = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = (Array.isArray(value) ? value : [value])
    .flatMap((rawValue) => String(rawValue).split(','))
    .map((taskId) => taskId.trim())
    .filter((taskId) => taskId.length > 0);

  return Array.from(new Set(normalized));
};

export class QueryAiLearningAnalyticsDto {
  @IsOptional()
  @IsIn(AI_LEARNING_ANALYTICS_WINDOWS)
  window?: AiLearningAnalyticsWindow;

  @IsOptional()
  @Transform(({ value }) => normalizeExcludedTaskIds(value))
  @IsArray()
  @IsMongoId({ each: true })
  excludedTaskIds?: string[];
}

export class QueryAiLearningAnalyticsStudentsDto extends QueryAiLearningAnalyticsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
