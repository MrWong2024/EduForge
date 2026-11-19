import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { TASK_COURSE_LABELS } from '../../learning-tasks/task-course-labels.constants';
import type { TaskCourseLabel } from '../../learning-tasks/task-course-labels.constants';

const trimCourseLabelInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export class CreateCourseDto {
  @IsString()
  @Matches(/\S/u)
  code!: string;

  @IsString()
  @Matches(/\S/u)
  name!: string;

  @IsString()
  @Matches(/\S/u)
  term!: string;

  @IsOptional()
  @Transform(trimCourseLabelInput)
  @IsIn(TASK_COURSE_LABELS)
  courseLabel?: TaskCourseLabel;
}
