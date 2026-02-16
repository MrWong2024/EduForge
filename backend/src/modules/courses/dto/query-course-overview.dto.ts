import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const COURSE_OVERVIEW_WINDOWS = ['1h', '24h', '7d'] as const;
export type CourseOverviewWindow = (typeof COURSE_OVERVIEW_WINDOWS)[number];

export const COURSE_OVERVIEW_SORT_FIELDS = [
  'studentsCount',
  'submissionRate',
  'aiSuccessRate',
  'pendingJobs',
  'failedJobs',
] as const;
export type CourseOverviewSortField =
  (typeof COURSE_OVERVIEW_SORT_FIELDS)[number];

export const COURSE_OVERVIEW_SORT_ORDERS = ['asc', 'desc'] as const;
export type CourseOverviewSortOrder =
  (typeof COURSE_OVERVIEW_SORT_ORDERS)[number];

export class QueryCourseOverviewDto {
  @IsOptional()
  @IsIn(COURSE_OVERVIEW_WINDOWS)
  window?: CourseOverviewWindow;

  @IsOptional()
  @IsIn(COURSE_OVERVIEW_SORT_FIELDS)
  sort?: CourseOverviewSortField;

  @IsOptional()
  @IsIn(COURSE_OVERVIEW_SORT_ORDERS)
  order?: CourseOverviewSortOrder;

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
}
