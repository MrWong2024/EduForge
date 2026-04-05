import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
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

  @IsOptional()
  @Transform(({ value }) => toNullWhenEmpty(value as unknown))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  maxAttempts?: number | null;
}
