import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const CLASSROOM_EXPORT_SNAPSHOT_WINDOWS = ['7d', '30d', 'term'] as const;
export type ClassroomExportSnapshotWindow =
  (typeof CLASSROOM_EXPORT_SNAPSHOT_WINDOWS)[number];

export class QueryClassroomExportSnapshotDto {
  @IsOptional()
  @IsIn(CLASSROOM_EXPORT_SNAPSHOT_WINDOWS)
  window?: ClassroomExportSnapshotWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limitStudents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limitAssessment?: number;

  @IsOptional()
  @IsBooleanString()
  includePerTask?: string;
}
