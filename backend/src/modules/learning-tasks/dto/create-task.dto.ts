import {
  IsIn,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TaskStatus } from '../schemas/task.schema';
import { TASK_COURSE_LABELS } from '../task-course-labels.constants';
import type { TaskCourseLabel } from '../task-course-labels.constants';
import { TASK_VISIBILITIES } from '../task-template-visibility.constants';
import type { TaskVisibility } from '../task-template-visibility.constants';

const trimCourseLabelInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const trimVisibilityInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed ? trimmed : undefined;
};

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  knowledgeModule!: string;

  @IsOptional()
  @Transform(trimCourseLabelInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel;

  @IsOptional()
  @Transform(trimVisibilityInput)
  @IsIn(TASK_VISIBILITIES)
  visibility?: TaskVisibility;

  @IsInt()
  @Min(1)
  @Max(4)
  stage!: number;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsObject()
  rubric?: Record<string, unknown>;

  @IsEnum(TaskStatus)
  status!: TaskStatus;
}
