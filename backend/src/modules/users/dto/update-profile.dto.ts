import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  studentNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  employeeNo?: string;
}
