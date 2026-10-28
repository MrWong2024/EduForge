import {
  IsArray,
  IsDefined,
  IsInt,
  IsEnum,
  Equals,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../schemas/feedback.schema';
import { FeedbackTag } from '../ai-feedback/lib/feedback-normalizer';

export class CreateFeedbackDto {
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;

  @Equals(FeedbackSource.Teacher)
  source!: FeedbackSource;

  @IsEnum(FeedbackType)
  type!: FeedbackType;

  @IsEnum(FeedbackSeverity)
  severity!: FeedbackSeverity;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  suggestion?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: FeedbackTag[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scoreHint?: number;
}
