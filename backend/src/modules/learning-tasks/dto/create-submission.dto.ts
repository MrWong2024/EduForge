import {
  IsOptional,
  IsDefined,
  IsObject,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubmissionContentDto {
  @IsString()
  codeText!: string;

  @IsString()
  language!: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  // Unicode regex counts code points, including variation selectors; validator.js
  // MaxLength ignores presentation selectors and would undercount this field.
  @Matches(/^[\s\S]{0,20000}$/u, {
    message:
      'submissionNote must be shorter than or equal to 20000 Unicode code points',
  })
  submissionNote?: string;
}

class SubmissionMetaDto {
  @IsOptional()
  @IsString()
  aiUsageDeclaration?: string;
}

export class CreateSubmissionDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SubmissionContentDto)
  content!: SubmissionContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SubmissionMetaDto)
  meta?: SubmissionMetaDto;
}
