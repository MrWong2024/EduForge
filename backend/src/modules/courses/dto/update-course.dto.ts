import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { TASK_COURSE_LABELS } from '../../learning-tasks/task-course-labels.constants';
import type { TaskCourseLabel } from '../../learning-tasks/task-course-labels.constants';
import { CourseStatus } from '../schemas/course.schema';

const trimCourseLabelInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export class UpdateCourseDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  code?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  term?: string;

  @IsOptional()
  @Transform(trimCourseLabelInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(CourseStatus)
  status?: CourseStatus;
}
