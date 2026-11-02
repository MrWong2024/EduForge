import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  ValidateIf,
} from 'class-validator';

const toNullWhenEmpty = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class UpdateClassroomTaskDto {
  @IsOptional()
  @Transform(({ value }) => toNullWhenEmpty(value as unknown))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  dueAt?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  allowLate?: boolean;
}
