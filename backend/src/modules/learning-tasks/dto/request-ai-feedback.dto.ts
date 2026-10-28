import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestAiFeedbackDto {
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
