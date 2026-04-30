import {
  IsArray,
  IsEnum,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FeedbackSeverity, FeedbackType } from '../schemas/feedback.schema';
import { FeedbackTag } from '../ai-feedback/lib/feedback-normalizer';

export class UpdateFeedbackDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(FeedbackType)
  type?: FeedbackType;

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(FeedbackSeverity)
  severity?: FeedbackSeverity;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  message?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  suggestion?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  tags?: FeedbackTag[];

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  scoreHint?: number;
}
