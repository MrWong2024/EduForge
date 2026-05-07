import { ClassroomStatus } from '../schemas/classroom.schema';

export class ClassroomCourseSummaryDto {
  id!: string;
  code?: string;
  name?: string;
  term?: string;
  courseLabel?: string;
  status?: string;
}

export class ClassroomResponseDto {
  id!: string;
  courseId!: string;
  course?: ClassroomCourseSummaryDto;
  name!: string;
  teacherId!: string;
  joinCode!: string;
  status!: ClassroomStatus;
  studentIds?: string[];
  createdAt!: Date;
  updatedAt!: Date;
}
