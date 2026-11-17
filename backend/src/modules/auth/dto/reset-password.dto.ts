import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

const trimStringInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
};

export class ResetPasswordDto {
  @Transform(trimStringInput)
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  newPassword!: string;
}
