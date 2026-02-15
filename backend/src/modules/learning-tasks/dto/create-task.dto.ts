import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TaskStatus } from '../schemas/task.schema';

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  knowledgeModule!: string;

  @IsInt()
  @Min(1)
  @Max(4)
  stage!: number;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsObject()
  rubric?: Record<string, unknown>;

  @IsEnum(TaskStatus)
  status!: TaskStatus;
}
