import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../schemas/feedback.schema';

export class CreateFeedbackDto {
  @IsEnum(FeedbackSource)
  source!: FeedbackSource;

  @IsEnum(FeedbackType)
  type!: FeedbackType;

  @IsEnum(FeedbackSeverity)
  severity!: FeedbackSeverity;

  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  suggestion?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scoreHint?: number;
}
