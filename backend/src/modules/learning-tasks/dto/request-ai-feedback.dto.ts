import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestAiFeedbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
