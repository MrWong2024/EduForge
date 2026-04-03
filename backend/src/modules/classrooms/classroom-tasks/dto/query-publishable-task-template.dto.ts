import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TASK_COURSE_LABELS } from '../../../learning-tasks/task-course-labels.constants';
import type { TaskCourseLabel } from '../../../learning-tasks/task-course-labels.constants';

const trimStringInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const toOptionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return value;
};

export class QueryPublishableTaskTemplateDto {
  @IsOptional()
  @Transform(trimStringInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  onlyMine?: boolean;

  @IsOptional()
  @Transform(trimStringInput)
  @IsString()
  knowledgeModule?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  stage?: number;

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
