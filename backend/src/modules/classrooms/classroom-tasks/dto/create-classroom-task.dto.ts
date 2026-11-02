import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  ValidateNested,
  IsDateString,
} from 'class-validator';

class ClassroomTaskSettingsDto {
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;
}

export class CreateClassroomTaskDto {
  @IsMongoId()
  taskId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClassroomTaskSettingsDto)
  settings?: ClassroomTaskSettingsDto;
}
