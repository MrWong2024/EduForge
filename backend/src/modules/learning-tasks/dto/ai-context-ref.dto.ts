import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AI_CONTEXT_LIMITS } from '../ai-context/ai-context.types';

export class AiContextRefDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AI_CONTEXT_LIMITS.pathChars)
  archivePath!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_CONTEXT_LIMITS.files)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(AI_CONTEXT_LIMITS.pathChars, { each: true })
  entryPaths!: string[];
}

export class TaskAiContextDto {
  // IsOptional would also skip null, which is deliberately not a clear action.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(AI_CONTEXT_LIMITS.archives)
  @ArrayUnique((reference: AiContextRefDto | null) => reference?.archivePath)
  @ValidateNested({ each: true })
  @Type(() => AiContextRefDto)
  aiContextRefs?: AiContextRefDto[];
}
