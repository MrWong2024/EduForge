import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SubmissionContentDto } from './create-submission.dto';

export class UpdateSubmissionDto {
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SubmissionContentDto)
  content!: SubmissionContentDto;
}
