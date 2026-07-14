import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES,
  AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES,
} from '../types/ai-learning-analytics.types';
import type {
  AiLearningAnalyticsEngagementStatus,
  AiLearningAnalyticsOverallOutcome,
} from '../types/ai-learning-analytics.types';

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

const normalizeSearchQuery = (value: unknown): unknown => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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

  @IsOptional()
  @Transform(({ value }) => normalizeSearchQuery(value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(AI_LEARNING_ANALYTICS_OVERALL_OUTCOMES)
  overallOutcome?: AiLearningAnalyticsOverallOutcome;

  @IsOptional()
  @IsIn(AI_LEARNING_ANALYTICS_ENGAGEMENT_STATUSES)
  engagementStatus?: AiLearningAnalyticsEngagementStatus;
}
