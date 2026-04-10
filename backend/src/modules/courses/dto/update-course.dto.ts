import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
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
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @Transform(trimCourseLabelInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel | null;

  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;
}
