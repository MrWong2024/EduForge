import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  USER_PASSWORD_HASH_ROUNDS,
  USER_PASSWORD_MAX_LENGTH,
  USER_PASSWORD_MIN_LENGTH,
} from './password.constants';
import { UserStatus } from './schemas/user.schema';

export const normalizePasswordInput = (value: string): string => value.trim();

export const validateNewPassword = (
  value: string,
  fieldName = 'New password',
): string => {
  const normalized = normalizePasswordInput(value);
  if (!normalized) {
    throw new BadRequestException(`${fieldName} must not be blank`);
  }
  if (normalized.length < USER_PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at least ${USER_PASSWORD_MIN_LENGTH} characters`,
    );
  }
  if (normalized.length > USER_PASSWORD_MAX_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at most ${USER_PASSWORD_MAX_LENGTH} characters`,
    );
  }
  return normalized;
};

export const hashPassword = async (value: string): Promise<string> =>
  bcrypt.hash(value, USER_PASSWORD_HASH_ROUNDS);

export const comparePassword = async (
  plainText: string,
  passwordHash: string,
): Promise<boolean> => bcrypt.compare(plainText, passwordHash);

export const canUserAuthenticate = (status?: string): boolean =>
  status === UserStatus.Active;
