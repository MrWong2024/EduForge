import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const LEARNING_TRAJECTORY_WINDOWS = ['24h', '7d', '30d'] as const;
export type LearningTrajectoryWindow =
  (typeof LEARNING_TRAJECTORY_WINDOWS)[number];

export const LEARNING_TRAJECTORY_SORT_FIELDS = [
  'latestAttemptAt',
  'attemptsCount',
  'errorRate',
  'notSubmitted',
] as const;
export type LearningTrajectorySortField =
  (typeof LEARNING_TRAJECTORY_SORT_FIELDS)[number];

export const LEARNING_TRAJECTORY_SORT_ORDERS = ['asc', 'desc'] as const;
export type LearningTrajectorySortOrder =
  (typeof LEARNING_TRAJECTORY_SORT_ORDERS)[number];

export class QueryLearningTrajectoryDto {
  @IsOptional()
  @IsIn(LEARNING_TRAJECTORY_WINDOWS)
  window?: LearningTrajectoryWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsIn(LEARNING_TRAJECTORY_SORT_FIELDS)
  sort?: LearningTrajectorySortField;

  @IsOptional()
  @IsIn(LEARNING_TRAJECTORY_SORT_ORDERS)
  order?: LearningTrajectorySortOrder;

  @IsOptional()
  @IsBooleanString()
  includeAttempts?: string;

  @IsOptional()
  @IsBooleanString()
  includeTagDetails?: string;
}
