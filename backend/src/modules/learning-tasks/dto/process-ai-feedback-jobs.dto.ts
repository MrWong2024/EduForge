import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ProcessAiFeedbackJobsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  batchSize?: number;
}
