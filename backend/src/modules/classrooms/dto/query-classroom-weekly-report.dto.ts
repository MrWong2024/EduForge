import { IsBooleanString, IsIn, IsOptional } from 'class-validator';

export const CLASSROOM_WEEKLY_REPORT_WINDOWS = ['1h', '24h', '7d'] as const;
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
