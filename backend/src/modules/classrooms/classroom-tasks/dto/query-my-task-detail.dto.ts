import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryMyTaskDetailDto {
  @IsOptional()
  @IsBooleanString()
  includeFeedbackItems?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  feedbackLimit?: number;
}
