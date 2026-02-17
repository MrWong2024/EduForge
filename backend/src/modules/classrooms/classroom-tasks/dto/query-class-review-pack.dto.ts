import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const CLASS_REVIEW_PACK_WINDOWS = ['24h', '7d', '30d'] as const;
export type ClassReviewPackWindow = (typeof CLASS_REVIEW_PACK_WINDOWS)[number];

export class QueryClassReviewPackDto {
  @IsOptional()
  @IsIn(CLASS_REVIEW_PACK_WINDOWS)
  window?: ClassReviewPackWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  topK?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  examplesPerTag?: number;

  @IsOptional()
  @IsBooleanString()
  includeStudentTiers?: string;

  @IsOptional()
  @IsBooleanString()
  includeTeacherScript?: string;
}
