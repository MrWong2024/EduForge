import { IsBooleanString, IsIn, IsOptional } from 'class-validator';

export const AI_METRICS_WINDOWS = ['1h', '24h', '7d'] as const;
export type AiMetricsWindow = (typeof AI_METRICS_WINDOWS)[number];

export class QueryAiMetricsDto {
  @IsOptional()
  @IsIn(AI_METRICS_WINDOWS)
  window?: AiMetricsWindow;

  @IsOptional()
  @IsBooleanString()
  includeTags?: string;
}
