import {
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TaskStatus } from '../schemas/task.schema';
import { TASK_COURSE_LABELS } from '../task-course-labels.constants';
import type { TaskCourseLabel } from '../task-course-labels.constants';
import { TASK_TEMPLATE_SCOPES } from '../task-template-visibility.constants';
import type { TaskTemplateScope } from '../task-template-visibility.constants';
import { TASK_DIFFICULTY_FILTER_VALUES } from '../task-difficulty-filter.constants';
import type { TaskDifficultyFilter } from '../task-difficulty-filter.constants';

const trimCourseLabelInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const trimScopeInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
};

export class QueryTaskDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  knowledgeModule?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(TASK_DIFFICULTY_FILTER_VALUES)
  difficulty?: TaskDifficultyFilter;

  @IsOptional()
  @Transform(trimCourseLabelInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel;

  @IsOptional()
  @Transform(trimScopeInput)
  @IsIn(TASK_TEMPLATE_SCOPES)
  scope?: TaskTemplateScope;

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
