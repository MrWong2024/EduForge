import { CourseStatus } from '../schemas/course.schema';

export class CourseResponseDto {
  id!: string;
  code!: string;
  name!: string;
  term!: string;
  courseLabel?: string;
  status!: CourseStatus;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
