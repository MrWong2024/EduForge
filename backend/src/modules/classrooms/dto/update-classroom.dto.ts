import { IsEnum, IsString, Matches, ValidateIf } from 'class-validator';
import { ClassroomStatus } from '../schemas/classroom.schema';

export class UpdateClassroomDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ClassroomStatus)
  status?: ClassroomStatus;
}
