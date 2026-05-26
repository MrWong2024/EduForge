import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

const trimEmailInput = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim().toLowerCase();
};

export class ForgotPasswordDto {
  @Transform(trimEmailInput)
  @IsString()
  @IsEmail()
  email!: string;
}
