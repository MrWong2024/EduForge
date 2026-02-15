import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SubmissionContentDto {
  @IsString()
  codeText!: string;

  @IsString()
  language!: string;
}

class SubmissionMetaDto {
  @IsOptional()
  @IsString()
  aiUsageDeclaration?: string;
}

export class CreateSubmissionDto {
  @ValidateNested()
  @Type(() => SubmissionContentDto)
  content!: SubmissionContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SubmissionMetaDto)
  meta?: SubmissionMetaDto;
}
