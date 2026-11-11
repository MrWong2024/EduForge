import { IsBooleanString, IsIn, IsOptional } from 'class-validator';

export const CLASSROOM_WEEKLY_REPORT_WINDOWS = ['7d', '30d', 'all'] as const;
export type ClassroomWeeklyReportWindow =
  (typeof CLASSROOM_WEEKLY_REPORT_WINDOWS)[number];

export class QueryClassroomWeeklyReportDto {
  @IsOptional()
  @IsIn(CLASSROOM_WEEKLY_REPORT_WINDOWS)
  window?: ClassroomWeeklyReportWindow;

  @IsOptional()
  @IsBooleanString()
  includeRiskStudentIds?: string;
}
