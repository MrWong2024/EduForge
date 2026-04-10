import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ClassroomStatus } from '../schemas/classroom.schema';

export class UpdateClassroomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ClassroomStatus)
  status?: ClassroomStatus;
}
