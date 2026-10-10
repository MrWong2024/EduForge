import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  ValidateNested,
  Min,
  IsDateString,
  IsEnum,
  ValidateIf,
} from 'class-validator';

import { AiFeedbackMode } from '../classroom-task-content';

class ClassroomTaskSettingsDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsEnum(AiFeedbackMode)
  aiFeedbackMode?: AiFeedbackMode;

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
