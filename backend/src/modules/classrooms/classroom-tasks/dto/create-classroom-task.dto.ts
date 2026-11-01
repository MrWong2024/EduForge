import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';

class ClassroomTaskSettingsDto {
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;
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
