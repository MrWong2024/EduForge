import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  USER_PASSWORD_MAX_LENGTH,
  USER_PASSWORD_MIN_LENGTH,
} from '../../users/password.constants';

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

  @Transform(trimStringInput)
  @IsString()
  @MinLength(USER_PASSWORD_MIN_LENGTH)
  @MaxLength(USER_PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
