import { ClassroomStatus } from '../schemas/classroom.schema';

export class ClassroomResponseDto {
  id!: string;
  courseId!: string;
  name!: string;
  teacherId!: string;
  joinCode!: string;
  status!: ClassroomStatus;
  studentIds?: string[];
  createdAt!: Date;
  updatedAt!: Date;
}
