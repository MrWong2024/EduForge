import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AiFeedbackJobStatus } from '../ai-feedback/schemas/ai-feedback-job.schema';

export class QueryAiFeedbackJobsDto {
  @IsOptional()
  @IsEnum(AiFeedbackJobStatus)
  status?: AiFeedbackJobStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
