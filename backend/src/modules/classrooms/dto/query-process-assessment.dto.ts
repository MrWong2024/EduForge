import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PROCESS_ASSESSMENT_WINDOWS = ['7d', '30d', 'term'] as const;
export type ProcessAssessmentWindow =
  (typeof PROCESS_ASSESSMENT_WINDOWS)[number];

export const PROCESS_ASSESSMENT_SORT_FIELDS = [
  'score',
  'submissionsCount',
  'submittedTasksCount',
  'aiRequestedCount',
  'riskLevel',
] as const;
export type ProcessAssessmentSortField =
  (typeof PROCESS_ASSESSMENT_SORT_FIELDS)[number];

export const PROCESS_ASSESSMENT_SORT_ORDERS = ['asc', 'desc'] as const;
export type ProcessAssessmentSortOrder =
  (typeof PROCESS_ASSESSMENT_SORT_ORDERS)[number];

export class QueryProcessAssessmentDto {
  @IsOptional()
  @IsIn(PROCESS_ASSESSMENT_WINDOWS)
  window?: ProcessAssessmentWindow;

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
  @IsIn(PROCESS_ASSESSMENT_SORT_FIELDS)
  sort?: ProcessAssessmentSortField;

  @IsOptional()
  @IsIn(PROCESS_ASSESSMENT_SORT_ORDERS)
  order?: ProcessAssessmentSortOrder;
}
